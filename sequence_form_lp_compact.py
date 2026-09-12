#!/usr/bin/env python3
"""Compact exact sequence-form LP exporter for batch website precomputation."""
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
    FEASIBILITY_TOLERANCE, INFORMATION_MODEL, O, X, Rules, SequenceCatalog,
    bit, build_sequence_game, parse_hidden, certify_equilibrium, solve_equilibrium,
)


def log_progress(message: str) -> None:
    print(f"[{datetime.now().astimezone().isoformat(timespec='seconds')}] {message}", flush=True)


def write_artifact(path: Path, artifact: dict) -> None:
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


def compact_behavioral_policy(catalog: SequenceCatalog, realization: np.ndarray,
                              tol: float = 1e-10) -> Dict[str, Dict[str, float]]:
    if not np.isfinite(tol) or tol < 0:
        raise ValueError("Policy tolerance must be finite and nonnegative")
    return compact_policy_and_realization(catalog, realization)[0]


def compact_policy_and_realization(catalog: SequenceCatalog, realization: np.ndarray) -> Tuple[Dict[str, Dict[str, float]], np.ndarray]:
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
    infos = supported_infos(realization) if supported_infos is not None else catalog.infos.items()
    for key, info in infos:
        parent = float(reconstructed[info.parent_sequence])
        if parent == 0.0:
            continue
        weights = [max(0.0, float(realization[child])) for child in info.child_sequences]
        total = sum(weights)
        if not total > 0.0:
            raise RuntimeError(
                "Exact policy export encountered a positive-reach information set "
                f"with zero outgoing realization mass: {key}"
            )
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
        if not probabilities:
            raise RuntimeError(f"Exact policy export produced empty support at {key}")
        policy[key] = probabilities
    return policy, reconstructed


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hidden", type=parse_hidden, required=True, help="1-based mystery cells, e.g. 2,4")
    parser.add_argument("--start", choices=("O", "X"), default="O")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--node-limit", type=int, default=0)
    parser.add_argument("--enumerator", choices=("auto", "python", "native"), default="auto",
                        help="Exact enumeration backend (auto selects the native accelerator when available).")
    parser.add_argument("--lp-backend", choices=("auto", "highspy", "scipy", "highspy-reduced"), default="auto",
                        help="auto prefers streaming highspy; highspy-reduced is an opt-in exact flow reduction")
    parser.add_argument("--policy-tol", type=float, default=0.0,
                        help="Deprecated compatibility option; positive policy support is always retained.")
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
        f"Finished enumeration ({time.perf_counter() - started:.1f}s): histories={game.histories:,}, "
        f"terminals={game.terminals:,}, O infos={len(game.o.infos):,}, X infos={len(game.x.infos):,}, "
        f"O sequences={game.o.n_sequences:,}, X sequences={game.x.n_sequences:,}, payoff nnz={game.payoff.nnz:,}"
    )

    lp_started = time.perf_counter()
    log_progress(f"Solving primal-dual maximin LP using backend={args.lp_backend}...")
    x_o, x_x, lower_o, upper_o, result = solve_equilibrium(game, backend=args.lp_backend)
    log_progress(f"Solved and certified both players ({time.perf_counter() - lp_started:.1f}s; "
                 f"{time.perf_counter() - started:.1f}s since enumeration started; "
                 f"backend={getattr(result, 'solver_backend', 'HiGHS')})")
    gap = max(0.0, upper_o - lower_o)
    value = 0.5 * (lower_o + upper_o)

    export_started = time.perf_counter()
    log_progress("Constructing and certifying the exported behavioral strategies...")
    policy_o, exported_o = compact_policy_and_realization(game.o, x_o)
    policy_x, exported_x = compact_policy_and_realization(game.x, x_x)
    certificate = certify_equilibrium(game, exported_o, exported_x, result)
    artifact = {
        "schema": 2,
        "solver": getattr(result, "solver_backend", "HiGHS"),
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
            "histories": game.histories, "terminals": game.terminals,
            "informationSetsO": len(game.o.infos), "informationSetsX": len(game.x.infos),
            "sequencesO": game.o.n_sequences, "sequencesX": game.x.n_sequences,
            "payoffNnz": int(game.payoff.nnz),
            "storedInformationSetsO": len(policy_o), "storedInformationSetsX": len(policy_x),
        },
        "policy": {"O": policy_o, "X": policy_x},
        "notes": [
            "Complete unabstracted sequence-form LP; both players are recovered from its primal-dual solution.",
            "Mystery-cell attempts reveal the actor's attempted location but not success/failure.",
            "Policy entries with zero parent realization are omitted because their behavioral completion does not affect the realization plan.",
            "Every positive behavioral probability is retained; only exactly zero own-reach information sets are omitted.",
            "A positive-reach information set with zero outgoing realization mass is an export error; it is never completed with a fallback policy.",
            "Native enumeration aggregates terminal sequence-pair utilities without changing the game.",
            "When highspy is available, LP columns are streamed in bounded chunks to reduce peak memory.",
            "The certificate checks the realization plans reconstructed from the exported behavioral strategies.",
        ],
    }
    write_artifact(args.output, artifact)
    log_progress(f"Finished behavioral export and certificate ({time.perf_counter() - export_started:.1f}s)")
    log_progress(f"Wrote {args.output} ({args.output.stat().st_size / 1024 / 1024:.2f} MiB)")
    print(f"Stored support infos: O={len(policy_o):,}/{len(game.o.infos):,}, X={len(policy_x):,}/{len(game.x.infos):,}")
    print(f"O value interval: [{lower_o:.12g}, {upper_o:.12g}]  gap={gap:.3e}")


if __name__ == "__main__":
    main()
