"""Direct streaming highspy/HiGHS backend for the exact sequence-form solver."""

from __future__ import annotations

import os
import time

import numpy as np
from scipy.optimize import OptimizeResult
from scipy.sparse import csc_matrix, vstack

from sequence_form_lp import FEASIBILITY_TOLERANCE, _log


def _set_highs_options(highs, highspy) -> dict[str, object]:
    """Configure the permitted direct HiGHS simplex choices.

    ``choose`` is retained as the reference setting.  ``dual`` explicitly
    selects the dual simplex path.  No interior-point/HiPO setting is accepted
    here, including through environment configuration.
    """
    # Preserve the pre-optimization production choice by default.  The
    # explicit dual setting is available to the benchmark harness and may only
    # become a production default after it demonstrates a certified win.
    mode = os.environ.get("TTN_HIGHS_SIMPLEX_MODE", "choose").strip().lower()
    if mode not in {"choose", "dual"}:
        raise ValueError("TTN_HIGHS_SIMPLEX_MODE must be 'choose' or 'dual'")

    highs.setOptionValue("output_flag", False)
    highs.setOptionValue("presolve", "on")
    highs.setOptionValue("primal_feasibility_tolerance", FEASIBILITY_TOLERANCE)
    highs.setOptionValue("dual_feasibility_tolerance", FEASIBILITY_TOLERANCE)
    if mode == "dual":
        highs.setOptionValue("solver", "simplex")
        highs.setOptionValue("simplex_strategy", 1)
    else:
        highs.setOptionValue("solver", "choose")

    parallel = os.environ.get("TTN_HIGHS_PARALLEL", "choose").strip().lower()
    if parallel not in {"choose", "on", "off"}:
        raise ValueError("TTN_HIGHS_PARALLEL must be 'choose', 'on', or 'off'")
    highs.setOptionValue("parallel", parallel)

    threads_text = os.environ.get("TTN_HIGHS_THREADS")
    if threads_text:
        threads = int(threads_text)
        if threads <= 0:
            raise ValueError("TTN_HIGHS_THREADS must be positive")
        highs.setOptionValue("threads", threads)

    return {
        "simplexMode": mode,
        "parallel": parallel,
        "threads": int(threads_text) if threads_text else 0,
    }


def solve_highspy_streaming(
    E,
    e,
    F,
    f,
    payoff_self,
    n_x,
    n_p,
    *,
    flow_transpose=None,
) -> OptimizeResult:
    """Stream the augmented sequence-form LP into a direct HiGHS model."""
    try:
        import highspy
    except ImportError as error:
        raise ModuleNotFoundError("highspy is not installed") from error

    chunk_cols = max(1, int(os.environ.get("TTN_HIGHS_CHUNK_COLS", "50000")))
    started = time.perf_counter()
    total_rows = E.shape[0] + F.shape[1]
    inf = highspy.kHighsInf
    highs = highspy.Highs()
    highs_options = _set_highs_options(highs, highspy)

    row_lower = np.concatenate([e, np.full(F.shape[1], -inf, dtype=float)])
    row_upper = np.concatenate([e, np.zeros(F.shape[1], dtype=float)])
    _log(f"highspy: creating {total_rows:,} LP rows before streaming columns")
    status = highs.addRows(total_rows, row_lower, row_upper, 0, 0, 0, 0)
    if status == highspy.HighsStatus.kError:
        raise RuntimeError("highspy rejected empty LP rows")
    del row_lower, row_upper

    E_csc = E.tocsc(copy=False)
    # F.T is a small sparse flow structure relative to the payoff matrix.  It
    # is cached by SequenceCatalog for normal production calls and computed once
    # here for the standalone backend API used by focused tests.
    F_t = flow_transpose if flow_transpose is not None else F.transpose().tocsc(copy=False)
    cache_payoff_transpose = os.environ.get(
        "TTN_HIGHS_CACHE_PAYOFF_TRANSPOSE", "0"
    ).strip().lower() in {"1", "true", "on"}
    payoff_t = payoff_self.transpose().tocsc(copy=False) if cache_payoff_transpose else None
    streamed_nnz = 0
    streaming_started = time.perf_counter()
    for lo in range(0, n_x, chunk_cols):
        hi = min(n_x, lo + chunk_cols)
        payoff_block = (
            payoff_t[:, lo:hi]
            if payoff_t is not None
            else payoff_self[lo:hi, :].T
        )
        block = vstack(
            [E_csc[:, lo:hi], -payoff_block],
            format="csc",
        )
        del payoff_block
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
        source = F_t[:, lo:hi]
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

    streaming_seconds = time.perf_counter() - streaming_started
    _log(
        f"highspy LP streaming complete in {streaming_seconds:.2f}s; "
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
    simplex_iterations = int(getattr(info, "simplex_iteration_count", 0) or 0)
    ipm_iterations = int(getattr(info, "ipm_iteration_count", 0) or 0)
    result.nit = simplex_iterations + ipm_iterations
    result.solver_backend = "highspy-streaming"
    result.timings = {
        "assemblySeconds": streaming_started - started,
        "streamingSeconds": streaming_seconds,
        "solveSeconds": time.perf_counter() - solve_started,
        "backendTotalSeconds": time.perf_counter() - started,
        "chunkColumns": chunk_cols,
        "payoffTransposeCached": payoff_t is not None,
        "simplexIterations": simplex_iterations,
        "ipmIterations": ipm_iterations,
        **highs_options,
    }
    return result
