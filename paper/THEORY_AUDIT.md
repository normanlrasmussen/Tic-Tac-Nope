# Tic-Tac-Nope Computational Game Theory Audit

## Executive conclusion

Tic-Tac-Nope is modeled as a finite, sequential, two-player, zero-sum extensive-form game with imperfect information and perfect recall. Legal strategies act only through a player's information state. The only strategy allowed to inspect the actual hidden state is the explicitly simulation-only **Omniscient Oracle** benchmark.

The principal game-theoretic strategy is **Regret-Matched Behavioral (MCCFR)**. This name is deliberate: the deployed policy is a behavioral strategy \(\sigma_i(a\mid I)\), while outcome sampling is only the estimator used during training. The solver remains outcome-sampling Monte Carlo Counterfactual Regret Minimization (MCCFR), following the standard importance-weighted structure used by OpenSpiel.

The previous **Softmax Mixed** and deterministic **Extensive CFR (modal)** strategies have been removed from the active strategy set. Softmax added randomness without an equilibrium interpretation; the modal projection discarded strategically necessary randomization from the regret policy and therefore did not inherit the equilibrium guarantee.

The revised **Belief-State Search** no longer hands future play to an omniscient continuation oracle. Both Thompson variants are intentionally retained: **Uniform Thompson Sampling** samples compatible histories uniformly, while **Regret-Weighted Thompson Sampling** samples them according to reach probabilities under the learned regret behavioral policy. Keeping both creates a clean ablation: the action-selection rule is the same, and only the hidden-history weighting model changes.

## 1. Formal game model

A true state is represented by

\[
s=(B_O,B_X,T_O,T_X,p,o_O,o_X),
\]

where `B_O,B_X` are true-ownership bitmasks, `T_O,T_X` are attempted-mystery-cell bitmasks, `p` is the player to move, and `o_O,o_X` are the complete action/observation histories available to each player. The mystery-cell set and starting player are common knowledge.

For a visible cell, legality is public. For a mystery cell `c`, player `i` may attempt it iff `c` is not in `T_i`; underlying occupancy does not affect legality. If the opponent already owns the mystery cell, the attempt fails and still consumes the turn. This is essential: making hidden occupancy affect the legal action set would leak private information.

Terminal utility is

\[
u_O(z)\in\{-1,0,+1\},\qquad u_X(z)=-u_O(z),
\]

so the modeled game is exactly two-player zero-sum.

## 2. Information sets and perfect recall

The information key is

\[
I_i(h)=\bigl(i,\text{start player},\text{mystery mask},o_i(h)\bigr).
\]

A player observes visible moves and locations, its own mystery-action locations, an opponent mystery action only as a fog action, terminal/nonterminal status, and the ordering of all observations. A mystery attempt provides no direct success/failure result; hidden ownership is known only when it is implied by the player's complete observation history.

No player forgets an earlier action or observation. Thus the modeled game has perfect recall. The engine also asserts that histories sharing one information key expose the same legal action set.

This matters because a legal behavioral policy must satisfy

