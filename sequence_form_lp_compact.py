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
from typing import Dict, Tuple

import numpy as np

from sequence_form_lp import (
    FEASIBILITY_TOLERANCE,
    INFORMATION_MODEL,
    O,
    X,
    Rules,
    SequenceCatalog,
    bit,
    build_sequence_game,
    parse_hidden,
    certify_equilibrium,
    solve_equilibrium,
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
    """Export every positive action; ``tol`` is retained for API compatibility.

    A positive cutoff is not a realization-equivalent support reduction. Older
    versions applied this argument to small positive parents and actions; it no
    longer removes either. Only exactly unreachable information sets are absent.
    """
    if not np.isfinite(tol) or tol < 0:
        raise ValueError("Policy tolerance must be finite and nonnegative")
    return compact_policy_and_realization(catalog, realization)[0]


def compact_policy_and_realization(
    catalog: SequenceCatalog,
    realization: np.ndarray,
    *,
    _all_infos: bool = False,
) -> Tuple[Dict[str, Dict[str, float]], np.ndarray]:
    """Build the table and the realization plan actually played by its reader.

    Information sets are registered before their descendants. Reconstructing
    own reach in that order makes zero-reach omission exact, and lets the caller
    certify the normalized exported policy rather than only the raw LP vector.
    Small negative LP roundoff is clipped, but no positive weight is discarded.
    """
    realization = np.asarray(realization, dtype=float)
    if realization.shape != (catalog.n_sequences,):
        raise ValueError("Realization vector has the wrong shape")
    if not np.isfinite(realization).all():
        raise ValueError("Realization vector contains nonfinite weights")
    if np.min(realization) < -FEASIBILITY_TOLERANCE:
        raise ValueError("Realization vector contains negative weights beyond LP tolerance")
    if abs(float(realization[0]) - 1.0) > FEASIBILITY_TOLERANCE:
        raise ValueError("The empty sequence must have realization weight one")

    policy: Dict[str, Dict[str, float]] = {}
    reconstructed = np.zeros(catalog.n_sequences, dtype=float)
    reconstructed[0] = 1.0
    supported_infos = getattr(catalog, "iter_supported_infos", None)
    infos = (supported_infos(realization) if supported_infos is not None and not _all_infos
             else catalog.infos.items())
    for key, info in infos:
        parent = float(reconstructed[info.parent_sequence])
        if parent == 0.0:
            continue
        # Dividing by the positive sum is algebraically equivalent to dividing
        # by the parent and then normalizing, without overflow at tiny parents.
        weights = [max(0.0, float(realization[child])) for child in info.child_sequences]
        total = sum(weights)
        if total == 0.0:
            if supported_infos is not None and not _all_infos:
                # Completing a numerically empty positive branch can introduce
                # new support. In this unusual case inspect the complete catalog
                # so those newly reachable descendants also receive a policy.
                return compact_policy_and_realization(catalog, realization, _all_infos=True)
            # Feasibility roundoff can leave a tiny positive parent without any
            # positive child. Complete it uniformly, then require the final
            # reconstructed strategy to pass the equilibrium certificate.
            weights = [1.0] * len(info.actions)
            total = float(len(weights))
        probabilities = {}
        for action, child, weight in zip(info.actions, info.child_sequences, weights):
            if weight == 0.0:
                continue
            probability = weight / total
            child_weight = parent * probability
            if probability == 0.0 or child_weight == 0.0:
                raise FloatingPointError("Positive behavioral support underflowed during export")
            probabilities[str(action)] = probability
            reconstructed[child] = child_weight
        policy[key] = probabilities
    return policy, reconstructed


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hidden", type=parse_hidden, required=True, help="1-based mystery cells, e.g. 2,4")
    parser.add_argument("--start", choices=("O", "X"), default="O")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--node-limit", type=int, default=0)
    parser.add_argument(
        "--enumerator", choices=("auto", "python", "native"), default="auto",
        help="Exact enumeration backend (auto selects the native accelerator when available).",
    )
    parser.add_argument(
        "--policy-tol", type=float, default=0.0,
        help="Deprecated compatibility option; positive policy support is always retained.",
    )
    args = parser.parse_args()
    if not np.isfinite(args.policy_tol) or args.policy_tol < 0:
        parser.error("--policy-tol must be finite and nonnegative")
    if args.policy_tol != 0:
        log_progress("--policy-tol is deprecated: retaining every positive policy weight for exact export.")

    hidden_mask = sum(bit(move) for move in args.hidden)
    rules = Rules(hidden_mask=hidden_mask, start_player=O if args.start == "O" else X)
    started = time.perf_counter()
    log_progress(f"Started enumeration for hidden={tuple(m + 1 for m in args.hidden)}, start={args.start}...")
    game = build_sequence_game(rules, node_limit=args.node_limit, backend=args.enumerator)
    log_progress(
        f"Finished enumeration ({time.perf_counter() - started:.1f}s): "
        f"histories={game.histories:,}, terminals={game.terminals:,}, "
        f"O infos={len(game.o.infos):,}, X infos={len(game.x.infos):,}, "
        f"O sequences={game.o.n_sequences:,}, X sequences={game.x.n_sequences:,}"
    )

    lp_started = time.perf_counter()
    log_progress("Solving primal-dual maximin LP for both players...")
    x_o, x_x, lower_o, upper_o, result = solve_equilibrium(game)
    log_progress(f"Solved and certified both players ({time.perf_counter() - lp_started:.1f}s; "
                 f"{time.perf_counter() - started:.1f}s since enumeration started)")
    gap = max(0.0, upper_o - lower_o)
    value = 0.5 * (lower_o + upper_o)

    export_started = time.perf_counter()
    log_progress("Constructing and certifying the exported behavioral strategies...")
    policy_o, exported_o = compact_policy_and_realization(game.o, x_o)
    policy_x, exported_x = compact_policy_and_realization(game.x, x_x)
    certificate = certify_equilibrium(game, exported_o, exported_x, result)
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
        "numericallySolved": bool(result.success),
        "policyTolerance": 0.0,
        "certificate": certificate,
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
            "Complete unabstracted sequence-form LP; both players are recovered from its primal-dual solution.",
            "Mystery-cell attempts reveal the actor's attempted location but not success/failure.",
            "Policy entries with zero parent realization are omitted because their behavioral completion does not affect the realization plan.",
            "A stable fallback at omitted information sets is realization-equivalent to this equilibrium strategy.",
            "Every positive behavioral probability is retained; only exactly zero own-reach information sets are omitted.",
            "The certificate checks the realization plans reconstructed from the exported behavioral strategies.",
            "Numerical LP solutions are exact only up to solver feasibility/optimality tolerances.",
        ],
    }

    write_artifact(args.output, artifact)
    log_progress(f"Finished behavioral export and certificate ({time.perf_counter() - export_started:.1f}s)")
    log_progress(f"Wrote {args.output} ({args.output.stat().st_size / 1024 / 1024:.2f} MiB)")
    print(
        f"Stored support infos: O={len(policy_o):,}/{len(game.o.infos):,}, "
        f"X={len(policy_x):,}/{len(game.x.infos):,}"
    )
    print(f"O value interval: [{lower_o:.12g}, {upper_o:.12g}]  gap={gap:.3e}")


if __name__ == "__main__":
    main()
