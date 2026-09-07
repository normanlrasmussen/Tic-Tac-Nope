#!/usr/bin/env python3
"""Exact sequence-form LP exporter for Tic-Tac-Nope.

This is intentionally an OFFLINE research tool. The unabstracted game is much
larger than a browser should enumerate on demand. When the complete tree is
built and HiGHS solves the primal-dual sequence-form LP, the exported realization
plans form a Nash/minimax solution of the implemented two-player zero-sum
perfect-recall game, up to numerical LP tolerance.

Information model: a player observes the location of their own mystery-cell
attempt, but does not receive a success/failure signal. An opponent mystery
attempt is observed only as an anonymous fog action. Ownership can become known
only when it is implied by the player's complete observation history.

Example:
    python sequence_form_lp.py --hidden 2,4 --start O --output equilibrium.json

Dependencies: numpy, scipy
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
from scipy.optimize import OptimizeResult, linprog
from scipy.sparse import coo_matrix, csc_matrix, csr_matrix, hstack

X, O = 1, 2
FULL_MASK = 0x1FF
WIN_MASKS = (0x007, 0x038, 0x1C0, 0x049, 0x092, 0x124, 0x111, 0x054)
INFORMATION_MODEL = "hidden-attempt-location-no-result-v2"
_WINS = tuple(any(mask & win == win for win in WIN_MASKS) for mask in range(512))
_ACTIONS = tuple(tuple(i for i in range(9) if mask & (1 << i)) for mask in range(512))
# Match the existing HiGHS primal/dual feasibility defaults; optimizations must
# not gain speed by relaxing either solver or post-solve accuracy.
FEASIBILITY_TOLERANCE = 1e-7


def other(player: int) -> int:
    return X if player == O else O


def bit(move: int) -> int:
    return 1 << move


def has_win(mask: int) -> bool:
    if 0 <= mask <= FULL_MASK:
        return _WINS[mask]
    return any(mask & win == win for win in WIN_MASKS)


@dataclass(frozen=True)
class Rules:
    hidden_mask: int
    start_player: int


@dataclass(frozen=True)
class State:
    o_mask: int = 0
    x_mask: int = 0
    tried_o: int = 0
    tried_x: int = 0
    turn: int = O
    obs_o: str = ""
    obs_x: str = ""
    move_no: int = 0


def make_root(rules: Rules) -> State:
    return State(turn=rules.start_player)


def occupied(state: State) -> int:
    return state.o_mask | state.x_mask


def terminal_winner(state: State) -> int | None:
    if has_win(state.o_mask):
        return O
    if has_win(state.x_mask):
        return X
    if occupied(state) == FULL_MASK:
        return 0
    return None


def utility_o(state: State) -> float | None:
    winner = terminal_winner(state)
    if winner is None:
        return None
    if winner == 0:
        return 0.0
    return 1.0 if winner == O else -1.0


def legal_actions(state: State, rules: Rules) -> Tuple[int, ...]:
    if terminal_winner(state) is not None:
        return ()
    return _nonterminal_actions(state, rules)


def _nonterminal_actions(state: State, rules: Rules) -> Tuple[int, ...]:
    """Legal actions after the caller has established nonterminal status."""
    occ = occupied(state)
    tried = state.tried_o if state.turn == O else state.tried_x
    available = ((rules.hidden_mask & ~tried) | (~rules.hidden_mask & ~occ)) & FULL_MASK
    return _ACTIONS[available]


def apply_action(state: State, rules: Rules, move: int) -> State:
    if move not in legal_actions(state, rules):
        raise ValueError(f"Illegal action {move} in {state}")
    return _apply_legal_action(state, rules, move)


def _apply_legal_action(state: State, rules: Rules, move: int) -> State:
    """Internal transition for actions already checked by tree enumeration."""

    actor = state.turn
    b = bit(move)
    hidden = bool(rules.hidden_mask & b)
    success = not bool(occupied(state) & b)
    o_mask, x_mask = state.o_mask, state.x_mask
    tried_o, tried_x = state.tried_o, state.tried_x

    if hidden:
        if actor == O:
            tried_o |= b
        else:
            tried_x |= b
        if success:
            if actor == O:
                o_mask |= b
            else:
                x_mask |= b
    else:
        if actor == O:
            o_mask |= b
        else:
            x_mask |= b

    def token(viewer: int) -> str:
        if not hidden:
            return f"V{actor}{move};"
        if viewer != actor:
            return "H;"
        # The actor knows which mystery cell they attempted, but the game does
        # not reveal whether that attempt succeeded. Success remains latent in
        # the true state and may only be inferred from other observations.
        return f"P{move};"

    return State(
        o_mask=o_mask,
        x_mask=x_mask,
        tried_o=tried_o,
        tried_x=tried_x,
        turn=other(actor),
        obs_o=state.obs_o + token(O),
        obs_x=state.obs_x + token(X),
        move_no=state.move_no + 1,
    )


def information_key(state: State, rules: Rules, player: int | None = None) -> str:
    player = state.turn if player is None else player
    obs = state.obs_o if player == O else state.obs_x
    return f"{player}|{rules.start_player}|{rules.hidden_mask}|{obs}"


@dataclass
class InfoSet:
    key: str
    parent_sequence: int
    actions: Tuple[int, ...]
    child_sequences: Tuple[int, ...]


class SequenceCatalog:
    """Sequence-form bookkeeping for one player."""

    def __init__(self, player: int):
        self.player = player
        self.sequence_labels: List[str] = ["∅"]
        self.infos: Dict[str, InfoSet] = {}

    def register(self, key: str, parent: int, actions: Tuple[int, ...]) -> InfoSet:
        existing = self.infos.get(key)
        if existing is not None:
            if existing.parent_sequence != parent:
                raise RuntimeError(
                    f"Perfect-recall violation at {key}: parent sequence "
                    f"{existing.parent_sequence} != {parent}"
                )
            if existing.actions != actions:
                raise RuntimeError(f"Information-set legality mismatch at {key}")
            return existing

        children = []
        for action in actions:
            children.append(len(self.sequence_labels))
            self.sequence_labels.append(f"{key}::a{action}")
        info = InfoSet(key, parent, actions, tuple(children))
        self.infos[key] = info
        return info

    @property
    def n_sequences(self) -> int:
        return len(self.sequence_labels)

    @property
    def n_constraints(self) -> int:
        return 1 + len(self.infos)

    def realization_matrix(self) -> Tuple[csr_matrix, np.ndarray]:
        rows: List[int] = [0]
        cols: List[int] = [0]
        data: List[float] = [1.0]
        rhs = np.zeros(self.n_constraints, dtype=float)
        rhs[0] = 1.0

        for row, info in enumerate(self.infos.values(), start=1):
            rows.append(row)
            cols.append(info.parent_sequence)
            data.append(1.0)
            for child in info.child_sequences:
                rows.append(row)
                cols.append(child)
                data.append(-1.0)

        matrix = coo_matrix(
            (data, (rows, cols)),
            shape=(self.n_constraints, self.n_sequences),
            dtype=float,
        ).tocsr()
        return matrix, rhs


@dataclass
class SequenceGame:
    rules: Rules
    o: SequenceCatalog
    x: SequenceCatalog
    payoff: csr_matrix
    histories: int
    terminals: int


def build_sequence_game(rules: Rules, node_limit: int = 0, *, backend: str = "auto") -> SequenceGame:
    """Enumerate the full game; native and Python backends preserve all histories."""
    if backend not in ("auto", "native", "python"):
        raise ValueError(f"Unknown enumeration backend: {backend}")
    if node_limit < 0:
        raise ValueError("node_limit must be nonnegative")
    if backend != "python":
        from sequence_form_native import NativeUnavailable, build_native
        try:
            return build_native(rules, make_root(rules), node_limit)
        except NativeUnavailable as error:
            if backend == "native":
                raise
            import warnings
            warnings.warn(f"{error}; using the exact Python enumerator", RuntimeWarning)
    return build_sequence_game_python(rules, node_limit)


def build_sequence_game_python(rules: Rules, node_limit: int = 0) -> SequenceGame:
    """Enumerate the complete unabstracted extensive-form tree."""
    cat_o = SequenceCatalog(O)
    cat_x = SequenceCatalog(X)
    terminal_rows: List[int] = []
    terminal_cols: List[int] = []
    terminal_vals: List[float] = []
    histories = 0
    terminals = 0

    stack: List[Tuple[State, int, int]] = [(make_root(rules), 0, 0)]

    while stack:
        state, seq_o, seq_x = stack.pop()
        histories += 1
        if node_limit and histories > node_limit:
            raise RuntimeError(
                f"Node limit {node_limit:,} exceeded. This guard prevents an "
                "accidental full-memory solve; rerun with a larger limit or 0 "
                "only when you intend to build the complete game."
            )

        u = utility_o(state)
        if u is not None:
            terminals += 1
            if u != 0.0:
                terminal_rows.append(seq_o)
                terminal_cols.append(seq_x)
                terminal_vals.append(u)
            continue

        actions = _nonterminal_actions(state, rules)
        actor = state.turn
        key = information_key(state, rules, actor)
        catalog = cat_o if actor == O else cat_x
        parent = seq_o if actor == O else seq_x
        info = catalog.register(key, parent, actions)

        for action, child_seq in zip(reversed(info.actions), reversed(info.child_sequences)):
            child = _apply_legal_action(state, rules, action)
            if actor == O:
                stack.append((child, child_seq, seq_x))
            else:
                stack.append((child, seq_o, child_seq))

    payoff = coo_matrix(
        (terminal_vals, (terminal_rows, terminal_cols)),
        shape=(cat_o.n_sequences, cat_x.n_sequences),
        dtype=float,
    ).tocsr()
    payoff.sum_duplicates()
    payoff.eliminate_zeros()
    return SequenceGame(rules, cat_o, cat_x, payoff, histories, terminals)


def best_response_value(catalog: SequenceCatalog, coefficients: np.ndarray, maximize: bool = False) -> float:
    """Exactly optimize a linear objective over the full realization polytope.

    Process information sets in reverse topological order. At an information
    set all child continuation values are known; its best child contributes to
    the parent sequence. Distinct infos sharing a parent contribute additively.
    This dynamic program is independent of HiGHS and its dual potentials.
    """
    native = getattr(catalog, "best_response_value", None)
    if native is not None:
        return native(coefficients, maximize)
    values = np.array(coefficients, dtype=float, copy=True)
    if values.shape != (catalog.n_sequences,) or not np.isfinite(values).all():
        raise ValueError("Invalid best-response coefficients")
    select = max if maximize else min
    for info in reversed(catalog.infos.values()):
        values[info.parent_sequence] += select(values[child] for child in info.child_sequences)
    if not np.isfinite(values[0]):
        raise RuntimeError("Nonfinite best-response value")
    return float(values[0])


def _certify_realization_pair(
    E: csr_matrix,
    e: np.ndarray,
    F: csr_matrix,
    f: np.ndarray,
    payoff_self: csr_matrix,
    realization: np.ndarray,
    opponent_realization: np.ndarray,
    lower_potential: np.ndarray,
    upper_potential: np.ndarray,
    objective: float,
    tolerance: float,
    self_catalog: SequenceCatalog,
    opp_catalog: SequenceCatalog,
) -> Dict[str, float]:
    """Check both original sequence-form LPs using their primal/dual witnesses.

    A solver status alone is insufficient, especially after behavioral-policy
    normalization. These sparse checks cover every sequence and constraint;
    they do not sample states, prune strategies, or solve an approximate game.
    """
    if not np.isfinite(tolerance) or not 0 < tolerance <= FEASIBILITY_TOLERANCE:
        raise ValueError(f"Certificate tolerance must be in (0, {FEASIBILITY_TOLERANCE}].")
    for name, vector, length in (
        ("realization", realization, E.shape[1]),
        ("opponent realization", opponent_realization, F.shape[1]),
        ("lower potential", lower_potential, F.shape[0]),
        ("upper potential", upper_potential, E.shape[0]),
    ):
        if vector.shape != (length,) or not np.isfinite(vector).all():
            raise RuntimeError(f"Invalid {name} in sequence-form certificate.")

    def absolute_residual(values: np.ndarray) -> float:
        return float(np.max(np.abs(values), initial=0.0))

    def positive_residual(values: np.ndarray) -> float:
        return float(np.maximum(0.0, np.max(values, initial=0.0)))

    against_opponent = payoff_self @ opponent_realization
    against_self = payoff_self.T @ realization
    lower = float(f @ lower_potential)
    upper = float(e @ upper_potential)
    payoff = float(realization @ against_opponent)
    best_lower = best_response_value(opp_catalog, against_self)
    best_upper = best_response_value(self_catalog, against_opponent, maximize=True)
    certificate = {
        "tolerance": float(tolerance),
        "selfFlowResidual": absolute_residual(E @ realization - e),
        "opponentFlowResidual": absolute_residual(F @ opponent_realization - f),
        "selfNonnegativityResidual": positive_residual(-realization),
        "opponentNonnegativityResidual": positive_residual(-opponent_realization),
        "lowerBoundResidual": positive_residual(F.T @ lower_potential - against_self),
        "upperBoundResidual": positive_residual(against_opponent - E.T @ upper_potential),
        "objectiveResidual": abs(lower - objective),
        "dualityGap": upper - lower,
        "payoff": payoff,
        "payoffBoundsResidual": max(0.0, lower - payoff, payoff - upper),
        "bestResponseLowerBound": best_lower,
        "bestResponseUpperBound": best_upper,
        "exploitabilityGap": best_upper - best_lower,
        "bestResponseBoundsResidual": max(abs(best_lower - lower), abs(best_upper - upper)),
    }
    if not all(np.isfinite(value) for value in certificate.values()):
        raise RuntimeError("Non-finite sequence-form certificate.")
    failures = {
        name: value for name, value in certificate.items()
        if name not in ("tolerance", "payoff", "bestResponseLowerBound", "bestResponseUpperBound")
        and abs(value) > tolerance
    }
    if failures:
        detail = ", ".join(f"{name}={value:.3e}" for name, value in failures.items())
        raise RuntimeError(
            f"Sequence-form equilibrium certificate failed ({detail}; tolerance={tolerance:.1e})."
        )
    return certificate


def solve_max_player(
    self_catalog: SequenceCatalog,
    opp_catalog: SequenceCatalog,
    payoff_self: csr_matrix,
) -> Tuple[np.ndarray, float, OptimizeResult]:
    """Solve max_x min_y x^T A y in sequence form.

    max f^T p
    s.t. E x = e, x >= 0,
         F^T p <= A^T x.

    p is unrestricted. Native free bounds avoid duplicating its columns.

    The inequality duals also give the opponent's optimal realization plan:
    y = -result.ineqlin.marginals. Equality duals give upper-bound potentials
    q = -result.eqlin.marginals, with F y = f and E^T q >= A y. Consequently
    one primal-dual LP solves the full two-player equilibrium. The result keeps
    these witnesses and a certificate; the original three-item API is retained.
    """
    E, e = self_catalog.realization_matrix()
    F, f = opp_catalog.realization_matrix()
    n_x = self_catalog.n_sequences
    n_p = opp_catalog.n_constraints

    A_eq = hstack(
        [E.tocsc(), csc_matrix((E.shape[0], n_p), dtype=float)],
        format="csc",
    )
    b_eq = e

    # HiGHS consumes CSC. Assemble in that format to avoid converting a full
    # stacked CSR copy inside scipy.optimize.linprog.
    A_ub = hstack([-payoff_self.T, F.T], format="csc")
    b_ub = np.zeros(opp_catalog.n_sequences, dtype=float)

    c = np.zeros(n_x + n_p, dtype=float)
    c[n_x:] = -f
    bounds = np.empty((n_x + n_p, 2), dtype=float)
    bounds[:, 0] = 0.0
    bounds[n_x:, 0] = -np.inf
    bounds[:, 1] = np.inf

    result = linprog(
        c,
        A_ub=A_ub,
        b_ub=b_ub,
        A_eq=A_eq,
        b_eq=b_eq,
        bounds=bounds,
        method="highs",
        options={
            "presolve": True,
            "primal_feasibility_tolerance": FEASIBILITY_TOLERANCE,
            "dual_feasibility_tolerance": FEASIBILITY_TOLERANCE,
        },
    )
    if not result.success:
        raise RuntimeError(f"HiGHS failed: {result.message}")
    # The original sparse E/F/A suffice for certification; release the larger
    # augmented solver matrices before allocating the validation products.
    del A_eq, A_ub, bounds, c, b_ub

    realization = np.asarray(result.x[:n_x], dtype=float)
    value = -float(result.fun)
    opponent_realization = -np.asarray(result.ineqlin.marginals, dtype=float)
    lower_potential = np.asarray(result.x[n_x:], dtype=float)
    upper_potential = -np.asarray(result.eqlin.marginals, dtype=float)
    result.certificate = _certify_realization_pair(
        E, e, F, f, payoff_self, realization, opponent_realization,
        lower_potential, upper_potential, value, FEASIBILITY_TOLERANCE,
        self_catalog, opp_catalog,
    )
    result.opponent_realization = opponent_realization
    result.lower_bound = float(f @ lower_potential)
    result.upper_bound = float(e @ upper_potential)
    return realization, value, result


def solve_equilibrium(game: SequenceGame) -> Tuple[np.ndarray, np.ndarray, float, float, OptimizeResult]:
    """Return both exact-game realization plans from one certified HiGHS solve."""
    realization_o, _, result = solve_max_player(game.o, game.x, game.payoff)
    return (realization_o, result.opponent_realization,
            result.lower_bound, result.upper_bound, result)


def certify_equilibrium(
    game: SequenceGame,
    realization_o: np.ndarray,
    realization_x: np.ndarray,
    result: OptimizeResult,
    tolerance: float = FEASIBILITY_TOLERANCE,
) -> Dict[str, float]:
    """Recheck a pair, including reconstructed exported behavioral strategies.

    ``result`` must be the successful O-oriented solve returned by
    :func:`solve_equilibrium`. Its dual potentials independently bound the two
    strategies; this needs sparse matrix products, not another optimization.
    """
    if not result.success:
        raise RuntimeError("Cannot certify an unsuccessful LP solve.")
    E, e = game.o.realization_matrix()
    F, f = game.x.realization_matrix()
    return _certify_realization_pair(
        E, e, F, f, game.payoff,
        np.asarray(realization_o, dtype=float), np.asarray(realization_x, dtype=float),
        np.asarray(result.x[game.o.n_sequences:], dtype=float),
        -np.asarray(result.eqlin.marginals, dtype=float),
        -float(result.fun), tolerance, game.o, game.x,
    )


def behavioral_policy(
    catalog: SequenceCatalog,
    realization: np.ndarray,
    tol: float = 0.0,
) -> Dict[str, Dict[str, float]]:
    """Complete the support policy uniformly only at exactly unreachable infos."""
    from sequence_form_lp_compact import compact_behavioral_policy
    supported = compact_behavioral_policy(catalog, realization, tol)
    policy: Dict[str, Dict[str, float]] = {}
    for key, info in catalog.infos.items():
        if key in supported:
            policy[key] = {str(action): supported[key].get(str(action), 0.0) for action in info.actions}
        else:
            policy[key] = {str(action): 1.0 / len(info.actions) for action in info.actions}
    return policy


def parse_hidden(text: str) -> Tuple[int, ...]:
    values = tuple(sorted({int(part.strip()) for part in text.split(",") if part.strip()}))
    if len(values) < 2:
        raise argparse.ArgumentTypeError("Provide at least two mystery cells, e.g. 2,4")
    if any(v < 1 or v > 9 for v in values):
        raise argparse.ArgumentTypeError("Mystery cells are 1-based and must be in 1..9")
    return tuple(v - 1 for v in values)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hidden", type=parse_hidden, required=True, help="1-based mystery cells, e.g. 2,4")
    parser.add_argument("--start", choices=("O", "X"), default="O")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--enumerator", choices=("auto", "native", "python"), default="auto")
    parser.add_argument(
        "--node-limit",
        type=int,
        default=0,
        help="Safety cap during tree enumeration; 0 means no cap.",
    )
    args = parser.parse_args()

    hidden_mask = sum(bit(move) for move in args.hidden)
    rules = Rules(hidden_mask=hidden_mask, start_player=O if args.start == "O" else X)
    print(f"Building exact sequence form for hidden={tuple(m + 1 for m in args.hidden)}, start={args.start}...")
    game = build_sequence_game(rules, node_limit=args.node_limit, backend=args.enumerator)
    print(
        f"histories={game.histories:,}, terminals={game.terminals:,}, "
        f"O infos={len(game.o.infos):,}, X infos={len(game.x.infos):,}, "
        f"O sequences={game.o.n_sequences:,}, X sequences={game.x.n_sequences:,}"
    )

    print("Solving and certifying both players from one primal-dual LP...", flush=True)
    x_o, x_x, lower_o, upper_o, result = solve_equilibrium(game)
    from sequence_form_lp_compact import compact_policy_and_realization, write_artifact
    _, exported_o = compact_policy_and_realization(game.o, x_o)
    _, exported_x = compact_policy_and_realization(game.x, x_x)
    certificate = certify_equilibrium(game, exported_o, exported_x, result)
    gap = max(0.0, upper_o - lower_o)
    value = 0.5 * (lower_o + upper_o)

    artifact = {
        "schema": 1,
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
        "certificate": certificate,
        "counts": {
            "histories": game.histories,
            "terminals": game.terminals,
            "informationSetsO": len(game.o.infos),
            "informationSetsX": len(game.x.infos),
            "sequencesO": game.o.n_sequences,
            "sequencesX": game.x.n_sequences,
        },
        "policy": {
            "O": behavioral_policy(game.o, x_o),
            "X": behavioral_policy(game.x, x_x),
        },
        "notes": [
            "Policies are behavioral representations of sequence-form realization plans.",
            "Mystery-cell attempts reveal the actor's attempted location but not success/failure.",
            "At zero-realization information sets, uniform probabilities are a realization-equivalent completion.",
            "The equilibrium claim applies only when the complete unabstracted tree is enumerated and the LPs solve successfully.",
            "Numerical LP solutions are exact only up to solver feasibility/optimality tolerances.",
        ],
    }

    write_artifact(args.output, artifact)
    print(f"Wrote {args.output} ({args.output.stat().st_size / 1024 / 1024:.2f} MiB)")
    print(f"O value interval: [{lower_o:.12g}, {upper_o:.12g}]  gap={gap:.3e}")


if __name__ == "__main__":
    main()
