# Research Directions for Tic-Tac-Nope

Tic-Tac-Nope is most promising as a **research laboratory for imperfect-information game theory**, not merely as a new board game or a demonstration of sequence-form LP solving. Sequence form, CFR, and hidden-information board games already have mature literatures, so a strong paper should center on a new structural theorem, a new algorithmic result, a new complexity result, or a carefully designed empirical study that reveals a broader strategic phenomenon.

The five directions below are the strongest current candidates.

---

## 1. Strategic Value of Information Structure

### Core idea

Study how the **observation model itself** changes the equilibrium value of a sequential zero-sum game.

Let

\[
v(H,\mathcal O)
\]

denote the equilibrium value of Tic-Tac-Nope, where:

- \(H\) is the set of hidden cells; and
- \(\mathcal O\) is the information/observation structure.

The current game uses one particular observation structure:

- the actor knows which hidden cell they attempted;
- the actor does not observe whether the attempt succeeded;
- the opponent only observes an anonymous fog action;
- the opponent does not observe the attempted hidden location.

A stronger research program would define a family of observation structures while keeping the underlying board mechanics fixed.

Examples include:

1. actor observes location and success; opponent observes location and success;
2. actor observes location and success; opponent observes only a fog action;
3. actor observes location but not success; opponent observes only a fog action;
4. actor observes location but not success; opponent observes location but not success;
5. neither player observes hidden-action location;
6. delayed revelation of hidden-action outcomes;
7. noisy or probabilistic feedback channels.

### Central research question

> How does feedback granularity change equilibrium value and equilibrium behavior in a dynamic positional game?

A useful formalization would compare information structures using a partial order such as Blackwell informativeness. If \(\mathcal O_1\) is more informative to one player than \(\mathcal O_2\), one can ask when

\[
v(H,\mathcal O_1)\ge v(H,\mathcal O_2)
\]

must hold and when it can fail.

Giving one player more information should generally improve that player's strategic possibilities. Giving **both players** more information is subtler because the two informational gains work in opposite directions in a zero-sum game.

### Strong theoretical targets

Possible theorem-level contributions include:

- monotonicity of the game value under one-sided information refinement;
- counterexamples to monotonicity under simultaneous information refinement;
- sufficient conditions under which hiding action locations or outcomes benefits the first mover;
- bounds on the value change caused by refining or garbling one feedback channel;
- classification of observation structures that are strategically equivalent.

### Experimental program

For each hidden-cell configuration \(H\):

1. solve the game exactly under each observation model;
2. compare equilibrium values;
3. compare equilibrium support sizes and mixing behavior;
4. compare information-set counts and sequence counts;
5. identify where changing feedback causes qualitative changes in optimal play.

### Why this direction is strong

This direction connects Tic-Tac-Nope to a broad literature on:

- value of information;
- Blackwell comparison of experiments;
- information design;
- imperfect monitoring;
- dynamic zero-sum games.

The game becomes a small, exactly solvable environment in which informational effects can be measured without approximation error from the equilibrium solver.

### Possible paper framing

**The Strategic Value of Hidden Feedback in Positional Games: An Exact Study of Tic-Tac-Nope**

---

## 2. Geometry of Hidden Information

### Core idea

Study the equilibrium-value function

\[
v(H)
\]

as a set function of the hidden-cell configuration \(H\).

The existing exact artifacts already suggest that the **location and geometry of hidden cells matter substantially**, not merely the number of hidden cells.

For example, different two- and three-hidden-cell layouts produce materially different Nash values even when they contain the same number of mystery cells.

### Central research question

> What structural features of a hidden-cell set determine its strategic value?

Potential explanatory features include:

- center, corner, or edge membership;
- graph distance between hidden cells;
- whether hidden cells lie on the same winning line;
- number of winning lines incident to each hidden cell;
- overlap among winning lines;
- automorphism class under the board symmetry group;
- number of potential forks involving hidden cells.

### Marginal information value

Define the marginal effect of hiding a cell \(c\) given current hidden set \(H\):

\[
\Delta(c\mid H)=v(H\cup\{c\})-v(H).
\]

Then investigate whether \(v(H)\) has properties such as:

- monotonicity;
- submodularity;
- supermodularity;
- neither, with structured counterexamples.

### Information synergy

For two cells \(i,j\), define a second-order interaction term such as

\[
\Gamma(i,j)
=
v(\{i,j\})-v(\{i\})-v(\{j\})+v(\varnothing).
\]

Then:

- \(\Gamma(i,j)>0\) indicates strategic synergy from hiding the cells together;
- \(\Gamma(i,j)<0\) indicates substitutability.

