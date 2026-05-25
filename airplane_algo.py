import numpy as np

from functions import check_draw, check_winner, get_valid_moves, print_board

X, O = 1, 2
HIDDEN = 3

def get_all_moves(
        beliefs:list,
        splits:list,
):
    # This needs to add all posible moves to make, splits plus all the other possible moves. 
    moves = set()
    for belief in beliefs:
        belief = np.asarray(belief)
        moves.update(int(move) for move in get_valid_moves(belief))
        moves.update(int(move) for move in np.where(belief.ravel() == HIDDEN)[0])

    for split in splits:
        if split is not None:
            moves.add(int(split))

    return sorted(moves)

def is_event(
        belief:list,
        split:int=None,
):
    # This needs to return a true if there is event (tie, O-win (1), X-win (-1)) for the value
    if check_winner(belief, O):
        return True, 1
    if check_winner(belief, X):
        return True, -1
    if check_draw(belief) and not np.any(np.asarray(belief) == HIDDEN):
        return True, 0
    return False, None

def split_belief(
        belief:np.ndarray,
        tile:int
):
    # TAssume that every hidden tile is taken, and reutrn a list of that and the splits (you just set the belief to the tile)
    # NOTE, for each 3 tile found, create a copy where just that tile is filled in and the rest are still 3s
    new_beliefs = []
    new_splits = []

    for split in np.where(np.asarray(belief).ravel() == HIDDEN)[0]:
        new_belief = np.asarray(belief, dtype=np.int8).copy()
        new_belief[split] = tile
        new_beliefs.append(new_belief)
        new_splits.append(int(split))

    return new_beliefs, new_splits

def algo(
        beliefs:list,
        splits:list,
        minmax:bool,
        split_dict:bool,
        return_move:bool=False
):
    vals = get_all_moves(beliefs, splits)
    rows = []
    tile = O if minmax else X
    for belief, split in zip(beliefs, splits):
        belief = np.asarray(belief, dtype=np.int8)
        event, value = is_event(belief, split)
        if event:
            s_dict = {move: value for move in vals}
        else:
            s_dict = {}
            for move in get_valid_moves(belief):
                belief[move] = tile
                s_dict[int(move)] = algo([belief], [None],  not minmax, False)
                belief[move] = 0

            # Playing the hidden tile that was already occupied is a skipped move.
            if split is not None:
                s_dict[split] = algo([belief], [None],  not minmax, False)

            if np.any(belief == HIDDEN):
                b_new, s_new = split_belief(belief, tile)
                s_dict.update(algo(b_new, s_new, not minmax, True))

        rows.append([s_dict.get(move, np.nan) for move in vals])

    if not vals:
        return {} if split_dict else 0

    C = np.array(rows, dtype=np.float64)

    if minmax:
        security = np.nanmin(C, axis=0)
        S = np.nanmax(security)
        mask = np.isclose(security, S)
        aves = np.full_like(security, -np.inf, dtype=np.float64)
        aves[mask] = np.nanmean(C[:, mask], axis=0)
        move_index = int(np.nanargmax(aves))
        result = float(security[move_index])
    else:
        security = np.nanmax(C, axis=0)
        S = np.nanmin(security)
        mask = np.isclose(security, S)
        aves = np.full_like(security, np.inf, dtype=np.float64)
        aves[mask] = np.nanmean(C[:, mask], axis=0)
        move_index = int(np.nanargmin(aves))
        result = float(security[move_index])

    if return_move:
        return vals[move_index], vals, splits, C
    if split_dict:
        return {split: float(C[row_index, move_index]) for row_index, split in enumerate(splits)}
    else:
        return result
        







if __name__ == "__main__":
    board = np.zeros(9, dtype=np.int8)
    board[1] = HIDDEN
    board[3] = HIDDEN
    print_board(board)
