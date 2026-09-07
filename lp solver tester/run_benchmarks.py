#!/usr/bin/env python3
"""Run the original exact LP solver and experimental exact alternatives.

Default benchmark set: two 2-hidden masks and two 3-hidden masks, all chosen to
have nontrivial D4 stabilizers so the symmetry quotient is meaningfully tested.
Results are written as timestamped JSON/CSV plus results/latest.{json,csv}.
"""
from __future__ import annotations

import argparse
import csv
from datetime import datetime, timezone
import gc
import json
import os
from pathlib import Path
import platform
import sys
import time
import traceback
from typing import Any, Callable, Dict, List, Tuple

import numpy as np
import scipy

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import sequence_form_lp as prod
from common import ACCURACY_TOL, MethodUnavailable, Outcome, production_baseline, validate_outcome
from methods import constraint_generation, double_oracle, highspy_hipo, scipy_variant, symmetry_quotient

# Two geometrically distinct 2-hidden masks and two distinct 3-hidden masks.
# Each has a nontrivial stabilizer, allowing method 7 to be benchmarked too.
DEFAULT_CASES = (
    ("two_top_corners", (1, 3)),
    ("two_opposite_corners", (1, 9)),
    ("three_top_row", (1, 2, 3)),
    ("three_main_diagonal", (1, 5, 9)),
)


def hidden_mask(cells: Tuple[int, ...]) -> int:
    return sum(1 << (cell - 1) for cell in cells)


def environment() -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "timestampUtc": datetime.now(timezone.utc).isoformat(),
        "python": sys.version,
        "platform": platform.platform(),
        "machine": platform.machine(),
        "processor": platform.processor(),
        "cpuCount": os.cpu_count(),
        "numpy": np.__version__,
        "scipy": scipy.__version__,
        "informationModel": prod.INFORMATION_MODEL,
        "solverTolerance": prod.FEASIBILITY_TOLERANCE,
        "accuracyTolerance": ACCURACY_TOL,
    }
    try:
        import highspy
        payload["highspy"] = getattr(highspy, "__version__", "installed")
    except ImportError:
        payload["highspy"] = None
    try:
        import highspy_extras
        payload["highspyExtras"] = getattr(highspy_extras, "__version__", "installed")
    except ImportError:
        payload["highspyExtras"] = None
    return payload


def flatten_for_csv(row: Dict[str, Any]) -> Dict[str, Any]:
    validation = row.get("validation") or {}
    metadata = row.get("metadata") or {}
    return {
        "case": row.get("case"),
        "hiddenCells": ",".join(map(str, row.get("hiddenCells", []))),
        "hiddenCount": row.get("hiddenCount"),
        "hiddenMask": row.get("hiddenMask"),
        "startPlayer": row.get("startPlayer"),
        "method": row.get("method"),
        "status": row.get("status"),
        "solveSeconds": row.get("solveSeconds"),
        "accurate": validation.get("accurate"),
        "value": validation.get("value"),
        "referenceValueError": validation.get("referenceValueError"),
        "exploitabilityGap": validation.get("exploitabilityGap"),
        "flowResidualO": validation.get("flowResidualO"),
        "flowResidualX": validation.get("flowResidualX"),
        "error": row.get("error"),
        "metadata": json.dumps(metadata, separators=(",", ":"), sort_keys=True),
    }


def write_results(payload: Dict[str, Any], output_dir: Path) -> Tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    json_path = output_dir / f"benchmark-{stamp}.json"
    csv_path = output_dir / f"benchmark-{stamp}.csv"
    text = json.dumps(payload, indent=2, sort_keys=True, allow_nan=False)
    json_path.write_text(text + "\n", encoding="utf-8")
    (output_dir / "latest.json").write_text(text + "\n", encoding="utf-8")

    rows = [flatten_for_csv(row) for row in payload["runs"]]
    fieldnames = list(rows[0]) if rows else []
    for destination in (csv_path, output_dir / "latest.csv"):
        with destination.open("w", newline="", encoding="utf-8") as stream:
            writer = csv.DictWriter(stream, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)
    return json_path, csv_path