This creates a rigorous way to study whether combinations of hidden cells generate value beyond the sum of their individual effects.

### Generalization to positional games

The strongest version should move beyond the 3×3 board.

Represent a positional game as a hypergraph

\[
\mathcal G=(V,\mathcal W),
\]

where:

- \(V\) is the set of playable positions;
- \(\mathcal W\subseteq2^V\) is the family of winning sets.

Then let

\[
H\subseteq V
\]

be the hidden vertices.

Tic-Tac-Nope becomes one instance of a broader class of **hidden-information positional games**.

### Strong theoretical targets

Possible results include:

- characterizing when two hidden configurations are value-equivalent;
- proving symmetry-based reductions using automorphism groups;
- deriving bounds on \(v(H)\) from hypergraph structure;
- proving or disproving submodularity of the hidden-set value function;
- identifying graph or hypergraph features that predict large information effects.

### Why this direction is strong

This direction turns the exact artifact set into more than a table of Nash values. The research contribution becomes a structural theory of how **where information is hidden** interacts with the geometry of a competitive positional game.

### Possible paper framing

**The Geometry of Hidden Information in Positional Games**

---

## 3. Probing, Signaling, and Latent Actions

### Core idea

Tic-Tac-Nope contains a distinctive imperfect-monitoring mechanism.

A hidden-cell action can simultaneously have:

1. a real physical effect on board ownership;
2. a private action identity known to the actor;
3. an outcome that may remain hidden even from the actor;
4. only a coarse signal observed by the opponent.

Thus a move is not merely a board-placement decision. It can also affect future beliefs, future information, and what the opponent infers about the actor's behavior.

### Central research question

> When does equilibrium play sacrifice immediate board value in order to gain information, preserve ambiguity, or manipulate the opponent's beliefs?

This would make Tic-Tac-Nope a clean environment for studying:

- probing actions;
- signaling;
- information concealment;
- belief manipulation;
- strategic experimentation;
- imperfect monitoring.

### Possible value decomposition

One could attempt to distinguish components of an action's continuation value:

\[
Q(I,a)
=
\text{physical board effect}
+
\text{information effect}
+
\text{signaling effect},
\]

with the caveat that an exact additive decomposition would require a careful formal definition.

A more rigorous approach would compare the true equilibrium continuation value against counterfactual games in which one informational channel is removed or revealed.

### Strong theoretical targets

Potential results include statements such as:

- there exist information sets at which every equilibrium assigns positive probability to an action that is inferior under perfect-information continuation values;
- equilibrium randomization is necessary to preserve ambiguity about hidden actions;
- some hidden actions are valuable primarily because of their effect on future beliefs rather than their immediate board outcome;
- information-revealing actions can be strategically dominated by information-preserving actions even when their immediate expected physical payoff is higher.

### Empirical program

For each equilibrium information set:

1. compute the equilibrium action distribution;
2. compute perfect-information continuation values for each underlying state;
3. compare those with imperfect-information equilibrium continuation values;
4. identify actions whose ranking reverses because of information effects;
5. measure how much of the equilibrium support is attributable to strategic concealment or probing.

### Why this direction is strong

This paper would focus on a **strategic phenomenon**, not on the solver itself. The small size of Tic-Tac-Nope allows exact equilibria to be used to isolate signaling and probing behavior that is difficult to interpret in larger hidden-information games.

### Possible paper framing

**Probing and Signaling with Latent Action Outcomes in Imperfect-Information Games**

---

## 4. A New Scalable Exact Solver

### Core idea

The current solver uses classical sequence-form linear programming and explicitly enumerates the complete unabstracted game tree.

That is mathematically rigorous, but the use of sequence form itself is not novel. A publishable algorithm paper would need to exploit additional structure in Tic-Tac-Nope or in a broader game class.

### Central research question

> Can an exact equilibrium be computed without explicitly enumerating every true history?

Potential exploitable structure includes:

- public observation states;
- equivalent latent ownership states;
- board automorphisms;
- information-state DAGs;
- repeated continuation subgames;
- factorization of the sequence payoff matrix;
- compressed representations of observation histories;
- column generation or constraint generation;
- decomposition by public state;
- dynamic programming over belief-support structure.

### Strong algorithmic target

The ideal contribution would replace the current history-level representation with a substantially smaller exact representation while preserving the same equilibrium value.

For example, instead of scaling primarily with

\[
|H_{\text{histories}}|,
\]

the solver might scale with a quantity such as

\[
|S_{\text{public}}|\times |B_{\text{latent}}|,
\]

