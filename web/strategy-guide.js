(function () {
  'use strict';

  const T = window.TTNTheory;
  const D = window.TTNStrategyData;
  const root = document.getElementById('strategy-cards');
  if (!T || !D || !root) return;

  if (!document.querySelector('link[data-strategy-guide]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = './strategy-guide.css';
    link.dataset.strategyGuide = 'true';
    document.head.appendChild(link);
  }

  const order = ['belief','nash','robust','thompson','random','oracle'];
  const route = (id) => `./strategy-${id}.html`;

  const pageHead = document.querySelector('#page-strategies .page-head');
  const title = pageHead?.querySelector('h1');
  const lede = pageHead?.querySelector('.lede');
  if (title) title.textContent = 'Strategy overview';
  if (lede) lede.textContent = 'Each method now answers a distinct theoretical question: belief-based exploitation, regret-minimizing equilibrium play, worst-case hidden-state protection, policy-weighted probability matching, a random control, or an information-advantaged oracle benchmark.';

  root.className = 'strategy-overview-grid';

  const bestPanel = `
    <article class="panel strategy-overview-best">
      <div>
        <p class="kicker">IS THERE A BEST?</p>
        <h2>There is one strongest theoretical default, but no strategy dominates every opponent.</h2>
        <p>If “best” means <strong>hardest to exploit against an unknown strategic opponent</strong>, use <strong>Regret-Matched Behavioral (MCCFR)</strong>. It is the legal strategy here with the standard two-player zero-sum no-regret / Nash-minimax convergence result.</p>
        <p>If “best” means <strong>maximize score against one particular imperfect opponent</strong>, a model-based heuristic can do better by exploiting that opponent. That extra payoff is opponent-dependent and comes without the same worst-case security.</p>
      </div>
      <div class="overview-best-cases">
        <span><b>Unknown strategic opponent</b>Regret-Matched Behavioral</span>
        <span><b>Belief-based exploitation</b>Belief-State Search</span>
        <span><b>Worst hidden-state protection</b>Worst-Case Assumption</span>
        <span><b>Probability matching</b>Regret-Weighted Thompson</span>
      </div>
    </article>`;

  const cards = order.map((id, i) => {
    const d = D[id];
    const family = T.STRATEGIES.find((s) => s.id === id)?.family || d.family;
    const recommendation = id === 'nash' ? '<span class="overview-recommended">theoretical default</span>' : '';
    return `<article class="panel strategy-overview-card${id === 'nash' ? ' featured' : ''}">
      <div class="overview-card-top">
        <span class="overview-number">${String(i + 1).padStart(2,'0')}</span>
        <div><p class="kicker">${d.status.toUpperCase()}</p><h2>${d.name}</h2></div>
      </div>
      <p class="overview-verdict">${d.verdict}</p>
      <p class="overview-copy">${d.overview}</p>
      <div class="overview-mini-grid">
        <div><small>ASSUMPTION</small><span>${shortAssumption(id)}</span></div>
        <div><small>GUARANTEE</small><span>${shortGuarantee(id)}</span></div>
        <div><small>BEST FOR</small><span>${shortBest(id)}</span></div>
      </div>
      <div class="overview-card-footer">
        <div class="strategy-tags"><span>${family}</span><span>${d.playable ? 'Playable' : 'Simulation only'}</span>${recommendation}</div>
        <a class="secondary-btn strategy-read-more" href="${route(id)}">Read full analysis →</a>
      </div>
    </article>`;
  }).join('');

  const compare = `
    <article class="panel overview-compare-panel">
      <div><p class="kicker">ONE-MINUTE COMPARISON</p><h2>What is each method actually assuming?</h2></div>
      <div class="overview-compare-grid">
        <div><strong>Belief-State Search</strong><span>Equal-weights every currently compatible history, then evaluates legal future play without revealing the hidden board.</span></div>
        <div><strong>Worst-Case Assumption</strong><span>Refuses current-history probabilities and protects against the worst compatible hidden history.</span></div>
        <div><strong>Regret-Matched Behavioral</strong><span>Learns strategic behavioral probabilities at information sets through counterfactual regret minimization.</span></div>
        <div><strong>Regret-Weighted Thompson</strong><span>Uses the regret policy as a generative model to weight compatible histories, then samples one history.</span></div>
        <div><strong>Uniform Random</strong><span>Uses no strategic model and exists as a control.</span></div>
        <div><strong>Oracle</strong><span>Sees hidden truth and therefore solves a different, easier information problem.</span></div>
      </div>
    </article>`;

  root.innerHTML = bestPanel + cards + compare;

  const mixed = root.nextElementSibling;
  const audit = mixed?.nextElementSibling;
  if (mixed?.classList.contains('theory-core')) {
    mixed.innerHTML = `<p class="kicker">HOW TO READ THE STRATEGIES</p>
      <h2>Separate uncertainty about the world from strategic randomization.</h2>
      <div class="overview-principles">
        <div><strong>1 · Information set</strong><span>A legal action can depend only on what that player has observed. Keeping both players' observation histories prevents future-state leakage.</span></div>
        <div><strong>2 · Belief versus behavior</strong><span>A distribution over hidden histories answers “what world might I be in?” A behavioral strategy σ(a|I) answers “how should I randomize at this information set?”</span></div>
        <div><strong>3 · Guarantee</strong><span>Empirical round-robin strength is matchup evidence. No-regret convergence and minimax security are theoretical statements about the full strategic game.</span></div>
      </div>`;
  }
  if (audit?.classList.contains('theory-core')) audit.style.display = 'none';

  function shortAssumption(id) {
    if (id === 'nash') return 'Perfect-recall information-set game';
    if (id === 'belief') return 'Equal current histories + legal rollout model';
    if (id === 'robust') return 'Worst compatible hidden history';
    if (id === 'thompson') return 'Regret-policy reach as history model';
    if (id === 'oracle') return 'True hidden state is known';
    return 'No strategic model';
  }

  function shortGuarantee(id) {
    if (id === 'nash') return 'Asymptotic Nash/minimax convergence';
    if (id === 'belief') return 'Information-safe rollout estimate';
    if (id === 'robust') return 'Exact for its current worst-state objective';
    if (id === 'thompson') return 'Probability matching for the reference distribution';
    if (id === 'oracle') return 'Exact perfect-information minimax';
    return 'None beyond legal uniform play';
  }

  function shortBest(id) {
    return {
      belief: 'Interpretable exploitation',
      nash: 'Unknown strategic opponents',
      robust: 'Ambiguity aversion',
      thompson: 'Policy-weighted scenario sampling',
      random: 'Experimental control',
      oracle: 'Information-value benchmark'
    }[id];
  }
})();
