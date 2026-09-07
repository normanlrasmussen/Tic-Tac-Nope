# Literature Review: Tic-Tac-Nope and Hidden-Information Positional Games

## Purpose and scope

Tic-Tac-Nope sits at the intersection of several mature research areas: extensive-form games with imperfect information, exact equilibrium computation, regret-minimization methods, the economic value of information, search under partial observability, and combinatorial positional games. A credible research paper therefore cannot claim novelty merely from modeling Tic-Tac-Nope as an extensive-form game, solving it with sequence-form linear programming, or applying CFR/MCCFR. Those are established tools.

The stronger research opportunity is to use Tic-Tac-Nope as a **small, exactly solvable laboratory for studying how the structure and geometry of hidden information change strategic value**. The game has an unusually clean separation between the true physical state and the signals observed by the players: a mystery-cell attempt can change ownership, the actor knows the attempted location but not whether the attempt succeeded, and the opponent sees only an anonymous fog event. Because the underlying board is tiny, these information effects can be evaluated against exact minimax/Nash equilibria rather than approximate strategy quality alone.

This review develops that positioning. It first covers the theoretical foundations required to state the game correctly, then the exact and approximate solving literature, then the value-of-information literature, and finally the closest game-domain precedents such as Phantom Tic-Tac-Toe, Kriegspiel, Dark Hex, and Fog-of-War chess. The final section identifies the research gap that appears most defensible for a Tic-Tac-Nope paper.

---

## 1. Extensive-form games, information sets, and perfect recall

The correct starting point is Kuhn's extensive-form framework. In an imperfect-information sequential game, the underlying game history and the information available to the acting player are distinct objects. Histories that the acting player cannot distinguish are grouped into an **information set**, and a legal strategy must choose the same action distribution at every history in that information set.

Kuhn's 1953 paper is foundational because it formalizes the extensive form, information partitions, and the role of **perfect recall**. Perfect recall requires, informally, that a player never forgets information previously observed or actions previously taken. For finite games with perfect recall, mixed strategies over complete pure contingency plans and behavioral strategies that randomize locally at information sets are realization-equivalent.

This distinction is central to Tic-Tac-Nope. The solver must retain the true ownership of hidden cells internally while preventing a policy from conditioning on hidden truth that the player has not observed. If two different true histories generate the same player observation history, they must be represented by the same information set even though the true game states remain separate nodes of the extensive tree.

The current Tic-Tac-Nope observation model is naturally expressed in this language. The player observes visible moves, the locations of their own mystery attempts, and anonymous opponent mystery events. The actor does not directly observe the success or failure of a mystery attempt. Because the observation history records the ordered history of these events and the player's own actions, the intended model has perfect recall.

### Relevance to a paper

A paper should use Kuhn's framework as background, not as a contribution. The important claim is not "Tic-Tac-Nope has information sets." The important research question is what happens to equilibrium when those information sets are changed systematically by modifying the feedback channel.

**Core reference**

- H. W. Kuhn (1953), *Extensive Games and the Problem of Information*, in *Contributions to the Theory of Games II*, pp. 193-216.  
  DOI: https://doi.org/10.1515/9781400829156-011  
  Original bibliographic record: https://www.jstor.org/stable/j.ctt1b9x1zv.17

---

## 2. Sequence form and exact equilibrium computation

A normal-form pure strategy in an extensive game specifies an action at every information set, including information sets that may never be reached. Consequently, the normal-form representation can be exponentially larger than the extensive tree. This is precisely the computational obstacle addressed by the **sequence form**.

Von Stengel's 1996 paper replaces complete pure strategies with player action sequences and **realization weights**. In a perfect-recall game, these weights satisfy sparse linear flow constraints. For player O, the feasible realization plans can be written

\[
Q_O=\{x\ge 0: Ex=e\},
\]

and for X,

\[
Q_X=\{y\ge 0: Fy=f\}.
\]

If \(A\) is the sequence-form payoff matrix from O's perspective, expected utility is

\[
U_O(x,y)=x^T A y.
\]

