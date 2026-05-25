import numpy as np

from algo import HIDDEN, O, X, algo, get_all_moves, normalize_splits, split_belief
from functions import check_draw, check_winner


def other_tile(tile):
    return X if tile == O else O


def tile_name(tile):
    return "O" if tile == O else "X"


def initial_board(hidden_tiles):
    board = np.zeros(9, dtype=np.int8)
    for tile in hidden_tiles:
        board[int(tile)] = HIDDEN
    return board


def make_initial_state(hidden_tiles=(1, 3)):
    initial = initial_board(hidden_tiles)
    return {
        "actual_board": initial.copy(),
        "o_beliefs": [initial.copy()],
        "o_splits": [None],
        "x_beliefs": [initial.copy()],
        "x_splits": [None],
        "hidden_overlays": {},
    }


def cell_text(value, overlay=None):
    if overlay is not None:
        return overlay
    if value == X:
        return "X"
    if value == O:
        return "O"
    if value == HIDDEN:
        return "█"
    return str(value)


def print_game_board(board, overlays=None, title=None):
    if title:
        print(title)
    overlays = overlays or {}
    board = np.asarray(board).reshape(3, 3)
    for r in range(3):
        cells = []
        for c in range(3):
            i = 3 * r + c
            cells.append(cell_text(board[r, c], overlays.get(i)).center(3))
        print("|".join(cells))
        if r < 2:
            print("---+---+---")


def print_beliefs(beliefs, splits=None, title="Beliefs"):
    print(title)
    splits = splits or [None] * len(beliefs)
    for i, (belief, split) in enumerate(zip(beliefs, splits), start=1):
        print(f"Belief {i}, split moves: {list(normalize_splits(split))}")
        print_game_board(belief)


def terminal_status(actual_board):
    if check_winner(actual_board, O):
        return True, "O wins"
    if check_winner(actual_board, X):
        return True, "X wins"
    if check_draw(actual_board) and not np.any(np.asarray(actual_board) == HIDDEN):
        return True, "Draw"
    return False, None


def dedupe_beliefs(beliefs, splits):
    seen = set()
    new_beliefs = []
    new_splits = []
    for belief, split in zip(beliefs, splits):
        split = normalize_splits(split)
        key = (tuple(np.asarray(belief, dtype=np.int8).ravel()), split)
        if key in seen:
            continue
        seen.add(key)
        new_beliefs.append(np.asarray(belief, dtype=np.int8).copy())
        new_splits.append(split)
    return new_beliefs, new_splits


def known_update_beliefs(beliefs, splits, move, tile):
    out = []
    for belief in beliefs:
        belief = np.asarray(belief, dtype=np.int8).copy()
        if belief[move] == 0:
            belief[move] = tile
        out.append(belief)
    return dedupe_beliefs(out, splits)


def acting_hidden_update(beliefs, splits, move, tile, actual_board):
    out = []
    opponent = other_tile(tile)
    for belief in beliefs:
        belief = np.asarray(belief, dtype=np.int8).copy()
        if len(beliefs) == 1:
            if actual_board[move] in (tile, opponent):
                belief[move] = actual_board[move]
        elif belief[move] != opponent:
            belief[move] = tile
        out.append(belief)
    return dedupe_beliefs(out, splits)


def opponent_hidden_update(beliefs, splits, tile):
    out_beliefs = []
    out_splits = []
    for belief, split in zip(beliefs, splits):
        split_beliefs, split_moves = split_belief(belief, tile, split)
        if split_beliefs:
            out_beliefs.extend(split_beliefs)
            out_splits.extend(split_moves)
        else:
            out_beliefs.append(np.asarray(belief, dtype=np.int8).copy())
            out_splits.append(normalize_splits(split))
    return dedupe_beliefs(out_beliefs, out_splits)


def visible_overlays(overlays):
    visible = {}
    for move, tile in overlays.items():
        visible[int(move)] = f"*{tile_name(tile).lower()}*"
    return visible


def valid_moves_for_player(beliefs, splits):
    return get_all_moves(beliefs, splits)


def algorithm_decision(beliefs, splits, tile):
    minmax = tile == O
    return algo(beliefs, splits, minmax=minmax, split_dict=False, return_move=True)


def apply_move(state, move, tile, hidden_tiles):
    actual_board = state["actual_board"]
    acting_key = "o" if tile == O else "x"
    opponent_key = "x" if tile == O else "o"
    move = int(move)
    was_hidden_move = move in hidden_tiles or move in state["hidden_overlays"]

    if was_hidden_move:
        state["hidden_overlays"][move] = tile
        if actual_board[move] in (0, HIDDEN):
            actual_board[move] = tile

        state[f"{acting_key}_beliefs"], state[f"{acting_key}_splits"] = acting_hidden_update(
            state[f"{acting_key}_beliefs"],
            state[f"{acting_key}_splits"],
            move,
            tile,
            actual_board,
        )
        state[f"{opponent_key}_beliefs"], state[f"{opponent_key}_splits"] = opponent_hidden_update(
            state[f"{opponent_key}_beliefs"],
            state[f"{opponent_key}_splits"],
            tile,
        )
        return

    if actual_board[move] == 0:
        actual_board[move] = tile

    for key in ("o", "x"):
        beliefs, splits = known_update_beliefs(
            state[f"{key}_beliefs"],
            state[f"{key}_splits"],
            move,
            tile,
        )
        state[f"{key}_beliefs"] = beliefs
        state[f"{key}_splits"] = splits
