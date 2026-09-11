#!/usr/bin/env python3
"""Exact sequence-form LP exporter for Tic-Tac-Nope.

The exact solver enumerates the complete unabstracted perfect-recall game,
constructs sparse sequence-form realization constraints, and solves one
primal-dual zero-sum LP. The native path aggregates terminal sequence-pair
utilities during enumeration and materializes the payoff matrix directly as CSR.
When highspy is available, the LP is streamed into HiGHS in column chunks so the
full augmented SciPy matrices never coexist in memory.
"""
from __future__ import annotations

import argparse
import json
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
from scipy.optimize import OptimizeResult, linprog
from scipy.sparse import coo_matrix, csc_matrix, csr_matrix, hstack, vstack

X, O = 1, 2
FULL_MASK = 0x1FF
WIN_MASKS = (0x007, 0x038, 0x1C0, 0x049, 0x092, 0x124, 0x111, 0x054)
INFORMATION_MODEL = "hidden-attempt-location-no-result-v2"
_WINS = tuple(any(mask & win == win for win in WIN_MASKS) for mask in range(512))
_ACTIONS = tuple(tuple(i for i in range(9) if mask & (1 << i)) for mask in range(512))
FEASIBILITY_TOLERANCE = 1e-7


def _memory_status() -> str:
    try:
        values = {}
        for line in Path("/proc/self/status").read_text().splitlines():
            if line.startswith(("VmRSS:", "VmHWM:")):
                key, rest = line.split(":", 1)
                values[key] = float(rest.split()[0]) / 1024.0
        if values:
            return f"rss={values.get('VmRSS', float('nan')):.1f} MiB peak={values.get('VmHWM', float('nan')):.1f} MiB"
    except OSError:
        pass
    return "rss=n/a"


def _log(message: str) -> None:
    print(f"[exact] {message} [{_memory_status()}]", flush=True)


def _matrix_mib(matrix) -> float:
    return (matrix.data.nbytes + matrix.indices.nbytes + matrix.indptr.nbytes) / 1024 / 1024


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
    occ = occupied(state)
    tried = state.tried_o if state.turn == O else state.tried_x
    available = ((rules.hidden_mask & ~tried) | (~rules.hidden_mask & ~occ)) & FULL_MASK
    return _ACTIONS[available]


def apply_action(state: State, rules: Rules, move: int) -> State:
    if move not in legal_actions(state, rules):
        raise ValueError(f"Illegal action {move} in {state}")
    return _apply_legal_action(state, rules, move)


def _apply_legal_action(state: State, rules: Rules, move: int) -> State:
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
    elif actor == O:
        o_mask |= b
    else:
        x_mask |= b

    def token(viewer: int) -> str:
        if not hidden:
            return f"V{actor}{move};"
        return f"P{move};" if viewer == actor else "H;"

    return State(o_mask=o_mask, x_mask=x_mask, tried_o=tried_o, tried_x=tried_x,
                 turn=other(actor), obs_o=state.obs_o + token(O),
                 obs_x=state.obs_x + token(X), move_no=state.move_no + 1)


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
    def __init__(self, player: int):
        self.player = player
        self.sequence_labels: List[str] = ["∅"]
        self.infos: Dict[str, InfoSet] = {}
        self._realization = None

    def register(self, key: str, parent: int, actions: Tuple[int, ...]) -> InfoSet:
        existing = self.infos.get(key)
        if existing is not None:
            if existing.parent_sequence != parent:
                raise RuntimeError(f"Perfect-recall violation at {key}: parent sequence {existing.parent_sequence} != {parent}")
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
        if self._realization is not None:
            return self._realization
        rows: List[int] = [0]
        cols: List[int] = [0]
        data: List[float] = [1.0]
        rhs = np.zeros(self.n_constraints, dtype=float)
        rhs[0] = 1.0
        for row, info in enumerate(self.infos.values(), start=1):
            rows.append(row); cols.append(info.parent_sequence); data.append(1.0)
            for child in info.child_sequences:
                rows.append(row); cols.append(child); data.append(-1.0)
        matrix = coo_matrix((data, (rows, cols)), shape=(self.n_constraints, self.n_sequences), dtype=float).tocsr()
        self._realization = matrix, rhs
        return self._realization