For a two-player zero-sum game, the equilibrium problem becomes

\[
\max_{x\in Q_O}\min_{y\in Q_X} x^T A y.
\]

Dualizing the inner best-response LP gives a single linear program. This is the exact mathematical basis of the repository's current `sequence_form_lp.py` implementation. Koller, Megiddo, and von Stengel extend the sequence-form equilibrium framework to general two-person games through a linear complementarity formulation.

The conceptual importance of sequence form for Tic-Tac-Nope is twofold. First, it provides a rigorous exact-game equilibrium benchmark. Second, it establishes that the solver itself is not the research novelty: using sequence form for a finite, perfect-recall, two-player zero-sum extensive game is classical.

### What the exact solver contributes to research

The exact LP is best viewed as a **measurement instrument**. If the paper asks how changing hidden-cell geometry or observation rules changes strategic value, the LP allows those comparative statics to be measured without contamination from training error. That is a major advantage over large benchmark domains in which exploitability or equilibrium value must itself be approximated.

This distinction should be explicit in any paper:

> The contribution is not a new equilibrium concept or a new sequence-form formulation. The contribution is the structural phenomenon studied using an exact equilibrium oracle.

**Core references**

- Bernhard von Stengel (1996), *Efficient Computation of Behavior Strategies*, **Games and Economic Behavior** 14(2), 220-246.  
  DOI: https://doi.org/10.1006/game.1996.0050

- Daphne Koller, Nimrod Megiddo, and Bernhard von Stengel (1996), *Efficient Computation of Equilibria for Extensive Two-Person Games*, **Games and Economic Behavior** 14(2), 247-259.  
  DOI: https://doi.org/10.1006/game.1996.0051  
  Author PDF: https://ai.stanford.edu/~koller/Papers/Koller%2Bal%3AGEB96.pdf

---

## 3. CFR and MCCFR: scalable approximate equilibrium computation

Counterfactual Regret Minimization (CFR) provides a different route to equilibrium. Zinkevich et al. introduced counterfactual regret as a decomposition of regret across information sets. In finite two-player zero-sum perfect-recall games, driving average counterfactual regret toward zero drives the average strategy toward the Nash/minimax set.

The key conceptual difference from sequence-form LP is computational. Sequence form constructs and solves a global optimization problem. CFR repeatedly performs local regret updates at information sets. This can scale to games that are too large for direct LP solution, especially when combined with abstraction or sampling.

Lanctot et al. introduced Monte Carlo CFR (MCCFR), including outcome sampling and external sampling. MCCFR samples portions of the game tree and uses importance-weighted estimates so that, under the stated conditions, the regret updates agree with CFR in expectation and retain convergence guarantees.

For Tic-Tac-Nope, the LP and MCCFR are complementary rather than competing theoretical contributions. The exact LP gives ground truth for solved configurations; MCCFR provides a scalable approximate method. This creates a clean methodological benchmark: one can evaluate convergence, exploitability, or value error against a complete exact equilibrium.

### What would and would not be publishable

A paper showing that MCCFR can play Tic-Tac-Nope is not novel. Likewise, a comparison of LP and MCCFR runtime on a 3x3 game is unlikely to be a strong contribution by itself. A stronger computational paper would require a new reduction, decomposition, public-state representation, or other method that changes the scaling behavior of exact or approximate solving.

The exact equilibrium atlas is still valuable experimentally. It can be used to test whether approximate algorithms behave differently as the number, geometry, and information content of mystery cells change.

**Core references**

- Martin Zinkevich, Michael Johanson, Michael Bowling, and Carmelo Piccione (2007), *Regret Minimization in Games with Incomplete Information*, **NeurIPS 20**, 1729-1736.  
  Paper: https://papers.nips.cc/paper_files/paper/2007/hash/08d98638c6fcd194a4b1e6992063e944-Abstract.html  
  PDF: https://proceedings.neurips.cc/paper/2007/file/08d98638c6fcd194a4b1e6992063e944-Paper.pdf