def run_one(
    case_name: str,
    cells: Tuple[int, ...],
    start_name: str,
    method_name: str,
    solve: Callable[[], Outcome],
    game: prod.SequenceGame,
    reference_value: float | None,
) -> Dict[str, Any]:
    prefix = {
        "case": case_name,
        "hiddenCells": list(cells),
        "hiddenCount": len(cells),
        "hiddenMask": hidden_mask(cells),
        "startPlayer": start_name,
        "method": method_name,
    }
    print(f"  -> {method_name}", flush=True)
    started = time.perf_counter()
    try:
        outcome = solve()
        elapsed = time.perf_counter() - started
        validation = validate_outcome(game, outcome, reference_value)
        print(
            f"     {elapsed:.3f}s | accurate={validation['accurate']} | "
            f"value={validation.get('value')} | gap={validation.get('exploitabilityGap')}",
            flush=True,
        )
        return {
            **prefix,
            "status": "ok",
            "solveSeconds": elapsed,
            "validation": validation,
            "metadata": outcome.metadata,
        }
    except MethodUnavailable as error:
        elapsed = time.perf_counter() - started
        print(f"     unavailable: {error}", flush=True)
        return {
            **prefix,
            "status": "unavailable",
            "solveSeconds": elapsed,
            "validation": {"accurate": None, "reason": "method unavailable"},
            "metadata": {},
            "error": str(error),
        }
    except Exception as error:
        elapsed = time.perf_counter() - started
        print(f"     ERROR: {error}", flush=True)
        return {
            **prefix,
            "status": "error",
            "solveSeconds": elapsed,
            "validation": {"accurate": False, "reason": "method raised an exception"},
            "metadata": {},
            "error": f"{type(error).__name__}: {error}",
            "traceback": traceback.format_exc(),
        }
    finally:
        gc.collect()


