"""Experimental exact LP methods for Tic-Tac-Nope.

Methods mirror the numbered ideas in the solver-speed discussion:
  1. Explicit SciPy HiGHS dual-simplex / IPM selection.
  2. Direct highspy HiPO with controlled threading.
  3. HiPO/IPM without crossover.
  4. Exact constraint generation using full-game best-response cuts.
  5. Exact restricted-game / double-oracle sequence generation.
  7. Exact intra-mask D4 symmetry quotient.

Every method returns a full-game realization pair.  The runner independently
validates those pairs, so these routines do not get to declare themselves exact.
"""
from __future__ import annotations

import time
from typing import Dict, Iterable, List, Sequence, Tuple

import numpy as np
from scipy.optimize import linprog
from scipy.sparse import csc_matrix, csr_matrix, hstack, vstack

from common import (
    MethodUnavailable,
    Outcome,
    TOL,
    assemble_sequence_lp,
    outcome_from_scipy_result,
    solve_generic_sequence_matrices,
    sparse_pure_realization,
)
import sequence_form_lp as prod
from precompute_all import TRANSFORMS, transform_mask


# ---------------------------------------------------------------------------
# Method 1: explicitly select HiGHS dual simplex or IPM through SciPy.
# ---------------------------------------------------------------------------

def scipy_variant(game: prod.SequenceGame, solver_method: str) -> Outcome:
    if solver_method not in ("highs-ds", "highs-ipm"):
        raise ValueError(solver_method)
    _, _, _, _, a_eq, b_eq, a_ub, b_ub, c, lower, upper = assemble_sequence_lp(game)
    started = time.perf_counter()
    result = linprog(
        c,
        A_ub=a_ub,
        b_ub=b_ub,
        A_eq=a_eq,
        b_eq=b_eq,
        bounds=np.column_stack([lower, upper]),
        method=solver_method,
        options={
            "presolve": True,
            "primal_feasibility_tolerance": TOL,
            "dual_feasibility_tolerance": TOL,
        },
    )
    return outcome_from_scipy_result(
        game,
        f"method1_{solver_method.replace('-', '_')}",
        result,
        {
            "solver": f"scipy.optimize.linprog(method='{solver_method}')",
            "innerSolveSeconds": time.perf_counter() - started,
            "nit": int(getattr(result, "nit", 0) or 0),
        },
    )


# ---------------------------------------------------------------------------
# Methods 2/3: direct highspy, HiPO, threading, optional crossover.
# ---------------------------------------------------------------------------

def _load_highspy():
    try:
        import highspy
    except ImportError as error:
        raise MethodUnavailable(
            "highspy is not installed; run pip install -r 'lp solver tester/requirements.txt'"
        ) from error
    return highspy


