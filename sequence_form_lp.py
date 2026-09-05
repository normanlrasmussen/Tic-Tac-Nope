#!/usr/bin/env python3
"""Exact sequence-form LP exporter for Tic-Tac-Nope.

This is intentionally an OFFLINE research tool. The unabstracted game is much
larger than a browser should enumerate on demand. When the complete tree is
built and HiGHS solves both players' sequence-form LPs, the exported realization
plans form a Nash/minimax solution of the implemented two-player zero-sum
perfect-recall game, up to numerical LP tolerance.

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
from scipy.optimize import linprog
from scipy.sparse import coo_matrix, csr_matrix, hstack

X, O = 1, 2
FULL_MASK = 0x1FF
WIN_MASKS = (0x007, 0x038, 0x1C0, 0x049, 0x092, 0x124, 0x111, 0x054)
_WINS = tuple(any(mask & win == win for win in WIN_MASKS) for mask in range(512))
_ACTIONS = tuple(tuple(i for i in range(9) if mask & (1 << i)) for mask in range(512))


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
        return f"{'S' if success else 'F'}{move};"

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


def build_sequence_game(rules: Rules, node_limit: int = 0) -> SequenceGame:
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


def solve_max_player(
    self_catalog: SequenceCatalog,
    opp_catalog: SequenceCatalog,
    payoff_self: csr_matrix,
) -> Tuple[np.ndarray, float, object]:
    """Solve max_x min_y x^T A y in sequence form.

    max f^T p
    s.t. E x = e, x >= 0,
         F^T p <= A^T x.

    p is unrestricted. Native free bounds avoid duplicating its columns.
    """
    E, e = self_catalog.realization_matrix()
    F, f = opp_catalog.realization_matrix()
    n_x = self_catalog.n_sequences
    n_p = opp_catalog.n_constraints

    A_eq = hstack(
        [E, csr_matrix((E.shape[0], n_p), dtype=float)],
        format="csr",
    )
    b_eq = e

    A_ub = hstack([-payoff_self.T, F.T], format="csr")
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
        options={"presolve": True},
    )
    if not result.success:
        raise RuntimeError(f"HiGHS failed: {result.message}")

    realization = np.asarray(result.x[:n_x], dtype=float)
    value = -float(result.fun)
    return realization, value, result


def behavioral_policy(
    catalog: SequenceCatalog,
    realization: np.ndarray,
    tol: float = 1e-10,
) -> Dict[str, Dict[str, float]]:
    policy: Dict[str, Dict[str, float]] = {}
    for key, info in catalog.infos.items():
        parent = realization[info.parent_sequence]
        if parent > tol:
            probs = np.maximum(0.0, realization[list(info.child_sequences)] / parent)
            total = float(probs.sum())
            if total > tol:
                probs /= total
            else:
                probs[:] = 1.0 / len(info.actions)
        else:
            probs = np.full(len(info.actions), 1.0 / len(info.actions), dtype=float)
        policy[key] = {str(a): float(p) for a, p in zip(info.actions, probs)}
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
    game = build_sequence_game(rules, node_limit=args.node_limit)
    print(
        f"histories={game.histories:,}, terminals={game.terminals:,}, "
        f"O infos={len(game.o.infos):,}, X infos={len(game.x.infos):,}, "
        f"O sequences={game.o.n_sequences:,}, X sequences={game.x.n_sequences:,}"
    )

    print("Solving O maximin LP...")
    x_o, lower_o, result_o = solve_max_player(game.o, game.x, game.payoff)
    print("Solving X maximin LP...")
    x_x, lower_x, result_x = solve_max_player(game.x, game.o, -game.payoff.T.tocsr())
    upper_o = -lower_x
    gap = max(0.0, upper_o - lower_o)
    value = 0.5 * (lower_o + upper_o)

    artifact = {
        "schema": 1,
        "solver": "scipy.optimize.linprog(method='highs')",
        "game": "Tic-Tac-Nope",
        "hidden": [move + 1 for move in args.hidden],
        "hiddenMask": hidden_mask,
        "startPlayer": args.start,
        "valueO": value,
        "lowerBoundO": lower_o,
        "upperBoundO": upper_o,
        "dualityGap": gap,
        "numericallySolved": bool(result_o.success and result_x.success),
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
            "At zero-realization information sets, uniform probabilities are a realization-equivalent completion.",
            "The equilibrium claim applies only when the complete unabstracted tree is enumerated and the LPs solve successfully.",
            "Numerical LP solutions are exact only up to solver feasibility/optimality tolerances.",
        ],
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(artifact, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {args.output} ({args.output.stat().st_size / 1024 / 1024:.2f} MiB)")
    print(f"O value interval: [{lower_o:.12g}, {upper_o:.12g}]  gap={gap:.3e}")


if __name__ == "__main__":
    main()
