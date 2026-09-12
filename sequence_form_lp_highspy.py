"""Direct streaming highspy/HiGHS backend for the exact sequence-form solver."""

from __future__ import annotations

import os
import time

import numpy as np
from scipy.optimize import OptimizeResult
from scipy.sparse import csc_matrix, vstack

from sequence_form_lp import FEASIBILITY_TOLERANCE, _log


def solve_highspy_streaming(E, e, F, f, payoff_self, n_x, n_p) -> OptimizeResult:
    """Stream the augmented sequence-form LP into a direct HiGHS model."""
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
        block = vstack(
            [E_csc[:, lo:hi], -payoff_self[lo:hi, :].T],
            format="csc",
        )
        # Native payoff aggregation can leave duplicate sequence-pair entries
        # in different flushes. HiGHS requires canonical streamed columns.
        if not block.has_canonical_format:
            block.sum_duplicates()
            block.eliminate_zeros()
        m = hi - lo
        status = highs.addCols(
            m,
            np.zeros(m),
            np.zeros(m),
            np.full(m, inf),
            block.nnz,
            block.indptr[:-1],
            block.indices,
            block.data,
        )
        if status == highspy.HighsStatus.kError:
            raise RuntimeError(f"highspy rejected realization columns {lo}:{hi}")
        streamed_nnz += block.nnz
        if hi == n_x or (lo // chunk_cols) % 10 == 0:
            _log(
                f"highspy: streamed realization cols {hi:,}/{n_x:,}; "
                f"nnz copied={streamed_nnz:,}"
            )
        del block
    del E_csc

    n_eq = E.shape[0]
    for lo in range(0, n_p, chunk_cols):
        hi = min(n_p, lo + chunk_cols)
        source = F[lo:hi, :].T.tocsc()
        shifted = source.indices.astype(
            np.int64 if total_rows >= 2**31 else np.int32,
            copy=True,
        )
        shifted += n_eq
        block = csc_matrix(
            (source.data, shifted, source.indptr),
            shape=(total_rows, hi - lo),
            copy=False,
        )
        costs = -f[lo:hi]
        m = hi - lo
        status = highs.addCols(
            m,
            costs,
            np.full(m, -inf),
            np.full(m, inf),
            block.nnz,
            block.indptr[:-1],
            block.indices,
            block.data,
        )
        if status == highspy.HighsStatus.kError:
            raise RuntimeError(f"highspy rejected potential columns {lo}:{hi}")
        streamed_nnz += block.nnz
        if hi == n_p or (lo // chunk_cols) % 10 == 0:
            _log(
                f"highspy: streamed potential cols {hi:,}/{n_p:,}; "
                f"nnz copied={streamed_nnz:,}"
            )
        del source, shifted, block

    _log(
        f"highspy LP streaming complete in {time.perf_counter() - started:.2f}s; "
        "starting HiGHS solve"
    )
    solve_started = time.perf_counter()
    status = highs.run()
    model_status = highs.modelStatusToString(highs.getModelStatus())
    _log(
        f"highspy/HiGHS returned in {time.perf_counter() - solve_started:.2f}s "
        f"with status={model_status}"
    )
    if status == highspy.HighsStatus.kError or "Optimal" not in model_status:
        raise RuntimeError(f"HiGHS failed: {model_status}")
    solution = highs.getSolution()
    col_value = np.asarray(solution.col_value, dtype=float)
    row_dual = np.asarray(solution.row_dual, dtype=float)
    result = OptimizeResult()
    result.success = True
    result.status = 0
    result.message = model_status
    result.x = col_value
    result.fun = float(highs.getObjectiveValue())
    result.eqlin = OptimizeResult(marginals=row_dual[:n_eq])
    result.ineqlin = OptimizeResult(marginals=row_dual[n_eq:])
    info = highs.getInfo()
    result.nit = int(getattr(info, "simplex_iteration_count", 0) or 0) + int(
        getattr(info, "ipm_iteration_count", 0) or 0
    )
    result.solver_backend = "highspy-streaming"
    return result