def highspy_hipo(
    game: prod.SequenceGame,
    *,
    threads: int,
    crossover: bool,
    name: str,
    time_limit: float = 0.0,
) -> Outcome:
    highspy = _load_highspy()
    _, _, _, _, a_eq, b_eq, a_ub, b_ub, c, lower, upper = assemble_sequence_lp(game)
    matrix = vstack([a_eq, a_ub], format="csc")
    n_eq = a_eq.shape[0]
    inf = highspy.kHighsInf

    model = highspy.HighsLp()
    model.num_col_ = matrix.shape[1]
    model.num_row_ = matrix.shape[0]
    model.col_cost_ = np.asarray(c, dtype=np.double)
    model.col_lower_ = np.where(np.isneginf(lower), -inf, lower).astype(np.double)
    model.col_upper_ = np.where(np.isposinf(upper), inf, upper).astype(np.double)
    row_lower = np.concatenate([b_eq, np.full(len(b_ub), -inf)])
    row_upper = np.concatenate([b_eq, b_ub])
    model.row_lower_ = np.asarray(row_lower, dtype=np.double)
    model.row_upper_ = np.asarray(row_upper, dtype=np.double)
    model.a_matrix_.format_ = highspy.MatrixFormat.kColwise
    model.a_matrix_.start_ = np.asarray(matrix.indptr, dtype=np.int64)
    model.a_matrix_.index_ = np.asarray(matrix.indices, dtype=np.int32)
    model.a_matrix_.value_ = np.asarray(matrix.data, dtype=np.double)

    highs = highspy.Highs()
    highs.setOptionValue("output_flag", False)
    highs.setOptionValue("presolve", "on")
    highs.setOptionValue("primal_feasibility_tolerance", TOL)
    highs.setOptionValue("dual_feasibility_tolerance", TOL)
    highs.setOptionValue("solver", "hipo")
    highs.setOptionValue("threads", int(threads))
    highs.setOptionValue("run_crossover", "on" if crossover else "off")
    if time_limit and time_limit > 0:
        highs.setOptionValue("time_limit", float(time_limit))

    status = highs.passModel(model)
    if status == highspy.HighsStatus.kError:
        raise MethodUnavailable("highspy rejected the LP model")
    started = time.perf_counter()
    status = highs.run()
    elapsed = time.perf_counter() - started
    model_status = highs.modelStatusToString(highs.getModelStatus())
    if status == highspy.HighsStatus.kError or "Optimal" not in model_status:
        # A common reason is a highspy installation without highspy-extras/HiPO.
        raise MethodUnavailable(f"HiPO did not solve to optimality: {model_status}")

    solution = highs.getSolution()
    col_value = np.asarray(list(solution.col_value), dtype=float)
    row_dual = np.asarray(list(solution.row_dual), dtype=float)
    if len(row_dual) != matrix.shape[0]:
        raise RuntimeError("highspy did not return the expected row dual vector")
    n_o = game.o.n_sequences
    xo = col_value[:n_o]
    xx = -row_dual[n_eq:]
    info = highs.getInfo()
    return Outcome(
        name,
        xo,
        xx,
        -float(highs.getObjectiveValue()),
        {
            "solver": "highspy HiPO",
            "threads": int(threads),
            "crossover": bool(crossover),
            "innerSolveSeconds": elapsed,
            "modelStatus": model_status,
            "simplexIterations": int(getattr(info, "simplex_iteration_count", 0) or 0),
            "ipmIterations": int(getattr(info, "ipm_iteration_count", 0) or 0),
        },
    )


# ---------------------------------------------------------------------------
# Method 4: exact best-response constraint generation.
# ---------------------------------------------------------------------------

def _require_native_oracles(game: prod.SequenceGame) -> None:
    needed = (
        (game.o, "uniform_realization"),
        (game.o, "best_response"),
        (game.x, "uniform_realization"),
        (game.x, "best_response"),
    )
    if any(not hasattr(obj, attr) for obj, attr in needed):
        raise MethodUnavailable("method requires the native sequence catalog/oracles")


def constraint_generation(
    game: prod.SequenceGame,
    *,
    max_iterations: int = 200,
    tolerance: float = TOL,
) -> Outcome:
    """Solve max_x min_y x'Ay with pure-opponent-plan cut generation.

    The master retains the complete O realization polytope Ex=e but initially has
    only one robust-payoff cut.  Each iteration obtains an exact X best response
    in the full game and adds its cut.  At convergence, master dual weights mix
    the generated pure X plans into X's equilibrium realization.
    """
    _require_native_oracles(game)
    E, e = game.o.realization_matrix()
    n_o = game.o.n_sequences
    n_x = game.x.n_sequences

    uniform_o = game.o.uniform_realization()
    _, initial_plan, _ = game.x.best_response(
        np.asarray(game.payoff.T @ uniform_o).ravel(), maximize=False
    )

    plans: List[np.ndarray] = []
    cut_rows: List[csr_matrix] = []
    seen = set()

    def add_plan(plan: np.ndarray) -> bool:
        plan = np.asarray(plan, dtype=np.int64)
        signature = plan.tobytes()
        if signature in seen:
            return False
        seen.add(signature)
        plans.append(plan)
        y_sparse = sparse_pure_realization(n_x, plan)
        coeff = game.payoff @ y_sparse  # sparse n_O x 1
        cut_rows.append(hstack([-coeff.T, csr_matrix([[1.0]])], format="csr"))
        return True

    add_plan(initial_plan)
    a_eq = hstack([E, csr_matrix((E.shape[0], 1))], format="csr")
    c = np.zeros(n_o + 1, dtype=float)
    c[-1] = -1.0  # maximize v
    lower = np.zeros(n_o + 1, dtype=float)
    lower[-1] = -np.inf
    upper = np.full(n_o + 1, np.inf, dtype=float)
    bounds = np.column_stack([lower, upper])

    last_result = None
    last_br = None
    master_seconds = 0.0
    for iteration in range(1, max_iterations + 1):
        a_ub = vstack(cut_rows, format="csr")
        started = time.perf_counter()
        result = linprog(
            c,
            A_ub=a_ub,
            b_ub=np.zeros(len(cut_rows)),
            A_eq=a_eq,
            b_eq=e,
            bounds=bounds,
            method="highs-ds",
            options={
                "presolve": True,
                "primal_feasibility_tolerance": TOL,
                "dual_feasibility_tolerance": TOL,
            },
        )
        master_seconds += time.perf_counter() - started
        if not result.success:
            raise RuntimeError(f"constraint-generation master failed: {result.message}")
        xo = np.asarray(result.x[:n_o], dtype=float)
        master_value = float(result.x[-1])
        br_value, br_plan, _ = game.x.best_response(
            np.asarray(game.payoff.T @ xo).ravel(), maximize=False
        )
        last_result = result
        last_br = float(br_value)
        violation = master_value - float(br_value)
        if violation <= tolerance:
            weights = -np.asarray(result.ineqlin.marginals, dtype=float)
            weights[np.abs(weights) <= tolerance] = 0.0
            weights = np.maximum(weights, 0.0)
            total = float(weights.sum())
            if total <= 0:
                raise RuntimeError("constraint-generation master returned no opponent mixture")
            weights /= total
            xx = np.zeros(n_x, dtype=float)
            for weight, plan in zip(weights, plans):
                if weight:
                    xx[plan] += weight
            return Outcome(
                "method4_constraint_generation",
                xo,
                xx,
                0.5 * (master_value + float(br_value)),
                {
                    "iterations": iteration,
                    "generatedOpponentPlans": len(plans),
                    "masterValue": master_value,
                    "fullBestResponseValue": float(br_value),
                    "masterSolveSeconds": master_seconds,
                    "finalViolation": max(0.0, violation),
                },
            )
        if not add_plan(br_plan):
            raise RuntimeError(
                "constraint generation found the same violated best response twice; "
                "numerical tolerances are inconsistent"
            )

    raise RuntimeError(
        f"constraint generation hit {max_iterations} iterations; "
        f"last master/full-BR values were {-last_result.fun if last_result else float('nan')} / {last_br}"
    )