- Marc Lanctot, Kevin Waugh, Martin Zinkevich, and Michael Bowling (2009), *Monte Carlo Sampling for Regret Minimization in Extensive Games*, **NeurIPS 22**.  
  Paper: https://proceedings.neurips.cc/paper/2009/hash/00411460f7c92d2124a67ea0f4cb5f85-Abstract.html  
  PDF mirror: https://www.cs.cmu.edu/~kwaugh/publications/nips09b.pdf

---

## 4. The value and comparison of information

The most important literature for a structurally novel Tic-Tac-Nope paper is not the solver literature; it is the **value-of-information** literature.

Blackwell's comparison of experiments provides the canonical order on information structures in single-agent decision problems. One signal is more informative than another when the less informative signal can be obtained as a **garbling** of the more informative one. Blackwell's result connects this order to decision value: a more informative experiment is at least as useful in every decision problem.

Strategic games are subtler because information given to one player changes the strategic environment faced by the other player. Pęski gives necessary and sufficient conditions for comparison of information structures in zero-sum games, phrased through Blackwell garbling of the players' information. De Meyer, Lehrer, and Rosenberg study value-of-information functions in zero-sum games with incomplete information on both sides and identify Blackwell monotonicity and concavity properties.

This literature provides the correct language for the proposed Tic-Tac-Nope research direction. Let

\[
v(H,\mathcal O)
\]

denote the zero-sum equilibrium value for a hidden-cell configuration \(H\) and observation structure \(\mathcal O\). The research problem is to understand how \(v\) changes when one component of \(\mathcal O\) is refined or garbled.

Examples include changing whether:

- the actor observes success/failure of a mystery attempt;
- the opponent observes the attempted mystery location;
- the opponent observes success/failure;
- information is revealed immediately or with delay;
- feedback is deterministic, noisy, or probabilistic.

### Important theoretical caution

The classical value-of-information papers do **not** automatically solve the Tic-Tac-Nope problem. In Tic-Tac-Nope, information is generated dynamically by strategic actions, and the feedback channel affects future information sets and future feasible behavior. The relevant information structure is therefore embedded in an extensive-form game rather than being merely an exogenous signal observed before a one-shot action.

That difference is potentially where a new paper can contribute. Blackwell/Pęski/De Meyer et al. provide comparative-statistics principles and terminology; Tic-Tac-Nope can test which properties extend, fail, or require modification when information is **endogenous, sequential, and action-dependent**.

### Strong candidate results

A strong theoretical program could seek results of the following form:

1. **One-sided refinement monotonicity.** If only the maximizing player's observations are refined while the physical game and the minimizing player's observations are unchanged, characterize when the value weakly increases.
2. **Two-sided refinement ambiguity.** Show that simultaneous information improvements for both players need not move the value monotonically in one direction.
3. **Strategic equivalence of feedback channels.** Characterize when two observation structures induce the same equilibrium value or realization-equivalent strategy set.
4. **Bounds on information value.** Bound \(|v(H,\mathcal O_1)-v(H,\mathcal O_2)|\) using structural properties of the hidden cells or feedback channel.
5. **Endogenous-information counterexamples.** Identify small examples where intuitions from exogenous signal comparison fail because players strategically choose which hidden interactions occur.

**Core references**

- David Blackwell (1953), *Equivalent Comparisons of Experiments*, **The Annals of Mathematical Statistics** 24(2), 265-272.  
  DOI: https://doi.org/10.1214/aoms/1177729032  
  JSTOR: https://www.jstor.org/stable/2236332

- Marcin Pęski (2008), *Comparison of Information Structures in Zero-Sum Games*, **Games and Economic Behavior** 62(2), 732-735.  
  DOI: https://doi.org/10.1016/j.geb.2007.06.004  
  Author PDF: https://marcinpeski.github.io/files/zs.pdf

