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

  const order = ['belief','softmax','extensive','nash','robust','thompson','random','oracle'];
  const route = (id) => `./strategy-${id}.html`;

  const pageHead = document.querySelector('#page-strategies .page-head');
  const title = pageHead?.querySelector('h1');
  const lede = pageHead?.querySelector('.lede');
  if (title) title.textContent = 'Strategy overview';
  if (lede) lede.textContent = 'Start here for the big picture. Each strategy has its own page for assumptions, guarantees, failure modes, and the exact question it is designed to answer.';

  root.className = 'strategy-overview-grid';

  const bestPanel = `
    <article class="panel strategy-overview-best">
      <div>
        <p class="kicker">IS THERE A BEST?</p>
        <h2>There is a best theoretical default — but not a universal winner.</h2>
        <p>If “best” means <strong>hardest to exploit against an unknown strategic opponent</strong>, the answer is <strong>Equilibrium Mixed (MCCFR)</strong>. Its average behavioral strategy is the only legal method here with the standard two-player zero-sum equilibrium/minimax convergence guarantee.</p>
        <p>If “best” means <strong>maximize score against one particular imperfect opponent</strong>, the answer can change. A more exploitative heuristic may earn more against predictable mistakes while sacrificing worst-case protection.</p>
      </div>
      <div class="overview-best-cases">
        <span><b>Unknown strategic opponent</b>Equilibrium Mixed</span>
        <span><b>Readable aggressive baseline</b>Belief Search</span>
        <span><b>Worst hidden-state protection</b>Robust Maximin</span>
        <span><b>Interpret the equilibrium</b>Extensive CFR (modal)</span>
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
      <div><p class="kicker">ONE-MINUTE COMPARISON</p><h2>What changes from strategy to strategy?</h2></div>
      <div class="overview-compare-grid">
        <div><strong>Belief Search / Softmax / Thompson</strong><span>Use an equal-weight set of compatible histories.</span></div>
        <div><strong>Robust Maximin</strong><span>Refuses probabilities and protects the worst compatible history.</span></div>
        <div><strong>Extensive CFR / MCCFR</strong><span>Use the full observation-history information sets; strategic reach is learned through self-play.</span></div>
        <div><strong>Oracle</strong><span>Sees hidden truth and therefore solves a different, easier information problem.</span></div>
      </div>
    </article>`;

  root.innerHTML = bestPanel + cards + compare;

  const mixed = root.nextElementSibling;
  const audit = mixed?.nextElementSibling;
  if (mixed?.classList.contains('theory-core')) {
    mixed.innerHTML = `<p class="kicker">HOW TO READ THE STRATEGIES</p>
      <h2>Three questions separate almost every method.</h2>
      <div class="overview-principles">
        <div><strong>1 · What does the player believe?</strong><span>Equal-weight histories, worst-case histories, learned strategic reach, or the true state?</span></div>
        <div><strong>2 · What does it assume about the opponent?</strong><span>No model, an omniscient continuation oracle, or strategic self-play?</span></div>
        <div><strong>3 · What guarantee matters?</strong><span>Local optimization, robustness to hidden states, or equilibrium security against opponent strategies?</span></div>
      </div>`;
  }
  if (audit?.classList.contains('theory-core')) audit.style.display = 'none';

  function shortAssumption(id) {
    if (id === 'nash' || id === 'extensive') return 'Full information-set model';
    if (id === 'robust') return 'Worst compatible history';
    if (id === 'oracle') return 'True hidden state is known';
    if (id === 'random') return 'No strategic model';
    return 'Equal-weight compatible histories';
  }

  function shortGuarantee(id) {
    if (id === 'nash') return 'Asymptotic Nash/minimax convergence';
    if (id === 'belief' || id === 'robust') return 'Exact for its local objective only';
    if (id === 'oracle') return 'Exact perfect-information minimax';
    if (id === 'softmax') return 'Valid full-support distribution';
    if (id === 'extensive') return 'No equilibrium guarantee after taking the mode';
    if (id === 'thompson') return 'Probability matching for chosen world model';
    return 'None beyond legal uniform play';
  }

  function shortBest(id) {
    return {
      belief: 'Interpretability / exploitation',
      softmax: 'Noisy bounded-rational play',
      extensive: 'Explaining MCCFR preferences',
      nash: 'Unknown strategic opponents',
      robust: 'Ambiguity aversion',
      thompson: 'Scenario-sampling exploration',
      random: 'Experimental control',
      oracle: 'Information-value benchmark'
    }[id];
  }
})();
