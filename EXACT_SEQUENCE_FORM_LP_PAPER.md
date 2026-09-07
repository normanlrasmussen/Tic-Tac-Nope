# Computing Nash Equilibria in Tic-Tac-Nope with Sequence-Form Linear Programming

## A rigorous description of the game model, sequence representation, LP derivation, correctness guarantees, and implementation optimizations

---

## Abstract

Tic-Tac-Nope is a finite, two-player, zero-sum extensive-form game with imperfect information. The game modifies ordinary tic-tac-toe by introducing mystery cells: a player may attempt a mystery cell at most once, the first successful claimant owns the cell, an attempted mystery move does not reveal success or failure to the actor, and an opponent's mystery attempt is observed only as an anonymous fog action. These rules create private information while preserving perfect recall.

This document gives a rigorous derivation of the exact-game sequence-form linear program implemented in `sequence_form_lp.py`. The solver first enumerates the complete unabstracted game tree. Histories that are observationally indistinguishable to a player are grouped into information sets. For each player, the solver constructs a sequence-form realization plan: one nonnegative variable for each player-action sequence, together with linear flow constraints of the form

\[
E x=e, \qquad F y=f.
\]

The sparse matrix \(A\) maps pairs of terminal player sequences to utilities. The zero-sum equilibrium problem is

\[
\max_{x}\min_{y}x^T A y
\]

subject to the realization constraints. Dualizing the inner minimization produces a single linear program for the maximizing player,

\[
\begin{aligned}
\max_{x,p}\quad & f^T p\\
\text{s.t.}\quad & Ex=e,\\
& x\ge 0,\\
& F^T p\le A^T x,
\end{aligned}
\]

which is solved numerically with SciPy/HiGHS. A symmetric solve for the other player produces an upper bound on the first player's value; together the two solves yield a numerical equilibrium certificate through their value interval and duality gap.

The implementation is exact with respect to the enumerated game model: it uses no strategic abstraction, heuristic pruning, or sampled approximation in the LP solve. The word *exact* therefore refers to solving the complete unabstracted finite game rather than to symbolic arithmetic; HiGHS uses floating-point numerical optimization. The implementation further reduces runtime and storage using sequence form, sparse matrices, bit-mask lookup tables, redundant-validation elimination, native free dual variables, geometric board symmetries, player-label symmetry, support-pruned policy export, resumable batch computation, and atomic output publication. Regression tests independently verify realization feasibility, best-response optimality, equivalence to an earlier split-variable LP, optimized enumeration equivalence, and player-symmetry transformations.

---

## 1. Introduction

A normal tic-tac-toe position is fully observed. Tic-Tac-Nope is different because the true ownership of mystery cells may not be known to one or both players. Consequently, a strategy cannot condition on the true internal board state unless that state is inferable from the player's observation history. The correct mathematical model is therefore not a perfect-information minimax tree, but an imperfect-information extensive-form game.

The central computational problem is:

> Compute a strategy for each player such that neither player can improve their expected payoff by unilaterally deviating, while respecting exactly the information available to that player at every decision point.

For a finite two-player zero-sum game with perfect recall, this is a minimax/Nash-equilibrium problem. A direct normal-form representation is usually infeasible because a normal-form pure strategy must specify an action at every information set, including information sets that are not reached in actual play. If information set \(I\) has \(|A(I)|\) legal actions, the number of complete pure contingency plans is on the order of

\[
\prod_I |A(I)|,
\]

which grows exponentially in the number of information sets.

Sequence form replaces this exponential representation by a representation whose size is linear in the number of information sets and available actions. Instead of assigning probability to complete pure plans, it assigns *realization weights* to the player's own action sequences. Perfect recall makes this representation strategically complete.

This document has four goals:

1. define the implemented Tic-Tac-Nope game precisely;
2. derive the sequence-form constraints \(Ex=e\) and \(Fy=f\) from first principles;
3. derive the LP dual used by the implementation and state the resulting equilibrium guarantee; and
4. document which implementation optimizations preserve the exact game and why.

---

## 2. Formal game model

### 2.1 Board and players

The board contains nine cells indexed by

\[
\mathcal C=\{0,1,\ldots,8\}.
\]

The two players are denoted by \(O\) and \(X\). A fixed mystery-cell set

\[
M\subseteq \mathcal C
\]

is common knowledge before play begins, as is the starting player.

The ordinary tic-tac-toe winning masks are the three rows, three columns, and two diagonals. A player wins when the set of cells that the player truly owns contains a winning mask.

### 2.2 True state

The implementation represents a true state as

\[
s=(B_O,B_X,T_O,T_X,p,o_O,o_X,m),
\]

where:

- \(B_O\subseteq\mathcal C\) is the set of cells truly owned by \(O\);
- \(B_X\subseteq\mathcal C\) is the set of cells truly owned by \(X\);
- \(T_O\subseteq M\) is the set of mystery cells already attempted by \(O\);
- \(T_X\subseteq M\) is the set of mystery cells already attempted by \(X\);
- \(p\in\{O,X\}\) is the player to move;
- \(o_O\) and \(o_X\) are the players' observation histories; and
- \(m\) is the move count.

The code stores \(B_O,B_X,T_O,T_X\) as 9-bit integer masks.

### 2.3 Legal actions

Let

\[
B(s)=B_O\cup B_X
\]

be the truly occupied cells.

For a visible cell \(c\notin M\), the action is legal exactly when the cell is unoccupied:

\[
c\in A_p(s)\iff c\notin B(s).
\]

