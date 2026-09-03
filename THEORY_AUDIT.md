# Tic-Tac-Nope Computational Game Theory Audit

## Executive conclusion

The browser game is modeled as a finite, sequential, two-player, zero-sum extensive-form game with imperfect information and perfect recall. Legal strategies act only through a player's information state. The only strategy allowed to inspect the true hidden state is the explicitly labeled simulation-only **Omniscient Oracle** benchmark.

The equilibrium strategy uses **outcome-sampling Monte Carlo Counterfactual Regret Minimization (MCCFR)**. The implementation follows the standard importance-weighted outcome-sampling estimator used in the OpenSpiel reference implementation. This is a theoretically convergent approximate-equilibrium method for finite two-player zero-sum perfect-recall extensive-form games. A finite training run is not claimed to be an exact Nash equilibrium.

No game-state abstraction, utility approximation, or hidden-state leakage is used by the MCCFR solver. Sampling changes the computational estimator, not the game being solved.

## 1. Formal game model

A true state is represented by

\[
s=(B_O,B_X,T_O,T_X,p,o_O,o_X),
\]

where `B_O,B_X` are true-ownership bitmasks, `T_O,T_X` are attempted-mystery-cell bitmasks, `p` is the player to move, and `o_O,o_X` are the complete action/observation histories available to each player. The mystery-cell set and starting player are common knowledge.

### Legal actions

For a normal cell, the action is legal iff the cell is truly empty. This does not leak private information because all non-mystery occupancy is public.

For a mystery cell `c`, player `i` may attempt it iff `c` is not in `T_i`. Underlying occupancy does **not** affect legality. If the opponent already owns the mystery cell, the action fails and still consumes the turn. Modeling an occupied mystery cell as illegal would reveal hidden state through the action set and change the game.

### Terminal utility

\[
u_O(z)=\begin{cases}+1,&O\text{ wins},\\0,&\text{draw},\\-1,&X\text{ wins},\end{cases}
\qquad u_X(z)=-u_O(z).
\]

Therefore the game is exactly two-player zero-sum.

## 2. Information sets and perfect recall

Each player observes every visible move and its location; an opponent mystery action only as “a fog action occurred”; its own mystery-action location; whether its own mystery action succeeded or failed; and whether the game ended.

The information-state key is

\[
I_i(h)=\bigl(i,\text{start player},\text{mystery mask},o_i(h)\bigr).
\]

Two histories are in the same information set exactly when they generate the same stored observation history for the acting player.

A player never forgets any public action, the identity of any mystery cell it personally attempted, the success/failure result, or the ordering of observations. Thus histories merged into one information set contain the same sequence of that player's previous information sets and own actions. This is the perfect-recall condition needed for behavioral-strategy analysis and CFR convergence.

The engine also asserts at runtime that any repeated information key has the same legal action set. A violation throws immediately rather than silently solving a malformed game.

## 3. Public inference from nontermination

Game continuation is itself an observation. If one hypothetical hidden location would have immediately produced three in a row but the real game continues, that hypothetical history is impossible and must be removed. Belief transitions therefore keep a hypothetical successor only if terminal/nonterminal status matches the public outcome; if the game ends, the winner must also match.

## 4. Strategy definitions

### Belief Search

\[
Q(I,a)=\frac{1}{|I|}\sum_{h\in I}V_{\text{oracle}}(T(h,a)).
\]

The same action is applied to every compatible history. Continuation is exact perfect-information minimax for the same Tic-Tac-Nope move rules, including attempted-cell state and failed mystery actions. This is an internally consistent one-step information-set heuristic, not a full imperfect-information equilibrium.

### Softmax Mixed

\[
\sigma(a\mid I)=\frac{\exp(\beta Q(I,a))}{\sum_b\exp(\beta Q(I,b))},\qquad \beta=2.2.
\]

This is a valid randomized behavioral rule but not game-theoretic equilibrium mixing.

### Robust Maximin

\[
a^*=\arg\max_a\min_{h\in I}V_{\text{oracle}}(T(h,a)).
\]

This is an ambiguity-averse robust rule. It protects the worst compatible history but is not generally a Nash equilibrium.

### Thompson World Sampling

Sample one compatible history from the equal-weight possibility model, then choose its oracle-best move. Randomization comes from uncertainty over hidden histories rather than strategic indifference.

### Extensive-Form Modal

Let \(\bar\sigma^{\text{MCCFR}}(a\mid I)\) be the learned average behavior strategy. The modal projection plays

\[
a^*=\arg\max_a\bar\sigma^{\text{MCCFR}}(a\mid I).
\]

It is a deterministic visualization of the extensive-form policy and is not guaranteed to retain equilibrium properties because strategic randomization may be essential.

### Equilibrium Mixed (Outcome-Sampling MCCFR)

Play samples directly from

\[
a\sim\bar\sigma^{\text{MCCFR}}(\cdot\mid I).
\]

This is the primary game-theoretic mixed strategy.

### Uniform Random