# ---------------------------------------------------------------------------
# Method 5: exact restricted sequence-game / double oracle.
# ---------------------------------------------------------------------------

def double_oracle(
    game: prod.SequenceGame,
    *,
    max_iterations: int = 100,
    tolerance: float = TOL,
) -> Outcome:
    """Grow both players' sequence supports until full-game BRs close the gap."""
    _require_native_oracles(game)
    if not hasattr(game.o, "restricted") or not hasattr(game.x, "restricted"):
        raise MethodUnavailable("native restricted catalogs are unavailable")

    uniform_o = game.o.uniform_realization()
    uniform_x = game.x.uniform_realization()
    _, plan_o, _ = game.o.best_response(
        np.asarray(game.payoff @ uniform_x).ravel(), maximize=True
    )
    _, plan_x, _ = game.x.best_response(
        np.asarray(game.payoff.T @ uniform_o).ravel(), maximize=False
    )
    keep_o = np.asarray(plan_o, dtype=np.int64)
    keep_x = np.asarray(plan_x, dtype=np.int64)

    restricted_solve_seconds = 0.0
    for iteration in range(1, max_iterations + 1):
        keep_o = np.unique(keep_o)
        keep_x = np.unique(keep_x)
        ro = game.o.restricted(keep_o)
        rx = game.x.restricted(keep_x)
        reduced_payoff = game.payoff[keep_o, :][:, keep_x].tocsr()
        reduced = prod.SequenceGame(game.rules, ro, rx, reduced_payoff, game.histories, game.terminals)

        started = time.perf_counter()
        rxo, rxx, _, _, _ = prod.solve_equilibrium(reduced)
        restricted_solve_seconds += time.perf_counter() - started
        xo = np.zeros(game.o.n_sequences, dtype=float)
        xx = np.zeros(game.x.n_sequences, dtype=float)
        xo[keep_o] = rxo
        xx[keep_x] = rxx

        upper, br_o, _ = game.o.best_response(
            np.asarray(game.payoff @ xx).ravel(), maximize=True
        )
        lower, br_x, _ = game.x.best_response(
            np.asarray(game.payoff.T @ xo).ravel(), maximize=False
        )
        gap = float(upper) - float(lower)
        if gap <= tolerance:
            return Outcome(
                "method5_double_oracle",
                xo,
                xx,
                0.5 * (float(lower) + float(upper)),
                {
                    "iterations": iteration,
                    "restrictedSequencesO": int(len(keep_o)),
                    "restrictedSequencesX": int(len(keep_x)),
                    "fullSequencesO": int(game.o.n_sequences),
                    "fullSequencesX": int(game.x.n_sequences),
                    "restrictionFractionO": float(len(keep_o) / game.o.n_sequences),
                    "restrictionFractionX": float(len(keep_x) / game.x.n_sequences),
                    "bestResponseLowerBound": float(lower),
                    "bestResponseUpperBound": float(upper),
                    "exploitabilityGap": max(0.0, gap),
                    "restrictedSolveSeconds": restricted_solve_seconds,
                },
            )

        new_o = np.union1d(keep_o, np.asarray(br_o, dtype=np.int64))
        new_x = np.union1d(keep_x, np.asarray(br_x, dtype=np.int64))
        if len(new_o) == len(keep_o) and len(new_x) == len(keep_x):
            raise RuntimeError("double oracle stalled before full-game exploitability closed")
        keep_o, keep_x = new_o, new_x

    raise RuntimeError(f"double oracle hit {max_iterations} iterations")