- Bernard De Meyer, Ehud Lehrer, and Dinah Rosenberg (2010), *Evaluating Information in Zero-Sum Games with Incomplete Information on Both Sides*, **Mathematics of Operations Research** 35(4), 851-863.  
  DOI: https://doi.org/10.1287/moor.1100.0467  
  PDF: https://www.math.tau.ac.il/~lehrer/Papers/value%20of%20information%20-%20both%20sides.pdf

---

## 5. Imperfect-information search and the danger of determinization

A second adjacent literature studies how to search imperfect-information games when exact game-theoretic solution is difficult. This literature is important because several intuitive Tic-Tac-Nope heuristics - sampling compatible hidden states and solving them as if fully observed - resemble techniques historically used in Bridge, Kriegspiel, and other hidden-information games.

Frank and Basin's analysis of imperfect-information game search showed why naive Monte Carlo sampling of perfect-information states can fail badly: solving sampled states independently can ignore the requirement that a player choose one strategy that is consistent across indistinguishable histories. This is closely related to the conceptual error that the Tic-Tac-Nope solver audit previously identified in perfect-information continuation heuristics.

Kriegspiel provides an especially relevant board-game precedent. In Kriegspiel chess, the opponent's pieces and moves are hidden, and players infer state from attempted actions and referee feedback. Ciancarini and Favini investigated Monte Carlo tree-search approaches to Kriegspiel, emphasizing dynamic information and decision-making under uncertainty. Other work has constructed exact tablebases for restricted Kriegspiel endgames.

The lesson for Tic-Tac-Nope is useful but also limiting. Hidden board state, failed attempts, probing, and partial referee feedback are **not new phenomena** by themselves. A paper centered only on "players must reason about hidden board ownership" would sit too close to established Kriegspiel and imperfect-information search work.

What Tic-Tac-Nope can add is tractability: it is small enough to solve the complete extensive game exactly while still exhibiting hidden outcomes and asymmetric action observability. That makes it possible to distinguish a true information-theoretic strategic effect from an artifact of an approximate search algorithm.

**Representative references**

- Ian Frank and David Basin (2001), *A Theoretical and Empirical Investigation of Search in Imperfect Information Games*, **Theoretical Computer Science** 252(1-2), 217-256.  
  DOI: https://doi.org/10.1016/S0304-3975(00)00083-9

- Paolo Ciancarini and Gian Piero Favini (2010), *Monte Carlo Tree Search in Kriegspiel*, **Artificial Intelligence** 174(11), 670-684.  
  DOI: https://doi.org/10.1016/j.artint.2010.04.017  
  PDF mirror: https://ics.uci.edu/~dechter/courses/ics-295/fall-2019/papers/2010-mtc-aij.pdf

- Paolo Ciancarini and Gian Piero Favini (2010), *Playing the Perfect Kriegspiel Endgame*, **Theoretical Computer Science** 411, 3563-3577.  
  DOI: https://doi.org/10.1016/j.tcs.2010.05.019

---

## 6. General game playing with imperfect information

General Game Playing (GGP) provides another important precedent. GDL-II extends game-description languages to games with partial observations and stochasticity. Work such as HyperPlay and later HyperPlay-II reasons over sets of states compatible with a player's observations and explicitly addresses the valuation of information-gathering actions.

This line of work matters because it shows that representing and searching **belief-compatible histories** is itself established. Therefore, a Tic-Tac-Nope paper should not claim novelty from maintaining a set of possible hidden boards or from defining a belief-state search heuristic.

Instead, the exact Tic-Tac-Nope solver can contribute a controlled benchmark for evaluating such methods: because exact equilibrium policies are available for selected configurations, belief-state heuristics can be tested for value error and exploitability rather than only head-to-head win rate.

**Representative reference**

- Michael John Schofield and Michael Thielscher (2019), *General Game Playing with Imperfect Information*, **Journal of Artificial Intelligence Research** 66, 901-935.  
  DOI: https://doi.org/10.1613/JAIR.1.11844  
  Paper: https://mlanthology.org/jair/2019/schofield2019jair-general/

---

## 7. Positional games and generalized tic-tac-toe

