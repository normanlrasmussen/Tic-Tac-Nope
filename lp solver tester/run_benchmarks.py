#!/usr/bin/env python3
"""Benchmark the production exact LP backends on two-hidden-cell games.

Each candidate runs in a fresh subprocess so Linux VmHWM is not inherited from
earlier candidates.  Only direct highspy simplex, auto, and the SciPy fallback
are supported here; no IPM/HiPO or Double Oracle methods are included.
"""

from __future__ import annotations

import argparse
import csv
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import traceback
from typing import Any

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import sequence_form_lp as lp
from common import certificate_summary, environment, flatten_run, memory_status


DEFAULT_CASES = (("two_top_corners", (1, 3)), ("two_opposite_corners", (1, 9)))


def parse_cells(text: str) -> tuple[int, int]:
    values = tuple(sorted(int(part.strip()) for part in text.split(",") if part.strip()))
    if len(values) != 2 or any(value < 1 or value > 9 for value in values):
        raise argparse.ArgumentTypeError("cases must contain exactly two cells in 1..9, e.g. 1,3")
    return values


def parse_csv(text: str) -> tuple[str, ...]:
    values = tuple(part.strip() for part in text.split(",") if part.strip())
    if not values:
        raise argparse.ArgumentTypeError("provide at least one value")
    return values


def hidden_mask(cells: tuple[int, int]) -> int:
    return sum(lp.bit(cell - 1) for cell in cells)


