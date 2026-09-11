#!/usr/bin/env python3
"""Expensive smoke test for the full native + SciPy exact-solver path.

Solves three complete two-hidden-cell games from scratch and checks their
certified value intervals against the committed exact-equilibrium artifacts.
This is intentionally not part of the normal pytest suite because each case
contains millions of histories and million-scale sequence-form LPs.

Run from the repository root:
    python tests/smoke_scipy_two_hidden.py
"""
from __future__ import annotations

import json
import math
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import sequence_form_lp as lp

CASES = (
    (3, (1, 2)),
    (5, (1, 3)),
    (10, (2, 4)),
)
TOLERANCE = 5e-7


def _reference(mask: int) -> dict:
    path = ROOT / "web" / "equilibria" / "exact" / f"mask-{mask}-O.json"
    artifact = json.loads(path.read_text(encoding="utf-8"))
    if artifact.get("informationModel") != lp.INFORMATION_MODEL:
        raise RuntimeError(f"{path} uses a stale information model")
    if artifact.get("numericallySolved") is not True:
        raise RuntimeError(f"{path} is not a solved exact artifact")
    return artifact


def _close(actual: float, expected: float, label: str) -> None:
    if not math.isclose(actual, expected, rel_tol=0.0, abs_tol=TOLERANCE):
        raise AssertionError(f"{label}: got {actual:.12g}, expected {expected:.12g}")


def main() -> None:
    total_started = time.perf_counter()
    for index, (mask, cells) in enumerate(CASES, start=1):
        print("=" * 72, flush=True)
        print(f"[{index}/{len(CASES)}] hidden={cells}, start=O, backend=native+scipy", flush=True)
        reference = _reference(mask)

        started = time.perf_counter()
        game = lp.build_sequence_game(lp.Rules(mask, lp.O), backend="native")
        build_seconds = time.perf_counter() - started

        counts = reference["counts"]
        expected_counts = {
            "histories": game.histories,
            "terminals": game.terminals,
            "informationSetsO": len(game.o.infos),
            "informationSetsX": len(game.x.infos),
            "sequencesO": game.o.n_sequences,
            "sequencesX": game.x.n_sequences,
        }
        for key, actual in expected_counts.items():
            if int(counts[key]) != int(actual):
                raise AssertionError(f"mask={mask} {key}: got {actual:,}, expected {int(counts[key]):,}")

        solve_started = time.perf_counter()
        _, _, lower, upper, result = lp.solve_equilibrium(game, backend="scipy")
        solve_seconds = time.perf_counter() - solve_started

        _close(lower, float(reference["lowerBoundO"]), f"mask={mask} lower bound")
        _close(upper, float(reference["upperBoundO"]), f"mask={mask} upper bound")
        _close(0.5 * (lower + upper), float(reference["valueO"]), f"mask={mask} value")
        if result.certificate["exploitabilityGap"] > lp.FEASIBILITY_TOLERANCE:
            raise AssertionError(
                f"mask={mask} exploitability gap={result.certificate['exploitabilityGap']:.3e}"
            )

        print(
            f"PASS mask={mask}: value={0.5 * (lower + upper):.12g}, "
            f"build={build_seconds:.2f}s, solve+certificate={solve_seconds:.2f}s",
            flush=True,
        )

    print("=" * 72, flush=True)
    print(f"PASS all {len(CASES)} SciPy smoke cases in {time.perf_counter() - total_started:.2f}s", flush=True)


if __name__ == "__main__":
    main()