For a mystery cell \(c\in M\), legality depends on whether the acting player has attempted that mystery cell before, not on the cell's true occupancy:

\[
c\in A_p(s)\iff c\notin T_p.
\]

This rule is essential for information correctness. If mystery-cell legality depended on hidden occupancy, the set of legal actions itself would reveal private ownership information.

### 2.4 Transition rule

Suppose player \(p\) chooses cell \(c\).

If \(c\notin M\), the cell is visible and unoccupied by legality, so ownership is assigned to \(p\).

If \(c\in M\), the player records that \(c\) has been attempted. Define

\[
\operatorname{success}(s,c)=\mathbf 1\{c\notin B(s)\}.
\]

If the mystery attempt succeeds, the acting player acquires the cell. If it fails because the opponent already owns the cell, true ownership does not change. In either case the turn passes to the other player.

### 2.5 Observation rule

The implementation intentionally separates the *true transition* from the *observed transition*.

For a visible move at cell \(c\), both players observe the acting player and the cell location.

For a mystery move at cell \(c\):

- the actor observes that they attempted mystery cell \(c\), but receives no direct success/failure signal;
- the opponent observes only that an anonymous mystery action occurred, not which mystery cell was attempted.

Thus two different true histories may induce the same observation history for a player.

This is the source of imperfect information.

### 2.6 Terminal utility

Let \(Z\) be the set of terminal histories. Utility from \(O\)'s perspective is

\[
u_O(z)=
\begin{cases}
+1,&\text{if }O\text{ wins},\\
0,&\text{if the board is full with no winner},\\
-1,&\text{if }X\text{ wins}.
\end{cases}
\]

The game is zero-sum:

\[
u_X(z)=-u_O(z).
\]

---

## 3. Histories, information sets, and perfect recall

### 3.1 Histories

A history \(h\) is a finite sequence of actions from the root. Because transitions are deterministic once actions are fixed, every history corresponds to a unique true state.

The solver enumerates the complete history tree. Importantly, histories are **not** merged merely because one player cannot distinguish them. Distinct true histories remain distinct nodes in the underlying game tree.

### 3.2 Information sets

For player \(i\), define the observation map

\[
\mathcal O_i(h)=o_i(h).
\]

