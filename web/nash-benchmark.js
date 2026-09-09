(function () {
  'use strict';

  const T = window.TTNTheory;
  if (!T) return;
  const { O, X } = T;
  const PAGE_ID = 'nash';
  const LP_ID = 'lp';
  const DEFAULT_ROUNDS = 30;
  const MAX_ROUNDS = 500;
  const MCCFR_TARGET = 20000;
  const solvers = new Map();
  const sleep = () => new Promise((resolve) => setTimeout(resolve, 0));

  function injectStyles() {
    if (document.getElementById('nash-benchmark-styles')) return;
    const style = document.createElement('style');
    style.id = 'nash-benchmark-styles';
    style.textContent = `
      .nash-value-grid{display:grid;grid-template-columns:1fr;gap:18px;margin:22px 0}
      .nash-value-card{padding:22px;border:1px solid var(--line,#d8d1c4);border-radius:18px;background:var(--panel,#fffdf8)}
      .nash-value-card .nash-number{font-size:clamp(2rem,5vw,4rem);line-height:1;font-weight:800;letter-spacing:-.05em;margin:10px 0}
      .nash-value-card small{display:block;color:var(--muted,#6f6a61);line-height:1.5}
      .nash-certificate-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:14px}
      .nash-certificate{padding:14px 16px;border-radius:14px;background:rgba(0,0,0,.035)}
      .nash-certificate strong{display:block;font-size:1.08rem;margin-top:4px}
      .nash-toolbar{display:flex;align-items:end;justify-content:space-between;gap:18px;flex-wrap:wrap;margin-top:18px}
      .nash-toolbar-actions{display:flex;align-items:end;gap:12px;flex-wrap:wrap}
      .nash-rounds-control{display:grid;gap:5px;min-width:160px}
      .nash-rounds-control label{font-size:.75rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
      .nash-rounds-control input{width:100%;padding:10px 12px;border:1px solid var(--line,#d8d1c4);border-radius:10px;background:transparent;color:inherit}
      .nash-config-chip{display:inline-flex;gap:8px;align-items:center;flex-wrap:wrap}
      .nash-config-chip code{font-size:.9em}
      .nash-table-wrap{overflow:auto;margin-top:18px}
      .nash-table{width:100%;border-collapse:collapse;min-width:900px}
      .nash-table th,.nash-table td{padding:13px 12px;text-align:left;border-bottom:1px solid var(--line,#ded8cd);vertical-align:top}
      .nash-table th{font-size:.75rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#6f6a61)}
      .nash-result-main{font-weight:800;font-variant-numeric:tabular-nums}
      .nash-result-sub{display:block;margin-top:3px;font-size:.78rem;color:var(--muted,#6f6a61);white-space:nowrap}
      .nash-status{display:inline-flex;padding:5px 9px;border-radius:999px;font-size:.76rem;font-weight:800;white-space:nowrap}
      .nash-status.good{background:rgba(41,120,72,.12);color:#24643e}
      .nash-status.watch{background:rgba(174,113,22,.14);color:#88580f}
      .nash-status.oracle{background:rgba(111,86,156,.13);color:#5a4380}
      .nash-status.self{background:rgba(38,94,134,.12);color:#245b82}
      .nash-progress{margin-top:14px;height:8px;background:rgba(0,0,0,.07);border-radius:999px;overflow:hidden}
      .nash-progress i{display:block;height:100%;width:0;background:currentColor;transition:width .2s ease}
      .nash-empty{padding:22px;border:1px dashed var(--line,#d8d1c4);border-radius:14px;margin-top:18px}
      .nash-note{margin-top:16px;padding:15px 16px;border-left:3px solid currentColor;background:rgba(0,0,0,.025);line-height:1.55}
      @media(max-width:760px){.nash-value-grid,.nash-certificate-grid{grid-template-columns:1fr}.nash-value-card{padding:18px}}
    `;
    document.head.appendChild(style);
  }

  function installPage() {
    if (document.getElementById('page-nash')) return;
    injectStyles();

    const nav = document.querySelector('.topbar .nav');
    const simulateButton = nav?.querySelector('[data-page="simulate"]');
    if (nav && !nav.querySelector('[data-page="nash"]')) {
      const button = document.createElement('button');
      button.className = 'nav-btn';
      button.dataset.page = PAGE_ID;
      button.textContent = 'Exact Nash';
      if (simulateButton) nav.insertBefore(button, simulateButton); else nav.appendChild(button);
      button.addEventListener('click', () => openPage());
    }

    const page = document.createElement('section');
    page.id = 'page-nash';
    page.className = 'page';
    page.setAttribute('aria-labelledby', 'nash-title');
    page.innerHTML = `
      <div class="page-head">
        <div>
          <p class="eyebrow">CERTIFIED EQUILIBRIUM BENCHMARK</p>
          <h1 id="nash-title">Exact Nash values, then test the security guarantee.</h1>
          <p class="lede">Read the sequence-form LP certificate for the current mystery-cell layout, then simulate the exact strategy against every other model in the site.</p>
        </div>
        <a class="secondary-btn" href="./strategy-lp.html">LP theory & guarantees</a>
      </div>

      <section class="panel" aria-labelledby="nash-values-title">
        <div class="panel-heading">
          <div><p class="kicker">GAME VALUE</p><h2 id="nash-values-title">Equilibrium game value</h2></div>
          <span id="nash-config" class="pill nash-config-chip">Reading current setup…</span>
        </div>
        <p class="muted">Utility is +1 for a win, 0 for a draw, and −1 for a loss. The displayed Nash value is the equilibrium expected utility of the player who moves first. Because the game is zero-sum, the second player's value is exactly its negative. O/X relabeling is checked numerically below rather than displayed as separate values.</p>
        <div id="nash-values-body"><div class="nash-empty muted">Waiting for exact LP artifacts…</div></div>
      </section>

      <section class="panel" style="margin-top:24px" aria-labelledby="nash-benchmark-title">
        <div class="panel-heading">
          <div>
            <p class="kicker">SECURITY TEST</p>
            <h2 id="nash-benchmark-title">Exact Nash against the other strategies</h2>
            <p class="muted">For each opponent, the exact policy is tested once as the first mover and once as the second mover, balanced across O/X labels. An admissible opponent should not push the exact player's true expected utility below its certified security value.</p>
          </div>
        </div>
        <div class="nash-toolbar">
          <div id="nash-benchmark-summary" class="muted">Choose the number of paired rounds and run the benchmark.</div>
          <div class="nash-toolbar-actions">
            <div class="nash-rounds-control"><label for="nash-rounds">Paired rounds / matchup</label><input id="nash-rounds" type="number" min="1" max="${MAX_ROUNDS}" step="1" value="${DEFAULT_ROUNDS}" inputmode="numeric"></div>
            <button id="run-nash-benchmark" class="primary-btn">Run Nash benchmark</button>
          </div>
        </div>
        <div class="nash-progress" aria-hidden="true"><i id="nash-progress-bar"></i></div>
        <div id="nash-results"><div class="nash-empty muted">No simulation run yet.</div></div>
        <div class="nash-note muted"><strong>How to read this.</strong> Self-play should converge to the Nash value. Against another admissible strategy, the exact player can do better than the Nash value, but should not do worse in expectation. The Oracle sees the true hidden state, so it violates the game's information structure and is shown only as an out-of-game stress test; the Nash guarantee does not apply to that row.</div>
      </section>`;

    const simulatePage = document.getElementById('page-simulate');
    if (simulatePage?.parentNode) simulatePage.parentNode.insertBefore(page, simulatePage);
    else document.querySelector('main')?.appendChild(page);

    document.getElementById('run-nash-benchmark')?.addEventListener('click', runBenchmark);
    document.getElementById('hidden-picker')?.addEventListener('click', () => setTimeout(refresh, 0));
    window.addEventListener('ttn-lp-artifacts-loaded', refresh);
    refresh();
  }

  function openPage() {
    document.querySelectorAll('.page').forEach((el) => el.classList.toggle('active', el.id === 'page-nash'));
    document.querySelectorAll('.nav-btn[data-page]').forEach((el) => el.classList.toggle('active', el.dataset.page === PAGE_ID));
    window.location.hash = PAGE_ID;
    refresh();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function selectedHidden() {
    return [...document.querySelectorAll('#hidden-picker .picker-cell')]
      .flatMap((cell, index) => cell.classList.contains('selected') ? [index] : []);
  }

  function configuration() {
    const hidden = selectedHidden();
    const rulesO = T.makeRules(hidden, O);
    const rulesX = T.makeRules(hidden, X);
    const artifactO = typeof T.exactLPArtifactForRules === 'function' ? T.exactLPArtifactForRules(rulesO) : null;
    const artifactX = typeof T.exactLPArtifactForRules === 'function' ? T.exactLPArtifactForRules(rulesX) : null;
    return { hidden, rulesO, rulesX, artifactO, artifactX };
  }

  function finite(value, fallback = NaN) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function fmt(value, digits = 4) {
    return Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${value.toFixed(digits)}` : '—';
  }

  function roleValues(cfg) {
    const aO = cfg.artifactO;
    const aX = cfg.artifactX;
    if (!aO || !aX) return null;

    const firstO = finite(aO.valueO);
    const firstX = -finite(aX.valueO);
    const secondX = -finite(aO.valueO);
    const secondO = finite(aX.valueO);

    const firstValue = 0.5 * (firstO + firstX);
    const secondValue = 0.5 * (secondX + secondO);

    const firstFloor = 0.5 * (finite(aO.lowerBoundO, finite(aO.valueO)) - finite(aX.upperBoundO, finite(aX.valueO)));
    const secondFloor = 0.5 * (-finite(aO.upperBoundO, finite(aO.valueO)) + finite(aX.lowerBoundO, finite(aX.valueO)));

    const maxGap = Math.max(Math.abs(finite(aO.dualityGap, 0)), Math.abs(finite(aX.dualityGap, 0)));
    const roleMismatch = Math.max(Math.abs(firstO - firstX), Math.abs(secondX - secondO));
    return { firstO, firstX, secondX, secondO, firstValue, secondValue, firstFloor, secondFloor, maxGap, roleMismatch };
  }

  function refresh() {
    const cfg = configuration();
    const configEl = document.getElementById('nash-config');
    if (configEl) configEl.innerHTML = `Mystery cells <code>${cfg.hidden.map((m) => m + 1).join(', ') || 'none'}</code>`;
    const body = document.getElementById('nash-values-body');
    const button = document.getElementById('run-nash-benchmark');
    if (!body) return;

    const values = roleValues(cfg);
    if (!values) {
      body.innerHTML = `<div class="nash-empty"><strong>Exact artifact unavailable for this layout.</strong><p class="muted">The tab requires certified current-information-model artifacts for both O-opening and X-opening versions of the selected mystery-cell symmetry class. Generate/publish the missing local LP artifacts, or choose a solved layout.</p></div>`;
      if (button) button.disabled = true;
      return;
    }
    if (button) button.disabled = false;

    const symmetryNote = values.roleMismatch <= 1e-9
      ? 'O/X relabeling agrees to numerical tolerance.'
      : `Warning: role-normalized O/X values differ by ${values.roleMismatch.toExponential(2)}.`;

    body.innerHTML = `
      <div class="nash-value-grid">
        <article class="nash-value-card">
          <p class="kicker">FIRST-PLAYER GAME VALUE</p>
          <div class="nash-number">${fmt(values.firstValue)}</div>
          <small>Certified equilibrium expected utility for the player who opens. The second player's equilibrium utility is ${fmt(values.secondValue)} = −v by zero-sum symmetry.</small>
        </article>
      </div>
      <div class="nash-certificate-grid">
        <div class="nash-certificate"><span>First-player security floor</span><strong>${fmt(values.firstFloor)}</strong></div>
        <div class="nash-certificate"><span>Second-player security floor</span><strong>${fmt(values.secondFloor)}</strong></div>
        <div class="nash-certificate"><span>Largest LP duality gap</span><strong>${values.maxGap.toExponential(2)}</strong></div>
        <div class="nash-certificate"><span>Role symmetry check</span><strong>${symmetryNote}</strong></div>
      </div>`;
  }

  function solverFor(rules) {
    const key = `${rules.hiddenMask}|${rules.startPlayer}`;
    if (!solvers.has(key)) solvers.set(key, new T.OutcomeSamplingMCCFR(rules, 0x4e415348 ^ rules.hiddenMask ^ (rules.startPlayer << 12)));
    const solver = solvers.get(key);
    if (solver.iterations < MCCFR_TARGET) solver.train(MCCFR_TARGET - solver.iterations);
    return solver;
  }

  function play(oStrategy, xStrategy, rules, rng) {
    let state = T.makeRoot(rules);
    const beliefs = new T.BeliefTracker(rules);
    const solver = solverFor(rules);
    for (let guard = 0; !T.terminal(state).done && guard < 24; guard++) {
      const actor = state.turn;
      const strategy = actor === O ? oStrategy : xStrategy;
      const move = T.chooseStrategy(strategy, { state, rules, beliefs: beliefs.for(actor), solver, rng });
      const legal = T.legalActions(state, rules, actor);
      if (!legal.includes(move)) throw new Error(`${strategy} returned illegal move ${move}.`);
      const before = state;
      state = T.applyAction(before, rules, move);
      if (!state) throw new Error(`${strategy} produced an invalid transition.`);
      beliefs.advance(before, state);
    }
    const terminal = T.terminal(state);
    if (!terminal.done) throw new Error('Simulation exceeded the finite-horizon guard.');
    return terminal.winner === O ? 1 : terminal.winner === X ? -1 : 0;
  }

  function makeRng(seed) {
    const random = new T.RNG((seed >>> 0) || 1);
    return () => random.next();
  }

  function summarize(samples) {
    const n = samples.length;
    const mean = n ? samples.reduce((a, b) => a + b, 0) / n : NaN;
    if (n < 2) return { n, mean, lo: mean, hi: mean, wins: samples.filter((x) => x === 1).length, draws: samples.filter((x) => x === 0).length, losses: samples.filter((x) => x === -1).length };
    const variance = samples.reduce((sum, x) => sum + ((x - mean) ** 2), 0) / (n - 1);
    const half = 1.96 * Math.sqrt(variance / n);
    return {
      n,
      mean,
      lo: Math.max(-1, mean - half),
      hi: Math.min(1, mean + half),
      wins: samples.filter((x) => x === 1).length,
      draws: samples.filter((x) => x === 0).length,
      losses: samples.filter((x) => x === -1).length
    };
  }

  function statusFor(summary, floor, kind) {
    if (kind === 'oracle') return { cls: 'oracle', text: 'outside guarantee' };
    if (kind === 'self') return { cls: 'self', text: 'self-play' };
    if (summary.hi < floor - 1e-9) return { cls: 'watch', text: 'statistical warning' };
    return { cls: 'good', text: 'consistent with bound' };
  }

  function resultCell(summary, floor) {
    const margin = summary.mean - floor;
    return `<span class="nash-result-main">${fmt(summary.mean, 3)}</span><span class="nash-result-sub">95% CI [${fmt(summary.lo, 3)}, ${fmt(summary.hi, 3)}]</span><span class="nash-result-sub">security ${fmt(floor, 3)} · margin ${fmt(margin, 3)}</span><span class="nash-result-sub">W/D/L ${summary.wins}/${summary.draws}/${summary.losses}</span>`;
  }

  async function benchmarkOpponent(opponentId, rounds, cfg, seed) {
    const first = [];
    const second = [];
    const rng = makeRng(seed);
    for (let round = 0; round < rounds; round++) {
      first.push(play(LP_ID, opponentId, cfg.rulesO, rng));
      first.push(-play(opponentId, LP_ID, cfg.rulesX, rng));
      second.push(-play(opponentId, LP_ID, cfg.rulesO, rng));
      second.push(play(LP_ID, opponentId, cfg.rulesX, rng));
      if (round % 5 === 4) await sleep();
    }
    return { first: summarize(first), second: summarize(second) };
  }

  async function runBenchmark() {
    const cfg = configuration();
    const values = roleValues(cfg);
    const root = document.getElementById('nash-results');
    const button = document.getElementById('run-nash-benchmark');
    const input = document.getElementById('nash-rounds');
    const summaryEl = document.getElementById('nash-benchmark-summary');
    const progress = document.getElementById('nash-progress-bar');
    if (!root || !button || !input || !values) return;

    const rounds = Math.max(1, Math.min(MAX_ROUNDS, Math.floor(Number(input.value) || DEFAULT_ROUNDS)));
    input.value = rounds;

    const others = T.STRATEGIES.filter((strategy) => strategy.sim && strategy.id !== LP_ID);
    const matchups = [{ id: LP_ID, name: 'Exact Nash (self-play)', kind: 'self' }]
      .concat(others.map((strategy) => ({ id: strategy.id, name: strategy.name, kind: strategy.id === 'oracle' ? 'oracle' : 'admissible' })));

    button.disabled = input.disabled = true;
    root.innerHTML = '<div class="nash-empty muted">Preparing strategy references and simulations…</div>';
    if (summaryEl) summaryEl.textContent = `${matchups.length} matchups · ${4 * rounds} games per matchup · ${4 * rounds * matchups.length} games total`;
    if (progress) progress.style.width = '0%';

    const results = [];
    try {
      for (let i = 0; i < matchups.length; i++) {
        const matchup = matchups[i];
        root.innerHTML = `<div class="nash-empty muted">Running ${matchup.name}… ${i}/${matchups.length} matchups complete.</div>`;
        const data = await benchmarkOpponent(matchup.id, rounds, cfg, 0x9e3779b9 ^ (i << 16) ^ rounds ^ cfg.rulesO.hiddenMask);
        results.push({ ...matchup, ...data });
        if (progress) progress.style.width = `${((i + 1) / matchups.length) * 100}%`;
        await sleep();
      }

      root.innerHTML = `<div class="nash-table-wrap"><table class="nash-table">
        <thead><tr><th>Opponent model</th><th>Exact as first player</th><th>Exact as second player</th><th>Interpretation</th></tr></thead>
        <tbody>${results.map((row) => {
          const firstStatus = statusFor(row.first, values.firstFloor, row.kind);
          const secondStatus = statusFor(row.second, values.secondFloor, row.kind);
          const status = row.kind === 'oracle'
            ? firstStatus
            : (firstStatus.cls === 'watch' || secondStatus.cls === 'watch') ? { cls: 'watch', text: 'inspect sampling/model' }
              : row.kind === 'self' ? { cls: 'self', text: 'tracks equilibrium' }
                : { cls: 'good', text: 'security bound holds' };
          return `<tr><td><strong>${row.name}</strong>${row.kind === 'oracle' ? '<span class="nash-result-sub">omniscient benchmark; not an admissible game strategy</span>' : ''}</td><td>${resultCell(row.first, values.firstFloor)}</td><td>${resultCell(row.second, values.secondFloor)}</td><td><span class="nash-status ${status.cls}">${status.text}</span></td></tr>`;
        }).join('')}</tbody>
      </table></div>
      <p class="muted" style="margin-top:14px">Each matchup uses ${rounds} paired rounds for each role: O-open and X-open are both tested, giving ${4 * rounds} games per row. Confidence intervals are normal-approximation 95% intervals over exact-player utility. They are diagnostic only; the LP certificate, not the Monte Carlo estimate, is the equilibrium guarantee.</p>`;
    } catch (error) {
      console.error(error);
      root.innerHTML = `<div class="nash-empty"><strong>Benchmark stopped.</strong><p class="muted">${String(error?.message || error)}</p></div>`;
    } finally {
      button.disabled = input.disabled = false;
    }
  }

  installPage();
  window.TTNNashBenchmark = { openPage, refresh, runBenchmark };
})(window);