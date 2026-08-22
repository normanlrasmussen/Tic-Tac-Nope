# Tic-Tac-Nope

Tic-Tac-Nope is a command-line Python version of tic-tac-toe with hidden tiles.
Players still try to make three in a row, but some board positions start hidden.
The first player to choose a hidden position claims it; later attempts to use that
same hidden position do not change who owns it.

## Requirements

- Python 3
- NumPy

Install NumPy if it is missing:

```bash
python -m pip install numpy
```

## Running the Game

Start the interactive game with:

```bash
python main.py
```

By default, `main.py` runs:

```python
play_game(verbose_1=True, verbose_2=True)
```

This prints the game board, player beliefs, algorithm details, and the AI's
recommended moves. To reduce output, edit the call at the bottom of `main.py`:

```python
play_game(verbose_1=False, verbose_2=False)
```

Moves are entered as integers from `0` to `8`, laid out like this:

```text
0 | 1 | 2
--+---+--
3 | 4 | 5
--+---+--
6 | 7 | 8
```

## Game Rules

The basic rules are the same as tic-tac-toe:

- `O` and `X` alternate turns.
- The first player with three marks in a row, column, or diagonal wins.
- If the board fills without a winner, the game is a draw.

The twist is hidden tiles:

- Hidden tiles are shown as `█`.
- A hidden tile can be selected by each player, but only the first claim counts
  on the actual board.
- Each player tracks possible beliefs about what hidden moves may have happened.
- The AI uses those belief states to choose moves.

The default hidden tiles are positions `1` and `3`.

## Files

### `main.py`

The interactive entry point.

Important pieces:

- Imports the game engine from `simulation.py`.
- Imports tile constants and split formatting from `algo.py`.
- Defines `prompt_for_move()`, which repeatedly asks the human player for a valid
  integer move.
- Defines verbose debug printers:
  - `print_verbose_1()` shows the current player's beliefs, move columns, split
    rows, cost matrix, and recommended move.
  - `print_verbose_2()` shows both players' belief states and the actual board.
- Defines `play_game()`, which runs the turn loop, asks for human input, calls the
  AI, applies moves, and stops when there is a win or draw.

Run this file directly to play the game.

### `simulation.py`

The main game-state engine.

Important pieces:

- Creates the initial board and state dictionaries.
- Converts numeric tile values into display text.
- Prints the actual board and belief boards.
- Checks terminal game status.
- Updates both players' beliefs after known and hidden moves.
- Tracks hidden overlays so claimed hidden moves can be shown on the board.
- Exposes `algorithm_decision()`, which calls the minimax-like algorithm in
  `algo.py`.
- Exposes `apply_move()`, which mutates the game state after each move.

The state dictionary contains:

- `actual_board`: the real board used for win/draw checks.
- `o_beliefs`: O's possible board states.
- `o_splits`: hidden-tile split history for O's beliefs.
- `x_beliefs`: X's possible board states.
- `x_splits`: hidden-tile split history for X's beliefs.
- `hidden_overlays`: display hints for hidden tiles that have been claimed.

### `algo.py`

The AI and hidden-information search logic.

Important pieces:

- Defines tile constants:
  - `X = 1`
  - `O = 2`
  - `HIDDEN = 3`
- `normalize_splits()` converts split data into a sorted tuple.
- `get_all_moves()` collects all moves that may be legal across a group of
  belief states.
- `is_event()` checks whether a belief state is already a win, loss, or draw.
- `split_belief()` expands one hidden board into multiple possible boards.
- `algo()` recursively evaluates moves over belief states.

The algorithm treats `O` as the maximizing player and `X` as the minimizing
player. It returns either a score, a dictionary of split scores, or a recommended
move depending on the arguments.

### `functions.py`

General tic-tac-toe helper functions.

Important pieces:

- `print_board()` prints one board.
- `print_multi_board()` prints several boards side by side.
- `check_winner()` checks rows, columns, and diagonals for a winner.
- `check_draw()` returns true when the board has no zero-valued empty cells.
- `get_valid_moves()` returns indexes where a belief board contains `0`.

This file does not know about the full game loop. It only provides reusable board
utilities.

### `game_rules.txt`

A short plain-text description of the game idea. It explains the hidden-tile
variant in informal language.

### `.gitignore`

Ignores Python cache and compiled bytecode files:

- `__pycache__/`
- `*.pyc`
- `*.pyo`
- `*.pyd`

### `__pycache__/`

Generated Python bytecode cache directory. This is ignored by Git and can be
deleted safely. Python may recreate it automatically.

## Possible Errors and Fixes

### `ModuleNotFoundError: No module named 'numpy'`

NumPy is not installed in the active Python environment.

Fix:

```bash
python -m pip install numpy
```

### `Enter an integer move.`

The interactive prompt received something that cannot be parsed as an integer.

Fix: enter a number from the valid-move list printed by the game.

### `Invalid move. Valid moves: [...]`

The move was an integer, but it was not valid for the current belief state.

Fix: choose one of the moves shown in the printed valid-move list.

### `IndexError` from hidden tile setup

`initial_board()` writes hidden tiles directly into a length-9 board. If a hidden
tile is outside `0` through `8`, Python will raise an index error.

Fix: call `play_game(hidden_tiles=(...))` only with board indexes from `0` to `8`.

### Slow startup or slow AI moves

The AI recursively searches possible belief states. Hidden tiles increase the
number of states, so the first decision or later decisions may take a few
seconds.

Fixes:

- Use fewer hidden tiles.
- Turn off verbose output.
- Add more memoization or pruning if expanding the game.

### Display issues with `█`

Hidden tiles use the Unicode block character `█`. Some terminals may display it
with odd spacing or as an unknown character.

Fix: use a UTF-8-capable terminal, or change the hidden display character in
`functions.py` and `simulation.py`.

### No winner after hidden tiles remain

Draw detection intentionally waits until there are no hidden tiles left on the
actual board. This is part of the current implementation. If hidden tiles are not
resolved as expected, the game may continue longer than normal tic-tac-toe.

Relevant code:

- `terminal_status()` in `simulation.py`
- `is_event()` in `algo.py`

## Development Checks

Run a syntax/import check with:

```bash
python -m py_compile main.py algo.py functions.py simulation.py
```

Run a quick AI smoke check with:

```bash
python -c "from simulation import make_initial_state, algorithm_decision; from algo import O; s=make_initial_state((1,3)); print(algorithm_decision(s['o_beliefs'], s['o_splits'], O)[0])"
```

