"""Information-set action solver for Tic-Tac-Nope.

This module deliberately uses ONLY the acting player's information set.
It never requires, reconstructs, or guesses the opponent's information set.

Model
-----
The acting player has a collection of possible board states (beliefs).  Every
state in that information set is assigned equal probability.  The player must
choose ONE action for the whole information set.

For an action ``a`` and information set ``I`` we compute

    Q(I, a) = (1 / |I|) * sum_{s in I} V(T(s, a)),

where T applies the same action to each possible state and V is a continuation
value.  The default continuation value is ordinary perfect-information minimax
on the resulting concrete board.  That continuation model is intentionally
isolated in ``perfect_information_value`` so it can later be replaced without
changing the information-set action selection logic.

Important limitation
--------------------
This solves the CURRENT player's Bayesian action-selection problem given only
that player's information set.  It does not claim to solve the full
imperfect-information two-player equilibrium, because doing that exactly would
require a model of the opponent's information and observation history.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from typing import Iterable, Sequence

import numpy as np

from functions import check_draw, check_winner


X, O = 1, 2
HIDDEN = 3
EMPTY = 0

Board = tuple[int, ...]


@dataclass(frozen=True)
class InformationSetResult:
    """Result of choosing one action for an entire information set."""

    action: int
    expected_value: float
    action_values: dict[int, float]
    number_of_states: int


def canonical_board(board: Sequence[int] | np.ndarray) -> Board:
    """Convert a board to a hashable length-9 tuple."""
    arr = np.asarray(board, dtype=np.int8).ravel()
    if arr.size != 9:
        raise ValueError(f"Expected a 9-cell board, received {arr.size} cells.")
    return tuple(int(x) for x in arr)


def canonical_information_set(
    beliefs: Iterable[Sequence[int] | np.ndarray],
) -> tuple[Board, ...]:
    """Deduplicate and canonically order the player's possible states.

    Equal probability is assigned AFTER deduplication.  In other words, this
    function interprets ``beliefs`` as a set of possible information states,
    not as a list in which duplicates carry additional probability mass.
    """
    states = {canonical_board(board) for board in beliefs}
    if not states:
        raise ValueError("The information set must contain at least one state.")
    return tuple(sorted(states))


def terminal_value(board: Board, player: int) -> float | None:
    """Return +1 win, 0 draw, -1 loss, or None if the board is nonterminal."""
    opponent = O if player == X else X
    arr = np.asarray(board, dtype=np.int8)

    if check_winner(arr, player):
        return 1.0
    if check_winner(arr, opponent):
        return -1.0
    if check_draw(arr) and not np.any(arr == HIDDEN):
        return 0.0
    return None


def playable_moves(board: Board) -> set[int]:
    """Cells that can be attempted on this possible board.

    In Tic-Tac-Nope, a cell represented as HIDDEN is still a playable location,
    so both EMPTY and HIDDEN cells are treated as available.
    """
    return {
        i
        for i, value in enumerate(board)
        if value in (EMPTY, HIDDEN)
    }


def legal_information_set_moves(info_set: tuple[Board, ...]) -> list[int]:
    """Return actions that are legal in EVERY state the player considers possible.

    A player must choose one action before knowing which possible state is real.
    Using the intersection prevents the solver from choosing an action that is
    only legal in some hidden worlds.
    """
    legal = playable_moves(info_set[0]).copy()
    for board in info_set[1:]:
        legal.intersection_update(playable_moves(board))
    return sorted(legal)


def apply_action(board: Board, action: int, tile: int) -> Board:
    """Apply one move to one possible board state."""
    if action < 0 or action >= 9:
        raise ValueError(f"Action must be in [0, 8], received {action}.")
    if board[action] not in (EMPTY, HIDDEN):
        raise ValueError(f"Action {action} is not playable on board {board}.")

    new_board = list(board)
    new_board[action] = int(tile)
    return tuple(new_board)


def _concrete_legal_moves(board: Board) -> tuple[int, ...]:
    return tuple(sorted(playable_moves(board)))


@lru_cache(maxsize=None)
def _perfect_information_minimax(
    board: Board,
    to_move: int,
    root_player: int,
) -> float:
    """Standard minimax continuation value for one concrete board.

    This function is NOT using the opponent's information set.  It is simply a
    continuation evaluator for a concrete possible world.  The outer
    information-set solver is what enforces one common current action across
    all worlds.
    """
    value = terminal_value(board, root_player)
    if value is not None:
        return value

    moves = _concrete_legal_moves(board)
    if not moves:
        return 0.0

    next_tile = O if to_move == X else X
    child_values = [
        _perfect_information_minimax(
            apply_action(board, move, to_move),
            next_tile,
            root_player,
        )
        for move in moves
    ]

    if to_move == root_player:
        return max(child_values)
    return min(child_values)


def perfect_information_value(board: Board, next_to_move: int, player: int) -> float:
    """Public wrapper for the default continuation evaluator."""
    return _perfect_information_minimax(board, next_to_move, player)


def action_value_equal_beliefs(
    info_set: tuple[Board, ...],
    action: int,
    player: int,
) -> float:
    """Expected value of one action when all possible states are equally likely.

    The same action is applied to every state in the information set.  This is
    the key imperfect-information constraint: the player cannot condition the
    current action on which hidden state is actually true.
    """
    opponent = O if player == X else X
    values: list[float] = []

    for state in info_set:
        next_state = apply_action(state, action, player)

        immediate = terminal_value(next_state, player)
        if immediate is not None:
            values.append(immediate)
        else:
            values.append(
                perfect_information_value(
                    next_state,
                    next_to_move=opponent,
                    player=player,
                )
            )

    return float(np.mean(values))


def best_action_from_information_set(
    beliefs: Iterable[Sequence[int] | np.ndarray],
    player: int,
) -> InformationSetResult:
    """Choose the best current action using only the player's information set.

    Assumptions
    -----------
    1. The solver never receives the opponent's information set.
    2. Every distinct state in ``beliefs`` is equally likely.
    3. One common current action must be legal in every possible state.
    4. Utilities are win=+1, draw=0, loss=-1 from ``player``'s perspective.
    5. Future concrete-board value is estimated by perfect-information minimax.

    Ties are broken deterministically by choosing the lowest-numbered action.
    """
    if player not in (X, O):
        raise ValueError(f"player must be X ({X}) or O ({O}); received {player}.")

    info_set = canonical_information_set(beliefs)

    # If every possible state is already terminal, no action should be chosen.
    terminal_values = [terminal_value(state, player) for state in info_set]
    if all(value is not None for value in terminal_values):
        raise ValueError("Every state in the information set is already terminal.")

    actions = legal_information_set_moves(info_set)
    if not actions:
        raise ValueError("No action is legal across the entire information set.")

    action_values = {
        action: action_value_equal_beliefs(info_set, action, player)
        for action in actions
    }

    best_value = max(action_values.values())
    best_action = min(
        action
        for action, value in action_values.items()
        if np.isclose(value, best_value)
    )

    return InformationSetResult(
        action=best_action,
        expected_value=float(best_value),
        action_values=action_values,
        number_of_states=len(info_set),
    )


def algorithm_decision_equal_beliefs(
    beliefs: Iterable[Sequence[int] | np.ndarray],
    tile: int,
) -> int:
    """Small adapter with a shape similar to simulation.algorithm_decision."""
    return best_action_from_information_set(beliefs, tile).action


if __name__ == "__main__":
    # Tiny smoke-test example: the player believes either state is equally likely.
    example_beliefs = [
        np.array([O, O, 0, X, X, 0, 0, 0, 0], dtype=np.int8),
        np.array([O, 0, O, X, X, 0, 0, 0, 0], dtype=np.int8),
    ]

    result = best_action_from_information_set(example_beliefs, O)
    print("Best action:", result.action)
    print("Expected value:", result.expected_value)
    print("All action values:", result.action_values)
