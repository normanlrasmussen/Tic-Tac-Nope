"""Exact deterministic-flow reduction for the sequence-form LP.

This module is opt-in.  It contracts sequence variables joined by information
sets with exactly one legal action, solves the resulting mathematically
equivalent primal-dual LP, lifts both realization plans, reconstructs full
dual potentials, and runs the unchanged full-game certificate.
"""

from __future__ import annotations

from dataclasses import dataclass
import time

import numpy as np
from scipy.optimize import OptimizeResult
from scipy.sparse import coo_matrix, csr_matrix

import sequence_form_lp as prod


_ACTION_COUNTS = np.array([mask.bit_count() for mask in range(512)], dtype=np.int16)


@dataclass
class FlowReduction:
    """Mapping from a full sequence catalog to a reduced realization space."""

    full_to_reduced: np.ndarray
    matrix: csr_matrix
    rhs: np.ndarray
    active_rows: np.ndarray
    deterministic_equalities: int

    @property
    def full_sequences(self) -> int:
        return int(len(self.full_to_reduced))

    @property
    def reduced_sequences(self) -> int:
        return int(self.matrix.shape[1])

    def lift(self, realization: np.ndarray) -> np.ndarray:
        values = np.asarray(realization, dtype=float)
        if values.shape != (self.reduced_sequences,):
            raise ValueError("Reduced realization has the wrong shape")
        return values[self.full_to_reduced]


def _deterministic_edges(catalog) -> tuple[np.ndarray, np.ndarray]:
    """Return parent/child sequence edges for one-action information sets."""
    native_arrays = all(
        hasattr(catalog, name)
        for name in ("parent_sequences", "first_children", "action_masks")
    )
    if native_arrays:
        masks = np.asarray(catalog.action_masks)
        selected = _ACTION_COUNTS[masks.astype(np.int64, copy=False)] == 1
        return (
            np.asarray(catalog.parent_sequences[selected], dtype=np.int64),
            np.asarray(catalog.first_children[selected], dtype=np.int64),
        )

    parents = []
    children = []
    for info in catalog.infos.values():
        if len(info.actions) == 1:
            parents.append(info.parent_sequence)
            children.append(info.child_sequences[0])
    return np.asarray(parents, dtype=np.int64), np.asarray(children, dtype=np.int64)


def _union_mapping(length: int, parents: np.ndarray, children: np.ndarray) -> np.ndarray:
    representative = np.arange(length, dtype=np.int64)

    def find(value: int) -> int:
        root = value
        while representative[root] != root:
            root = int(representative[root])
        while representative[value] != value:
            next_value = int(representative[value])
            representative[value] = root
            value = next_value
        return root

    for parent, child in zip(parents, children):
        parent_root = find(int(parent))
        child_root = find(int(child))
        if parent_root != child_root:
            representative[child_root] = parent_root

    for index in range(length):
        representative[index] = find(index)
    _, compact = np.unique(representative, return_inverse=True)
    return compact.astype(np.int64, copy=False)


def _aggregate_columns(matrix: csr_matrix, mapping: np.ndarray) -> csr_matrix:
    source = matrix.tocoo(copy=False)
    result = coo_matrix(
        (source.data, (source.row, mapping[source.col])),
        shape=(matrix.shape[0], int(mapping.max()) + 1),
        dtype=float,
    ).tocsr()
    result.sum_duplicates()
    result.eliminate_zeros()
    return result


def build_flow_reduction(catalog, matrix: csr_matrix, rhs: np.ndarray) -> FlowReduction:
    parents, children = _deterministic_edges(catalog)
    mapping = _union_mapping(matrix.shape[1], parents, children)
    reduced = _aggregate_columns(matrix, mapping)
    reduced_rhs = np.asarray(rhs, dtype=float)
    active = (np.diff(reduced.indptr) != 0) | (np.abs(reduced_rhs) > 0.0)
    return FlowReduction(
        full_to_reduced=mapping,
        matrix=reduced[active].tocsr(),
        rhs=reduced_rhs[active],
        active_rows=np.flatnonzero(active),
        deterministic_equalities=int(len(parents)),
    )


def _aggregate_payoff(payoff: csr_matrix, self_map: np.ndarray, opp_map: np.ndarray) -> csr_matrix:
    source = payoff.tocoo(copy=False)
    reduced = coo_matrix(
        (
            source.data,
            (self_map[source.row], opp_map[source.col]),
        ),
        shape=(int(self_map.max()) + 1, int(opp_map.max()) + 1),
        dtype=float,
    ).tocsr()
    reduced.sum_duplicates()
    reduced.eliminate_zeros()
    return reduced