Tic-tac-toe also belongs to the combinatorial literature on **positional games**. A positional game is naturally described on a hypergraph \((V,\mathcal W)\), where vertices are playable positions and hyperedges are winning sets. Strong positional games, Maker-Breaker games, Avoider-Enforcer games, and related variants have a substantial theory connecting game outcomes to hypergraph structure.

This literature gives a natural way to generalize Tic-Tac-Nope beyond the 3x3 board. Let

\[
\mathcal G=(V,\mathcal W)
\]

be an underlying positional game and let

\[
H\subseteq V
\]

be the hidden or mystery vertices. The observation channel then specifies what each player learns when actions interact with hidden vertices.

The strongest "geometry of hidden information" paper would use this abstraction. Rather than presenting 502 tic-tac-toe mask values as isolated data, it would ask whether the equilibrium-value set function

\[
v(H)
\]

has structural properties tied to the winning hypergraph.

Possible questions include:

- Is \(v(H)\) monotone in \(H\)?
- Is it submodular or supermodular?
- If neither, can minimal counterexamples be characterized?
- How do shared winning hyperedges, vertex degree, automorphism class, and fork structure predict marginal information value?
- Which hidden configurations are value-equivalent under automorphisms?
- Can bounds on \(v(H)\) be derived from hypergraph parameters?

The positional-games literature is mostly a perfect-information literature. That is precisely why an imperfect-information extension may be conceptually useful: the paper would preserve the familiar hypergraph geometry while adding a formally controlled observation structure.

**Core reference**

- Dan Hefetz, Michael Krivelevich, Miloš Stojaković, and Tibor Szabó (2014), *Positional Games*, Oberwolfach Seminars 44, Birkhäuser/Springer.  
  DOI: https://doi.org/10.1007/978-3-0348-0825-5

A representative generalized tic-tac-toe/positional-game discussion is also available in the broader literature summarized by the book above.

---

## 8. Phantom Tic-Tac-Toe, Dark Hex, and modern imperfect-information benchmarks

The closest modern competitive-learning precedent is particularly important: **Phantom Tic-Tac-Toe is already used as an imperfect-information benchmark**.

Recent work by Rudolph et al., presented at ICLR 2026, reevaluates policy-gradient methods for imperfect-information games and provides broadly accessible exact exploitability computation for several large games. Their benchmark set includes two variants of Phantom Tic-Tac-Toe, two imperfect-information Hex variants, and Liar's Dice. This means that "a hidden-information tic-tac-toe game as a benchmark for game-solving algorithms" is already occupied research territory.

Similarly, Sokota et al.'s work on decision-time planning evaluates methods on Phantom Tic-Tac-Toe and Dark Hex. These papers reinforce the need for precise positioning: Tic-Tac-Nope should not be sold principally as a new benchmark merely because it is a small hidden-information grid game.

However, these precedents also strengthen one potential contribution. Modern benchmark papers are often concerned with algorithm performance or exploitability at scale. Tic-Tac-Nope can instead focus on **exact comparative statics of the information structure itself**. The board is not valuable because it is large; it is valuable because it is small enough to completely solve under many controlled observation models.

**Representative references**

- Max Rudolph, Nathan Lichtlé, Sobhan Mohammadpour, Alexandre Bayen, J. Zico Kolter, Amy Zhang, Gabriele Farina, Eugene Vinitsky, and Samuel Sokota (2026), *Reevaluating Policy Gradient Methods for Imperfect-Information Games*, ICLR 2026.  
  arXiv: https://arxiv.org/abs/2502.08938  
  Benchmark code: https://github.com/nathanlct/IIG-RL-Benchmark

- Samuel Sokota, Gabriele Farina, David J. Wu, Hengyuan Hu, Kevin A. Wang, J. Zico Kolter, and Noam Brown (2024), *The Update Equivalence Framework for Decision-Time Planning*, ICLR 2024.  
  Project/PDF: https://www.mit.edu/~gfarina/2024/dtp_iclr24/

---

## 9. Fog-of-War chess and information-sensitive search