def parse_threads(text: str) -> Tuple[int, ...]:
    values = tuple(dict.fromkeys(int(part.strip()) for part in text.split(",") if part.strip()))
    if not values or any(value <= 0 for value in values):
        raise argparse.ArgumentTypeError("threads must be positive integers, e.g. 4,8")
    return values


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", choices=("O", "X"), default="O")
    parser.add_argument("--enumerator", choices=("native", "python", "auto"), default="native")
    parser.add_argument("--hipo-threads", type=parse_threads, default=(4, 8), help="method 2 thread counts")
    parser.add_argument("--no-crossover-threads", type=int, default=4, help="method 3 HiPO thread count")
    parser.add_argument("--time-limit", type=float, default=0.0, help="HiPO per-solve limit; 0 means unlimited")
    parser.add_argument("--constraint-max-iterations", type=int, default=200)
    parser.add_argument("--double-oracle-max-iterations", type=int, default=100)
    parser.add_argument("--output-dir", type=Path, default=HERE / "results")
    parser.add_argument(
        "--methods",
        default="baseline,1,2,3,4,5,7",
        help="comma-separated subset of baseline,1,2,3,4,5,7",
    )
    args = parser.parse_args()
    selected = {part.strip() for part in args.methods.split(",") if part.strip()}
    unknown = selected - {"baseline", "1", "2", "3", "4", "5", "7"}
    if unknown:
        parser.error(f"unknown methods: {sorted(unknown)}")
    if args.no_crossover_threads <= 0:
        parser.error("--no-crossover-threads must be positive")

    payload: Dict[str, Any] = {
        "schema": 1,
        "description": "Tic-Tac-Nope exact LP solver benchmark",
        "environment": environment(),
        "cases": [
            {"name": name, "hiddenCells": list(cells), "hiddenMask": hidden_mask(cells)}
            for name, cells in DEFAULT_CASES
        ],
        "runs": [],
    }

    start_player = prod.O if args.start == "O" else prod.X
    for case_name, cells in DEFAULT_CASES:
        mask = hidden_mask(cells)
        print(f"\n=== {case_name}: hidden={cells}, mask={mask}, start={args.start} ===", flush=True)
        enum_started = time.perf_counter()
        game = prod.build_sequence_game(
            prod.Rules(mask, start_player), backend=args.enumerator
        )
        enum_seconds = time.perf_counter() - enum_started
        print(
            f"enumerated in {enum_seconds:.3f}s | histories={game.histories:,} | "
            f"O seq={game.o.n_sequences:,} | X seq={game.x.n_sequences:,}",
            flush=True,
        )
        case_record = {
            "case": case_name,
            "hiddenCells": list(cells),
            "hiddenMask": mask,
            "startPlayer": args.start,
            "enumerationSeconds": enum_seconds,
            "histories": int(game.histories),
            "terminals": int(game.terminals),
            "informationSetsO": int(len(game.o.infos)),
            "informationSetsX": int(len(game.x.infos)),
            "sequencesO": int(game.o.n_sequences),
            "sequencesX": int(game.x.n_sequences),
        }
        payload.setdefault("caseDimensions", []).append(case_record)

        reference_value = None
        if "baseline" in selected:
            baseline_row = run_one(
                case_name,
                cells,
                args.start,
                "original_current",
                lambda: production_baseline(game),
                game,
                None,
            )
            baseline_row["enumerationSeconds"] = enum_seconds
            payload["runs"].append(baseline_row)
            if baseline_row["status"] != "ok" or not baseline_row["validation"].get("accurate"):
                print("Baseline failed validation; skipping comparisons for this case.", flush=True)
                continue
            reference_value = float(baseline_row["validation"]["value"])
        else:
            print("WARNING: baseline omitted; methods will be checked by exploitability but not value agreement.")

        method_calls: List[Tuple[str, Callable[[], Outcome]]] = []
        if "1" in selected:
            method_calls.extend([
                ("method1_highs_ds", lambda: scipy_variant(game, "highs-ds")),
                ("method1_highs_ipm", lambda: scipy_variant(game, "highs-ipm")),
            ])
        if "2" in selected:
            for thread_count in args.hipo_threads:
                method_calls.append((
                    f"method2_highspy_hipo_t{thread_count}",
                    lambda t=thread_count: highspy_hipo(
                        game,
                        threads=t,
                        crossover=True,
                        name=f"method2_highspy_hipo_t{t}",
                        time_limit=args.time_limit,
                    ),
                ))
        if "3" in selected:
            method_calls.append((
                f"method3_highspy_hipo_no_crossover_t{args.no_crossover_threads}",
                lambda: highspy_hipo(
                    game,
                    threads=args.no_crossover_threads,
                    crossover=False,
                    name=f"method3_highspy_hipo_no_crossover_t{args.no_crossover_threads}",
                    time_limit=args.time_limit,
                ),
            ))
        if "4" in selected:
            method_calls.append((
                "method4_constraint_generation",
                lambda: constraint_generation(
                    game, max_iterations=args.constraint_max_iterations
                ),
            ))
        if "5" in selected:
            method_calls.append((
                "method5_double_oracle",
                lambda: double_oracle(
                    game, max_iterations=args.double_oracle_max_iterations
                ),
            ))
        if "7" in selected:
            method_calls.append(("method7_symmetry_quotient", lambda: symmetry_quotient(game)))

        for method_name, solve in method_calls:
            row = run_one(
                case_name,
                cells,
                args.start,
                method_name,
                solve,
                game,
                reference_value,
            )
            row["enumerationSeconds"] = enum_seconds
            payload["runs"].append(row)

        # Save after every case so a long benchmark remains useful if interrupted.
        write_results(payload, args.output_dir)
        del game
        gc.collect()

    json_path, csv_path = write_results(payload, args.output_dir)
    successful = [row for row in payload["runs"] if row["status"] == "ok"]
    inaccurate = [row for row in successful if row["validation"].get("accurate") is False]
    print(f"\nSaved JSON: {json_path}")
    print(f"Saved CSV:  {csv_path}")
    print(f"Successful runs: {len(successful)}; inaccurate successful runs: {len(inaccurate)}")
    return 1 if inaccurate else 0


if __name__ == "__main__":
    raise SystemExit(main())
