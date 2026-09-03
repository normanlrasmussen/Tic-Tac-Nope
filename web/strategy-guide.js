(function () {
  'use strict';

  const T = window.TTNTheory;
  if (!T || !document.getElementById('strategy-cards')) return;

  const DETAILS = {
    belief: {
      status: 'Heuristic', formula: 'Q(I,a) = meanₕ V_oracle(T(h,a))', verdict: 'Strong interpretable heuristic; not strategically unexploitable.',
      summary: 'Belief Search treats every history still compatible with the player’s observations as equally plausible, applies one common action to all of them, and chooses the action with the best average continuation value.',
      player: 'The acting player is rational with respect to the current equal-weight information set and maximizes win/draw/loss utility.',
      opponent: 'There is no learned opponent policy. After the current action, the continuation oracle effectively assumes fully informed optimal play by both sides.',
      hidden: 'Every distinct compatible history receives equal weight. This is a modeling convention, not Bayesian conditioning from an opponent strategy.',
      objective: 'Maximize mean perfect-information continuation value over the current information set.',
      guarantee: 'It exactly optimizes its stated one-step objective, assuming the tracked information set and oracle values are correct. It has no Nash, minimax, or no-regret guarantee for the full imperfect-information game.',
      failure: 'Equal weighting can misprice histories. The omniscient continuation approximation can misvalue actions relative to true imperfect-information continuation, and deterministic behavior can be exploitable.',
      cost: 'Moderate: enumerate compatible histories and query memoized exact perfect-information continuation for every legal action.',
      best: 'Best as an interpretable/exploitative baseline when equal-weight histories are reasonable and equilibrium security is not the primary objective.'
    },
    softmax: {
      status: 'Heuristic mixed', formula: 'σ(a|I) ∝ exp(β Q(I,a)), β = 2.2', verdict: 'Useful stochastic heuristic; “mixed” does not mean Nash.',
      summary: 'Softmax Mixed starts from Belief Search scores and converts them into probabilities. Better moves are more likely, but every legal action retains positive probability.',
      player: 'The player is modeled as bounded-rational: move quality changes choice probability smoothly rather than producing a deterministic argmax.',
      opponent: 'No strategic opponent model is learned. A repeated opponent can potentially exploit the fixed relationship between heuristic scores and action probabilities.',
      hidden: 'It inherits Belief Search’s equal-weight compatible-history model and perfect-information continuation oracle.',
      objective: 'Randomize with probability increasing exponentially in heuristic action quality; β controls the degree of concentration on high-scoring moves.',
      guarantee: 'It always returns a valid normalized full-support behavioral distribution. It has no equilibrium, minimax, regret, or payoff-optimality guarantee.',
      failure: 'Randomness by itself is not strategic protection. A Nash mixture can differ radically from a softmax of move scores.',
      cost: 'Moderate: almost all cost is computing Belief Search values; softmax normalization and sampling are negligible.',
      best: 'Best when you want noisy/human-like play, a stochastic stress test, or simple randomized behavior without equilibrium training.'
    },
    extensive: {
      status: 'Deterministic projection', formula: 'a* = arg maxₐ σ̄_MCCFR(a|I)', verdict: 'Excellent for interpretation; weaker theory than the mixed policy it came from.',
      summary: 'Extensive CFR (modal) uses the exact extensive-form information key and the learned MCCFR average policy, then discards the probabilities and always selects the most probable action.',
      player: 'The player trusts the extensive-form learner but insists on a deterministic action.',
      opponent: 'The source policy was learned through strategic self-play. The deterministic projection, however, can be exploited by an opponent that adapts to the removed mixing.',
      hidden: 'No equal-weight hidden-world approximation is used for action selection. Decisions are indexed directly by observation history/information set.',
      objective: 'Choose the modal action of the learned average MCCFR behavior strategy.',
      guarantee: 'The source average MCCFR strategy has an asymptotic equilibrium guarantee. Taking only its mode does not inherit that guarantee; equilibrium play can require positive probability on multiple actions.',
      failure: 'It destroys strategically essential randomization. Even the modal projection of an exact equilibrium can be exploitable.',
      cost: 'High up-front MCCFR training cost; then essentially a table lookup.',
      best: 'Best for explaining what the extensive-form learner “prefers,” not for preserving equilibrium security.'
    },
    nash: {
      status: 'Equilibrium target', formula: 'a ~ σ̄_MCCFR(·|I)', verdict: 'Best equilibrium-oriented legal strategy, subject to finite-training approximation.',
      summary: 'Equilibrium Mixed trains both players with outcome-sampling Monte Carlo Counterfactual Regret Minimization and samples from the time-averaged behavioral policy at each information set. Its randomization is strategic, not score noise.',
      player: 'Players maximize expected zero-sum utility, remember their own actions/observations, and may condition behavior only on their information sets. The game is finite and has perfect recall.',
      opponent: 'Training uses strategic self-play. At an exact minimax equilibrium, the security guarantee does not require the real opponent to also play equilibrium: no opponent can force a value below the game value.',
      hidden: 'No equal-weight hidden-world assumption defines the policy. Reach probabilities are generated endogenously by the players’ behavioral strategies through the extensive-form tree.',
      objective: 'Drive counterfactual regret toward zero at every information set and use the average strategy, whose exploitability approaches zero under the standard assumptions.',
      guarantee: 'This is the strongest legal guarantee on the site. In finite two-player zero-sum perfect-recall games, MCCFR is a no-regret method and the average strategy converges toward a Nash/minimax equilibrium as training increases. The deployed finite policy is approximate; the site does not currently certify its exploitability.',
      failure: 'Finite Monte Carlo training leaves sampling error and residual regret. A minimax-secure strategy can also earn less than a targeted exploitative strategy against a known weak or biased opponent.',
      cost: 'Highest up-front cost. Outcome sampling, sparse information-set tables, bitmasks, memoization, and lazy per-configuration training keep it practical; action selection is cheap after training.',
      best: 'Best theoretical default when the opponent is unknown or strategic and “best” means hard to exploit / worst-case secure.'
    },
    robust: {
      status: 'Robust heuristic', formula: 'a* = arg maxₐ minₕ V_oracle(T(h,a))', verdict: 'Best for ambiguity aversion, not the same thing as Nash security.',
      summary: 'Robust Maximin refuses to assign probabilities to hidden histories. It evaluates the worst compatible hidden history for each move and chooses the move with the strongest floor.',
      player: 'The player is ambiguity-averse: protecting against the worst hidden state matters more than average performance.',
      opponent: 'The adversarial object is the hidden history, not the opponent’s full behavioral strategy. Continuation still uses the fully informed minimax oracle.',
      hidden: 'No probabilities are assigned. Every compatible history is allowed to be the worst case.',
      objective: 'Maximize the minimum oracle continuation value across currently compatible histories.',
      guarantee: 'It exactly optimizes this current-action robust objective. It is not game-theoretic maximin over opponent strategies and does not guarantee the extensive-form game value.',
      failure: 'A very implausible compatible history can dominate the decision. It can therefore be overly conservative and still inherits the perfect-information continuation approximation.',
      cost: 'Moderate and similar to Belief Search; it evaluates all actions over all compatible histories but aggregates by minimum rather than mean.',
      best: 'Best when you explicitly distrust probability assignments and want worst-hidden-state protection.'
    },
    thompson: {
      status: 'Posterior-style heuristic', formula: 'h ~ Uniform(I), a* = arg maxₐ V_oracle(T(h,a))', verdict: 'Principled sampling heuristic; not an equilibrium method.',
      summary: 'Thompson World Sampling draws one compatible hidden history and then acts as if that sampled world were true, choosing the oracle-best action for it.',
      player: 'The player uses probability matching: uncertainty is resolved by sampling a plausible world and optimizing for that sample.',
      opponent: 'No opponent policy is modeled directly. The continuation oracle assumes fully informed optimal play after the current choice.',
      hidden: 'Compatible histories are sampled uniformly. Calling this a true Bayesian posterior would require a justified prior and likelihood model, which is not assumed here.',
      objective: 'Randomize indirectly by sampling a hidden history and taking that history’s best action.',
      guarantee: 'It correctly implements probability matching for the chosen uniform possibility model. It has no Nash/minimax guarantee and no Bayesian-optimality guarantee unless the uniform history distribution is actually the correct posterior.',
      failure: 'One sampled history may be unrepresentative, and a strategic opponent can exploit the induced action distribution.',
      cost: 'Usually lighter than aggregating every belief-world action because one sampled world drives the choice; oracle values remain exact and memoized.',
      best: 'Best as an exploration/probability-matching contrast to both deterministic averaging and strategic equilibrium mixing.'
    },
    random: {
      status: 'Baseline', formula: 'σ(a|I) = 1 / |A(I)|', verdict: 'Control group, not a candidate for best play.',
      summary: 'Uniform Random intentionally ignores move quality and gives every legal action equal probability. Its job is to provide a scientific baseline.',
      player: 'No rationality assumption beyond selecting a legal action.',
      opponent: 'None.',
      hidden: 'None beyond the information needed to identify legal actions.',
      objective: 'Sample uniformly from the legal action set.',
      guarantee: 'All legal actions receive equal positive probability. There is no performance, regret, equilibrium, or robustness guarantee.',
      failure: 'It discards nearly all strategic information and is generally easy to outperform.',
      cost: 'Minimal: enumerate legal actions and sample.',
      best: 'Best only as a control for measuring how much value the other methods add.'
    },
    oracle: {
      status: 'Illegal benchmark', formula: 'a* = arg maxₐ V_oracle(s,a)', verdict: 'Strongest information benchmark; disqualified from legal play.',
      summary: 'The Omniscient Oracle sees the true hidden board and uses exact memoized perfect-information minimax under the same physical move rules. A legal Tic-Tac-Nope player does not have this information.',
      player: 'A hypothetical fully informed player with access to the true underlying state.',
      opponent: 'The continuation minimax also assumes fully informed optimal opposition.',
      hidden: 'There is no uncertainty: the actual hidden state is known.',
      objective: 'Choose the exact perfect-information minimax action from the true state.',
      guarantee: 'Exact for the perfect-information relaxation represented by the oracle. Because it violates the information rules, it cannot determine which legal strategy is best.',
      failure: 'It cheats. Its information advantage makes direct strategic comparison inappropriate.',
      cost: 'Potentially expensive the first time a state is solved, then cheap because the exact minimax values are memoized.',
      best: 'Best only as a simulation benchmark for quantifying the value of hidden information.'
    }
  };

  const hiddenModel = (id) => {
    if (id === 'nash' || id === 'extensive') return 'Information-set / endogenous reach';
    if (id === 'robust') return 'Worst compatible history';
    if (id === 'random') return 'Not used';
    if (id === 'oracle') return 'True state known';
    return 'Equal-weight compatible histories';
  };

  const eqGuarantee = (id) => {
    if (id === 'nash') return 'Yes — asymptotically';
    if (id === 'extensive') return 'No — modal projection loses it';
    return 'No';
  };

  function installStyles() {
    if (document.querySelector('link[data-strategy-guide]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = './strategy-guide.css';
    link.dataset.strategyGuide = 'true';
    document.head.appendChild(link);
  }

  function renderGuide() {
    const root = document.getElementById('strategy-cards');
    if (!root) return;
    root.classList.add('strategy-guide-grid');

    const pageHead = document.querySelector('#page-strategies .page-head');
    const title = pageHead?.querySelector('h1');
    const lede = pageHead?.querySelector('.lede');
    if (title) title.textContent = 'How each strategy thinks — and what it can guarantee.';
    if (lede) lede.textContent = 'The algorithms differ less by “smartness” than by what they assume about hidden information, the opponent, and rationality. The right strategy depends on which risk you are trying to control.';

    const comparisonRows = T.STRATEGIES.map((s) => {
      const d = DETAILS[s.id];
      return `<div class="strategy-compare-row"><b>${s.name}</b><span>${d.status}</span><span>${hiddenModel(s.id)}</span><span>${eqGuarantee(s.id)}</span><span>${d.verdict}</span></div>`;
    }).join('');

    const cards = T.STRATEGIES.map((s, i) => {
      const d = DETAILS[s.id];
      return `<article class="panel strategy-card strategy-card-deep${s.id === 'nash' ? ' strategy-card-featured' : ''}">
        <div class="strategy-card-head"><span>${String(i + 1).padStart(2, '0')}</span><div><p class="kicker">${d.status.toUpperCase()}</p><h2>${s.name}</h2><p class="strategy-verdict">${d.verdict}</p></div></div>
        <p class="strategy-summary">${d.summary}</p>
        <div class="formula">${d.formula}</div>
        <div class="strategy-assumption-grid">
          <div><small>PLAYER MODEL</small><p>${d.player}</p></div>
          <div><small>OPPONENT MODEL</small><p>${d.opponent}</p></div>
          <div><small>HIDDEN-STATE ASSUMPTION</small><p>${d.hidden}</p></div>
          <div><small>WHAT IT OPTIMIZES</small><p>${d.objective}</p></div>
          <div class="guarantee"><small>THEORETICAL GUARANTEE</small><p>${d.guarantee}</p></div>
          <div class="warning"><small>WHERE IT CAN FAIL</small><p>${d.failure}</p></div>
          <div><small>COMPUTATIONAL PROFILE</small><p>${d.cost}</p></div>
          <div class="best-use"><small>WHEN IT IS THE BEST FIT</small><p>${d.best}</p></div>
        </div>
        <div class="strategy-tags"><span>${s.family}</span><span>${s.play ? 'Legal playable strategy' : 'Simulation only'}</span>${s.id === 'nash' ? '<span class="recommended-tag">Recommended theoretical default</span>' : ''}</div>
      </article>`;
    }).join('');

    root.innerHTML = `
      <article class="panel strategy-best-panel">
        <div class="strategy-best-copy">
          <p class="kicker">IS THERE A “BEST” STRATEGY?</p>
          <h2>Yes for security. No for every possible opponent.</h2>
          <p>If <strong>best</strong> means “protect my expected result against an arbitrary strategic opponent,” the equilibrium target is <strong>Equilibrium Mixed (MCCFR)</strong>. In a solved two-player zero-sum game, a Nash/minimax strategy secures the game value: no opponent can exploit it into a lower expected value.</p>
          <p>If <strong>best</strong> instead means “score as highly as possible against this particular imperfect opponent,” there is no universal winner. Equilibrium play trades some exploitative upside for protection. A targeted heuristic can outperform it against a weak or systematically biased opponent while being much more exploitable itself.</p>
        </div>
        <div class="best-answer-grid">
          <div class="best-answer recommended"><small>UNKNOWN / RATIONAL OPPONENT</small><strong>Equilibrium Mixed</strong><span>Best theoretical default: asymptotic Nash/minimax security.</span></div>
          <div><small>EXPLOIT NON-EQUILIBRIUM PLAY</small><strong>Belief Search</strong><span>Interpretable and aggressive, but has no anti-exploitation guarantee.</span></div>
          <div><small>DISTRUST HIDDEN-STATE PROBABILITIES</small><strong>Robust Maximin</strong><span>Protects the worst compatible history, not the worst opponent policy.</span></div>
          <div><small>UNDERSTAND THE EQUILIBRIUM</small><strong>Extensive CFR (modal)</strong><span>Shows the favorite move, but discarding mixing can make it exploitable.</span></div>
        </div>
        <p class="strategy-caveat"><strong>Finite-training caveat:</strong> the deployed MCCFR table is an approximation to the equilibrium target. The theorem is asymptotic, and this site does not currently compute a certified exploitability bound for the finite policy.</p>
      </article>
      <section class="panel strategy-comparison-panel">
        <div class="panel-heading"><div><p class="kicker">AT A GLANCE</p><h2>Assumptions and guarantees side by side</h2></div></div>
        <div class="strategy-compare-scroll"><div class="strategy-compare-table"><div class="strategy-compare-row strategy-compare-head"><b>Strategy</b><b>Class</b><b>Hidden-state model</b><b>Equilibrium guarantee?</b><b>Bottom line</b></div>${comparisonRows}</div></div>
      </section>
      ${cards}`;
  }

  installStyles();
  renderGuide();
})();
