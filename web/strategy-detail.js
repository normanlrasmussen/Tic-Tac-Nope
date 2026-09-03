(function () {
  'use strict';

  const D = window.TTNStrategyData || {};
  const id = document.body.dataset.strategy;
  const d = D[id];
  const order = ['belief','softmax','extensive','nash','robust','thompson','random','oracle'];
  if (!d) {
    document.getElementById('strategy-detail-root').innerHTML = '<section class="panel detail-error"><h1>Strategy not found</h1><a href="./index.html#strategies">Back to strategies</a></section>';
    return;
  }

  const index = order.indexOf(id);
  const prev = order[(index - 1 + order.length) % order.length];
  const next = order[(index + 1) % order.length];
  const root = document.getElementById('strategy-detail-root');

  document.title = `${d.name} · Tic-Tac-Nope`;
  document.querySelector('meta[name="description"]')?.setAttribute('content', `${d.name}: assumptions, objective, theoretical guarantees, limitations, and role in Tic-Tac-Nope.`);

  root.innerHTML = `
    <div class="detail-breadcrumb"><a href="./index.html#strategies">← Strategy overview</a><span>${d.family}</span></div>

    <section class="detail-hero">
      <div>
        <p class="eyebrow">${d.status.toUpperCase()}</p>
        <h1>${d.name}</h1>
        <p class="detail-verdict">${d.verdict}</p>
        <p class="lede">${d.overview}</p>
      </div>
      <div class="panel detail-formula-card">
        <small>DECISION RULE</small>
        <div class="formula">${d.formula}</div>
        <span class="detail-legality">${d.playable ? 'Legal playable strategy' : 'Simulation-only benchmark'}</span>
      </div>
    </section>

    <section class="detail-section">
      <div class="detail-section-head"><p class="kicker">ASSUMPTIONS</p><h2>What model of the game and players does it use?</h2></div>
      <div class="detail-assumption-grid">
        ${infoCard('Acting player', d.player)}
        ${infoCard('Opponent', d.opponent)}
        ${infoCard('Hidden information', d.hidden)}
      </div>
    </section>

    <section class="detail-two-column">
      <article class="panel detail-objective">
        <p class="kicker">WHAT IT OPTIMIZES</p>
        <h2>The optimization target</h2>
        <p>${d.objective}</p>
        <div class="formula">${d.formula}</div>
      </article>
      <article class="panel detail-best">
        <p class="kicker">WHEN IS IT “BEST”?</p>
        <h2>Use case</h2>
        <p>${d.best}</p>
      </article>
    </section>

    <section class="detail-section">
      <div class="detail-section-head"><p class="kicker">THEORETICAL STATUS</p><h2>What can you actually claim?</h2></div>
      <div class="detail-guarantee-grid">
        <article class="detail-guarantee good"><small>GUARANTEE</small><p>${d.guarantee}</p></article>
        <article class="detail-guarantee caution"><small>DOES NOT GUARANTEE</small><p>${d.notGuarantee}</p></article>
      </div>
    </section>

    <section class="detail-two-column">
      <article class="panel">
        <p class="kicker">FAILURE MODES</p>
        <h2>Where the method can break down</h2>
        <p>${d.failure}</p>
      </article>
      <article class="panel">
        <p class="kicker">COMPUTATIONAL PROFILE</p>
        <h2>What it costs</h2>
        <p>${d.cost}</p>
      </article>
    </section>

    <section class="panel detail-vs-nash">
      <p class="kicker">RELATION TO EQUILIBRIUM PLAY</p>
      <h2>How this differs from the Nash-target strategy</h2>
      <p>${d.nash}</p>
    </section>

    <section class="panel detail-best-answer">
      <p class="kicker">BOTTOM LINE</p>
      <h2>${bottomLine(id)}</h2>
      <p>${bottomCopy(id)}</p>
    </section>

    <nav class="detail-pagination" aria-label="Strategy pages">
      <a href="./strategy-${prev}.html"><small>PREVIOUS</small><strong>← ${D[prev].name}</strong></a>
      <a href="./index.html#strategies" class="detail-all">All strategies</a>
      <a href="./strategy-${next}.html"><small>NEXT</small><strong>${D[next].name} →</strong></a>
    </nav>`;

  function infoCard(title, copy) {
    return `<article class="panel detail-assumption"><small>${title.toUpperCase()}</small><p>${copy}</p></article>`;
  }

  function bottomLine(strategy) {
    return {
      nash: 'Best theoretical default for an unknown strategic opponent.',
      belief: 'Strong local decision heuristic, but not a full-game equilibrium.',
      softmax: 'Useful randomized behavior, but not strategic equilibrium mixing.',
      extensive: 'Best for interpretation; use the mixed policy for security.',
      robust: 'Best when hidden-state ambiguity—not opponent strategy—is the risk you care about.',
      thompson: 'Best as a scenario-sampling baseline when probability matching is useful.',
      random: 'Best as a control group.',
      oracle: 'Best only as an information-advantaged benchmark.'
    }[strategy];
  }

  function bottomCopy(strategy) {
    if (strategy === 'nash') return 'Among the legal strategies on this site, this is the one with the strongest standard game-theoretic guarantee. The important caveat is finite training: the algorithm targets equilibrium, but the current browser policy is an approximation rather than a certified exact Nash solution.';
    if (strategy === 'oracle') return 'Its exact perfect-information solution is useful scientifically, but it answers a different question because legal Tic-Tac-Nope players do not know the hidden state.';
    return 'Whether it outperforms other methods in simulation depends on the opponent and the fog configuration. A high empirical win rate against one opponent is evidence about that matchup, not a universal optimality theorem.';
  }
})();
