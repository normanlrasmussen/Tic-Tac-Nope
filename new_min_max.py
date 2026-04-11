"""
Minimax from X's perspective with matrix aggregation when hidden tiles (3) exist.
Security policy: max_j min_i M[i,j] (X) / min_j max_i M[i,j] (O), mean tie-break,
win+loss columns capped for tie-break so mixed +/-1 does not beat pure ties.
"""

import numpy as np

from functions import check_draw, check_winner, get_valid_moves, print_board

X, O = 1, 2
HIDDEN = 3


def create_split_board(board, opponent_char, hidden_char=HIDDEN):
    splits = {}
    for i in np.where(np.asarray(board).ravel() == hidden_char)[0]:
        new_board = np.asarray(board, dtype=np.int8).copy()
        new_board[i] = opponent_char
        splits[i] = new_board

        if np.sum(new_board == hidden_char) == 1:
            new_board[np.where(new_board == hidden_char)[0]] = 0
    return splits


def _terminal_score(board):
    if check_winner(board, X):
        return 1
    if check_winner(board, O):
        return -1
    if check_draw(board):
        return 0
    return None


def _adjusted_column_mean(col: np.ndarray) -> float:
    """Mean of finite entries; if column has both +1 and -1, cap tie-break mean slightly below 0."""
    finite = col[np.isfinite(col)]
    if finite.size == 0:
        return float("nan")
    raw_mean = float(np.mean(finite))
    has_win = np.any(finite >= 1.0 - 1e-9)
    has_loss = np.any(finite <= -1.0 + 1e-9)
    if has_win and has_loss:
        return min(raw_mean, -1e-9)
    return raw_mean


def _minimax_score(board, is_maximizing):
    board = np.asarray(board, dtype=np.int8)
    t = _terminal_score(board)
    if t is not None:
        return float(t)

    if is_maximizing:
        best = -np.inf
        for move in get_valid_moves(board):
            board[move] = X
            best = max(best, _minimax_score(board, False))
            board[move] = 0
    else:
        best = np.inf
        for move in get_valid_moves(board):
            board[move] = O
            best = min(best, _minimax_score(board, True))
            board[move] = 0

    if np.any(board == HIDDEN):
        matrix_val = _matrix_aggregate(board, is_maximizing)
        if matrix_val is not None:
            best = max(best, matrix_val) if is_maximizing else min(best, matrix_val)

    return best


def _collect_action_values(board, is_maximizing, split=None):
    board = np.asarray(board, dtype=np.int8)
    if _terminal_score(board) is not None:
        return {}

    out = {}
    if is_maximizing:
        for move in get_valid_moves(board):
            board[move] = X
            out[move] = _minimax_score(board, False)
            board[move] = 0
        if split is not None:
            out[split] = _minimax_score(board, False)
    else:
        for move in get_valid_moves(board):
            board[move] = O
            out[move] = _minimax_score(board, True)
            board[move] = 0
        if split is not None:
            out[split] = _minimax_score(board, True)
    return out


def _matrix_aggregate(board, is_maximizing):
    """
    Rows: split scenarios. Columns: union of actions (including pass at split index).
    Security: max_j min_i M[i,j] for X aggregate, min_j max_i M[i,j] for O aggregate.
    Tie-break: best adjusted column mean among columns tied on primary.
    """
    opponent = O if is_maximizing else X
    split_boards = create_split_board(board, opponent)
    if not split_boards:
        return None

    child_max = not is_maximizing
    col_keys = set()
    rows = []
    for split_index, split_board in split_boards.items():
        vals = _collect_action_values(split_board, child_max, split_index)
        col_keys.update(vals.keys())
        rows.append(vals)

    col_keys = sorted(col_keys)
    n_rows, n_cols = len(rows), len(col_keys)
    if n_cols == 0 or n_rows == 0:
        return None

    matrix = np.full((n_rows, n_cols), np.nan, dtype=np.float64)
    for i, vals in enumerate(rows):
        for j, k in enumerate(col_keys):
            if k in vals:
                matrix[i, j] = vals[k]

    atol = 1e-9
    if is_maximizing:
        col_worst = np.nanmin(matrix, axis=0)
        finite = np.isfinite(col_worst)
        if not np.any(finite):
            return None
        primary = float(np.nanmax(col_worst))
        tied = finite & np.isclose(col_worst, primary, rtol=0.0, atol=atol)
        # Tie-break: among columns achieving primary, prefer higher adjusted mean
        # (win+loss columns capped so they lose to pure ties).
        tie_scores = []
        for j in np.where(tied)[0]:
            am = _adjusted_column_mean(matrix[:, j])
            if np.isfinite(am):
                tie_scores.append((am, j))
        if tie_scores:
            _ = max(tie_scores, key=lambda t: t[0])  # tie-break: highest adjusted mean
        return primary

    col_best_for_x = np.nanmax(matrix, axis=0)
    finite = np.isfinite(col_best_for_x)
    if not np.any(finite):
        return None
    primary = float(np.nanmin(col_best_for_x))
    tied = finite & np.isclose(col_best_for_x, primary, rtol=0.0, atol=atol)
    tie_scores = []
    for j in np.where(tied)[0]:
        am = _adjusted_column_mean(matrix[:, j])
        if np.isfinite(am):
            tie_scores.append((am, j))
    if tie_scores:
        _ = min(tie_scores, key=lambda t: t[0])  # tie-break: lowest adjusted mean
    return primary


def minimax_actions(board, is_maximizing, split=None):
    """
    Map each legal move index to minimax value from X's perspective after that move.
    If split is not None, includes pass at that index (may overwrite if also a legal move).
    """
    return _collect_action_values(
        np.asarray(board, dtype=np.int8), is_maximizing, split
    )


def print_move_outcomes(board, is_maximizing, split=None):
    """Print all possible moves and their expected outcomes (X perspective scores)."""
    board = np.asarray(board)
    vals = minimax_actions(board, is_maximizing, split)
    if not vals:
        print("(terminal or no moves)")
        return
    label = "X" if is_maximizing else "O"
    print(f"Player to move: {label} (maximizer=X perspective: +1 X win, -1 O win, 0 draw)")
    for move in sorted(vals.keys()):
        suffix = " (pass)" if split is not None and move == split else ""
        print(f"  move {move}{suffix}: {vals[move]}")


if __name__ == "__main__":
    # One hidden tile; full search can take ~1–2 minutes on a quiet CPU.
    board = np.zeros(9, dtype=np.int8)
    board[1] = HIDDEN
    board[3] = HIDDEN
    print_board(board)
    # print()
    # print_move_outcomes(board, True)
    # print()
    # print("Optional pass at hidden index: print_move_outcomes(board, True, split=4)")
    # print()
    # print(f"_minimax_score (X to move): {_minimax_score(board, True)}")

    # NOTE: I will mock play a game
    print()
    x_board = board.copy()
    x_board[1] = X # We say X played in the top

    split_board = create_split_board(board, X)

    # NOTE: For both split boards make the 0 move
    for split_index, split_board in split_board.items():
        split_board[0] = O
      
    # NOTE: This checks the next move
    for split_index, split_board in split_board.items():
        print_board(split_board)
        print()
        print_move_outcomes(split_board, True, None)
        print()
