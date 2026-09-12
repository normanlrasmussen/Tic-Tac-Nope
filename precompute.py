#!/usr/bin/env python3
"""One-command precompute entrypoint.

Uses precompute_all.py for symmetry enumeration / resume / manifests, but routes
exact solves through the compact support-pruned sequence-form exporter.
"""

from __future__ import annotations

import json
import os
import shutil
import sys
from pathlib import Path

import precompute_all as batch
from sequence_form_lp import INFORMATION_MODEL

_lp_backend = "auto"

_DEFAULT_BATCH_ARGS = (
    "--mode", "all",
    "--solvers", "exact",
    "--lp-backend", "auto",
    "--keep-going",
)


def _extract_lp_backend(argv: list[str]) -> tuple[str, list[str]]:
    """Remove precompute.py's compact-solver-only backend option from argv.

    precompute_all.py owns the common batch CLI. This wrapper consumes the
    extra exact-LP option before delegating to that parser, while preserving it
    across the keep-awake re-exec below.
    """
    backend = "auto"
    cleaned = [argv[0]]
    index = 1
    while index < len(argv):
        argument = argv[index]
        if argument == "--lp-backend":
            if index + 1 >= len(argv):
                raise SystemExit("--lp-backend requires one of: auto, highspy, scipy")
            value = argv[index + 1]
            index += 2
        elif argument.startswith("--lp-backend="):
            value = argument.split("=", 1)[1]
            index += 1
        else:
            cleaned.append(argument)
            index += 1
            continue
        if value not in ("auto", "highspy", "scipy"):
            raise SystemExit(
                f"invalid --lp-backend {value!r}; choose auto, highspy, or scipy"
            )
        backend = value
    return backend, cleaned


def _apply_default_arguments(argv: list[str]) -> list[str]:
    """Add the safe production defaults while preserving explicit overrides."""
    if any(argument in ("--help", "-h") for argument in argv[1:]):
        return list(argv)

    result = list(argv)
    options = set(argv[1:])
    if not any(argument == "--mode" or argument.startswith("--mode=") for argument in argv[1:]):
        result.extend(_DEFAULT_BATCH_ARGS[0:2])
    if not any(argument == "--solvers" or argument.startswith("--solvers=") for argument in argv[1:]):
        result.extend(_DEFAULT_BATCH_ARGS[2:4])
    if not any(argument == "--lp-backend" or argument.startswith("--lp-backend=") for argument in argv[1:]):
        result.extend(_DEFAULT_BATCH_ARGS[4:6])
    if "--keep-going" not in options:
        result.append("--keep-going")
    return result


def keep_awake() -> None:
    """Re-execute under a Linux inhibitor held for the entire batch lifetime."""
    marker = "TIC_TAC_NOPE_SLEEP_INHIBITED"
    if os.environ.pop(marker, None) == "1":
        print("Keep-awake active for this batch; normal power settings resume on exit.", flush=True)
        return
    if "--help" in sys.argv or "-h" in sys.argv:
        return
    inhibitor = shutil.which("systemd-inhibit")
    if not sys.platform.startswith("linux") or inhibitor is None:
        raise SystemExit("Keep-awake requires Linux with systemd-inhibit installed.")
    print("Requesting sleep, idle, lid-close and shutdown inhibition for this batch...", flush=True)
    command = [
        inhibitor,
        "--what=sleep:idle:shutdown:handle-lid-switch",
        "--mode=block",
        "--who=Tic-Tac-Nope precompute",
        "--why=Computing exact equilibrium web data",
        "--",
        sys.executable, str(Path(__file__).resolve()), *sys.argv[1:],
    ]
    environment = os.environ.copy()
    environment[marker] = "1"
    os.execve(inhibitor, command, environment)


def artifact_matches_information_model(artifact: dict) -> bool:
    return (
        artifact.get("schema") == 2
        and artifact.get("numericallySolved") is True
        and artifact.get("informationModel") == INFORMATION_MODEL
    )


def artifact_matches_requested_lp_backend(artifact: dict) -> bool:
    """Honor an explicitly requested backend when deciding whether to reuse output."""
    if _lp_backend == "auto":
        return True
    solver = str(artifact.get("solver", "")).lower()
    if _lp_backend == "scipy":
        # Accept both the current name and legacy SciPy/linprog artifact labels.
        return "scipy" in solver
    return solver.startswith("highspy")


def solve_exact_compact(mask: int, start: str, node_limit: int, force: bool) -> Path:
    """Solve one exact start-player configuration; never synthesize its counterpart."""
    out = batch.EXACT_DIR / f"mask-{mask}-{start}.json"
    if out.exists() and not force:
        try:
            existing = json.loads(out.read_text(encoding="utf-8"))
        except (ValueError, TypeError, OSError):
            existing = None
        if isinstance(existing, dict) and artifact_matches_information_model(existing):
            if artifact_matches_requested_lp_backend(existing):
                print(f"SKIP exact  mask={mask:03d} start={start}  ({out.name} is current)")
                return out
            print(
                f"STALE exact mask={mask:03d} start={start}  "
                f"({out.name} backend={existing.get('solver')!r}, requested={_lp_backend}; recomputing)"
            )
        else:
            print(f"STALE exact mask={mask:03d} start={start}  ({out.name} uses an older information model; recomputing)")

    cells = ",".join(map(str, batch.mask_cells(mask)))
    command = [
        sys.executable,
        str(batch.ROOT / "sequence_form_lp_compact.py"),
        "--hidden", cells,
        "--start", start,
        # Production batch solves use the native exact enumerator. Failing loudly
        # is safer than silently switching enumerators during a long batch.
        "--enumerator", "native",
        "--lp-backend", _lp_backend,
        "--output", str(out),
    ]
    if node_limit:
        command += ["--node-limit", str(node_limit)]
    batch.run_command(command)
    return out


batch.solve_exact = solve_exact_compact

if __name__ == "__main__":
    sys.argv[:] = _apply_default_arguments(sys.argv)
    keep_awake()
    _lp_backend, cleaned_argv = _extract_lp_backend(sys.argv)
    sys.argv[:] = cleaned_argv
    if "--help" in sys.argv or "-h" in sys.argv:
        print("precompute.py exact-solver option: --lp-backend {auto,highspy,scipy}\n")
    elif _lp_backend != "auto":
        print(f"Exact LP backend forced to: {_lp_backend}", flush=True)
    batch.main()
