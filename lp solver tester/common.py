"""Shared utilities for exact LP-solver experiments.

This module deliberately imports the production game/enumerator, but none of the
experiments in this directory are imported by production code.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
import sys
from typing import Any, Dict, Optional

import numpy as np
from scipy.sparse import csc_matrix, csr_matrix, hstack, vstack

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import sequence_form_lp as prod

TOL = prod.FEASIBILITY_TOLERANCE
ACCURACY_TOL = 5e-7


@dataclass
class Outcome:
    name: str
    realization_o: np.ndarray
    realization_x: np.ndarray
    reported_value: float
    metadata: Dict[str, Any] = field(default_factory=dict)


class MethodUnavailable(RuntimeError):
    """Raised when an optional solver backend is not installed/usable."""


def max_abs(values: np.ndarray) -> float:
    arr = np.asarray(values, dtype=float)
    return float(np.max(np.abs(arr), initial=0.0))


def max_positive(values: np.ndarray) -> float:
    arr = np.asarray(values, dtype=float)
    return float(max(0.0, np.max(arr, initial=0.0)))


def validate_outcome(
    game: prod.SequenceGame,
    outcome: Outcome,
    reference_value: Optional[float] = None,
    *,
    tolerance: float = ACCURACY_TOL,
) -> Dict[str, Any]:
    """Validate a candidate against the *complete* game.

    Accuracy does not rely on the candidate solver's own status.  We independently
    check both realization-flow systems, nonnegativity, the actual payoff, and
    full-game best responses.  A candidate is called accurate only when its
    exploitability interval is closed to tolerance and (when available) agrees
    with the original production solver's value.
    """
    xo = np.asarray(outcome.realization_o, dtype=float)
    xx = np.asarray(outcome.realization_x, dtype=float)
    if xo.shape != (game.o.n_sequences,) or xx.shape != (game.x.n_sequences,):
        return {
            "accurate": False,
            "reason": "realization shape mismatch",
            "oShape": list(xo.shape),
            "xShape": list(xx.shape),
        }
    if not np.isfinite(xo).all() or not np.isfinite(xx).all():
        return {"accurate": False, "reason": "non-finite realization weights"}

    E, e = game.o.realization_matrix()
    F, f = game.x.realization_matrix()
    flow_o = max_abs(E @ xo - e)
    flow_x = max_abs(F @ xx - f)
    nonneg_o = max_positive(-xo)
    nonneg_x = max_positive(-xx)

    against_x = np.asarray(game.payoff @ xx).ravel()
    against_o = np.asarray(game.payoff.T @ xo).ravel()
    upper = prod.best_response_value(game.o, against_x, maximize=True)
    lower = prod.best_response_value(game.x, against_o, maximize=False)
    payoff = float(xo @ against_x)
    value = 0.5 * (lower + upper)
    exploitability = max(0.0, upper - lower)
    payoff_residual = max(0.0, lower - payoff, payoff - upper)
    report_residual = abs(float(outcome.reported_value) - value)
    reference_error = None if reference_value is None else abs(value - float(reference_value))

    accurate = (
        flow_o <= tolerance
        and flow_x <= tolerance
        and nonneg_o <= tolerance
        and nonneg_x <= tolerance
        and exploitability <= tolerance
        and payoff_residual <= tolerance
        and report_residual <= tolerance
        and (reference_error is None or reference_error <= tolerance)
    )
    return {
        "accurate": bool(accurate),
        "value": value,
        "reportedValue": float(outcome.reported_value),
        "payoff": payoff,
        "bestResponseLowerBound": lower,
        "bestResponseUpperBound": upper,
        "exploitabilityGap": exploitability,
        "flowResidualO": flow_o,
        "flowResidualX": flow_x,
        "nonnegativityResidualO": nonneg_o,
        "nonnegativityResidualX": nonneg_x,
        "payoffBoundsResidual": payoff_residual,
        "reportedValueResidual": report_residual,
        "referenceValueError": reference_error,
        "tolerance": tolerance,
    }


def production_baseline(game: prod.SequenceGame) -> Outcome:
    xo, xx, lower, upper, result = prod.solve_equilibrium(game)
    return Outcome(
        "original_current",
        np.asarray(xo, dtype=float),
        np.asarray(xx, dtype=float),
        0.5 * (float(lower) + float(upper)),
        {
            "solver": "production scipy.optimize.linprog(method='highs')",
            "lowerBound": float(lower),
            "upperBound": float(upper),
            "dualityGap": max(0.0, float(upper) - float(lower)),
            "solverMessage": str(result.message),
        },
    )


def assemble_sequence_lp(game: prod.SequenceGame):
    """Return the production O-oriented LP in sparse minimization form."""
    E, e = game.o.realization_matrix()
    F, f = game.x.realization_matrix()
    n_x = game.o.n_sequences
    n_p = game.x.n_constraints
    a_eq = hstack([E.tocsc(), csc_matrix((E.shape[0], n_p))], format="csc")
    a_ub = hstack([-game.payoff.T, F.T], format="csc")
    c = np.zeros(n_x + n_p, dtype=float)
    c[n_x:] = -f
    lower = np.zeros(n_x + n_p, dtype=float)
    lower[n_x:] = -np.inf
    upper = np.full(n_x + n_p, np.inf, dtype=float)
    return E, e, F, f, a_eq, e, a_ub, np.zeros(game.x.n_sequences), c, lower, upper


def outcome_from_scipy_result(game: prod.SequenceGame, name: str, result, metadata=None) -> Outcome:
    if not result.success:
        raise RuntimeError(f"{name}: HiGHS failed: {result.message}")
    n_o = game.o.n_sequences
    xo = np.asarray(result.x[:n_o], dtype=float)
    xx = -np.asarray(result.ineqlin.marginals, dtype=float)
    reported = -float(result.fun)
    details = {"solverMessage": str(result.message)}
    if metadata:
        details.update(metadata)
    return Outcome(name, xo, xx, reported, details)


def solve_generic_sequence_matrices(
    E: csr_matrix,
    e: np.ndarray,
    F: csr_matrix,
    f: np.ndarray,
    payoff: csr_matrix,
    *,
    method: str = "highs",
):
    """Solve a generic sequence-form saddle point and recover both realizations."""
    from scipy.optimize import linprog

    n_x = E.shape[1]
    n_p = F.shape[0]
    a_eq = hstack([E.tocsc(), csc_matrix((E.shape[0], n_p))], format="csc")
    a_ub = hstack([-payoff.T, F.T], format="csc")
    c = np.zeros(n_x + n_p, dtype=float)
    c[n_x:] = -f
    lower = np.zeros(n_x + n_p, dtype=float)
    lower[n_x:] = -np.inf
    upper = np.full(n_x + n_p, np.inf, dtype=float)
    result = linprog(
        c,
        A_ub=a_ub,
        b_ub=np.zeros(F.shape[1]),
        A_eq=a_eq,
        b_eq=e,
        bounds=np.column_stack([lower, upper]),
        method=method,
        options={
            "presolve": True,
            "primal_feasibility_tolerance": TOL,
            "dual_feasibility_tolerance": TOL,
        },
    )
    if not result.success:
        raise RuntimeError(result.message)
    return (
        np.asarray(result.x[:n_x], dtype=float),
        -np.asarray(result.ineqlin.marginals, dtype=float),
        -float(result.fun),
        result,
    )


def sparse_pure_realization(length: int, plan: np.ndarray) -> csc_matrix:
    plan = np.asarray(plan, dtype=np.int64)
    return csc_matrix(
        (np.ones(len(plan), dtype=float), (plan, np.zeros(len(plan), dtype=np.int64))),
        shape=(length, 1),
    )
