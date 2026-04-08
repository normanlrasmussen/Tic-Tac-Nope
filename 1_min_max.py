import numpy as np
from functions import print_board, check_winner, check_draw, get_valid_moves, print_multi_board

# Board values: 1 = X (maximizer), 2 = O (minimizer), 0 = empty
X, O = 1, 2








if __name__ == "__main__":
    board = np.zeros(9)
    board[4] = 1
    board[8] = 2
    board[0] = 3
    boards = [board, board, board]
    print_multi_board(boards)