@dataclass
class SequenceGame:
    rules: Rules
    o: SequenceCatalog
    x: SequenceCatalog
    payoff: csr_matrix
    histories: int
    terminals: int


def build_sequence_game(rules: Rules, node_limit: int = 0, *, backend: str = "auto") -> SequenceGame:
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
    _log("Using Python reference enumerator (slow path)")
    return build_sequence_game_python(rules, node_limit)


def build_sequence_game_python(rules: Rules, node_limit: int = 0) -> SequenceGame:
    cat_o, cat_x = SequenceCatalog(O), SequenceCatalog(X)
    terminal_rows: List[int] = []
    terminal_cols: List[int] = []
    terminal_vals: List[float] = []
    histories = terminals = 0
    stack: List[Tuple[State, int, int]] = [(make_root(rules), 0, 0)]
    started = time.perf_counter()
    next_report = 1_000_000
    while stack:
        state, seq_o, seq_x = stack.pop()
        histories += 1
        if histories >= next_report:
            _log(f"Python enumeration: histories={histories:,} terminals={terminals:,} elapsed={time.perf_counter()-started:.1f}s")
            next_report += 1_000_000
        if node_limit and histories > node_limit:
            raise RuntimeError(f"Node limit {node_limit:,} exceeded. This guard prevents an accidental full-memory solve; rerun with a larger limit or 0 only when you intend to build the complete game.")
        u = utility_o(state)
        if u is not None:
            terminals += 1
            if u != 0.0:
                terminal_rows.append(seq_o); terminal_cols.append(seq_x); terminal_vals.append(u)
            continue
        actions = _nonterminal_actions(state, rules)
        actor = state.turn
        catalog = cat_o if actor == O else cat_x
        parent = seq_o if actor == O else seq_x
        info = catalog.register(information_key(state, rules, actor), parent, actions)
        for action, child_seq in zip(reversed(info.actions), reversed(info.child_sequences)):
            child = _apply_legal_action(state, rules, action)
            stack.append((child, child_seq, seq_x) if actor == O else (child, seq_o, child_seq))
    payoff = coo_matrix((terminal_vals, (terminal_rows, terminal_cols)),
                        shape=(cat_o.n_sequences, cat_x.n_sequences), dtype=float).tocsr()
    payoff.sum_duplicates(); payoff.eliminate_zeros()
    return SequenceGame(rules, cat_o, cat_x, payoff, histories, terminals)


def best_response_value(catalog: SequenceCatalog, coefficients: np.ndarray, maximize: bool = False) -> float:
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


