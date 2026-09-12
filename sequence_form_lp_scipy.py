"""SciPy/HiGHS LP backend for the exact sequence-form solver."""

from __future__ import annotations

import time

import numpy as np
from scipy.optimize import OptimizeResult, linprog
from scipy.sparse import csc_matrix, hstack

from sequence_form_lp import FEASIBILITY_TOLERANCE, _log, _matrix_mib


def solve_scipy(E, e, F, f, payoff_self, n_x, n_p) -> OptimizeResult:
    """Solve the augmented sequence-form LP with SciPy's HiGHS interface."""
    started = time.perf_counter()
    _log("SciPy fallback: assembling full augmented equality matrix")
    A_eq = hstack(
        [E.tocsc(), csc_matrix((E.shape[0], n_p), dtype=float)],
        format="csc",
    )
    _log(
        f"A_eq ready: shape={A_eq.shape} nnz={A_eq.nnz:,} "
        f"size={_matrix_mib(A_eq):.1f} MiB"
    )
    _log("SciPy fallback: assembling full augmented inequality matrix")
    A_ub = hstack([-payoff_self.T, F.T], format="csc")
    _log(
        f"A_ub ready: shape={A_ub.shape} nnz={A_ub.nnz:,} "
        f"size={_matrix_mib(A_ub):.1f} MiB"
    )
    c = np.zeros(n_x + n_p, dtype=float)
    c[n_x:] = -f
    bounds = np.empty((n_x + n_p, 2), dtype=float)
    bounds[:, 0] = 0.0
    bounds[n_x:, 0] = -np.inf
    bounds[:, 1] = np.inf
    _log(
        f"Calling scipy.optimize.linprog after "
        f"{time.perf_counter() - started:.2f}s of LP assembly"
    )
    solve_started = time.perf_counter()
    result = linprog(
        c,
        A_ub=A_ub,
        b_ub=np.zeros(F.shape[1]),
        A_eq=A_eq,
        b_eq=e,
        bounds=bounds,
        method="highs",
        options={
            "presolve": True,
            "primal_feasibility_tolerance": FEASIBILITY_TOLERANCE,
            "dual_feasibility_tolerance": FEASIBILITY_TOLERANCE,
        },
    )
    _log(f"SciPy/HiGHS returned in {time.perf_counter() - solve_started:.2f}s")
    result.solver_backend = "scipy-highs-augmented"
    result.timings = {
        "assemblySeconds": solve_started - started,
        "streamingSeconds": 0.0,
        "solveSeconds": time.perf_counter() - solve_started,
        "backendTotalSeconds": time.perf_counter() - started,
        "chunkColumns": 0,
        "payoffTransposeCached": False,
        "simplexMode": "scipy-default",
    }
    return result