Fog-of-War chess is a useful large-domain comparison because it emphasizes strategic issues also present in Tic-Tac-Nope: information gathering, reasoning about what the opponent knows, signaling, and planning when there is no common public state.

Recent work by Zhang and Sandholm develops search techniques for imperfect-information games without common knowledge and applies them to superhuman Fog-of-War chess. This illustrates the frontier at the large-game algorithmic end of the literature.

For Tic-Tac-Nope, this work provides both motivation and a boundary. The game can exhibit the same categories of strategic phenomena at a tiny scale, but it should not compete with Fog-of-War chess on algorithmic scale or AI performance. Its comparative advantage is exactness and interpretability.

**Representative reference**

- Brian Zhang and Tuomas Sandholm (2026), *General Search Techniques without Common Knowledge for Imperfect-Information Games, and Application to Superhuman Fog of War Chess*, ICLR 2026.  
  Paper: https://proceedings.iclr.cc/paper_files/paper/2026/hash/9705eec26e511d7844a591ce10c33a3f-Abstract-Conference.html

---

## 10. Synthesis: what is already known and what remains open

The literature establishes the following points.

### Established and therefore not sufficient as the main contribution

1. **Extensive-form modeling of imperfect information.** Information sets and perfect recall are classical.
2. **Behavioral strategies under perfect recall.** Kuhn's theorem provides the standard representation.
3. **Sequence-form exact equilibrium computation.** Linear-sized sequence representation and zero-sum LP solution are classical.
4. **CFR/MCCFR equilibrium approximation.** Regret-minimization methods are established and heavily studied.
5. **Hidden-information board games.** Kriegspiel, Phantom Tic-Tac-Toe, Dark Hex, and Fog-of-War chess already provide major precedents.
6. **Belief-state sampling/search.** Reasoning over compatible hidden states is established in imperfect-information search and GGP.
7. **Value-of-information comparisons.** Blackwell ordering and zero-sum information comparisons have a substantial formal literature.
8. **Positional-game geometry.** Hypergraph formulations of tic-tac-toe-like games are classical.

### The strongest remaining gap for Tic-Tac-Nope

The most defensible research gap is the intersection of these literatures:

> **Exact structural analysis of dynamic, action-dependent information in a positional game, with controlled variation of both the geometry of hidden locations and the feedback channel.**

That formulation is narrower than "imperfect-information games" but much stronger than "we solved a tic-tac-toe variant."

Tic-Tac-Nope has three features that make this gap plausible.

First, **information is endogenous**. Players choose mystery-cell actions, and those actions determine which hidden ownership transitions occur and which signals are generated.

Second, **feedback can be parameterized independently from physical dynamics**. One can hold the board transition rule fixed while changing whether action location, success/failure, or delayed information is revealed to either player.

Third, **the complete equilibrium is computationally accessible** for the 3x3 laboratory. This permits exact value comparisons across many information structures and hidden-cell geometries.

---

## 11. A research model suggested by the literature

A useful generalized definition is:

\[
\mathfrak G=(V,\mathcal W,H,\mathcal O),
\]

where

- \(V\) is the set of playable positions;
- \(\mathcal W\subseteq 2^V\) is the family of winning sets;
- \(H\subseteq V\) is the set of hidden/mystery positions; and
- \(\mathcal O\) is an observation rule assigning each player a signal after each action/transition.

For a fixed starting player, define

\[
v(H,\mathcal O)
\]

as the zero-sum equilibrium value.

This separates two research axes.

### Axis A: geometry

Hold \(\mathcal O\) fixed and study

\[
H\mapsto v(H,\mathcal O).
\]

This is the **geometry of hidden information** problem.

Define the marginal value of hiding \(c\notin H\):

\[
\Delta(c\mid H)=v(H\cup\{c\},\mathcal O)-v(H,\mathcal O).
\]

Then test monotonicity, submodularity, supermodularity, symmetry equivalence, and relationships to the winning hypergraph.

### Axis B: feedback structure

Hold \(H\) fixed and compare