def _certify_realization_pair(E, e, F, f, payoff_self, realization, opponent_realization,
                              lower_potential, upper_potential, objective, tolerance,
                              self_catalog, opp_catalog) -> Dict[str, float]:
    if not np.isfinite(tolerance) or not 0 < tolerance <= FEASIBILITY_TOLERANCE:
        raise ValueError(f"Certificate tolerance must be in (0, {FEASIBILITY_TOLERANCE}].")
    for name, vector, length in (
        ("realization", realization, E.shape[1]), ("opponent realization", opponent_realization, F.shape[1]),
        ("lower potential", lower_potential, F.shape[0]), ("upper potential", upper_potential, E.shape[0]),
    ):
        if vector.shape != (length,) or not np.isfinite(vector).all():
            raise RuntimeError(f"Invalid {name} in sequence-form certificate.")
    absolute = lambda x: float(np.max(np.abs(x), initial=0.0))
    positive = lambda x: float(np.maximum(0.0, np.max(x, initial=0.0)))
    against_opponent = payoff_self @ opponent_realization
    against_self = payoff_self.T @ realization
    lower = float(f @ lower_potential)
    upper = float(e @ upper_potential)
    payoff = float(realization @ against_opponent)
    best_lower = best_response_value(opp_catalog, against_self)
    best_upper = best_response_value(self_catalog, against_opponent, maximize=True)
    certificate = {
        "tolerance": float(tolerance), "selfFlowResidual": absolute(E @ realization - e),
        "opponentFlowResidual": absolute(F @ opponent_realization - f),
        "selfNonnegativityResidual": positive(-realization),
        "opponentNonnegativityResidual": positive(-opponent_realization),
        "lowerBoundResidual": positive(F.T @ lower_potential - against_self),
        "upperBoundResidual": positive(against_opponent - E.T @ upper_potential),
        "objectiveResidual": abs(lower - objective), "dualityGap": upper - lower,
        "payoff": payoff, "payoffBoundsResidual": max(0.0, lower - payoff, payoff - upper),
        "bestResponseLowerBound": best_lower, "bestResponseUpperBound": best_upper,
        "exploitabilityGap": best_upper - best_lower,
        "bestResponseBoundsResidual": max(abs(best_lower - lower), abs(best_upper - upper)),
    }
    if not all(np.isfinite(value) for value in certificate.values()):
        raise RuntimeError("Non-finite sequence-form certificate.")
    failures = {name: value for name, value in certificate.items()
                if name not in ("tolerance", "payoff", "bestResponseLowerBound", "bestResponseUpperBound")
                and abs(value) > tolerance}
    if failures:
        detail = ", ".join(f"{name}={value:.3e}" for name, value in failures.items())
        raise RuntimeError(f"Sequence-form equilibrium certificate failed ({detail}; tolerance={tolerance:.1e}).")
    return certificate


def _solve_scipy(E, e, F, f, payoff_self, n_x, n_p) -> OptimizeResult:
    started = time.perf_counter()
    _log("SciPy fallback: assembling full augmented equality matrix")
    A_eq = hstack([E.tocsc(), csc_matrix((E.shape[0], n_p), dtype=float)], format="csc")
    _log(f"A_eq ready: shape={A_eq.shape} nnz={A_eq.nnz:,} size={_matrix_mib(A_eq):.1f} MiB")
    _log("SciPy fallback: assembling full augmented inequality matrix")
    A_ub = hstack([-payoff_self.T, F.T], format="csc")
    _log(f"A_ub ready: shape={A_ub.shape} nnz={A_ub.nnz:,} size={_matrix_mib(A_ub):.1f} MiB")
    c = np.zeros(n_x + n_p, dtype=float); c[n_x:] = -f
    bounds = np.empty((n_x + n_p, 2), dtype=float)
    bounds[:, 0] = 0.0; bounds[n_x:, 0] = -np.inf; bounds[:, 1] = np.inf
    _log(f"Calling scipy.optimize.linprog after {time.perf_counter()-started:.2f}s of LP assembly")
    solve_started = time.perf_counter()
    result = linprog(c, A_ub=A_ub, b_ub=np.zeros(F.shape[1]), A_eq=A_eq, b_eq=e,
                     bounds=bounds, method="highs",
                     options={"presolve": True, "primal_feasibility_tolerance": FEASIBILITY_TOLERANCE,
                              "dual_feasibility_tolerance": FEASIBILITY_TOLERANCE})
    _log(f"SciPy/HiGHS returned in {time.perf_counter()-solve_started:.2f}s")
    result.solver_backend = "scipy-highs-augmented"
    return result


