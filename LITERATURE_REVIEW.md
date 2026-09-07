# Tic-Tac-Nope Literature Review: Five Core Papers

This file identifies five papers that provide the most useful foundation for understanding the research space around Tic-Tac-Nope as an imperfect-information, two-player, zero-sum extensive-form game.

The goal is not to collect every relevant citation. These five papers were selected to cover the minimum serious foundation needed for the current research directions:

1. perfect recall and behavioral strategies;
2. sequence-form equilibrium computation;
3. counterfactual regret minimization;
4. Monte Carlo CFR; and
5. the strategic value of information.

A productive reading order is the order below.

---

## 1. Kuhn (1953): Extensive Games and the Problem of Information

**Citation**

H. W. Kuhn. *Extensive Games and the Problem of Information*. In H. W. Kuhn and A. W. Tucker, editors, **Contributions to the Theory of Games II**, Annals of Mathematics Studies 28, Princeton University Press, 1953, pp. 193–216.

**Link**

https://doi.org/10.1515/9781400829156-011

### Why this paper matters

This is the conceptual foundation for the entire Tic-Tac-Nope model.

The most important ideas to extract are:

- extensive-form games;
- information sets;
- perfect recall;
- pure, mixed, and behavioral strategies;
- the relationship between what a player observes and what a legal strategy may condition on; and
- Kuhn's realization-equivalence result for finite perfect-recall games.

For Tic-Tac-Nope, perfect recall is what justifies representing a strategy locally as

\[
\sigma_i(a\mid I)
\]

at each information set rather than explicitly randomizing over complete pure contingency plans.

### Connection to the repository

The current exact solver enforces a unique parent player sequence for every information set. Conceptually, that is directly tied to perfect recall: a player reaching an information set cannot have forgotten which of their own prior strategic actions led there.

The current observation model should be read through Kuhn's framework:

- the true hidden state belongs to the game state;
- the player's observation history determines the information set;
- the strategy may depend on the information set but not on the hidden true node inside it.

### What to understand before moving on

You should be able to explain clearly:

1. why two different true histories can belong to the same information set;
2. why perfect recall matters;
3. the difference between a mixed strategy and a behavioral strategy; and
4. why Tic-Tac-Nope's equilibrium policy can be stored as local probabilities at information sets.

---

## 2. von Stengel (1996): Efficient Computation of Behavior Strategies

**Citation**

Bernhard von Stengel. *Efficient Computation of Behavior Strategies*. **Games and Economic Behavior**, 14(2), 220–246, 1996.

**Link**

https://doi.org/10.1006/game.1996.0050

### Why this paper matters

This is the single most important paper for understanding the exact sequence-form LP currently implemented in Tic-Tac-Nope.

The central contribution is the sequence form: instead of assigning probabilities to exponentially many complete pure strategies, a perfect-recall extensive-form game can be represented using realization weights over player action sequences.

For player O, this is the origin of the constraints

\[
Ex=e, \qquad x\ge 0,
\]

and for player X,

\[
Fy=f, \qquad y\ge 0.
\]

The payoff of a pair of realization plans is represented bilinearly as

\[
x^T A y.
\]

For two-player zero-sum games, the equilibrium can then be computed by linear programming.

### Connection to the repository

This paper explains almost every mathematical object in `sequence_form_lp.py`:

- player sequences;
- realization weights;
- realization-flow constraints;
- the sparse payoff matrix;
- the sequence-form zero-sum LP; and
- conversion from realization weights back to behavioral probabilities.

The key local relation is

\[
x_{s(I)}=\sum_{a\in A(I)}x_{s(I)a},
\]

which becomes one row of the realization matrix.

The behavioral probability is recovered by

\[
\sigma(a\mid I)=\frac{x_{s(I)a}}{x_{s(I)}}
\]

when the parent realization is positive.

### What to understand before moving on

You should be able to derive:

1. why sequence form is linear in information-set actions rather than exponential in pure plans;
2. why realization weights are not the same as physical reach probabilities;
3. why the same parent sequence can appear in several information-set flow equations;
4. why the expected utility is \(x^TAy\); and
5. how the opponent's best-response LP is dualized to obtain the maximin LP used in the code.

