import numpy as np

from algo import O, X, normalize_splits
from simulation import (
    algorithm_decision,
    apply_move,
    make_initial_state,
    other_tile,
    print_beliefs,
    print_game_board,
    terminal_status,
    tile_name,
    valid_moves_for_player,
    visible_overlays,
)


def prompt_for_move(valid_moves):
    valid = set(int(move) for move in valid_moves)
    while True:
        raw = input("Move: ").strip()
        try:
            move = int(raw)
        except ValueError:
            print("Enter an integer move.")
            continue
        if move in valid:
            return move
        print(f"Invalid move. Valid moves: {sorted(valid)}")


def print_verbose_1(state, tile):
    key = "o" if tile == O else "x"
    beliefs = state[f"{key}_beliefs"]
    splits = state[f"{key}_splits"]
    move, vals, row_splits, C = algorithm_decision(beliefs, splits, tile)
    print_beliefs(beliefs, splits, f"{tile_name(tile)} beliefs")
    print("Move columns:", vals)
    print("Row splits:", [list(normalize_splits(split)) for split in row_splits])
    print("Cost matrix C:")
    print(C)
    print(f"Recommended move: {move}")


def print_verbose_2(state):
    print_beliefs(state["o_beliefs"], state["o_splits"], "O beliefs")
    print_beliefs(state["x_beliefs"], state["x_splits"], "X beliefs")
    print_game_board(state["actual_board"], visible_overlays(state["hidden_overlays"]), "Actual board")


def play_game(
        hidden_tiles=(1, 3),
        human_first=True,
        verbose_1=False,
        verbose_2=False,
        seed=None,
):
    hidden_tiles = tuple(sorted(int(tile) for tile in hidden_tiles))
    state = make_initial_state(hidden_tiles)

    if seed is not None:
        np.random.seed(seed)

    human_tile = O if human_first else X
    ai_tile = X if human_first else O
    current_tile = O

    while True:
        done, message = terminal_status(state["actual_board"])
        if done:
            print_game_board(state["actual_board"], visible_overlays(state["hidden_overlays"]), "Final board")
            print(message)
            return message

        current_key = "o" if current_tile == O else "x"
        beliefs = state[f"{current_key}_beliefs"]
        splits = state[f"{current_key}_splits"]
        valid_moves = valid_moves_for_player(beliefs, splits)

        if current_tile == ai_tile:
            move, vals, _, C = algorithm_decision(beliefs, splits, current_tile)
            if verbose_1:
                print(f"AI {tile_name(current_tile)} algorithm columns:", vals)
                print("AI cost matrix C:")
                print(C)
                print(f"AI recommended move: {move}")
            print(f"AI {tile_name(current_tile)} plays {move}")
        else:
            if verbose_2:
                print_verbose_2(state)
            if verbose_1:
                print_verbose_1(state, current_tile)
            print_game_board(
                state["actual_board"],
                visible_overlays(state["hidden_overlays"]),
                f"{tile_name(current_tile)} to move",
            )
            print("Valid moves:", valid_moves)
            move = prompt_for_move(valid_moves)

        apply_move(state, move, current_tile, hidden_tiles)
        current_tile = other_tile(current_tile)


if __name__ == "__main__":
    play_game()