\[
\sigma_i(a\mid h)=\sigma_i(a\mid h')\quad\text{whenever }h,h'\in I.
\]

## 3. Why behavioral strategy is the right representation

A normal-form mixed strategy randomizes over complete pure contingency plans. That representation is enormous in this game. Under perfect recall, Kuhn's theorem gives outcome equivalence between mixed strategies over pure plans and behavioral strategies that randomize at information sets. The implementation therefore stores and samples

\[
\sigma_i(a\mid I)
\]

directly.

This is why **Regret-Matched Behavioral (MCCFR)** is a true behavioral strategy even though the training algorithm samples trajectories. Sampling is a computational device used to estimate regret; it does not change the mathematical object used at play time.

## 4. Active strategies

### 4.1 Belief-State Search

The old Belief Search used

\[
Q(I,a)=\frac1{|I|}\sum_{h\in I}V_{\text{oracle}}(T(h,a)),
\]

which respected the current information set but then evaluated the future as though the hidden state became known. That continuation was information-advantaged and could mis-rank actions.

The revised strategy uses the conceptual objective

\[
Q(I,a)\approx\frac1{|I|}\sum_{h\in I}
\mathbb E_{\bar\sigma_R}\!\left[u_i\mid h,a\right],
\]

where \(\bar\sigma_R\) is the learned average regret behavioral policy used only for future continuation.

Implementation properties:

1. every currently compatible history is included;
2. the same candidate action is applied across the acting player's information set;
3. hypothetical states retain both `obsO` and `obsX`;
4. each future player selects actions from a policy keyed only by that player's own information state;
5. continuation is estimated with bounded Monte Carlo behavioral rollouts rather than an omniscient minimax continuation.

Therefore hidden truth is not revealed to future players during Belief-State Search.

The remaining assumptions are explicit. Current compatible histories are still equal-weighted, future behavior is evaluated relative to the regret-policy continuation model, and finite rollouts introduce variance. This is an information-safe heuristic, not a Nash solver.

#### Why not make Belief-State Search an exact oracle?

An exact continuation that preserves both players' information constraints must solve strategic decisions over future information sets. That is no longer a simple hidden-state oracle; it is essentially another solve of the imperfect-information extensive-form game. Doing that from scratch at every move would duplicate the equilibrium problem and is computationally inappropriate for a browser strategy whose purpose is to remain a distinct, interpretable heuristic.

### 4.2 Regret-Matched Behavioral (MCCFR)

Play samples directly from

\[
a\sim\bar\sigma^{\text{MCCFR}}(\cdot\mid I).
\]

CFR minimizes counterfactual regret at information sets. In finite two-player zero-sum perfect-recall games, vanishing average regret implies convergence of the average strategy toward the Nash/minimax set.

The implementation uses outcome-sampling MCCFR. For updating player `i`, a terminal trajectory is sampled. At player `i` information sets the sampling policy includes exploration

\[
q(a\mid I)=\epsilon/|A(I)|+(1-\epsilon)\sigma(a\mid I),
\]

with \(\epsilon=0.6\). Importance weighting produces unbiased sampled counterfactual-value estimates under the standard MCCFR conditions.

Regret matching uses positive cumulative regret and falls back to uniform when all positive regrets are zero. The time-averaged behavioral policy is the deployed policy.

What can be claimed:

- the target game is the original unabstracted extensive-form game;
- the policy is a genuine behavioral strategy;
- MCCFR has the standard no-regret / equilibrium convergence result under the stated assumptions;
- the average policy, not the modal action, is the equilibrium-target object;
- a finite training run is only an approximate equilibrium;
- the site does not currently compute an exact exploitability certificate.

#### Why not replace MCCFR with full-tree CFR?

Full-tree CFR would traverse all relevant branches every iteration and remove Monte Carlo sampling variance per iteration, but that does not make the resulting strategy “more behavioral.” Both methods produce behavioral policies.

The existing development benchmark already shows the computational issue: a 100-iteration external-sampling prototype required about 1.25 seconds and touched more than 300,000 information sets, while 10,000 outcome-sampling iterations took about 0.47 seconds on the same development runtime. Literal full-tree traversal is more expensive still. For a browser-hosted 3×3 game with private observation histories, outcome sampling gives a much better training-cost tradeoff while retaining the convergence theory.

### 4.3 Worst-Case Assumption

This is the renamed former Robust Maximin heuristic:

\[
a^*=\arg\max_a\min_{h\in I}V_{\text{oracle}}(T(h,a)).
\]

The new name is more precise. The inner adversary is the currently compatible hidden history, not the opponent's complete behavioral strategy. Therefore calling the method simply “maximin” risks confusing hidden-state robustness with game-theoretic minimax.

It exactly optimizes its stated one-step worst-hidden-state objective but does not guarantee the extensive-form game value.

### 4.4 Uniform Thompson Sampling

Uniform Thompson samples

\[
h\sim\operatorname{Uniform}(I),
\]

then chooses

\[
a^*=\arg\max_a V_{\text{oracle}}(T(h,a)).
\]

Every currently compatible full history receives probability \(1/|I|\). This is a deliberate possibility-model baseline, not automatically a Bayesian posterior. It is useful because it isolates the effect of Thompson-style scenario sampling without introducing an opponent-policy model into the history probabilities.

Uniform Thompson has no Nash/minimax guarantee. Its principal modeling risk is that strategically implausible histories receive exactly as much probability as histories that a realistic opponent policy would make much more likely.

### 4.5 Regret-Weighted Thompson Sampling

For each compatible history `h`, replay the history from the root and compute its reach under the learned average regret behavioral policy:

\[
w(h)=\pi^{\bar\sigma_R}(h).
\]

Conditioning on the current information set gives

\[
P_{\bar\sigma_R}(h\mid I)
=\frac{w(h)}{\sum_{h'\in I}w(h')}.
\]

The strategy samples one compatible history from this distribution and then uses the same current-action rule as Uniform Thompson:

\[
a^*=\arg\max_a V_{\text{oracle}}(T(h,a)).
\]

This is a more strategically informed history model because its weights come from a behavioral generative policy rather than equal weighting. It is Bayesian only conditional on accepting the learned regret policy as the model that generated prior behavior. If the real opponent behaves differently, these posterior-style weights can be wrong.

#### Why keep both Thompson variants?

They form a controlled comparison. Both strategies:

- use the same compatible-history set;
- sample exactly one hidden history;
- choose the perfect-information oracle-best current action in that sampled history.

The only intended difference is the history distribution:

\[
P_U(h\mid I)=\frac1{|I|}
\]

versus

\[
P_R(h\mid I)\propto\pi^{\bar\sigma_R}(h).
\]

Therefore a systematic performance difference in simulation is evidence about the value of the weighting model, not about a different downstream decision rule. Uniform Thompson is the natural ablation/control for Regret-Weighted Thompson.

#### Why not use Belief-State Search to create the weighted Thompson distribution?

Belief-State Search is deterministic given its information set and rollout estimates; it is not itself a calibrated probability model over opponent actions or hidden histories. Turning its scores into probabilities would require an extra stochastic/noise model. That would recreate the same conceptual problem as the removed Softmax strategy: arbitrary score-to-probability randomization without a game-theoretic reason for those probabilities. The regret behavioral policy already supplies a coherent mixed reference policy, so it is the appropriate weighted source.

### 4.6 Uniform Random

\[
\sigma(a\mid I)=1/|A(I)|.
\]

A control strategy only. Randomness by itself is not equilibrium mixing.

### 4.7 Omniscient Oracle

Exact perfect-information minimax on the actual hidden state. It is illegal under the imperfect-information game and remains simulation-only.

## 5. Retired strategies

### Softmax Mixed — removed

Softmax converted heuristic action scores into probabilities. It was a valid stochastic behavioral rule but had no Nash, minimax, or regret interpretation. Because the project now distinguishes strategic mixing from arbitrary randomization, this strategy was removed rather than relabeled as “mixed.”

### Extensive CFR modal projection — removed

The modal projection played

\[
\arg\max_a\bar\sigma^{\text{MCCFR}}(a\mid I).
\]

It discarded the equilibrium policy's randomization. A 55/45 behavioral mix becoming 100/0 can make an otherwise secure policy exploitable. The modal action remains useful as an analysis/visualization statistic, but it should not be presented as a separate strategic policy.

This removal does not depend on a small round-robin sample. A 30-game cell in the browser heatmap is too noisy to establish a general theoretical ranking, and matchup performance cannot restore an equilibrium guarantee that the deterministic projection does not possess.

## 6. MCCFR implementation notes

The deployed solver follows the standard outcome-sampling structure with a zero baseline. A sampled trajectory is corrected by its sampling probability, regrets are accumulated at visited information sets, and the average strategy is reach-weighted.

The implementation retains sparse information-set tables, integer bitmasks, memoized perfect-information oracle values for benchmark/heuristic use, seeded xorshift RNG for training, and lazy training by fog configuration and starting player.

No board-state abstraction or symmetry merge is used in the regret solver. This avoids accidentally merging distinct private observation histories.

## 7. Empirical evaluation policy

Round-robin results answer a matchup question, not a theorem question. Recommended practice is:

- report number of games per cell;
- alternate the starting player;
- distinguish legal strategies from the Oracle benchmark;
- use substantially more than 30 games when making performance claims about stochastic strategies;
- report uncertainty or repeated seeds when comparing close scores;
- use the Uniform-vs-Regret-Weighted Thompson comparison as an ablation of the history-weighting assumption;
- do not infer Nash optimality from round-robin rank.

## 8. References

- Zinkevich, M., Johanson, M., Bowling, M., & Piccione, C. (2007). *Regret Minimization in Games with Incomplete Information*. NeurIPS.
- Lanctot, M., Waugh, K., Zinkevich, M., & Bowling, M. (2009). *Monte Carlo Sampling for Regret Minimization in Extensive Games*. NeurIPS.
- Kuhn, H. W. (1953). *Extensive Games and the Problem of Information*.
- Google DeepMind OpenSpiel, `outcome_sampling_mccfr.py`, implementation-level reference for the outcome-sampling MCCFR estimator.