# ---------------------------------------------------------------------------
# Method 7: exact D4 stabilizer quotient within one hidden mask.
# ---------------------------------------------------------------------------

_TOKEN_MAP_CACHE: Dict[Tuple[int, ...], np.ndarray] = {}
_POPCOUNT = np.asarray([i.bit_count() for i in range(512)], dtype=np.uint64)


def _token_map(transform: Tuple[int, ...]) -> np.ndarray:
    cached = _TOKEN_MAP_CACHE.get(transform)
    if cached is not None:
        return cached
    mapping = np.arange(32, dtype=np.uint64)
    mapping[0] = 0
    mapping[1] = 1  # anonymous H token
    for move in range(9):
        mapping[2 + move] = 2 + transform[move]       # P<move>
        mapping[11 + move] = 11 + transform[move]    # V1<move>
        mapping[20 + move] = 20 + transform[move]    # V2<move>
    _TOKEN_MAP_CACHE[transform] = mapping
    return mapping


def _transform_observation_arrays(catalog, transform: Tuple[int, ...]):
    """Vectorized lossless transform of the native base-32 observation codes."""
    low = np.asarray(catalog.obs_low, dtype=np.uint64)
    high = np.asarray(catalog.obs_high, dtype=np.uint64)
    out_low = np.zeros_like(low)
    out_high = np.zeros_like(high)
    token_map = _token_map(transform)
    mask31 = np.uint64(31)

    # Native observations use five nonzero bits per token.  Position 60 is the
    # sole token slot crossing the uint64 boundary.
    for position in range(0, 125, 5):
        if position <= 55:
            token = (low >> np.uint64(position)) & mask31
            mapped = token_map[token]
            out_low |= mapped << np.uint64(position)
        elif position == 60:
            token = ((low >> np.uint64(60)) & np.uint64(15)) | ((high & np.uint64(1)) << np.uint64(4))
            mapped = token_map[token]
            out_low |= (mapped & np.uint64(15)) << np.uint64(60)
            out_high |= (mapped >> np.uint64(4)) & np.uint64(1)
        else:
            shift = position - 64
            token = (high >> np.uint64(shift)) & mask31
            mapped = token_map[token]
            out_high |= mapped << np.uint64(shift)
    return out_low, out_high


def _information_permutation(catalog, transform: Tuple[int, ...]) -> np.ndarray:
    target_low, target_high = _transform_observation_arrays(catalog, transform)
    dtype = np.dtype([("high", np.uint64), ("low", np.uint64)])
    base = np.empty(len(catalog.parent_sequences), dtype=dtype)
    base["high"] = catalog.obs_high
    base["low"] = catalog.obs_low
    target = np.empty(len(base), dtype=dtype)
    target["high"] = target_high
    target["low"] = target_low
    order = np.argsort(base, order=("high", "low"))
    sorted_base = base[order]
    positions = np.searchsorted(sorted_base, target)
    if np.any(positions >= len(sorted_base)):
        raise RuntimeError("symmetry transformed an information set outside the catalog")
    mapped = order[positions]
    if not np.all(sorted_base[positions] == target):
        raise RuntimeError("symmetry-transformed observation key was not found")
    return np.asarray(mapped, dtype=np.int64)