---

## 3. Zinkevich, Johanson, Bowling, and Piccione (2007): Regret Minimization in Games with Incomplete Information

**Citation**

Martin Zinkevich, Michael Johanson, Michael Bowling, and Carmelo Piccione. *Regret Minimization in Games with Incomplete Information*. **Advances in Neural Information Processing Systems 20**, 2007.

**Link**

https://papers.nips.cc/paper_files/paper/2007/hash/08d98638c6fcd194a4b1e6992063e944-Abstract.html

### Why this paper matters

This is the foundational Counterfactual Regret Minimization (CFR) paper.

CFR gives a fundamentally different route to equilibrium than sequence-form LP.

Instead of globally solving one linear program, CFR repeatedly updates local regrets at information sets. The key conceptual object is **counterfactual regret**: regret for an action at an information set is weighted in a way that separates the acting player's own reach contribution from the opponent/chance contribution.

The paper shows that minimizing counterfactual regret across information sets minimizes overall external regret and, in two-player zero-sum self-play, drives the average strategy toward the Nash/minimax set.

### Connection to Tic-Tac-Nope

The repository's MCCFR strategy is built on this theory.

The exact LP and CFR target the same equilibrium concept under the same game model, but the computational approaches differ:

- sequence-form LP performs global exact-game optimization;
- CFR performs iterative regret minimization;
- LP provides a direct numerical optimality certificate;
- finite-run CFR provides an approximation whose quality depends on regret convergence.

This makes the exact LP particularly useful as a ground-truth benchmark for CFR/MCCFR experiments.

### What to understand before moving on

You should be able to explain:

1. counterfactual value;
2. instantaneous and cumulative counterfactual regret;
3. regret matching;
4. why average strategy rather than the final instantaneous strategy is the standard equilibrium object; and
5. why low regret implies approximate Nash equilibrium in two-player zero-sum games.

---

## 4. Lanctot, Waugh, Zinkevich, and Bowling (2009): Monte Carlo Sampling for Regret Minimization in Extensive Games

**Citation**

Marc Lanctot, Kevin Waugh, Martin Zinkevich, and Michael Bowling. *Monte Carlo Sampling for Regret Minimization in Extensive Games*. **Advances in Neural Information Processing Systems 22**, 2009.

**Paper link**

https://papers.nips.cc/paper_files/paper/2009/hash/00411460f7c92d2124a67ea0f4cb5f85-Abstract.html

**Direct PDF mirror**

https://www.cs.cmu.edu/~kwaugh/publications/nips09b.pdf

### Why this paper matters

This paper generalizes CFR into Monte Carlo Counterfactual Regret Minimization (MCCFR).

Instead of traversing the full game tree on every iteration, MCCFR samples portions of the tree and uses importance-weighted estimators to preserve the regret-minimization guarantees under appropriate conditions.

The paper develops sampling schemes including outcome sampling, which is especially relevant to the current repository.

### Connection to Tic-Tac-Nope

Tic-Tac-Nope is exactly the kind of domain where this distinction becomes useful:

- the complete unabstracted game can contain millions of histories;
- exact sequence-form solving is therefore an offline workload;
- outcome-sampling MCCFR can update from sampled trajectories much more cheaply;
- the tradeoff is that finite MCCFR runs do not provide the same immediate primal/dual optimality certificate as the exact LP.

This creates a natural research experiment:

\[
\text{MCCFR approximation quality versus exact sequence-form equilibrium}
\]

as a function of iterations, samples, information-set count, and hidden-cell geometry.

### What to understand before moving on

You should be able to explain:

1. why sampling reduces computational cost;
2. what the sampling policy is;
3. why importance weighting is required;
4. the difference between external sampling and outcome sampling; and
5. what theoretical guarantee survives when full CFR is replaced with MCCFR.

---

## 5. De Meyer, Lehrer, and Rosenberg (2010): Evaluating Information in Zero-Sum Games with Incomplete Information on Both Sides

**Citation**

