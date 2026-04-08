import numpy as np
from functions import print_board, check_winner, check_draw, get_valid_moves

# Board values: 1 = X (maximizer), 2 = O (minimizer), 0 = empty
X, O = 1, 2


def minimax(board, depth, is_maximizing, memo=None):
    """
    Minimax from X's perspective: +1 if X wins, -1 if O wins, 0 for draw.
    `is_maximizing` True means X to move, False means O to move.
    Returns (best_score, best_move) for the side to move; move is None at terminals.
    """
    if memo is None:
        memo = {}

    if check_winner(board, X):
        return 1, None
    if check_winner(board, O):
        return -1, None
    if check_draw(board):
        return 0, None

    key = (tuple(np.asarray(board, dtype=np.int8).ravel()), is_maximizing)
    if key in memo:
        return memo[key]

    if is_maximizing:
        best_score = -np.inf
        best_move = None
        for move in get_valid_moves(board):
            board[move] = X
            score, _ = minimax(board, depth + 1, False, memo)
            board[move] = 0
            if score > best_score:
                best_score = score
                best_move = move
        memo[key] = (best_score, best_move)
        return best_score, best_move

    best_score = np.inf
    best_move = None
    for move in get_valid_moves(board):
        board[move] = O
        score, _ = minimax(board, depth + 1, True, memo)
        board[move] = 0
        if score < best_score:
            best_score = score
            best_move = move
    memo[key] = (best_score, best_move)
    return best_score, best_move

















if __name__ == "__main__":
    board = np.zeros(9)
    memo = {}
    while (
        not check_winner(board, X)
        and not check_winner(board, O)
        and not check_draw(board)
    ):
        print_board(board)
        _, best_move = minimax(board, 0, True, memo)
        board[best_move] = X
        if check_winner(board, X) or check_winner(board, O) or check_draw(board):
            break
        _, best_move = minimax(board, 0, False, memo)
        board[best_move] = O
    print_board(board)

