import numpy as np

def print_board(arr, x_val=1, o_val=2, empty_char=' ', hidden_val=3):
    """
    Print a tic-tac-toe board from a length-9 array.

    Parameters:
        arr (np.ndarray or list): length-9 array
        x_val: value representing X
        o_val: value representing O
        empty_char: what to print for empty spaces
    """
    arr = np.array(arr).reshape(3, 3)

    def convert(val):
        if val == x_val:
            return 'X'
        elif val == o_val:
            return 'O'
        elif val == hidden_val:
            return '█'
        else:
            return empty_char
    
    for i, row in enumerate(arr):
        row_str = " | ".join(convert(v) for v in row)
        print(" " + row_str + " ")
        if i < 2:
            print("---+---+---")


def print_multi_board(
    boards,
    x_val=1,
    o_val=2,
    empty_char=" ",
    hidden_val=3,
    between="  ",
):
    """
    Print several tic-tac-toe boards side by side on one set of lines.

    Parameters:
        boards: list of length-9 (or 3x3) arrays
        x_val, o_val, empty_char, hidden_val: same as print_board
        between: string placed between each mini-board (default two spaces)
    """
    if not boards:
        return

    grids = [np.array(b).reshape(3, 3) for b in boards]

    def convert(val):
        if val == x_val:
            return "X"
        elif val == o_val:
            return "O"
        elif val == hidden_val:
            return "█"
        else:
            return empty_char

    for i in range(3):
        row_parts = []
        for g in grids:
            row_str = " | ".join(convert(v) for v in g[i])
            row_parts.append(" " + row_str + " ")
        print(between.join(row_parts))
        if i < 2:
            sep_parts = ["---+---+---"] * len(grids)
            print(between.join(sep_parts))


def check_winner(board, player):
    """
    Return True if `player` has three in a row.

    Parameters:
        board (np.ndarray or list): length-9 array or 3x3 board
        player (int/float): value representing the player
    """
    board = np.array(board).reshape(3, 3)

    # Check rows and columns
    for i in range(3):
        if np.all(board[i, :] == player) or np.all(board[:, i] == player):
            return True

    # Check diagonals
    if np.all(np.diag(board) == player):
        return True
    if np.all(np.diag(np.fliplr(board)) == player):
        return True

    return False

def check_draw(board):
    return np.all(board != 0)


def get_valid_moves(player_belief):
    return np.where(player_belief == 0)[0]
