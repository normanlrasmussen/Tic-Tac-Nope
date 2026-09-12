#!/usr/bin/env python3
"""Run every production LP backend on two random two-hidden-cell games.

This is intentionally a standalone smoke test rather than a normal unit test:
each complete two-hidden-cell game can contain millions of histories.

Run from the repository root:
    python tests/smoke_all_lp_backends.py

Use ``--seed`` to reproduce a different pair of layouts.
"""

from __future__ import annotations

import argparse
import gc
import random
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import sequence_form_lp as lp


BACKENDS = ("scipy", "highspy", "auto")


def random_cases(seed: int, count: int) -> list[tuple[int, tuple[int, int]]]:
    rng = random.Random(seed)
    cases = []
    seen = set()
    while len(cases) < count:
        cells = tuple(sorted(rng.sample(range(9), 2)))
        if cells in seen:
            continue
        seen.add(cells)
        mask = sum(lp.bit(cell) for cell in cells)
        cases.append((mask, tuple(cell + 1 for cell in cells)))
    return cases


def run_backend(game: lp.SequenceGame, backend: str) -> float | None:
    started = time.perf_counter()
    try:
        _, _, lower, upper, result = lp.solve_equilibrium(game, backend=backend)
    except ModuleNotFoundError as error:
        if backend == "highspy":
            print(f"  {backend:7s} UNAVAILABLE: {error}", flush=True)
            return None
        raise

    elapsed = time.perf_counter() - started
    gap = max(0.0, upper - lower)
    certificate_gap = result.certificate["exploitabilityGap"]
    if gap > lp.FEASIBILITY_TOLERANCE or certificate_gap > lp.FEASIBILITY_TOLERANCE:
        raise RuntimeError(
            f"{backend} certificate failed: duality_gap={gap:.3e}, "
            f"exploitability_gap={certificate_gap:.3e}"
        )
    print(
        f"  {backend:7s} PASS solver={result.solver_backend:<24s} "
        f"value={0.5 * (lower + upper): .12g} "
        f"interval=[{lower:.12g}, {upper:.12g}] "
        f"gap={gap:.3e} time={elapsed:.2f}s",
        flush=True,
    )
    return elapsed


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=int, default=20260911)
    parser.add_argument("--cases", type=int, default=2)
    args = parser.parse_args()
    if args.cases <= 0:
        parser.error("--cases must be positive")

    cases = random_cases(args.seed, args.cases)
    total_started = time.perf_counter()
    backend_totals = {backend: 0.0 for backend in BACKENDS}
    backend_runs = {backend: 0 for backend in BACKENDS}
    print(f"Seed: {args.seed}; backends: {', '.join(BACKENDS)}", flush=True)
    for index, (mask, cells) in enumerate(cases, start=1):
        print("=" * 88, flush=True)
        print(f"[{index}/{len(cases)}] hidden={cells}, start=O, mask={mask}", flush=True)
        build_started = time.perf_counter()
        game = lp.build_sequence_game(lp.Rules(mask, lp.O), backend="native")
        print(
            f"  build    PASS histories={game.histories:,} "
            f"terminals={game.terminals:,} "
            f"O_sequences={game.o.n_sequences:,} X_sequences={game.x.n_sequences:,} "
            f"time={time.perf_counter() - build_started:.2f}s",
            flush=True,
        )
        for backend in BACKENDS:
            elapsed = run_backend(game, backend)
            if elapsed is not None:
                backend_totals[backend] += elapsed
                backend_runs[backend] += 1
        del game
        gc.collect()

    print("=" * 88, flush=True)
    print(
        f"Completed {len(cases)} cases across {len(BACKENDS)} backends "
        f"in {time.perf_counter() - total_started:.2f}s",
        flush=True,
    )
    print("Total backend time:", flush=True)
    for backend in BACKENDS:
        if backend_runs[backend]:
            print(
                f"  {backend:7s} {backend_totals[backend]:.2f}s "
                f"({backend_runs[backend]} run(s))",
                flush=True,
            )
        else:
            print(f"  {backend:7s} unavailable", flush=True)


if __name__ == "__main__":
    main()