or another compressed sufficient-state description.

### What would make this publishable

A strong algorithm paper should include:

1. a formal compressed representation;
2. a proof that it is strategically equivalent to the original extensive-form game;
3. an exact equilibrium algorithm over the compressed representation;
4. complexity analysis;
5. empirical comparisons with the existing full sequence-form solver;
6. scaling experiments on larger boards or generalized games.

The key result should not be a constant-factor speedup. It should be a new structural reduction or decomposition that changes the practical or asymptotic scaling.

### Natural benchmark progression

A convincing evaluation could include:

- 3×3 Tic-Tac-Nope as the exact reference;
- 4×4 variants;
- \(k\)-in-a-row variants;
- larger hidden-cell sets;
- generalized positional-game hypergraphs.

### Why this direction is strong

If successful, Tic-Tac-Nope becomes a motivating example for a broader exact imperfect-information solving technique rather than merely an application of an existing LP formulation.

### Possible paper framing

**Exact Equilibrium Computation in Hidden-Information Positional Games via Public-State Compression**

---

## 5. Complexity of Generalized Tic-Tac-Nope

### Core idea

Generalize the decision problem and classify its computational complexity.

For example, define a generalized game instance containing:

- a board or positional-game hypergraph \(\mathcal G=(V,\mathcal W)\);
- a hidden set \(H\subseteq V\);
- an observation structure \(\mathcal O\);
- a starting player;
- possibly a target value \(q\).

Then study a decision problem such as

\[
\textsc{Tic-Tac-Nope-Value}:
\qquad
\text{Is }v(\mathcal G,H,\mathcal O)\ge q?
\]

### Central research question

> What is the computational complexity of solving generalized hidden-information positional games?

### Possible theorem structure

A complete complexity classification generally requires both:

1. a lower bound, usually through a reduction from a known hard problem; and
2. a matching upper bound showing that the decision problem lies in the claimed complexity class.

The appropriate complexity class should **not be assumed in advance**. It will depend on important modeling choices such as:

- finite versus succinct game representation;
- horizon length;
- perfect recall;
- whether the hidden set is fixed or part of the input;
- whether observation rules are fixed or variable;
- whether randomization is required;
- whether the question is exact value, approximate value, or existence of a winning strategy.

### Candidate subproblems

Possible restricted families include:

- generalized \(n\times n\) boards;
- \(k\)-in-a-row winning conditions;
- arbitrary winning hypergraphs;
- exactly two hidden cells;
- one-sided imperfect information;
- fixed feedback model versus arbitrary feedback model;
- deterministic winning-strategy decision versus equilibrium-value computation.

### Strong theoretical targets

Examples of worthwhile results include:

- completeness of the generalized winning-strategy problem for a natural complexity class;
- a separation between perfect-information and hidden-information versions;
- hardness that remains even under severe restrictions on the hidden set;
- fixed-parameter tractability in the number of hidden cells, treewidth, or another structural parameter;
- complexity changes induced by different feedback rules.

### Why this direction is strong

A clean complexity theorem can stand independently of the implementation. Tic-Tac-Nope would then serve as a minimal game family demonstrating how hidden information changes the computational difficulty of positional games.

### Possible paper framing

**The Complexity of Hidden-Information Positional Games**

---

# Comparative Assessment

| Direction | Main contribution | Theoretical upside | Computational burden | Current readiness |
|---|---|---:|---:|---:|
| Information structure / value of feedback | Structural game-theory results | Very high | Moderate | High |
| Geometry of hidden information | Set-function and positional-game structure | Very high | Moderate | High |
| Probing / signaling / latent actions | New strategic phenomena | Very high if strong examples exist | Moderate | Medium-high |
| New scalable exact solver | New computational-game-theory algorithm | Very high | High | Medium |
| Complexity of generalized game | Complexity classification | Very high | Very high | Early |

---

# Recommended Research Order

The most natural progression from the current repository is:

1. **Complete the exact equilibrium atlas** for the current information model.
2. **Introduce multiple observation structures** and solve the same hidden-cell configurations under each.
3. Analyze the set function \(v(H)\) and search for structural properties, counterexamples, and geometric predictors.
4. Inspect equilibrium policies for probing, signaling, and information-preserving behavior.
5. Use the resulting structure to motivate either a compressed exact solver or a generalized complexity result.

The strongest near-term paper is likely to combine Directions 1 and 2:

> **How the structure and location of hidden information change equilibrium value in positional games.**

That framing uses Tic-Tac-Nope as an exactly solvable research environment while making the principal claims relevant to imperfect-information game theory more broadly.