Uniform over legal actions; used as a control baseline.

### Omniscient Oracle

Exact perfect-information minimax on the true state. It is illegal under the imperfect-information game and is simulation-only.

## 5. Why behavioral mixing is the correct representation

A normal-form mixed strategy is a distribution over complete pure contingency plans, which is enormous here. Under perfect recall, Kuhn's theorem gives outcome equivalence between mixed strategies over pure plans and behavioral strategies that randomize independently at each information set. The implementation therefore stores \(\sigma_i(a\mid I)\) rather than enumerating complete pure strategies.

## 6. MCCFR correctness

CFR minimizes counterfactual regret locally at information sets; in two-player zero-sum self-play, the average strategy approaches a Nash equilibrium. Literal full-tree traversal is too expensive for this game, so the deployed solver uses **outcome-sampling MCCFR**.

For updating player `i`, one terminal trajectory is sampled. At player `i`'s information sets, the sampling policy uses exploration

\[
q(a\mid I)=\epsilon/|A(I)|+(1-\epsilon)\sigma(a\mid I),
\]

with \(\epsilon=0.6\). Opponent nodes are sampled from the current policy.

With a zero baseline, only sampled action \(a_s\) has nonzero sampled child estimate:

\[
\tilde v(a)=\begin{cases}v_{\text{child}}/q(a_s\mid I),&a=a_s,\\0,&a\neq a_s.\end{cases}
\]

and

\[
\tilde v(I)=\sum_a\sigma(a\mid I)\tilde v(a).
\]

Counterfactual estimates apply the opponent-reach / sample-reach importance ratio:

\[
\tilde v_i(I,a)=\tilde v(a)\frac{\pi_{-i}}{\pi_q},\qquad
\tilde v_i(I)=\tilde v(I)\frac{\pi_{-i}}{\pi_q}.
\]

Regret update:

\[
R_i(I,a)\leftarrow R_i(I,a)+\tilde v_i(I,a)-\tilde v_i(I).
\]

Average-strategy accumulator:

\[
S_i(I,a)\leftarrow S_i(I,a)+\frac{\pi_i\sigma(a\mid I)}{\pi_q}.
\]

Regret matching uses positive cumulative regret and falls back to uniform when all positive regrets are zero. These equations match the standard OpenSpiel outcome-sampling MCCFR reference structure. Exploration supplies support at the updating player's actions; importance weighting corrects sampling bias.

### What is and is not guaranteed

- The algorithm targets the original unabstracted extensive-form game.
- MCCFR has regret/convergence guarantees under the stated game assumptions.
- The **average** strategy is the object with the equilibrium convergence guarantee.
- A finite iteration count is only an approximate equilibrium.
- The website does not claim an exact Nash certificate or exact exploitability value.

## 7. Speed optimization without changing the target game

The optimization pass intentionally avoids state abstraction:

1. integer bitmasks for O ownership, X ownership, attempted cells, and mystery cells;
2. eight precomputed win masks;
3. memoized omniscient minimax by the complete strategically relevant perfect-information state;
4. sparse information-set tables created only when sampled trajectories reach them;
5. seeded low-overhead xorshift RNG for training;
6. lazy equilibrium training only for configurations that request it;
7. outcome sampling instead of exhaustive/full external traversal.

No board-symmetry reduction is used because a correct symmetry map would also have to transform the mystery configuration and every private observation history; an incorrect canonicalization could merge distinct information sets and violate perfect recall.

## 8. Validation performed before deployment

The implementation pass tested:

- 5,000 random-history information-set action-consistency episodes;
- exact zero-sum terminal utilities;
- finite-horizon/nontermination guards;
- 500 incremental belief-tracking games in which the reachable truth was never eliminated;
- acting-player legal-action agreement across tracked possible histories;
- probability normalization and nonnegativity for MCCFR policies;
- all 64 ordered pairings of the 8 simulation strategies with multiple smoke-test games per pairing.

All checks passed.

## 9. Development performance benchmark

On the local Node runtime used for validation with the default mystery cells `{2,4}` in one-based display numbering:

- 100 external-sampling prototype iterations: about 1.25 s and more than 300k visited information sets;
- 10,000 deployed outcome-sampling iterations: about 0.47 s;
- 20,000 deployed outcome-sampling iterations during the full validation: about 0.82 s and roughly 61k information sets stored.

These are development-machine measurements, not browser performance guarantees.

## 10. References

- Zinkevich, M., Johanson, M., Bowling, M., & Piccione, C. (2007). *Regret Minimization in Games with Incomplete Information*. NeurIPS.
- Lanctot, M., Waugh, K., Zinkevich, M., & Bowling, M. (2009). *Monte Carlo Sampling for Regret Minimization in Extensive Games*. NeurIPS.
- Kuhn, H. W. (1953). *Extensive Games and the Problem of Information*.
- Google DeepMind OpenSpiel, `outcome_sampling_mccfr.py`, used as an implementation-level reference for the importance-weighted estimator structure.