def _catalog_structure(catalog) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return parent sequence, child-start, and child-end arrays cheaply."""
    if all(hasattr(catalog, name) for name in ("parent_sequences", "first_children")):
        parents = np.asarray(catalog.parent_sequences, dtype=np.int64)
        starts = np.asarray(catalog.first_children, dtype=np.int64)
        ends = np.empty(len(starts), dtype=np.int64)
        if len(starts):
            ends[:-1] = starts[1:]
            ends[-1] = catalog.n_sequences
        return parents, starts, ends

    infos = list(catalog.infos.values())
    parents = np.asarray([info.parent_sequence for info in infos], dtype=np.int64)
    starts = np.asarray(
        [info.child_sequences[0] for info in infos], dtype=np.int64
    )
    ends = np.asarray(
        [info.child_sequences[-1] + 1 for info in infos], dtype=np.int64
    )
    return parents, starts, ends


def _dual_potentials_min(catalog, coefficients: np.ndarray) -> np.ndarray:
    """Construct a feasible optimal dual for a catalog minimization BR."""
    values = np.asarray(coefficients, dtype=float)
    if values.shape != (catalog.n_sequences,) or not np.isfinite(values).all():
        raise ValueError("Invalid best-response coefficients")

    # The native catalog already computes the same sequence-tree dual
    # potentials while finding a best-response plan.  Reuse that native path
    # instead of spending seconds iterating over hundreds of thousands of
    # information sets in Python.  The returned potentials are still checked
    # against the original full F matrix by the unchanged certificate.
    native_best_response = getattr(catalog, "best_response", None)
    if native_best_response is not None:
        _, _, potentials = native_best_response(values, maximize=False)
        return np.asarray(potentials, dtype=float)

    parents, starts, ends = _catalog_structure(catalog)
    potentials = np.zeros(catalog.n_constraints, dtype=float)
    continuation = np.zeros(catalog.n_sequences, dtype=float)
    # Sequence catalogs register an information set only after its parent
    # sequence exists, and all descendant information sets are registered
    # later.  Reverse registration order is therefore a topological order for
    # this sequence-tree dynamic program and avoids allocating an argsort of
    # every information set.
    for index in range(len(parents) - 1, -1, -1):
        child_slice = slice(int(starts[index]), int(ends[index]))
        potentials[index + 1] = -float(
            np.min(values[child_slice] - continuation[child_slice])
        )
        continuation[parents[index]] += potentials[index + 1]
    potentials[0] = values[0] - continuation[0]
    return potentials


def _solve_reduced_lp(E, e, F, f, payoff, backend: str):
    n_x = E.shape[1]
    n_p = F.shape[0]
    if backend == "highspy":
        return prod._solve_highspy_streaming(
            E, e, F, f, payoff, n_x, n_p,
            flow_transpose=F.transpose().tocsc(copy=False),
        )
    return prod._solve_scipy(E, e, F, f, payoff, n_x, n_p)


def solve_equilibrium_reduced(game: prod.SequenceGame, backend: str = "highspy"):
    if backend not in {"highspy", "auto", "scipy"}:
        raise ValueError("Reduced LP backend must be highspy, auto, or scipy")
    total_started = time.perf_counter()
    E, e = game.o.realization_matrix()
    F, f = game.x.realization_matrix()
    reduction_started = time.perf_counter()
    reduced_o = build_flow_reduction(game.o, E, e)
    reduced_x = build_flow_reduction(game.x, F, f)
    reduced_payoff = _aggregate_payoff(
        game.payoff, reduced_o.full_to_reduced, reduced_x.full_to_reduced
    )
    reduction_seconds = time.perf_counter() - reduction_started

    selected_backend = backend
    if backend == "auto":
        try:
            import highspy  # noqa: F401
            selected_backend = "highspy"
        except ImportError:
            selected_backend = "scipy"
    result = _solve_reduced_lp(
        reduced_o.matrix, reduced_o.rhs,
        reduced_x.matrix, reduced_x.rhs,
        reduced_payoff, selected_backend,
    )
    if not result.success:
        raise RuntimeError(f"Reduced HiGHS failed: {result.message}")

    reduced_o_realization = np.asarray(result.x[:reduced_o.reduced_sequences], dtype=float)
    reduced_x_realization = -np.asarray(result.ineqlin.marginals, dtype=float)
    lift_started = time.perf_counter()
    realization_o = reduced_o.lift(reduced_o_realization)
    realization_x = reduced_x.lift(reduced_x_realization)
    against_x = np.asarray(game.payoff @ realization_x).ravel()
    against_o = np.asarray(game.payoff.T @ realization_o).ravel()
    lower_potential = _dual_potentials_min(game.x, against_o)
    upper_potential = -_dual_potentials_min(game.o, -against_x)
    lift_seconds = time.perf_counter() - lift_started

    result.x = np.concatenate([realization_o, lower_potential])
    result.ineqlin = OptimizeResult(marginals=-realization_x)
    result.eqlin = OptimizeResult(marginals=-upper_potential)
    result.opponent_realization = realization_x
    result.lower_bound = float(f @ lower_potential)
    result.upper_bound = float(e @ upper_potential)
    result.fun = -float(result.lower_bound)
    certificate_started = time.perf_counter()
    result.certificate = prod._certify_realization_pair(
        E, e, F, f, game.payoff,
        realization_o, realization_x,
        lower_potential, upper_potential,
        -float(result.fun), prod.FEASIBILITY_TOLERANCE,
        game.o, game.x,
    )
    certificate_seconds = time.perf_counter() - certificate_started
    result.solver_backend = f"{getattr(result, 'solver_backend', selected_backend)}-reduced"
    result.timings = {
        **getattr(result, "timings", {}),
        "reductionSeconds": reduction_seconds,
        "liftSeconds": lift_seconds,
        "certificateSeconds": certificate_seconds,
        "totalSeconds": time.perf_counter() - total_started,
        "fullOSequences": int(game.o.n_sequences),
        "fullXSequences": int(game.x.n_sequences),
        "reducedOSequences": reduced_o.reduced_sequences,
        "reducedXSequences": reduced_x.reduced_sequences,
        "reducedORows": int(reduced_o.matrix.shape[0]),
        "reducedXRows": int(reduced_x.matrix.shape[0]),
        "reducedPayoffNnz": int(reduced_payoff.nnz),
        "deterministicEqualitiesO": reduced_o.deterministic_equalities,
        "deterministicEqualitiesX": reduced_x.deterministic_equalities,
    }
    return realization_o, realization_x, result.lower_bound, result.upper_bound, result