def worker(args: argparse.Namespace) -> int:
    cells = parse_cells(args.case)
    mask = hidden_mask(cells)
    start_player = lp.O if args.start == "O" else lp.X
    enum_started = time.perf_counter()
    game = lp.build_sequence_game(
        lp.Rules(mask, start_player), backend=args.enumerator
    )
    enum_seconds = time.perf_counter() - enum_started
    solve_started = time.perf_counter()
    try:
        _, _, lower, upper, result = lp.solve_equilibrium(game, backend=args.backend)
        solve_seconds = time.perf_counter() - solve_started
        certificate = certificate_summary(result.certificate)
        timings = dict(getattr(result, "timings", {}))
        timings["totalSeconds"] = solve_seconds
        dimensions = {
            "lpVariables": int(game.o.n_sequences + game.x.n_constraints),
            "lpRows": int(len(game.o.infos) + 1 + game.x.n_sequences),
            "payoffNnz": int(game.payoff.nnz),
            "fullLpVariables": int(game.o.n_sequences + game.x.n_constraints),
            "fullLpRows": int(len(game.o.infos) + 1 + game.x.n_sequences),
            "fullPayoffNnz": int(game.payoff.nnz),
            "oSequences": int(game.o.n_sequences),
            "xSequences": int(game.x.n_sequences),
        }
        if "reducedOSequences" in timings:
            dimensions.update({
                "lpVariables": int(timings["reducedOSequences"] + timings["reducedXRows"]),
                "lpRows": int(timings["reducedORows"] + timings["reducedXSequences"]),
                "payoffNnz": int(timings["reducedPayoffNnz"]),
            })
        payload: dict[str, Any] = {
            "status": "ok" if certificate["passed"] else "certificate-failed",
            "case": args.case,
            "hiddenCells": list(cells),
            "backend": args.backend,
            "enumerationSeconds": enum_seconds,
            "timings": timings,
            "dimensions": dimensions,
            "certificate": certificate,
            "lowerBound": float(lower),
            "upperBound": float(upper),
            "value": 0.5 * (float(lower) + float(upper)),
            "solverBackend": str(getattr(result, "solver_backend", "unknown")),
            "memory": memory_status(),
        }
    except Exception as error:
        payload = {
            "status": "error",
            "case": args.case,
            "hiddenCells": list(cells),
            "backend": args.backend,
            "enumerationSeconds": enum_seconds,
            "timings": {"totalSeconds": time.perf_counter() - solve_started},
            "memory": memory_status(),
            "error": f"{type(error).__name__}: {error}",
            "traceback": traceback.format_exc(),
        }
    Path(args.worker_report).write_text(
        json.dumps(payload, indent=2, sort_keys=True, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    print(
        f"worker {args.backend} case={args.case} status={payload['status']} "
        f"total={payload.get('timings', {}).get('totalSeconds', float('nan')):.3f}s "
        f"peak={payload.get('memory', {}).get('peakRssMiB', float('nan')):.1f} MiB",
        flush=True,
    )
    return 0 if payload["status"] == "ok" else 1


def run_child(
    case_name: str,
    cells: tuple[int, int],
    backend: str,
    start: str,
    enumerator: str,
    settings: dict[str, str],
    timeout: float | None,
) -> dict[str, Any]:
    with tempfile.NamedTemporaryFile(prefix="ttn-lp-", suffix=".json", delete=False) as stream:
        report = Path(stream.name)
    env = os.environ.copy()
    env.update(settings)
    command = [
        sys.executable,
        str(Path(__file__).resolve()),
        "--worker",
        "--worker-report", str(report),
        "--case", ",".join(map(str, cells)),
        "--backend", backend,
        "--start", start,
        "--enumerator", enumerator,
    ]
    started = time.perf_counter()
    try:
        completed = subprocess.run(command, env=env, check=False, timeout=timeout)
        elapsed = time.perf_counter() - started
        if report.exists() and report.stat().st_size:
            row = json.loads(report.read_text(encoding="utf-8"))
        else:
            row = {
                "status": "error",
                "error": f"worker produced no report (exit={completed.returncode})",
            }
        row["processSeconds"] = elapsed
        row["case"] = case_name
        row["backend"] = backend
        row["settings"] = settings
        if completed.returncode != 0 and row.get("status") == "ok":
            row["status"] = "error"
            row["error"] = f"worker exited with status {completed.returncode}"
        return row
    except subprocess.TimeoutExpired:
        return {
            "status": "timeout",
            "case": case_name,
            "backend": backend,
            "settings": settings,
            "processSeconds": time.perf_counter() - started,
            "error": f"candidate exceeded timeout of {timeout:.3f}s",
        }
    finally:
        report.unlink(missing_ok=True)


def write_results(payload: dict[str, Any], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    text = json.dumps(payload, indent=2, sort_keys=True, allow_nan=False) + "\n"
    (output_dir / f"benchmark-{stamp}.json").write_text(text, encoding="utf-8")
    (output_dir / "latest.json").write_text(text, encoding="utf-8")
    rows = [flatten_run(row) for row in payload["runs"]]
    fields = list(rows[0]) if rows else []
    for destination in (output_dir / f"benchmark-{stamp}.csv", output_dir / "latest.csv"):
        with destination.open("w", newline="", encoding="utf-8") as stream:
            writer = csv.DictWriter(stream, fieldnames=fields)
            writer.writeheader()
            writer.writerows(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--worker-report", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--case", default="1,3")
    parser.add_argument("--backend", default="highspy", help=argparse.SUPPRESS)
    parser.add_argument("--start", choices=("O", "X"), default="O")
    parser.add_argument("--enumerator", choices=("native", "auto", "python"), default="native")
    parser.add_argument("--backends", default="highspy,auto")
    parser.add_argument("--simplex-modes", default="choose,dual")
    parser.add_argument("--chunk-sizes", default="50000")
    parser.add_argument("--cache-payoff-transpose", choices=("off", "on"), default="off")
    parser.add_argument("--cases", default="1,3;1,9", help="semicolon-separated two-cell cases")
    parser.add_argument("--output-dir", type=Path, default=HERE / "results")
    parser.add_argument("--timeout-multiplier", type=float, default=2.0)
    parser.add_argument("--baseline-timeout", type=float, default=3600.0)
    args = parser.parse_args()

    if args.worker:
        if args.worker_report is None:
            parser.error("--worker-report is required in worker mode")
        return worker(args)

    backends = parse_csv(args.backends)
    modes = parse_csv(args.simplex_modes)
    try:
        chunks = tuple(int(value) for value in parse_csv(args.chunk_sizes))
    except ValueError as error:
        parser.error(f"invalid --chunk-sizes: {error}")
    if any(value <= 0 for value in chunks):
        parser.error("chunk sizes must be positive")
    if args.timeout_multiplier <= 1.0 or args.baseline_timeout <= 0:
        parser.error("timeout multiplier must exceed 1 and baseline timeout must be positive")

    cases: list[tuple[str, tuple[int, int]]] = []
    for index, text in enumerate(args.cases.split(";"), start=1):
        cells = parse_cells(text)
        name = dict(DEFAULT_CASES).get(cells)
        cases.append((name or f"two_hidden_{index}", cells))

    configurations: list[tuple[str, str, dict[str, str]]] = []
    for backend in backends:
        if backend not in {"highspy", "auto", "scipy", "highspy-reduced"}:
            parser.error(f"unsupported backend {backend!r}")
        backend_modes = modes if backend in {"highspy", "auto", "highspy-reduced"} else ("choose",)
        for mode in backend_modes:
            for chunk in chunks:
                settings = {
                    "TTN_HIGHS_SIMPLEX_MODE": mode,
                    "TTN_HIGHS_CHUNK_COLS": str(chunk),
                    "TTN_HIGHS_CACHE_PAYOFF_TRANSPOSE": args.cache_payoff_transpose,
                }
                name = f"{backend}-{mode}-chunk{chunk}"
                configurations.append((name, backend, settings))

    payload: dict[str, Any] = {
        "schema": 2,
        "description": "Exact LP backend benchmark; direct HiGHS simplex only",
        "environment": environment(),
        "cases": [{"name": name, "hiddenCells": list(cells)} for name, cells in cases],
        "configurations": [
            {"name": name, "backend": backend, "settings": settings}
            for name, backend, settings in configurations
        ],
        "runs": [],
    }

    for case_name, cells in cases:
        baseline_seconds: float | None = None
        for config_name, backend, settings in configurations:
            timeout = args.baseline_timeout if baseline_seconds is None else args.timeout_multiplier * baseline_seconds
            print(
                f"=== {case_name} hidden={cells} config={config_name} "
                f"timeout={timeout:.1f}s ===",
                flush=True,
            )
            row = run_child(
                case_name, cells, backend, args.start, args.enumerator, settings, timeout
            )
            row["configuration"] = config_name
            row["simplexMode"] = settings["TTN_HIGHS_SIMPLEX_MODE"]
            row["chunkColumns"] = int(settings["TTN_HIGHS_CHUNK_COLS"])
            row["payoffTransposeCached"] = settings["TTN_HIGHS_CACHE_PAYOFF_TRANSPOSE"] in {"1", "on", "true"}
            payload["runs"].append(row)
            write_results(payload, args.output_dir)
            if baseline_seconds is None and row.get("status") == "ok":
                baseline_seconds = float(row.get("timings", {}).get("totalSeconds", row["processSeconds"]))
            print(
                f"result status={row.get('status')} process={row.get('processSeconds', float('nan')):.3f}s",
                flush=True,
            )

    print(f"wrote benchmark results to {args.output_dir}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