\[
\mathcal O\mapsto v(H,\mathcal O).
\]

This is the **strategic value of feedback** problem.

Observation structures can be partially ordered by player-specific refinement/garbling where appropriate. The exact solver then permits direct numerical or theorem-driven comparison.

### Interaction

The most interesting possibility is that geometry and feedback interact:

\[
v(H,\mathcal O_1)-v(H,\mathcal O_2)
\]

may depend strongly on the position of the hidden cells. For example, revealing success on a center cell may have a different strategic value than revealing success on an edge cell because the center participates in more winning hyperedges.

This interaction is where the positional-game and information-value literatures genuinely meet.

---

## 12. Strong paper hypotheses generated by the review

The literature suggests several hypotheses worth testing before committing to a paper claim.

### H1. One-sided information refinement is value monotone

When the physical game is unchanged and only one player's observation is refined, the better-informed player's security value should weakly improve. A formal proof should specify the refinement map and show strategy-set simulation or an appropriate garbling relation in the extensive game.

### H2. Simultaneous refinement can have nontrivial effects

If both players receive additional information, the effect on the first-player value need not have a predetermined sign. Tic-Tac-Nope may provide minimal examples showing how board geometry controls which player's information gain dominates.

### H3. Hidden-cell value is not determined by cardinality

Existing exact artifacts already indicate that configurations with the same number of mystery cells can have different equilibrium values. The next step is to determine whether a small collection of hypergraph/geometric features explains those differences or whether higher-order interactions are essential.

### H4. The hidden-set value function is not globally submodular or supermodular

This is an empirical/theoretical question rather than an assumption. Exhaustive exact values on the 3x3 board can produce minimal counterexamples or support restricted structural results.

### H5. Information-sensitive equilibrium play differs qualitatively from perfect-information continuation rankings

There may exist information sets where equilibrium places positive probability on actions that would not be optimal if the hidden state were revealed. If found and characterized, these examples would isolate the strategic value of concealment, probing, or ambiguity.

### H6. Exact small-game equilibria expose approximation failure modes

Because exact exploitability and values are available, the game can test when determinization, equal-weight belief search, MCCFR, or other approximate methods become misleading as hidden-cell geometry and feedback change.

---

## 13. Recommended paper positioning

The strongest near-term paper should be positioned approximately as follows:

> We introduce a class of hidden-information positional games in which the physical winning hypergraph and the observation channel can be varied independently. Using a completely solved 3x3 instance as an exact laboratory, we study how hidden-location geometry and feedback refinement affect zero-sum equilibrium value and strategy. We establish structural properties and/or minimal counterexamples, and we use sequence-form LP only as the exact computational instrument.

A title in this direction could be:

**The Strategic Value and Geometry of Hidden Feedback in Positional Games**

or, if the results remain primarily computational:

**An Exact Equilibrium Atlas of Information Structures in Hidden-Information Tic-Tac-Toe**

The first title demands meaningful general theorems or structural characterizations. The second can support a more computational study, but it should still emphasize exhaustive information-structure analysis rather than the game implementation itself.

---

## 14. Reading order

For the shortest path to understanding the space, read in this order:

1. **Kuhn (1953)** - information sets, perfect recall, behavioral strategies.
2. **von Stengel (1996)** - sequence form and exact zero-sum LPs.
3. **Blackwell (1953)** - comparison/garbling of information.
4. **Pęski (2008)** and **De Meyer, Lehrer & Rosenberg (2010)** - strategic value of information in zero-sum games.
5. **Zinkevich et al. (2007)** and **Lanctot et al. (2009)** - CFR and MCCFR.
6. **Frank & Basin (2001)** and **Ciancarini & Favini (2010)** - search failure modes and hidden-board reasoning.
7. **Hefetz et al. (2014)** - positional-game/hypergraph framework.
8. **Sokota et al. (2024)** and **Rudolph et al. (2026)** - modern Phantom Tic-Tac-Toe/Dark Hex benchmarks and exploitability evaluation.
9. **Zhang & Sandholm (2026)** - current large-scale frontier for search without common knowledge.

