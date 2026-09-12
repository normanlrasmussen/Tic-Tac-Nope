"""Regression coverage for native payoff aggregation and streamed exact LPs."""
import importlib.util
import shutil
from unittest.mock import patch

import numpy as np
import pytest
from scipy.sparse import csr_matrix

import sequence_form_lp as lp
from sequence_form_lp_compact import compact_policy_and_realization


def _late_game(hidden=3):
    return lp.State(
        o_mask=0b010001001,
        x_mask=0b001010010,
        tried_o=0b010001001 & hidden,
        tried_x=0b001010010 & hidden,
        turn=lp.O,
    )


def test_compact_export_rejects_positive_reach_with_zero_outgoing_mass():
    catalog = lp.SequenceCatalog(lp.O)
    catalog.register("2|2|3|", 0, (0, 1))
    realization = np.zeros(catalog.n_sequences)
    realization[0] = 1.0
    with pytest.raises(RuntimeError, match="positive-reach information set"):
        compact_policy_and_realization(catalog, realization)


@pytest.mark.skipif(not (shutil.which("g++") or shutil.which("clang++")), reason="native compiler unavailable")
def test_native_aggregated_payoff_matches_python_reference():
    from sequence_form_native import build_native

    rules = lp.Rules(3, lp.O)
    root = _late_game(3)
    native = build_native(rules, root)
    with patch.object(lp, "make_root", return_value=root):
        reference = lp.build_sequence_game_python(rules)

    assert (native.histories, native.terminals) == (reference.histories, reference.terminals)
    assert native.o.n_sequences == reference.o.n_sequences
    assert native.x.n_sequences == reference.x.n_sequences
    assert len(native.o.infos) == len(reference.o.infos)
    assert len(native.x.infos) == len(reference.x.infos)
    assert native.payoff.has_sorted_indices
    assert (native.payoff != reference.payoff).nnz == 0


@pytest.mark.skipif(not (shutil.which("g++") or shutil.which("clang++")), reason="native compiler unavailable")
def test_scipy_exact_solver_still_certifies_native_game():
    from sequence_form_native import build_native

    rules = lp.Rules(3, lp.O)
    game = build_native(rules, _late_game(3))
    _, _, lower, upper, result = lp.solve_equilibrium(game, backend="scipy")
    assert abs(upper - lower) <= lp.FEASIBILITY_TOLERANCE
    assert result.certificate["exploitabilityGap"] <= lp.FEASIBILITY_TOLERANCE


@pytest.mark.skipif(importlib.util.find_spec("highspy") is None, reason="highspy unavailable")
def test_streaming_highspy_matches_scipy_on_small_exact_game():
    rules = lp.Rules(3, lp.O)
    root = _late_game(3)
    with patch.object(lp, "make_root", return_value=root):
        game = lp.build_sequence_game_python(rules)
    xo_s, xx_s, lo_s, hi_s, _ = lp.solve_equilibrium(game, backend="scipy")
    xo_h, xx_h, lo_h, hi_h, result = lp.solve_equilibrium(game, backend="highspy")
    np.testing.assert_allclose([lo_h, hi_h], [lo_s, hi_s], atol=lp.FEASIBILITY_TOLERANCE)
    assert result.certificate["exploitabilityGap"] <= lp.FEASIBILITY_TOLERANCE
    assert xo_h.shape == xo_s.shape
    assert xx_h.shape == xx_s.shape


@pytest.mark.skipif(importlib.util.find_spec("highspy") is None, reason="highspy unavailable")
def test_highspy_streaming_canonicalizes_duplicate_payoff_indices():
    # CSR matrices with duplicates are valid SciPy inputs and can arise when
    # native payoff chunks are concatenated.  HiGHS requires unique row
    # indices within every streamed column.
    E = csr_matrix([[1.0, 1.0]])
    F = csr_matrix([[1.0]])
    payoff = csr_matrix((np.array([0.25, 0.75]), np.array([0, 0]), np.array([0, 2, 2])),
                        shape=(2, 1))

    result = lp._solve_highspy_streaming(E, np.array([1.0]), F, np.array([1.0]),
                                         payoff, n_x=2, n_p=1)
    assert result.success
    np.testing.assert_allclose(result.x[:2].sum(), 1.0, atol=lp.FEASIBILITY_TOLERANCE)


@pytest.mark.skipif(importlib.util.find_spec("highspy") is None, reason="highspy unavailable")
@pytest.mark.parametrize(
    "backend, solver_name",
    [
        ("highspy-reduced-simplex", "simplex"),
        ("highspy-reduced-hipo", "hipo"),
        ("highspy-reduced-ipx", "ipx"),
    ],
)
def test_reduced_highspy_solver_choices_are_certified(backend, solver_name):
    rules = lp.Rules(3, lp.O)
    root = _late_game(3)
    with patch.object(lp, "make_root", return_value=root):
        game = lp.build_sequence_game_python(rules)
    _, _, lower, upper, result = lp.solve_equilibrium(game, backend=backend)
    assert result.timings["highsSolver"] == solver_name
    assert result.certificate["exploitabilityGap"] <= lp.FEASIBILITY_TOLERANCE
    np.testing.assert_allclose(lower, upper, atol=lp.FEASIBILITY_TOLERANCE)
