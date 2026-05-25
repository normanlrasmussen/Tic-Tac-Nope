import numpy as np

from functions import check_draw, check_winner, get_valid_moves

X, O = 1, 2
HIDDEN = 3


def normalize_splits(split):
    if split is None:
        return tuple()
    if isinstance(split, (list, tuple, set)):
        return tuple(sorted(int(x) for x in split))
    return (int(split),)


def add_split(split, move):
    return tuple(sorted(set(normalize_splits(split)) | {int(move)}))


def get_all_moves(
        beliefs: list,
        splits: list,
):
    moves = set()
    for belief in beliefs:
        belief = np.asarray(belief)
        moves.update(int(move) for move in get_valid_moves(belief))
        moves.update(int(move) for move in np.where(belief.ravel() == HIDDEN)[0])

    for split in splits:
        moves.update(normalize_splits(split))

    return sorted(moves)


def is_event(
        belief: list,
        split: int = None,
):
    if check_winner(belief, O):
        return True, 1
    if check_winner(belief, X):
        return True, -1
    if check_draw(belief) and not np.any(np.asarray(belief) == HIDDEN):
        return True, 0
    return False, None


def split_belief(
        belief: np.ndarray,
        tile: int,
        existing_splits=None,
):
    new_beliefs = []
    new_splits = []

    for split in np.where(np.asarray(belief).ravel() == HIDDEN)[0]:
        new_belief = np.asarray(belief, dtype=np.int8).copy()
        new_belief[split] = tile
        new_beliefs.append(new_belief)
        new_splits.append(add_split(existing_splits, int(split)))

    return new_beliefs, new_splits


def algo(
        beliefs: list,
        splits: list,
        minmax: bool,
        split_dict: bool,
        return_move: bool = False,
        _memo=None,
):
    if _memo is None:
        _memo = {}
    memo_key = (
        tuple(
            (tuple(np.asarray(belief, dtype=np.int8).ravel()), normalize_splits(split))
            for belief, split in zip(beliefs, splits)
        ),
        bool(minmax),
        bool(split_dict),
    )
    if not return_move and memo_key in _memo:
        return _memo[memo_key]

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
                s_dict[int(move)] = algo([belief], [None], not minmax, False, _memo=_memo)
                belief[move] = 0

            for split_move in normalize_splits(split):
                s_dict[split_move] = algo([belief], [None], not minmax, False, _memo=_memo)

            if np.any(belief == HIDDEN):
                b_new, s_new = split_belief(belief, tile, split)
                s_dict.update(algo(b_new, s_new, not minmax, True, _memo=_memo))

        rows.append([s_dict.get(move, np.nan) for move in vals])

    if not vals:
        result = {} if split_dict else 0
        if not return_move:
            _memo[memo_key] = result
        return result

    C = np.array(rows, dtype=np.float64)
    finite_cols = np.any(np.isfinite(C), axis=0)
    if not np.any(finite_cols):
        result = {} if split_dict else 0
        if not return_move:
            _memo[memo_key] = result
        return result
    C_choice = C[:, finite_cols]
    choice_indices = np.where(finite_cols)[0]

    if minmax:
        security = np.nanmin(C_choice, axis=0)
        S = np.nanmax(security)
        mask = np.isclose(security, S)
        aves = np.full_like(security, -np.inf, dtype=np.float64)
        aves[mask] = np.nanmean(C_choice[:, mask], axis=0)
        choice_index = int(np.nanargmax(aves))
        move_index = int(choice_indices[choice_index])
        result = float(security[choice_index])
    else:
        security = np.nanmax(C_choice, axis=0)
        S = np.nanmin(security)
        mask = np.isclose(security, S)
        aves = np.full_like(security, np.inf, dtype=np.float64)
        aves[mask] = np.nanmean(C_choice[:, mask], axis=0)
        choice_index = int(np.nanargmin(aves))
        move_index = int(choice_indices[choice_index])
        result = float(security[choice_index])

    if return_move:
        return vals[move_index], vals, splits, C
    if split_dict:
        result = {split: float(C[row_index, move_index]) for row_index, split in enumerate(splits)}

    _memo[memo_key] = result
    return result