---

## References

1. Kuhn, H. W. (1953). *Extensive Games and the Problem of Information*. In H. W. Kuhn and A. W. Tucker (eds.), **Contributions to the Theory of Games II**, 193-216. https://doi.org/10.1515/9781400829156-011
2. Blackwell, D. (1953). *Equivalent Comparisons of Experiments*. **The Annals of Mathematical Statistics**, 24(2), 265-272. https://doi.org/10.1214/aoms/1177729032
3. von Stengel, B. (1996). *Efficient Computation of Behavior Strategies*. **Games and Economic Behavior**, 14(2), 220-246. https://doi.org/10.1006/game.1996.0050
4. Koller, D., Megiddo, N., & von Stengel, B. (1996). *Efficient Computation of Equilibria for Extensive Two-Person Games*. **Games and Economic Behavior**, 14(2), 247-259. https://doi.org/10.1006/game.1996.0051
5. Frank, I., & Basin, D. (2001). *A Theoretical and Empirical Investigation of Search in Imperfect Information Games*. **Theoretical Computer Science**, 252(1-2), 217-256. https://doi.org/10.1016/S0304-3975(00)00083-9
6. Zinkevich, M., Johanson, M., Bowling, M., & Piccione, C. (2007). *Regret Minimization in Games with Incomplete Information*. **NeurIPS 20**. https://papers.nips.cc/paper_files/paper/2007/hash/08d98638c6fcd194a4b1e6992063e944-Abstract.html
7. Pęski, M. (2008). *Comparison of Information Structures in Zero-Sum Games*. **Games and Economic Behavior**, 62(2), 732-735. https://doi.org/10.1016/j.geb.2007.06.004
8. Lanctot, M., Waugh, K., Zinkevich, M., & Bowling, M. (2009). *Monte Carlo Sampling for Regret Minimization in Extensive Games*. **NeurIPS 22**. https://proceedings.neurips.cc/paper/2009/hash/00411460f7c92d2124a67ea0f4cb5f85-Abstract.html
9. Ciancarini, P., & Favini, G. P. (2010). *Monte Carlo Tree Search in Kriegspiel*. **Artificial Intelligence**, 174(11), 670-684. https://doi.org/10.1016/j.artint.2010.04.017
10. De Meyer, B., Lehrer, E., & Rosenberg, D. (2010). *Evaluating Information in Zero-Sum Games with Incomplete Information on Both Sides*. **Mathematics of Operations Research**, 35(4), 851-863. https://doi.org/10.1287/moor.1100.0467
11. Hefetz, D., Krivelevich, M., Stojaković, M., & Szabó, T. (2014). *Positional Games*. Birkhäuser. https://doi.org/10.1007/978-3-0348-0825-5
12. Schofield, M. J., & Thielscher, M. (2019). *General Game Playing with Imperfect Information*. **Journal of Artificial Intelligence Research**, 66, 901-935. https://doi.org/10.1613/JAIR.1.11844
13. Sokota, S., Farina, G., Wu, D. J., Hu, H., Wang, K. A., Kolter, J. Z., & Brown, N. (2024). *The Update Equivalence Framework for Decision-Time Planning*. **ICLR 2024**. https://www.mit.edu/~gfarina/2024/dtp_iclr24/
14. Rudolph, M., Lichtlé, N., Mohammadpour, S., Bayen, A., Kolter, J. Z., Zhang, A., Farina, G., Vinitsky, E., & Sokota, S. (2026). *Reevaluating Policy Gradient Methods for Imperfect-Information Games*. **ICLR 2026**. https://arxiv.org/abs/2502.08938
15. Zhang, B., & Sandholm, T. (2026). *General Search Techniques without Common Knowledge for Imperfect-Information Games, and Application to Superhuman Fog of War Chess*. **ICLR 2026**. https://proceedings.iclr.cc/paper_files/paper/2026/hash/9705eec26e511d7844a591ce10c33a3f-Abstract-Conference.html