Two decision histories \(h,h'\) for player \(i\) are placed in the same information set when the implementation's information keys are equal. The key is

\[
I_i(h)=
\bigl(i,\text{start player},M,\mathcal O_i(h)\bigr).
\]

Hence

\[
h\sim_i h'
\quad\Longleftrightarrow\quad
I_i(h)=I_i(h').
\]

A legal behavioral strategy must be constant across histories in one information set:

\[
\sigma_i(a\mid h)=\sigma_i(a\mid h')
\quad\text{for all }h,h'\in I.
\]

The player is not permitted to condition on which hidden true history inside \(I\) actually occurred.

### 3.3 Example

Suppose cells 2 and 4 are mystery cells. Consider two true histories:

\[
h_1=(O\text{ plays visible }1,\;X\text{ attempts mystery }2)
\]

and

\[
h_2=(O\text{ plays visible }1,\;X\text{ attempts mystery }4).
\]

The true states differ. Under \(h_1\), \(X\) may own cell 2; under \(h_2\), \(X\) may own cell 4. However, \(O\)'s observation in either history is only

\[
\text{``I played visible 1; the opponent made a mystery attempt.''}
\]

Therefore the two O-decision nodes can lie in one information set even though their true boards are different.

If \(O\) then attempts mystery cell 2, that attempt may fail in one true history and succeed in the other. The game tree keeps those true outcomes distinct, while \(O\)'s subsequent observations still do not reveal the success/failure result unless later public information logically implies it.

### 3.4 Perfect recall

Perfect recall requires that a player never forgets their own past actions or previously observed information.

#### Proposition 1. The implemented information model has perfect recall.

**Claim.** If two histories \(h,h'\) belong to the same information set of player \(i\), then player \(i\) has the same ordered sequence of prior information observations and own actions in both histories.

**Proof.** The information key contains player \(i\)'s complete encoded observation history. Every visible action appends its actor and location. Every mystery action by \(i\) appends the attempted location to \(i\)'s observation history. Every opponent mystery action appends a fog token, preserving its temporal position. Therefore equality of information keys implies equality of the complete ordered observation stream and, in particular, equality of all of player \(i\)'s own prior actions. Hence the player does not forget any own action or prior observation. \(\square\)

The code provides an additional structural assertion: when an existing information set is encountered again during tree enumeration, its stored parent sequence must equal the current player sequence. A mismatch raises a perfect-recall violation. The enumerator also requires the legal action tuple to match across every occurrence of the information set.

Perfect recall is not merely descriptive. It is the property that makes sequence form realization-equivalent to behavioral strategies.

---

## 4. Strategies and sequences

### 4.1 Behavioral strategy

A behavioral strategy for player \(i\) assigns a probability distribution independently at every information set:

\[
\sigma_i(\cdot\mid I)\in\Delta(A(I)).
\]

Thus

\[
\sigma_i(a\mid I)\ge 0,
\qquad
\sum_{a\in A(I)}\sigma_i(a\mid I)=1.
\]

### 4.2 Mixed strategy versus behavioral strategy

A normal-form mixed strategy randomizes over complete pure contingency plans. A pure plan specifies one action at every information set. If there are many information sets, the number of such plans grows exponentially.

Kuhn's theorem implies that in finite games with perfect recall, mixed and behavioral strategies have realization-equivalent representations. Therefore the solver need not enumerate all pure contingency plans.

### 4.3 Player sequences

A **player sequence** records only that player's own strategic actions along a possible path. It does not record the opponent's actions directly.

The empty sequence is denoted by

\[
\emptyset.
\]

Suppose player \(i\) has current parent sequence \(s\), reaches information set \(I\), and chooses action \(a\in A(I)\). The child sequence is denoted

\[
sa.
\]

Opponent actions affect *which information set* is reached; the player's sequence records the player's own strategic choices needed to reach that information set.

This distinction is central:

- an information set says **what the player currently knows**;
- a sequence says **which own strategic actions the player has previously taken**.

Because of perfect recall, every information set has a unique parent sequence for the acting player.

---

## 5. Realization plans and the equation \(Ex=e\)

### 5.1 Realization weights

For every player sequence \(s\), introduce a nonnegative realization weight

\[
x_s\ge 0.
\]

The realization weight is the product of that player's own behavioral probabilities along sequence \(s\). It is **not**, in general, the probability that the physical game reaches the associated information set, because opponent actions also affect reach.

The empty sequence has weight

\[
x_{\emptyset}=1.
\]

Suppose information set \(I\) has parent sequence \(s(I)\) and legal actions \(A(I)\). Probability conservation requires

\[
\sum_{a\in A(I)}x_{s(I)a}=x_{s(I)}.
\]

Equivalently,

\[
x_{s(I)}-\sum_{a\in A(I)}x_{s(I)a}=0.
\]

This is one sequence-flow equation per information set.

### 5.2 Why this is not physical probability flow

A parent sequence may be the parent of several different information sets that arise under different opponent contingencies. In that case the same realization weight appears in more than one information-set equation.

This does not duplicate physical probability mass. It expresses a contingent strategy: if the opponent causes information set \(I_1\), the player must specify a normalized conditional distribution there; if the opponent instead causes information set \(I_2\), the player must also specify a normalized conditional distribution there. Realization weights encode the player's own contribution to reach, not the total joint reach probability.

### 5.3 Matrix construction

Let player \(O\) have \(n_O\) sequences and \(m_O\) information sets. Define

\[
x\in\mathbb R^{n_O}.
\]

The realization matrix has

\[
1+m_O
\]

rows: one root-normalization row and one row for each information set.

The right-hand side is

\[
e=(1,0,\ldots,0)^T.
\]

The first row enforces

\[
x_{\emptyset}=1.
\]

For each information set \(I\), the corresponding row contains:

- \(+1\) in the parent-sequence column \(s(I)\);
- \(-1\) in every child-sequence column \(s(I)a\);
- zero elsewhere.

Thus the complete strategy-feasibility system is

\[
\boxed{Ex=e,\qquad x\ge 0.}
\]

For player \(X\), analogously,

\[
\boxed{Fy=f,\qquad y\ge 0.}
\]

where \(f=(1,0,\ldots,0)^T\).

### 5.4 Concrete example

Suppose a player has sequences

\[
\emptyset,L,R,LU,LD.
\]

The constraints are

\[
x_{\emptyset}=1,
\]

\[
x_{\emptyset}-x_L-x_R=0,
\]

\[
x_L-x_{LU}-x_{LD}=0.
\]

Therefore

\[
E=
\begin{bmatrix}
1&0&0&0&0\\
1&-1&-1&0&0\\
0&1&0&-1&-1
\end{bmatrix},
\qquad
x=
\begin{bmatrix}
x_{\emptyset}\\x_L\\x_R\\x_{LU}\\x_{LD}
\end{bmatrix},
\qquad
 e=
\begin{bmatrix}1\\0\\0\end{bmatrix}.
\]

Then \(Ex=e\) is exactly the three equations above.

### 5.5 Behavioral strategy to realization plan

Given a behavioral strategy \(\sigma\), define recursively

\[
x_{\emptyset}=1
\]

and

\[
x_{s(I)a}=x_{s(I)}\sigma(a\mid I).
\]

Then

\[
\sum_{a\in A(I)}x_{s(I)a}
=x_{s(I)}\sum_{a\in A(I)}\sigma(a\mid I)
=x_{s(I)},
\]

so \(Ex=e\).

### 5.6 Realization plan to behavioral strategy

Conversely, suppose \(x\ge 0\) and \(Ex=e\). For every information set with positive parent realization,

\[
x_{s(I)}>0,
\]

define

\[
\boxed{
\sigma(a\mid I)=\frac{x_{s(I)a}}{x_{s(I)}}.
}
\]

Because the flow equation gives

\[
\sum_{a\in A(I)}x_{s(I)a}=x_{s(I)},
\]

these ratios are nonnegative and sum to one.

If \(x_{s(I)}=0\), all child realizations are also zero. Sequence form does not uniquely determine local conditional probabilities at that information set. Any behavioral completion there is realization-equivalent because the information set is unreachable due to the player's own earlier zero-probability action sequence.

#### Lemma 1. Realization-flow feasibility is equivalent to a behavioral strategy on the support.

For a finite perfect-recall player tree, every behavioral strategy induces a feasible realization plan, and every feasible realization plan induces a behavioral strategy at all positive-parent information sets by the ratio formula above.

**Proof.** The forward direction follows by recursive multiplication and local normalization. The reverse direction follows directly from nonnegativity and each flow row. Perfect recall ensures that each information set has a unique parent player sequence, so the ratio is well defined. \(\square\)

---

## 6. Sequence-form payoff matrix

Let \(S_O\) and \(S_X\) denote the O- and X-sequence sets. Define a sparse matrix

\[
A\in\mathbb R^{|S_O|\times |S_X|}
\]

from O's perspective.

When the full tree enumerator reaches terminal history \(z\), it knows:

- the final O sequence \(s_O(z)\);
- the final X sequence \(s_X(z)\); and
- the terminal utility \(u_O(z)\in\{-1,0,+1\}\).

The implementation accumulates

\[
A_{s_O,s_X}
\leftarrow
A_{s_O,s_X}
+
\sum_{z:\,s_O(z)=s_O,\;s_X(z)=s_X}u_O(z).
\]

In the present deterministic game there are no exogenous chance probabilities to multiply into the terminal contribution. If multiple terminal histories map to the same sparse matrix coordinate, their contributions are summed. Zero-utility terminals are fully enumerated and counted but need not be stored as explicit zero entries.

For feasible realization plans \(x\) and \(y\), the expected payoff is

\[
\boxed{U_O(x,y)=x^T A y.}
\]

This bilinear expression is the sequence-form analogue of the normal-form expected payoff.

---

## 7. Zero-sum minimax formulation

Player O wants to maximize the payoff that O can guarantee against any legal X strategy:

\[
\boxed{
\max_{x}\min_{y}x^T A y
}
\]

subject to

\[
Ex=e,\quad x\ge 0,
\]

\[
Fy=f,\quad y\ge 0.
\]

Because the game is finite and zero-sum, the minimax value is the Nash-equilibrium value.

The remaining problem is computational: \(\max_x\min_y\) is a nested optimization. Sequence-form LP eliminates the inner minimization through linear-programming duality.

---

## 8. Derivation of the dual LP

### 8.1 Fix O's realization plan

Temporarily fix a feasible O plan \(x\). X chooses the feasible realization plan that minimizes O's payoff:

\[
\begin{aligned}
\text{minimize}_{y}\quad & x^T A y\\
\text{subject to}\quad & Fy=f,\\
& y\ge 0.
\end{aligned}
\]

Using

\[
x^T A y=(A^T x)^T y,
\]

define

\[
c=A^T x.
\]

The X best-response LP is therefore

\[
\boxed{
\begin{aligned}
\text{minimize}_{y}\quad & c^T y\\
\text{subject to}\quad & Fy=f,\\
& y\ge 0.
\end{aligned}}
\]

### 8.2 Lagrangian derivation

Associate an unrestricted dual variable vector \(p\) with the equality constraints \(Fy=f\). Equality constraints produce free dual variables, so

\[
p\in\mathbb R^{\text{rows}(F)}.
\]

Write the equality as

\[
f-Fy=0.
\]

The Lagrangian is

\[
\begin{aligned}
L(y,p)
&=c^T y+p^T(f-Fy)\\
&=f^T p+y^T(c-F^T p).
\end{aligned}
\]

For fixed \(p\), consider the infimum over \(y\ge 0\). If some coordinate satisfies

\[
c_j-(F^T p)_j<0,
\]

then sending \(y_j\to+\infty\) drives \(L(y,p)\to-\infty\). Therefore a finite lower bound requires

\[
c-F^T p\ge 0,
\]

or equivalently

\[
\boxed{F^T p\le c.}
\]

When this inequality holds, the nonnegative term

\[
y^T(c-F^T p)
\]

has infimum zero, so the dual objective is

\[
f^T p.
\]

Thus the dual of X's best-response problem is

\[
\boxed{
\begin{aligned}
\text{maximize}_{p}\quad & f^T p\\
\text{subject to}\quad & F^T p\le c,\\
& p\text{ free}.
\end{aligned}}
\]

Substituting \(c=A^T x\) gives

\[
\boxed{
\begin{aligned}
\text{maximize}_{p}\quad & f^T p\\
\text{subject to}\quad & F^T p\le A^T x.
\end{aligned}}
\]

### 8.3 Strong duality

For fixed feasible \(x\), X's realization polytope is nonempty and bounded in the relevant sequence coordinates. The primal best-response LP therefore has a finite optimum. Linear-programming strong duality gives

\[
\min_{y:\,Fy=f,\,y\ge 0}x^T A y
=
\max_{p:\,F^Tp\le A^Tx}f^T p.
\]

The inner minimization can therefore be replaced exactly by its dual maximization.

### 8.4 Final O maximin LP

O is still free to choose \(x\). Combining O's realization constraints with the dualized X best response yields

\[
\boxed{
\begin{aligned}
\text{maximize}_{x,p}\quad & f^T p\\
\text{subject to}\quad & Ex=e,\\
& x\ge 0,\\
& F^T p\le A^T x,\\
& p\text{ free}.
\end{aligned}}
\tag{P_O}
\]

This is the LP implemented by `solve_max_player` for O.

### 8.5 Interpretation of the dual variables

The vector \(p\) is not a strategy and its entries are not probabilities. It is a vector of dual potentials associated with X's realization-flow equalities. The inequality

\[
F^T p\le A^T x
\]

ensures that the value certificate represented by \(p\) is supported by the payoffs available against every X sequence under O's chosen realization plan \(x\).

Because

\[
f=(1,0,\ldots,0)^T,
\]

the objective \(f^T p\) selects the dual value associated with the root flow constraint. Maximizing it raises the worst-case payoff that O can certify against every legal X realization plan.

### 8.6 Matrix form used by SciPy

The code concatenates LP variables as

\[
z=\begin{bmatrix}x\\p\end{bmatrix}.
\]

The equality system is

\[
\begin{bmatrix}E&0\end{bmatrix}
\begin{bmatrix}x\\p\end{bmatrix}=e.
\]

The inequality

\[
F^T p\le A^T x
\]

is written in SciPy's \(A_{ub}z\le b_{ub}\) convention as

\[
\begin{bmatrix}-A^T&F^T\end{bmatrix}
\begin{bmatrix}x\\p\end{bmatrix}\le 0.
\]

SciPy's `linprog` minimizes, so the mathematical objective

\[
\max f^T p
\]

is implemented as

\[
\min -f^T p.
\]

The realization variables satisfy \(x\ge0\); the dual variables \(p\) have bounds \(( -\infty,+\infty )\).

---

## 9. Symmetric solve and equilibrium certificate

The O maximin LP returns a realization plan \(x_O\) and a lower bound

\[
L_O
\]

that O can guarantee.

The implementation also solves the symmetric maximin LP for X. From X's perspective, the payoff matrix is

\[
-A^T.
\]

Let the returned X guarantee be \(L_X\) in X's own utility. Since \(u_X=-u_O\), this implies an upper bound on O's value

\[
U_O=-L_X.
\]

Therefore

\[
\boxed{L_O\le v_O\le U_O.}
\]

The implementation records

\[
\operatorname{gap}=\max\{0,U_O-L_O\}
\]

and reports the midpoint

\[
\widehat v_O=\frac{L_O+U_O}{2}.
\]

For an exact mathematical LP solution, strong duality implies \(L_O=U_O=v_O\). In floating-point computation, a small nonzero interval can remain because of solver tolerances and numerical residuals.

---

## 10. Recovering playable move probabilities

The LP output is a realization plan, while the website needs behavioral move probabilities.

At information set \(I\) with parent sequence \(s(I)\), if

\[
x_{s(I)}>0,
\]

the behavioral probability of action \(a\) is

\[
\boxed{
\sigma(a\mid I)=\frac{x_{s(I)a}}{x_{s(I)}}.
}
\]

The exporter clips tiny negative floating-point artifacts to zero and renormalizes the probabilities.

### 10.1 Zero-realization information sets

If

\[
x_{s(I)}=0,
\]

then the equilibrium realization plan reaches \(I\) with zero probability due to the player's own earlier strategy choices. Sequence form does not determine a unique conditional behavioral distribution there.

The full exporter may use a stable completion such as uniform play. The compact exporter instead omits such policy entries entirely. This does not alter the realization plan or its equilibrium payoff because all descendants have zero realization weight.

This is an output compression only. The corresponding information sets remain present in the game tree and LP during optimization.

---

## 11. Correctness theorem

### Theorem 1. Sequence-form equilibrium correctness for the implemented game

Fix a mystery-cell set and starting player. Assume:

1. the enumerator traverses the complete finite Tic-Tac-Nope game tree;
2. the transition and observation rules match the intended game;
3. information sets identify exactly histories that are observationally indistinguishable to the acting player;
4. the game has perfect recall;
5. all histories within one information set have the same legal action set;
6. the sparse payoff matrix contains the complete terminal utility contribution; and
7. the two LPs are solved to optimality.

Then the realization plans returned by the O and X sequence-form LPs constitute a minimax/Nash equilibrium of the implemented two-player zero-sum game. Their induced behavioral strategies are realization-equivalent equilibrium strategies at every positive-realization information set.

**Proof.** Under assumptions 3--5 and perfect recall, the realization polytopes

\[
Q_O=\{x\ge0:Ex=e\}
\]

and

\[
Q_X=\{y\ge0:Fy=f\}
\]

represent the players' behavioral-strategy outcome distributions in sequence form. Assumption 6 implies that \(x^TAy\) equals expected O utility under realization plans \(x,y\). Hence the game's maximin problem is

\[
\max_{x\in Q_O}\min_{y\in Q_X}x^TAy.
\]

For fixed \(x\), the inner problem is a linear program whose dual is

\[
\max_p\{f^Tp:F^Tp\le A^Tx\}.
\]

Strong LP duality allows replacement of the inner minimization by this dual, producing \((P_O)\). Therefore an optimal solution of \((P_O)\) is O-maximin. The symmetric argument gives an X-maximin plan. The minimax theorem for finite two-player zero-sum games implies that the maximin and minimax values coincide and that the two strategies form a Nash equilibrium. Behavioral recovery follows from Lemma 1. \(\square\)

### Corollary 1. Numerical implementation guarantee

The implemented solver uses floating-point HiGHS optimization. Therefore the practical claim is:

> When the complete unabstracted tree is enumerated and both LPs solve successfully with acceptable numerical residuals and a small value interval, the exported policies are a numerical Nash/minimax solution of the implemented game up to LP feasibility and optimality tolerances.

This is stronger than a sampled convergence claim but weaker than symbolic exact arithmetic.

---

## 12. Computational complexity and why sequence form matters

Suppose player \(i\) has information sets \(\mathcal I_i\). A normal-form pure strategy chooses one action at every information set, so the number of pure strategies is

\[
N_i^{\text{normal}}
=
\prod_{I\in\mathcal I_i}|A(I)|.
\]

Sequence form instead uses one empty sequence plus one child sequence for every information-set action:

\[
N_i^{\text{seq}}
=
1+
\sum_{I\in\mathcal I_i}|A(I)|.
\]

Thus sequence form replaces exponential normal-form strategy enumeration with a representation linear in the local decision structure. This is the principal mathematical optimization in the exact solver.

Sequence form does **not** remove the need to enumerate the underlying unabstracted game tree in the present implementation. Tic-Tac-Nope can still contain millions of histories, so exact solving remains an offline workload.

---

## 13. Implementation optimizations

The exact solver has been optimized at several levels. The distinction between *mathematical reduction* and *engineering acceleration* is important: none of the optimizations below intentionally alter the game being solved.

### 13.1 Sequence form instead of normal form

**Type:** mathematical representation reduction.

The solver uses realization sequences rather than complete pure contingency plans. This changes the representation from exponential normal-form size to a number of variables proportional to information-set actions.

**Why exact:** perfect recall guarantees realization equivalence between behavioral strategies and sequence-form realization plans.

### 13.2 Sparse realization and payoff matrices

**Type:** memory and linear-algebra optimization.

The realization matrices are extremely sparse. An information-set row contains only one \(+1\) coefficient for its parent and one \(-1\) coefficient for each legal child action. The payoff matrix is also sparse relative to the Cartesian product of all player sequences.

The implementation builds coordinate-format sparse matrices and converts them to CSR for solving.

**Why exact:** zero entries are implicit rather than stored; matrix algebra is unchanged.

### 13.3 Integer bit-mask state representation

**Type:** state-transition optimization.

Ownership sets, mystery masks, and attempted-mystery sets are represented as 9-bit integers. Bitwise intersection, union, membership, and complement replace repeated Python set operations.

**Why exact:** the bit masks are one-to-one encodings of board subsets.

### 13.4 Precomputed win lookup table

There are only

\[
2^9=512
\]

possible board-ownership masks. The solver precomputes whether each mask contains a winning line.

**Why exact:** the lookup table is generated from the same eight tic-tac-toe winning masks and is regression-tested against direct win-mask scanning.

### 13.5 Precomputed action-mask lookup table

For every 9-bit availability mask, the implementation precomputes the tuple of enabled action indices.

**Why exact:** the table is a cached decoding of the bit mask, not a heuristic action reduction.

### 13.6 Avoiding duplicate legality validation inside the enumerator

The public transition function validates that an action is legal. During tree enumeration, however, the action list has just been computed by the legal-action function. Rechecking legality for each branch is redundant. The enumerator therefore applies an internal transition routine to already-validated actions.

**Why exact:** regression tests enumerate complete smaller subtrees using both the optimized internal transition and the validating public transition, then compare history counts, terminal counts, information catalogs, and payoff matrices.

### 13.7 Omitting explicit zero-payoff sparse entries

Draw terminals have utility zero. The enumerator still visits and counts every draw history, but it does not store an explicit zero in \(A\).

After construction, duplicate sparse coordinates are summed and explicit zeros are eliminated.

**Why exact:** adding zero to a matrix entry has no algebraic effect.

### 13.8 Native unrestricted dual variables

A free dual variable \(p_j\in\mathbb R\) can be represented using two nonnegative variables:

\[
p_j=p_j^+-p_j^-,
\qquad p_j^+,p_j^-\ge0.
\]

That representation doubles the dual columns. The current solver instead gives HiGHS native bounds

\[
-\infty<p_j<+\infty.
\]

**Why exact:** the feasible set of \(p\) is unchanged.

Regression tests retain the older split-variable formulation and verify that the optimized native-free-variable LP returns the same game value on complete test subtrees.

### 13.9 HiGHS presolve

The solver calls SciPy `linprog(method="highs")` with presolve enabled. HiGHS may simplify redundant rows, columns, and implied bounds before the main solve.

**Why exact:** presolve applies equivalence-preserving LP transformations and reconstructs a solution to the original formulation.

### 13.10 Geometric board symmetry

The 3x3 board has eight symmetries, the dihedral group \(D_4\): identity, three nontrivial rotations, and four reflections/reflected rotations.

The batch precomputation code maps every mystery-cell mask to a canonical representative under these eight transforms. For mystery sets of size at least two, the implementation reduces

\[
502\text{ raw masks}
\]

to

\[
98\text{ geometric symmetry classes}.
\]

For exactly two mystery cells, it reduces 36 raw masks to 8 classes.

**Why exact:** rotation and reflection are game isomorphisms. Actions and stored policies can be transformed back through the inverse board map.

### 13.11 O/X relabeling symmetry

Swapping player labels \(O\leftrightarrow X\) and swapping the starter produces an isomorphic zero-sum game. Therefore a solved artifact for one starter can be transformed into the counterpart artifact by:

- swapping O and X policies;
- relabeling player identifiers in visible observation tokens;
- swapping player information-set/sequence counts; and
- transforming the O value interval as

\[
[L_O,U_O]\mapsto[-U_O,-L_O].
\]

**Why exact:** tests compare color-swapped complete subtrees and verify

\[
A_{\text{original}}=-A_{\text{swapped}}^T
\]

under the relabeling, as well as consistency of transformed policy keys.

### 13.12 Support-pruned behavioral export

After solving the full LP, the compact exporter omits policy entries whose parent realization weight is below a small tolerance. Such information sets are unreachable under the player's own realization plan.

It also omits negligible child probabilities after normalization.

**Why exact with respect to realization:** zero-parent behavioral completions do not affect the realization plan. This optimization reduces serialized policy size, not LP size.

### 13.13 Resumable batch computation

Before solving a configuration, batch code checks for an existing compatible completed artifact. If present, it is reused. Artifacts from an older information model are rejected as stale.

**Why exact:** reuse is conditioned on metadata that identifies the current game information model and successful numerical completion.

### 13.14 Cached manifest metadata

Manifest rebuilds need only small artifact headers, not full policy tables. Metadata is cached using file signatures and invalidated after file replacement.

**Why exact:** this affects only batch I/O and publication metadata.

### 13.15 Atomic artifact publication

The compact exporter writes JSON to a temporary file and then atomically replaces the target file. An interrupted write therefore does not masquerade as a completed equilibrium artifact.

**Why important:** this is a robustness property for long offline precomputation runs.

### 13.16 Node-limit guard

The optional node limit aborts enumeration after a specified number of histories.

This is **not** an approximation mode. A run that hits the node limit does not support a full-game equilibrium claim. The guard exists to prevent accidental high-memory enumeration during development.

---

## 14. Validation strategy

The test suite does more than check syntax. It contains independent mathematical consistency tests.

### 14.1 Win-table equivalence

For every one of the 512 ownership masks, the precomputed win lookup is compared against direct evaluation of all winning masks.

### 14.2 Action-mask equivalence

For representative hidden masks, occupied masks, and attempted masks, optimized action generation is compared against direct logical construction.

### 14.3 Optimized-transition equivalence

Complete late-game subtrees are enumerated with the optimized already-validated transition and with the public validating transition. Tests compare:

- history counts;
- terminal counts;
- O information catalogs;
- X information catalogs; and
- sparse payoff entries.

### 14.4 Realization feasibility

For each tested solve, the returned realization vector is checked numerically against

\[
Ex=e
\]

and nonnegativity.

### 14.5 Independent split-variable LP

The test suite retains the older formulation in which every free dual variable is written as

\[
p=p^+-p^-.
\]

It solves this independent formulation and compares the value with the optimized native-free-variable formulation.

### 14.6 Independent best-response verification

After obtaining a realization plan \(x\), the tests solve the opponent's best-response LP directly:

\[
\min_y (A^Tx)^T y
\]

subject to

\[
Fy=f,\qquad y\ge0.
\]

The resulting best-response value is compared with the value reported by the maximin LP. This verifies the returned strategy itself, not merely the LP solver success flag.

### 14.7 Player-swap validation

Tests verify that swapping player labels twice returns the original artifact, that the value interval changes sign correctly, and that color-swapped complete subtrees have the expected transposed-negated payoff relation.

### 14.8 Atomic-write validation

Tests verify that invalid/nonfinite JSON output cannot replace a valid artifact and that temporary files are cleaned up.

---

## 15. Algorithm summary

The exact offline pipeline can be summarized as follows.

```text
INPUT:
    mystery-cell mask M
    starting player

1. Enumerate the complete true game tree.

2. At every nonterminal history:
       determine the acting player's observation-based information key;
       register/reuse the information set;
       verify common legal actions and common parent player sequence;
       create one child sequence per legal action;
       push every legal successor true state.

3. At every terminal history:
       record final O sequence;
       record final X sequence;
       accumulate terminal utility into sparse payoff matrix A.

4. Build O realization constraints:
       Ex = e, x >= 0.

5. Build X realization constraints:
       Fy = f, y >= 0.

6. Solve O maximin LP:
       maximize    f^T p
       subject to  Ex = e
                   x >= 0
                   F^T p <= A^T x
                   p free.

7. Solve X maximin LP using payoff -A^T.

8. Form O value interval:
       lower = O maximin value
       upper = -(X maximin value)
       gap   = upper - lower.

9. Convert positive-support realization plans to behavioral policies:
       sigma(a|I) = x_{s(I)a} / x_{s(I)}.

10. Compact the policy artifact by omitting zero-parent information sets.

OUTPUT:
       numerical equilibrium policies
       value interval
       duality gap
       solver status
       game-size statistics.
```

---

## 16. What the equilibrium probabilities mean

The local probability

\[
\sigma_i(a\mid I)
\]

is not an assumed prior probability that a hidden board state is true. It is a strategic randomization probability selected by the equilibrium optimization.

The LP does not assume, for example, that two hidden ownership possibilities each have probability \(1/2\). Instead, the equilibrium strategy chooses action probabilities so that no legal opponent strategy can force a worse expected payoff than the game value.

Beliefs about which true history inside an information set is more likely arise endogenously from strategy-induced reach probabilities if one explicitly computes such beliefs. They are not inserted as an arbitrary uniform hidden-state prior in the exact LP.

---

## 17. Guarantees and limitations

### 17.1 What can be claimed

For a completed solve of the full unabstracted game under the current information model:

- the strategy respects information sets;
- the realization plan is globally optimized against all legal opponent realization plans;
- the strategy is minimax/Nash for the implemented finite two-player zero-sum game up to numerical LP tolerance;
- the value interval and duality gap provide a numerical certificate;
- no strategic abstraction or sampled training approximation is used by the LP itself.

### 17.2 What cannot be claimed

The following stronger claims would be incorrect:

1. **Symbolic exactness.** HiGHS uses floating-point arithmetic.
2. **Uniqueness.** A game may have multiple Nash equilibria; different equivalent LP formulations may return different equilibrium policies with the same value.
3. **Sequential-equilibrium refinement.** Nash/minimax equilibrium does not automatically imply a particular off-path refinement.
4. **Best exploitation of a weak opponent.** A minimax strategy maximizes worst-case guarantee, not necessarily payoff against one known suboptimal opponent.
5. **Correctness under incomplete enumeration.** Hitting a node limit, heuristic pruning, or omitting parts of the tree removes the full-game guarantee.
6. **Correctness if the information model is wrong.** The LP is exact for the game it is given. If observation rules leak hidden information or incorrectly hide available information, the LP exactly solves the wrong game.

---

## 18. Exact LP versus MCCFR

The repository also contains an outcome-sampling MCCFR solver. The two approaches target the same minimax/Nash set under the same game model, but their computational guarantees differ.

### Sequence-form LP

- enumerates the complete game;
- solves a global sparse linear program;
- returns a numerical optimum directly;
- provides primal/dual value certificates;
- has high offline memory and preprocessing cost.

### MCCFR

- samples trajectories;
- updates local counterfactual regrets iteratively;
- has lower per-iteration cost;
- converges toward equilibrium under standard no-regret assumptions;
- does not, from a finite iteration count alone, provide the same exact LP optimality certificate.

A useful research workflow is therefore to use the sequence-form LP as a ground-truth benchmark for smaller or precomputed configurations and evaluate MCCFR value error or exploitability as training increases.

---

## 19. Reproducibility

Install the exact-solver dependencies:

```bash
python -m pip install numpy scipy
```

Solve one configuration:

```bash
python sequence_form_lp.py \
  --hidden 2,4 \
  --start O \
  --output equilibrium.json
```

Run the compact exporter:

```bash
python sequence_form_lp_compact.py \
  --hidden 2,4 \
  --start O \
  --output equilibrium.json
```

Precompute all canonical exact configurations with resume support:

```bash
python precompute.py --mode all --solvers exact --keep-going
```

Run regression tests:

```bash
python -m unittest discover -s tests -v
```

A full equilibrium claim requires complete tree traversal. The `--node-limit` option is a safety guard and should not be interpreted as an approximation certificate.

---

## 20. Conclusion

The exact Tic-Tac-Nope solver is best understood as a compiler from an imperfect-information extensive-form game into a sparse linear program.

The game tree determines the histories and terminal utilities. Observation histories determine information sets. Perfect recall gives each information set a unique parent player sequence. Sequence-flow conservation produces

\[
Ex=e,
\qquad
Fy=f.
\]

Terminal outcomes produce the sparse sequence payoff matrix \(A\). The zero-sum equilibrium objective is

\[
\max_x\min_yx^TAy.
\]

Dualizing the opponent's best-response LP converts this nested minimax problem into

\[
\begin{aligned}
\max_{x,p}\quad & f^Tp\\
\text{s.t.}\quad & Ex=e,\\
& x\ge0,\\
& F^Tp\le A^Tx.
\end{aligned}
\]

Solving the symmetric problem for the other player brackets the game value and supplies a numerical certificate. Finally, realization weights are converted back into behavioral probabilities using

\[
\sigma(a\mid I)=\frac{x_{s(I)a}}{x_{s(I)}}.
\]

The major efficiency gain comes from sequence form itself; the remaining optimizations make complete enumeration, sparse matrix construction, repeated batch solving, and website artifact publication practical without intentionally changing the game. The result is therefore a rigorous offline equilibrium benchmark for the implemented Tic-Tac-Nope information model.

---

## References

1. Kuhn, H. W. (1953). *Extensive Games and the Problem of Information*. In H. W. Kuhn and A. W. Tucker (eds.), **Contributions to the Theory of Games II**, Annals of Mathematics Studies 28, Princeton University Press.
2. Koller, D., Megiddo, N., and von Stengel, B. (1996). *Efficient Computation of Equilibria for Extensive Two-Person Games*. **Games and Economic Behavior**, 14(2), 247--259.
3. von Stengel, B. (1996). *Efficient Computation of Behavior Strategies*. **Games and Economic Behavior**, 14(2), 220--246.
4. Virtanen, P., Gommers, R., Oliphant, T. E., et al. (2020). *SciPy 1.0: Fundamental Algorithms for Scientific Computing in Python*. **Nature Methods**, 17, 261--272.

---

## Appendix A. Notation

| Symbol | Meaning |
|---|---|
| \(O,X\) | the two players |
| \(M\) | common-knowledge mystery-cell set |
| \(h\) | game history |
| \(z\) | terminal history |
| \(I\) | information set |
| \(A(I)\) | legal actions at information set \(I\) |
| \(s(I)\) | acting player's parent sequence at \(I\) |
| \(x\) | O realization plan |
| \(y\) | X realization plan |
| \(E,e\) | O realization-flow matrix and right-hand side |
| \(F,f\) | X realization-flow matrix and right-hand side |
| \(A\) | sparse sequence payoff matrix from O's perspective |
| \(p\) | free dual variables for X's realization equalities |
| \(\sigma_i(a\mid I)\) | behavioral probability of action \(a\) at \(I\) |
| \(L_O\) | lower bound O can guarantee |
| \(U_O\) | upper bound on O implied by X's guarantee |
| \(v_O\) | zero-sum equilibrium value from O's perspective |

---

## Appendix B. Direct correspondence to implementation

| Mathematical object | Implementation object |
|---|---|
| true game state | `State` |
| common rules | `Rules` |
| player information key | `information_key(...)` |
| information set | `InfoSet` |
| player sequence catalog | `SequenceCatalog` |
| realization matrix \(E\) or \(F\) | `SequenceCatalog.realization_matrix()` |
| full game enumeration | `build_sequence_game(...)` |
| payoff matrix \(A\) | `SequenceGame.payoff` |
| O/X maximin LP | `solve_max_player(...)` |
| behavioral recovery | `behavioral_policy(...)` / `compact_behavioral_policy(...)` |
| compact exact artifact | `sequence_form_lp_compact.py` |
| symmetry/reuse batch driver | `precompute.py`, `precompute_all.py` |
| regression verification | `tests/test_exact_optimizations.py` |
