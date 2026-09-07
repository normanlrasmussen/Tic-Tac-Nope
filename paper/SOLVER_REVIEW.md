# Tic-Tac-Nope Solver Review

## Bottom line

The current equal-belief solver has the correct **current-decision principle**:

> A player must choose one action for the entire information set, and if every possible information state is assumed equally likely, the action can be scored by averaging its value across those states.

That gives

\[
Q(I,a)=\frac{1}{|I|}\sum_{s\in I}V(T(s,a)).
\]

However, the Python `information_set_algo.py` is **not an exact solver for the full Tic-Tac-Nope game**. It is best described as a one-step information-set optimizer with a perfect-information continuation approximation.

## What is correct

### 1. One action is used across the whole information set

This is the essential imperfect-information constraint. The player cannot choose a different action depending on which hidden state is actually true.

### 2. Equal weighting matches the requested modeling assumption

`canonical_information_set` deduplicates states and then every distinct state is weighted equally. This is internally consistent with the assumption that each possible information state is equally likely.

### 3. The current action value is an expected value over the information set

The solver evaluates the same action in each state and averages the continuation values. This is the right structure for a Bayesian current-action decision under equal state weights.

## Problems found

### Critical 1: Occupied mystery cells are treated as illegal

The game rules say a player may attempt a mystery cell once even if the opponent already owns it. In that case the attempt fails and the turn is consumed.

The Python solver currently defines a move as playable only when the cell contains `EMPTY` or `HIDDEN`. If a possible state contains `X` or `O` at a mystery location, that action is removed.

That changes the game. A hidden-cell action should be legal based on whether **this player has already attempted that mystery location**, not based on whether the underlying board is occupied.

### Critical 2: Applying an action to an occupied mystery cell is modeled incorrectly

`apply_action` raises an error when a cell is already occupied. For an ordinary visible cell that is correct. For a mystery cell it is not: the legal action should leave the board unchanged and consume the turn.

### Critical 3: Board state alone is not a sufficient information state

Two histories can lead to the same board but have different future legal actions because a player may attempt each mystery cell only once.

Therefore an information state needs at least:

- the possible underlying board;
- the acting player's known attempted mystery cells (known exactly to that player);
- a representation of possible opponent mystery-attempt histories when those affect future inference or legality.

A board-only memoization key can merge strategically different states.

The browser implementation now keeps hypothetical opponent-attempt sets alongside each possible board for this reason.

### Critical 4: Future continuation becomes perfect-information tic-tac-toe

After the current action, `information_set_algo.py` evaluates each concrete board with `_perfect_information_minimax`.

That means future players effectively know the true board and do not make decisions from their own information sets. This does **not** solve the full imperfect-information game.

The current action can still be useful, but its value is an approximation:

\[
Q(I,a)=\frac1{|I|}\sum_s V_{\text{perfect-info}}(T(s,a)).
\]

rather than the exact imperfect-information continuation value.

### Important 5: Perfect-information minimax also uses ordinary occupancy legality

The continuation evaluator cannot represent a legal failed attempt into an occupied mystery cell. Thus even as a heuristic continuation model, it is solving a slightly different game once occupied mystery cells exist.

### Important 6: Equal weighting after deduplication is an assumption, not general Bayesian conditioning

If several different hidden histories collapse to the same board state, deduplicating and assigning every resulting state equal weight is not the same as carrying probability mass through the observation tree.

This is acceptable because the project explicitly assumes all possible information states are equally likely, but the UI should call these **equal-weight belief confidence values**, not statistically calibrated probabilities.

### Minor 7: Utility values are coarse

Using only `+1`, `0`, and `-1` produces many ties. The deterministic solver breaks ties by lowest cell number. This is mathematically valid for the stated utility but may make play look arbitrary among strategically equivalent actions.

## Browser solver changes made during this review

The web engine now improves the state model in two ways:

1. A mystery location remains a legal attempt even when it may already be occupied, provided the acting player has not previously attempted that location.
2. Each possible information state stores a hypothetical set of the opponent's prior mystery attempts, so two identical boards with different hidden-action histories are not automatically merged.

The browser still uses perfect-information minimax for deeper continuation. It therefore should be described as **optimal current action under the equal-weight belief model with a perfect-information continuation heuristic**, not as a solved extensive-form equilibrium.

## What an exact solver would require

For a true two-player solution, recurse over information states rather than concrete boards.

A full recursive state would need enough history to derive both players' observations and legal actions. Conceptually:

\[
G=(s, h, p)
\]

where `s` is the true underlying state, `h` is the observation/action history needed to reconstruct information sets, and `p` is the player to move.

At each information set, one strategy action must be chosen for every indistinguishable node in that set. After an action, possible worlds must be partitioned by the observation received by the next player.

That is an extensive-form imperfect-information game. Solving it exactly would require either:

- a recursive information-set dynamic program when the structure permits it;
- sequence-form equilibrium methods for suitable zero-sum formulations; or
- CFR / CFR+ if mixed strategies and a larger extensive-form representation are desired.

For the present project, the next clean engineering step is to replace the perfect-information continuation function with a recursive transition over the next player's information set while keeping the current equal-weight assumption.