def _sequence_permutation(catalog, info_perm: np.ndarray, transform: Tuple[int, ...]) -> np.ndarray:
    mapping = np.full(catalog.n_sequences, -1, dtype=np.int64)
    mapping[0] = 0
    action_masks = np.asarray(catalog.action_masks, dtype=np.uint16)
    first = np.asarray(catalog.first_children, dtype=np.uint64)
    for move in range(9):
        selected = (action_masks & (1 << move)) != 0
        if not np.any(selected):
            continue
        target_infos = info_perm[selected]
        target_move = transform[move]
        target_masks = action_masks[target_infos]
        if np.any((target_masks & (1 << target_move)) == 0):
            raise RuntimeError("symmetry did not preserve an information set's legal actions")
        source_sequences = first[selected] + _POPCOUNT[action_masks[selected] & ((1 << move) - 1)]
        target_sequences = first[target_infos] + _POPCOUNT[target_masks & ((1 << target_move) - 1)]
        mapping[source_sequences.astype(np.int64)] = target_sequences.astype(np.int64)
    if np.any(mapping < 0):
        raise RuntimeError("incomplete symmetry sequence permutation")
    return mapping


def _catalog_orbits(catalog, transforms: Sequence[Tuple[int, ...]]):
    seq_canonical = np.arange(catalog.n_sequences, dtype=np.int64)
    info_canonical = np.arange(len(catalog.parent_sequences), dtype=np.int64)
    for transform in transforms:
        info_perm = _information_permutation(catalog, transform)
        seq_perm = _sequence_permutation(catalog, info_perm, transform)
        seq_canonical = np.minimum(seq_canonical, seq_perm)
        info_canonical = np.minimum(info_canonical, info_perm)

    _, sequence_orbit = np.unique(seq_canonical, return_inverse=True)
    _, info_representative_indices = np.unique(info_canonical, return_index=True)
    info_representative_indices = np.sort(info_representative_indices)
    rows = np.concatenate(([0], info_representative_indices + 1)).astype(np.int64)
    projection = csc_matrix(
        (
            np.ones(catalog.n_sequences, dtype=float),
            (np.arange(catalog.n_sequences, dtype=np.int64), sequence_orbit.astype(np.int64)),
        ),
        shape=(catalog.n_sequences, int(sequence_orbit.max()) + 1),
    )
    return sequence_orbit.astype(np.int64), rows, projection


def symmetry_quotient(game: prod.SequenceGame) -> Outcome:
    if not all(hasattr(game.o, attr) for attr in ("obs_low", "obs_high", "first_children", "action_masks")):
        raise MethodUnavailable("symmetry quotient requires native compact sequence catalogs")

    stabilizer = [
        transform
        for transform in TRANSFORMS.values()
        if transform_mask(game.rules.hidden_mask, transform) == game.rules.hidden_mask
    ]
    if len(stabilizer) <= 1:
        raise MethodUnavailable("this hidden mask has only the identity D4 stabilizer")

    orbit_o, rows_o, P_o = _catalog_orbits(game.o, stabilizer)
    orbit_x, rows_x, P_x = _catalog_orbits(game.x, stabilizer)
    E, e = game.o.realization_matrix()
    F, f = game.x.realization_matrix()
    E_reduced = (E[rows_o, :] @ P_o).tocsr()
    F_reduced = (F[rows_x, :] @ P_x).tocsr()
    e_reduced = np.asarray(e[rows_o], dtype=float)
    f_reduced = np.asarray(f[rows_x], dtype=float)
    payoff_reduced = (P_o.T @ game.payoff @ P_x).tocsr()

    started = time.perf_counter()
    zo, zx, value, result = solve_generic_sequence_matrices(
        E_reduced, e_reduced, F_reduced, f_reduced, payoff_reduced, method="highs"
    )
    solve_seconds = time.perf_counter() - started
    xo = zo[orbit_o]
    xx = zx[orbit_x]
    return Outcome(
        "method7_symmetry_quotient",
        xo,
        xx,
        value,
        {
            "stabilizerSize": len(stabilizer),
            "fullSequencesO": int(game.o.n_sequences),
            "fullSequencesX": int(game.x.n_sequences),
            "reducedSequencesO": int(E_reduced.shape[1]),
            "reducedSequencesX": int(F_reduced.shape[1]),
            "fullConstraintsO": int(E.shape[0]),
            "fullConstraintsX": int(F.shape[0]),
            "reducedConstraintsO": int(E_reduced.shape[0]),
            "reducedConstraintsX": int(F_reduced.shape[0]),
            "reducedPayoffNnz": int(payoff_reduced.nnz),
            "innerSolveSeconds": solve_seconds,
            "solverMessage": str(result.message),
        },
    )