Bernard De Meyer, Ehud Lehrer, and Dinah Rosenberg. *Evaluating Information in Zero-Sum Games with Incomplete Information on Both Sides*. **Mathematics of Operations Research**, 35(4), 851–863, 2010.

**Link**

https://doi.org/10.1287/moor.1100.0467

### Why this paper matters

This paper is the most important of the five for the proposed **information-structure research direction**.

It asks a question that is much closer to the strongest potential Tic-Tac-Nope paper than the solver papers do:

> How does the information available to the players change the value of a zero-sum game?

The authors study value-of-information functions and establish important structural properties, including Blackwell monotonicity: improving a player's information should not hurt that player in the corresponding zero-sum information comparison.

This is the literature against which a paper about changing Tic-Tac-Nope's feedback model should be positioned.

### Connection to Tic-Tac-Nope

The current game fixes one observation structure. A stronger research program would parameterize it.

Let

\[
v(H,\mathcal O)
\]

be the equilibrium value under hidden-cell configuration \(H\) and observation structure \(\mathcal O\).

Possible observation channels include:

- actor sees or does not see success/failure;
- opponent sees or does not see hidden-action location;
- delayed revelation;
- noisy feedback;
- one-sided versus symmetric information refinement.

Then the research question becomes not merely "what is the Nash value?" but

\[
\text{how does the equilibrium value change when the information structure is refined or garbled?}
\]

That moves Tic-Tac-Nope directly into the theory of the strategic value of information.

### What to understand before moving on

You should be able to explain:

1. what an information structure is;
2. what it means for one information structure to be more informative than another;
3. Blackwell-style comparison/garbling intuition;
4. why giving one player more information and giving both players more information are different questions; and
5. how a value function over information structures could be defined for Tic-Tac-Nope.

---

# Recommended Reading Order

Read the papers in this order:

1. **Kuhn (1953)** — learn the language of extensive games, information sets, perfect recall, and behavioral strategies.
2. **von Stengel (1996)** — understand sequence form, realization plans, and the exact LP currently used in the repository.
3. **Zinkevich et al. (2007)** — understand CFR and the regret-based route to Nash equilibrium.
4. **Lanctot et al. (2009)** — understand why and how MCCFR samples the game tree.
5. **De Meyer et al. (2010)** — move from "how do we solve the game?" to the more research-oriented question "how does information itself change strategic value?"

---

# How These Papers Map to the Five Research Directions

| Research direction | Most relevant paper(s) |
|---|---|
| Strategic value of information structure | De Meyer et al. (2010), Kuhn (1953) |
| Geometry of hidden information | Kuhn (1953), von Stengel (1996), then positional-game literature |
| Probing, signaling, and latent actions | Kuhn (1953), De Meyer et al. (2010), then imperfect-monitoring/signaling literature |
| New scalable exact solver | von Stengel (1996), Zinkevich et al. (2007), Lanctot et al. (2009) |
| Complexity of generalized Tic-Tac-Nope | Kuhn (1953), von Stengel (1996), then computational-complexity literature on incomplete-information games |

---

# Important Sixth Paper After These Five

Once these five are understood, the next paper to read is:

Daphne Koller, Nimrod Megiddo, and Bernhard von Stengel. *Efficient Computation of Equilibria for Extensive Two-Person Games*. **Games and Economic Behavior**, 14(2), 247–259, 1996.

https://doi.org/10.1006/game.1996.0051

This extends the sequence-form equilibrium-computation framework beyond the zero-sum LP setting and is useful for understanding the broader computational-game-theory context around sequence form.

---

# Current Research Positioning

These papers imply an important distinction for Tic-Tac-Nope.

The following are established tools rather than standalone research contributions:

- modeling the game as an extensive-form game;
- using behavioral strategies under perfect recall;
- solving a two-player zero-sum perfect-recall game using sequence-form linear programming;
- using CFR or MCCFR to approximate an equilibrium.

A stronger paper should therefore use these tools to establish something new about one of the following:

- the value of different feedback/information structures;
- the geometry of hidden information;
- equilibrium probing, signaling, or concealment;
- an exact solver that exploits additional structure beyond generic sequence form; or
- the complexity of a generalized hidden-information positional-game family.
