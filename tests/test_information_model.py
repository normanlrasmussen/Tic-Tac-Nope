"""Regression tests for Tic-Tac-Nope's imperfect-information semantics."""

from sequence_form_lp import (
    INFORMATION_MODEL,
    O,
    X,
    Rules,
    apply_action,
    bit,
    information_key,
    make_root,
)


def _history(opponent_hidden_move: int):
    rules = Rules(hidden_mask=bit(1) | bit(3), start_player=O)
    state = make_root(rules)
    state = apply_action(state, rules, 0)  # O visible cell 1
    state = apply_action(state, rules, opponent_hidden_move)  # X fog action
    state = apply_action(state, rules, 1)  # O attempts mystery cell 2
    state = apply_action(state, rules, 2)  # X visible cell 3; O acts next
    return rules, state


def test_success_and_failure_share_the_same_information_set():
    rules, failed = _history(1)
    _, succeeded = _history(3)

    assert failed.x_mask & bit(1)
    assert not failed.o_mask & bit(1)
    assert succeeded.o_mask & bit(1)
    assert not succeeded.x_mask & bit(1)

    assert failed.obs_o == succeeded.obs_o
    assert information_key(failed, rules, O) == information_key(succeeded, rules, O)
    assert "S1;" not in failed.obs_o
    assert "F1;" not in failed.obs_o
    assert "P1;" in failed.obs_o


def test_opponent_hidden_location_is_anonymous():
    rules = Rules(hidden_mask=bit(1) | bit(3), start_player=O)
    root = make_root(rules)
    after_o = apply_action(root, rules, 0)
    x_at_1 = apply_action(after_o, rules, 1)
    x_at_3 = apply_action(after_o, rules, 3)

    assert x_at_1.obs_o == x_at_3.obs_o == "V20;H;"
    assert x_at_1.obs_x.endswith("P1;")
    assert x_at_3.obs_x.endswith("P3;")


def test_information_model_version_is_explicit():
    assert INFORMATION_MODEL == "hidden-attempt-location-no-result-v2"