def _solve_highspy_streaming(E, e, F, f, payoff_self, n_x, n_p) -> OptimizeResult:
    try:
        import highspy
    except ImportError as error:
        raise ModuleNotFoundError("highspy is not installed") from error

    chunk_cols = max(1, int(os.environ.get("TTN_HIGHS_CHUNK_COLS", "50000")))
    total_rows = E.shape[0] + F.shape[1]
    inf = highspy.kHighsInf
    highs = highspy.Highs()
    highs.setOptionValue("output_flag", False)
    highs.setOptionValue("presolve", "on")
    highs.setOptionValue("primal_feasibility_tolerance", FEASIBILITY_TOLERANCE)
    highs.setOptionValue("dual_feasibility_tolerance", FEASIBILITY_TOLERANCE)

    row_lower = np.concatenate([e, np.full(F.shape[1], -inf, dtype=float)])
    row_upper = np.concatenate([e, np.zeros(F.shape[1], dtype=float)])
    _log(f"highspy: creating {total_rows:,} LP rows before streaming columns")
    status = highs.addRows(total_rows, row_lower, row_upper, 0, 0, 0, 0)
    if status == highspy.HighsStatus.kError:
        raise RuntimeError("highspy rejected empty LP rows")
    del row_lower, row_upper

    E_csc = E.tocsc()
    streamed_nnz = 0
    started = time.perf_counter()
    for lo in range(0, n_x, chunk_cols):
        hi = min(n_x, lo + chunk_cols)
        block = vstack([E_csc[:, lo:hi], -payoff_self[lo:hi, :].T], format="csc")
        # Native payoff aggregation can leave equal sequence-pair entries in
        # different flushes.  SciPy permits duplicate sparse indices, but the
        # HiGHS column API rejects them.  Canonicalize each bounded block here
        # so streaming remains memory-bounded and the streamed model has the
        # same summed payoff as sparse matrix multiplication.
        if not block.has_canonical_format:
            block.sum_duplicates()
            block.eliminate_zeros()
        m = hi - lo
        status = highs.addCols(m, np.zeros(m), np.zeros(m), np.full(m, inf),
                               block.nnz, block.indptr[:-1], block.indices, block.data)
        if status == highspy.HighsStatus.kError:
            raise RuntimeError(f"highspy rejected realization columns {lo}:{hi}")
        streamed_nnz += block.nnz
        if hi == n_x or (lo // chunk_cols) % 10 == 0:
            _log(f"highspy: streamed realization cols {hi:,}/{n_x:,}; nnz copied={streamed_nnz:,}")
        del block
    del E_csc

    n_eq = E.shape[0]
    for lo in range(0, n_p, chunk_cols):
        hi = min(n_p, lo + chunk_cols)
        source = F[lo:hi, :].T.tocsc()
        shifted = source.indices.astype(np.int64 if total_rows >= 2**31 else np.int32, copy=True)
        shifted += n_eq
        block = csc_matrix((source.data, shifted, source.indptr), shape=(total_rows, hi - lo), copy=False)
        costs = -f[lo:hi]
        m = hi - lo
        status = highs.addCols(m, costs, np.full(m, -inf), np.full(m, inf),
                               block.nnz, block.indptr[:-1], block.indices, block.data)
        if status == highspy.HighsStatus.kError:
            raise RuntimeError(f"highspy rejected potential columns {lo}:{hi}")
        streamed_nnz += block.nnz
        if hi == n_p or (lo // chunk_cols) % 10 == 0:
            _log(f"highspy: streamed potential cols {hi:,}/{n_p:,}; nnz copied={streamed_nnz:,}")
        del source, shifted, block

    _log(f"highspy LP streaming complete in {time.perf_counter()-started:.2f}s; starting HiGHS solve")
    solve_started = time.perf_counter()
    status = highs.run()
    model_status = highs.modelStatusToString(highs.getModelStatus())
    _log(f"highspy/HiGHS returned in {time.perf_counter()-solve_started:.2f}s with status={model_status}")
    if status == highspy.HighsStatus.kError or "Optimal" not in model_status:
        raise RuntimeError(f"HiGHS failed: {model_status}")
    solution = highs.getSolution()
    col_value = np.asarray(solution.col_value, dtype=float)
    row_dual = np.asarray(solution.row_dual, dtype=float)
    result = OptimizeResult()
    result.success = True; result.status = 0; result.message = model_status
    result.x = col_value; result.fun = float(highs.getObjectiveValue())
    result.eqlin = OptimizeResult(marginals=row_dual[:n_eq])
    result.ineqlin = OptimizeResult(marginals=row_dual[n_eq:])
    info = highs.getInfo()
    result.nit = int(getattr(info, "simplex_iteration_count", 0) or 0) + int(getattr(info, "ipm_iteration_count", 0) or 0)
    result.solver_backend = "highspy-streaming"
    return result


def solve_max_player(self_catalog: SequenceCatalog, opp_catalog: SequenceCatalog, payoff_self: csr_matrix,
                     backend: str = "auto") -> Tuple[np.ndarray, float, OptimizeResult]:
    if backend not in ("auto", "highspy", "scipy"):
        raise ValueError("LP backend must be auto, highspy, or scipy")
    stage = time.perf_counter()
    _log("Building realization-flow matrices E and F")
    E, e = self_catalog.realization_matrix(); F, f = opp_catalog.realization_matrix()
    _log(f"Flow matrices ready in {time.perf_counter()-stage:.2f}s: E={E.shape}, nnz={E.nnz:,}, {_matrix_mib(E):.1f} MiB; F={F.shape}, nnz={F.nnz:,}, {_matrix_mib(F):.1f} MiB")
    _log(f"Payoff matrix: shape={payoff_self.shape} nnz={payoff_self.nnz:,} size={_matrix_mib(payoff_self):.1f} MiB")
    n_x, n_p = self_catalog.n_sequences, opp_catalog.n_constraints

    if backend in ("auto", "highspy"):
        try:
            result = _solve_highspy_streaming(E, e, F, f, payoff_self, n_x, n_p)
        except ModuleNotFoundError:
            if backend == "highspy":
                raise
            _log("highspy is unavailable; falling back to SciPy's augmented-matrix HiGHS path")
            result = _solve_scipy(E, e, F, f, payoff_self, n_x, n_p)
    else:
        result = _solve_scipy(E, e, F, f, payoff_self, n_x, n_p)
    if not result.success:
        raise RuntimeError(f"HiGHS failed: {result.message}")

    realization = np.asarray(result.x[:n_x], dtype=float)
    value = -float(result.fun)
    opponent_realization = -np.asarray(result.ineqlin.marginals, dtype=float)
    lower_potential = np.asarray(result.x[n_x:], dtype=float)
    upper_potential = -np.asarray(result.eqlin.marginals, dtype=float)
    _log("LP solved; running full sparse primal/dual and best-response certificate")
    certify_started = time.perf_counter()
    result.certificate = _certify_realization_pair(
        E, e, F, f, payoff_self, realization, opponent_realization,
        lower_potential, upper_potential, value, FEASIBILITY_TOLERANCE,
        self_catalog, opp_catalog,
    )
    _log(f"Equilibrium certificate passed in {time.perf_counter()-certify_started:.2f}s")
    result.opponent_realization = opponent_realization
    result.lower_bound = float(f @ lower_potential)
    result.upper_bound = float(e @ upper_potential)
    return realization, value, result


def solve_equilibrium(game: SequenceGame, backend: str = "auto") -> Tuple[np.ndarray, np.ndarray, float, float, OptimizeResult]:
    realization_o, _, result = solve_max_player(game.o, game.x, game.payoff, backend=backend)
    return realization_o, result.opponent_realization, result.lower_bound, result.upper_bound, result


def certify_equilibrium(game: SequenceGame, realization_o: np.ndarray, realization_x: np.ndarray,
                        result: OptimizeResult, tolerance: float = FEASIBILITY_TOLERANCE) -> Dict[str, float]:
    if not result.success:
        raise RuntimeError("Cannot certify an unsuccessful LP solve.")
    E, e = game.o.realization_matrix(); F, f = game.x.realization_matrix()
    return _certify_realization_pair(
        E, e, F, f, game.payoff, np.asarray(realization_o, dtype=float), np.asarray(realization_x, dtype=float),
        np.asarray(result.x[game.o.n_sequences:], dtype=float), -np.asarray(result.eqlin.marginals, dtype=float),
        -float(result.fun), tolerance, game.o, game.x,
    )


def behavioral_policy(catalog: SequenceCatalog, realization: np.ndarray, tol: float = 0.0) -> Dict[str, Dict[str, float]]:
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
    parser.add_argument("--lp-backend", choices=("auto", "highspy", "scipy"), default="auto",
                        help="auto prefers streaming highspy and falls back to SciPy when highspy is unavailable")
    parser.add_argument("--node-limit", type=int, default=0,
                        help="Safety cap during tree enumeration; 0 means no cap.")
    args = parser.parse_args()

    hidden_mask = sum(bit(move) for move in args.hidden)
    rules = Rules(hidden_mask=hidden_mask, start_player=O if args.start == "O" else X)
    total_started = time.perf_counter()
    _log(f"Build start: hidden={tuple(m + 1 for m in args.hidden)} start={args.start} enumerator={args.enumerator}")
    game = build_sequence_game(rules, node_limit=args.node_limit, backend=args.enumerator)
    _log(f"Game ready in {time.perf_counter()-total_started:.2f}s: histories={game.histories:,} terminals={game.terminals:,} O infos={len(game.o.infos):,} X infos={len(game.x.infos):,} O seq={game.o.n_sequences:,} X seq={game.x.n_sequences:,} payoff nnz={game.payoff.nnz:,}")

    solve_started = time.perf_counter()
    _log(f"Starting exact equilibrium solve with lp_backend={args.lp_backend}")
    x_o, x_x, lower_o, upper_o, result = solve_equilibrium(game, backend=args.lp_backend)
    _log(f"Raw equilibrium solve + certificate complete in {time.perf_counter()-solve_started:.2f}s")
    from sequence_form_lp_compact import compact_policy_and_realization, write_artifact
    _, exported_o = compact_policy_and_realization(game.o, x_o)
    _, exported_x = compact_policy_and_realization(game.x, x_x)
    certificate = certify_equilibrium(game, exported_o, exported_x, result)
    gap = max(0.0, upper_o - lower_o); value = 0.5 * (lower_o + upper_o)
    artifact = {
        "schema": 1, "solver": getattr(result, "solver_backend", "HiGHS"), "game": "Tic-Tac-Nope",
        "informationModel": INFORMATION_MODEL, "hidden": [move + 1 for move in args.hidden],
        "hiddenMask": hidden_mask, "startPlayer": args.start, "valueO": value,
        "lowerBoundO": lower_o, "upperBoundO": upper_o, "dualityGap": gap,
        "numericallySolved": bool(result.success), "certificate": certificate,
        "counts": {"histories": game.histories, "terminals": game.terminals,
                   "informationSetsO": len(game.o.infos), "informationSetsX": len(game.x.infos),
                   "sequencesO": game.o.n_sequences, "sequencesX": game.x.n_sequences,
                   "payoffNnz": int(game.payoff.nnz)},
        "policy": {"O": behavioral_policy(game.o, x_o), "X": behavioral_policy(game.x, x_x)},
        "notes": ["Complete unabstracted perfect-recall game.",
                  "Native enumeration aggregates terminal sequence-pair utilities without strategic abstraction.",
                  "The streaming highspy backend, when available, changes only LP materialization, not the game.",
                  "Numerical LP solutions are exact only up to solver feasibility/optimality tolerances."],
    }
    write_artifact(args.output, artifact)
    _log(f"Wrote {args.output} ({args.output.stat().st_size/1024/1024:.2f} MiB); total={time.perf_counter()-total_started:.2f}s")
    print(f"O value interval: [{lower_o:.12g}, {upper_o:.12g}]  gap={gap:.3e}")


if __name__ == "__main__":
    main()
