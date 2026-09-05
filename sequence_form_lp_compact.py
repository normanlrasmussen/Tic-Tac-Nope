#!/usr/bin/env python3
"""Compact exact sequence-form LP exporter for batch website precomputation.

It solves the same complete unabstracted sequence-form LP as sequence_form_lp.py,
but omits behavioral-policy entries whose parent realization weight is zero.
Those information sets are unreachable because of the player's own earlier
zero-probability action, so any behavioral completion there is realization-
equivalent. The website may use a stable fallback such as uniform play.
"""

from __future__ import annotations

import argparse
import json
import os
import tempfile
import time
from datetime import datetime
from pathlib import Path
from typing import Dict

import numpy as np

from sequence_form_lp import (
    INFORMATION_MODEL,
    O,
    X,
    Rules,
    SequenceCatalog,
    bit,
    build_sequence_game,
    parse_hidden,
    solve_max_player,
)


def log_progress(message: str) -> None:
    print(f"[{datetime.now().astimezone().isoformat(timespec='seconds')}] {message}", flush=True)


def write_artifact(path: Path, artifact: dict) -> None:
    """Publish only complete JSON, so an interrupted write remains resumable."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                         prefix=path.name + ".", suffix=".tmp", delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(artifact, stream, separators=(",", ":"), allow_nan=False)
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def compact_behavioral_policy(
    catalog: SequenceCatalog,
    realization: np.ndarray,
    tol: float = 1e-10,
) -> Dict[str, Dict[str, float]]:
    policy: Dict[str, Dict[str, float]] = {}
    for key, info in catalog.infos.items():
        parent = float(realization[info.parent_sequence])
        if parent <= tol:
            continue
        probs = np.maximum(0.0, realization[list(info.child_sequences)] / parent)
        total = float(probs.sum())
        if total <= tol:
            continue
        probs /= total
        policy[key] = {str(a): float(p) for a, p in zip(info.actions, probs) if p > tol}
    return policy


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hidden", type=parse_hidden, required=True, help="1-based mystery cells, e.g. 2,4")
    parser.add_argument("--start", choices=("O", "X"), default="O")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--node-limit", type=int, default=0)
    parser.add_argument("--policy-tol", type=float, default=1e-10)
    args = parser.parse_args()

    hidden_mask = sum(bit(move) for move in args.hidden)
    rules = Rules(hidden_mask=hidden_mask, start_player=O if args.start == "O" else X)
    started = time.perf_counter()
    log_progress(f"Started enumeration for hidden={tuple(m + 1 for m in args.hidden)}, start={args.start}...")
    game = build_sequence_game(rules, node_limit=args.node_limit)
    log_progress(
        f"Finished enumeration ({time.perf_counter() - started:.1f}s): "
        f"histories={game.histories:,}, terminals={game.terminals:,}, "
        f"O infos={len(game.o.infos):,}, X infos={len(game.x.infos):,}, "
        f"O sequences={game.o.n_sequences:,}, X sequences={game.x.n_sequences:,}"
    )

    lp_started = time.perf_counter()
    log_progress("Solving O maximin LP...")
    x_o, lower_o, result_o = solve_max_player(game.o, game.x, game.payoff)
    log_progress(f"Solved O maximin LP ({time.perf_counter() - lp_started:.1f}s)")
    x_started = time.perf_counter()
    log_progress("Solving X maximin LP...")
    x_x, lower_x, result_x = solve_max_player(game.x, game.o, -game.payoff.T.tocsr())
    log_progress(f"Solved X maximin LP ({time.perf_counter() - x_started:.1f}s)")
    log_progress(f"Finished both LP solves ({time.perf_counter() - lp_started:.1f}s; "
                 f"{time.perf_counter() - started:.1f}s since enumeration started)")
    upper_o = -lower_x
    gap = max(0.0, upper_o - lower_o)
    value = 0.5 * (lower_o + upper_o)

    policy_o = compact_behavioral_policy(game.o, x_o, args.policy_tol)
    policy_x = compact_behavioral_policy(game.x, x_x, args.policy_tol)
    artifact = {
        "schema": 2,
        "solver": "scipy.optimize.linprog(method='highs')",
        "game": "Tic-Tac-Nope",
        "informationModel": INFORMATION_MODEL,
        "hidden": [move + 1 for move in args.hidden],
        "hiddenMask": hidden_mask,
        "startPlayer": args.start,
        "valueO": value,
        "lowerBoundO": lower_o,
        "upperBoundO": upper_o,
        "dualityGap": gap,
        "numericallySolved": bool(result_o.success and result_x.success),
        "policyTolerance": args.policy_tol,
        "counts": {
            "histories": game.histories,
            "terminals": game.terminals,
            "informationSetsO": len(game.o.infos),
            "informationSetsX": len(game.x.infos),
            "sequencesO": game.o.n_sequences,
            "sequencesX": game.x.n_sequences,
            "storedInformationSetsO": len(policy_o),
            "storedInformationSetsX": len(policy_x),
        },
        "policy": {"O": policy_o, "X": policy_x},
        "notes": [
            "Complete unabstracted sequence-form LP; only the exported behavioral table is support-pruned.",
            "Mystery-cell attempts reveal the actor's attempted location but not success/failure.",
            "Policy entries with zero parent realization are omitted because their behavioral completion does not affect the realization plan.",
            "A stable fallback at omitted information sets is realization-equivalent to this equilibrium strategy.",
            "Numerical LP solutions are exact only up to solver feasibility/optimality tolerances.",
        ],
    }

    write_artifact(args.output, artifact)
    log_progress(f"Wrote {args.output} ({args.output.stat().st_size / 1024 / 1024:.2f} MiB)")
    print(
        f"Stored support infos: O={len(policy_o):,}/{len(game.o.infos):,}, "
        f"X={len(policy_x):,}/{len(game.x.infos):,}"
    )
    print(f"O value interval: [{lower_o:.12g}, {upper_o:.12g}]  gap={gap:.3e}")


if __name__ == "__main__":
    main()