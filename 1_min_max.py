import numpy as np
from functions import print_board, check_winner, check_draw, get_valid_moves, print_multi_board

# Board values: 1 = X (maximizer), 2 = O (minimizer), 0 = empty
X, O = 1, 2

def create_split_board(board, opponent_char, hidden_char=3):
    splits = {}
    for i in np.where(board == hidden_char)[0]:
        new_board = board.copy()
        new_board[i] = opponent_char
        splits[i] = new_board

        # If there is 1 unknown spot left, get rid of other hidden spots
        if np.sum(new_board == hidden_char) == 1:
            new_board[np.where(new_board == hidden_char)[0]] = 0
    return splits



def _matrix_uncertainty_value(board, is_maximizing):
    """
    Matrix over hidden-cell resolutions (rows) vs opponent's first actions (columns).
    Each entry is the minimax value from X's perspective after that resolution and move.

    Row player (nature): adversarial over which masked cell is true.
    Column player: the opponent to move in the child (O if is_maximizing, else X).

    - When X is to move and there are hidden O cells: rows resolve O, columns are O moves.
      X wants high values: use max_j min_i M[i,j] with tie-break preferring higher
      mean_i M[i,j] among columns tied on the min (risk-aware tie-break).
    - When O is to move and there are hidden X cells: rows resolve X, columns are X moves.
      O wants low values: use min_j max_i M[i,j] with tie-break preferring lower mean
      among columns tied on the max.
    """
    opponent = O if is_maximizing else X
    split_boards = create_split_board(board, opponent)
    if not split_boards:
        return None

    child_max = not is_maximizing
    col_keys = set()
    rows = []
    for split_index, split_board in split_boards.items():
        vals = minimax(split_board, child_max, split_index)
        col_keys.update(vals.keys())
        rows.append((split_index, split_board, vals))
    col_keys = sorted(col_keys)
    n_rows, n_cols = len(rows), len(col_keys)
    if n_cols == 0:
        return None

    matrix = np.full((n_rows, n_cols), np.nan, dtype=np.float64)
    for i, (_, _, vals) in enumerate(rows):
        for j, k in enumerate(col_keys):
            if k in vals:
                matrix[i, j] = vals[k]

    col_worst = np.nanmin(matrix, axis=0)
    col_mean = np.nanmean(matrix, axis=0)

    if is_maximizing:
        # X: maximize over O's policy columns; each column scored by worst row (nature).
        finite = np.isfinite(col_worst)
        if not np.any(finite):
            return None
        primary = float(np.nanmax(col_worst))
        tied = finite & np.isclose(col_worst, primary, rtol=0.0, atol=1e-9)
        secondary = np.nanmax(np.where(tied, col_mean, np.nan))
        if not np.isfinite(secondary):
            return primary
        return primary + 1e-12 * float(secondary)

    # Minimizing (O): minimize over X's policy columns; each column scored by best row for X.
    col_best_for_x = np.nanmax(matrix, axis=0)
    finite = np.isfinite(col_best_for_x)
    if not np.any(finite):
        return None
    primary = float(np.nanmin(col_best_for_x))
    tied = finite & np.isclose(col_best_for_x, primary, rtol=0.0, atol=1e-9)
    secondary = np.nanmin(np.where(tied, col_mean, np.nan))
    if not np.isfinite(secondary):
        return primary
    return primary + 1e-12 * float(secondary)


def _minimax_score(board, is_maximizing):
    """Minimax value from X's perspective; no memoization."""
    if check_winner(board, X):
        return 1
    if check_winner(board, O):
        return -1
    if check_draw(board):
        return 0
    if is_maximizing:
        best = -np.inf
        for move in get_valid_moves(board):
            board[move] = X
            best = max(best, _minimax_score(board, False))
            board[move] = 0

        matrix_val = _matrix_uncertainty_value(board, True)
        if matrix_val is not None:
            best = max(best, matrix_val)
        return best

    best = np.inf
    for move in get_valid_moves(board):
        board[move] = O
        best = min(best, _minimax_score(board, True))
        board[move] = 0

    matrix_val = _matrix_uncertainty_value(board, False)
    if matrix_val is not None:
        best = min(best, matrix_val)
    return best


def minimax(board, is_maximizing, split=None):
    """
    Minimax from X's perspective: +1 if X wins, -1 if O wins, 0 for draw.
    `is_maximizing` True means X to move, False means O to move.
    Returns a dict mapping each legal move index to the minimax value (from X's
    perspective) after that move. Returns {} if the position is terminal.
    """
    if check_winner(board, X) or check_winner(board, O) or check_draw(board):
        return {}

    out = {}
    if is_maximizing:
        valid_moves = get_valid_moves(board)
        for move in valid_moves:
            board[move] = X
            out[move] = _minimax_score(board, False)
            board[move] = 0
        
        # Check skipping a turn for the split index
        if split is not None:
            out[split] = _minimax_score(board, False)
    else:
        valid_moves = get_valid_moves(board)
        for move in valid_moves:
            board[move] = O
            out[move] = _minimax_score(board, True)
            board[move] = 0
        # Check skipping a turn for the split index
        if split is not None:
            out[split] = _minimax_score(board, True)

    return out


def minimax_sorted(board, is_maximizing, split=None):
    """
    Minimax values from `minimax`, as a 1d array ordered by increasing board
    index: every valid empty cell, plus `split` when given (deduplicated).
    Example: valid moves {1, 3, 5} and split=2 -> values for indices 1, 2, 3, 5.
    """
    vals = minimax(board, is_maximizing, split)
    if not vals:
        return np.array([], dtype=np.float64)

    indices = set(get_valid_moves(board))
    if split is not None:
        indices.add(int(split))
    ordered = sorted(indices)
    return np.array([vals[i] for i in ordered], dtype=np.float64)


if __name__ == "__main__":
    board = np.zeros(9)
    board[1] = 3
    board[3] = 3
    board[5] = 3
    # board[0] = 1
    # board[4] = 2
    # board[5] = 1
    # board[8] = 2
    print_board(board)

    splits = create_split_board(board, 1)
    print_multi_board(splits.values())
    print()

    # for split_index, split in splits.items():
    #     print(f"Split {split_index}:")
    #     print_board(split)
    #     vals = minimax(split, False, split_index)

    #     board_possibilities = []
    #     # Generate board possibilits
    #     for move in vals.keys():
    #         new_board = split.copy()
    #         if move != split_index:
    #             new_board[move] = 2
    #         board_possibilities.append([move, new_board])
        
    #     # Sort by value
    #     board_possibilities.sort(key=lambda x: x[0], reverse=False)

    #     boards_row = [x[1] for x in board_possibilities]
    #     between = "  "
    #     col_w = 11  # matches print_multi_board row width (" c | c | c ")
    #     print_multi_board(boards_row, between=between)
    #     labels = [f"M{m}:{vals[m]}".center(col_w) for m, _ in board_possibilities]
    #     print(between.join(labels))
       




