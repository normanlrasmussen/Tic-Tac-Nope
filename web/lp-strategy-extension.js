(function () {
  'use strict';

  const T = window.TTNTheory;
  if (!T) return;

  const ID = 'lp';
  const NAME = 'Exact Nash (Sequence-Form LP)';
  const DETAIL_URL = './strategy-lp.html';
  const MANIFEST_URL = './equilibria/manifest.json';
  const artifacts = new Map();
  let manifest = { artifacts: [] };

  const lpStrategy = { id: ID, name: NAME, family: 'Certified sequence-form equilibrium', play: true, sim: false };
  if (!T.STRATEGIES.some((s) => s.id === ID)) T.STRATEGIES.splice(1, 0, lpStrategy);

  function symbol(player) { return player === T.O ? 'O' : 'X'; }
  function configKey(mask, startPlayer) { return `${Number(mask)}|${symbol(startPlayer)}`; }

  function selectedConfiguration() {
    let mask = 0;
    document.querySelectorAll('#hidden-picker .picker-cell.selected').forEach((cell, index) => {
      // Picker cells are rendered in board order and remain in the DOM in that order.
      mask |= (1 << index);
    });
    const opponentOpens = document.querySelector('[data-order="second"]')?.classList.contains('active');
    return { mask, startPlayer: opponentOpens ? T.X : T.O };
  }

  function artifactForRules(rules) {
    return artifacts.get(configKey(rules.hiddenMask, rules.startPlayer)) || null;
  }

  function exactPolicy(state, rules) {
    const artifact = artifactForRules(rules);
    if (!artifact || !artifact.numericallySolved) return [];
    const player = state.turn;
    const key = T.informationKey(state, rules, player);
    const table = artifact.policy?.[symbol(player)]?.[key];
    const legal = T.legalActions(state, rules, player);
    if (!table) {
      // Exported artifacts intentionally omit zero-own-reach information sets.
      // Such a state cannot be reached while this player follows its realization plan.
      return legal.map((move) => ({ move, prob: 1 / Math.max(1, legal.length) }));
    }
    const policy = legal.map((move) => ({ move, prob: Math.max(0, Number(table[String(move)]) || 0) }));
    const total = policy.reduce((sum, item) => sum + item.prob, 0);
    if (!(total > 0)) return legal.map((move) => ({ move, prob: 1 / Math.max(1, legal.length) }));
    return policy.map((item) => ({ ...item, prob: item.prob / total }));
  }

  function sample(policy, rng = Math.random) {
    if (!policy.length) return null;
    let draw = rng();
    for (const item of policy) {
      draw -= item.prob;
      if (draw <= 0) return item.move;
    }
    return policy[policy.length - 1].move;
  }

  const originalChoose = T.chooseStrategy;
  T.chooseStrategy = function chooseWithExactLP(id, context) {
    if (id !== ID) return originalChoose(id, context);
    const policy = exactPolicy(context.state, context.rules);
    if (!policy.length) throw new Error('No certified sequence-form LP artifact is loaded for this game configuration.');
    return sample(policy, context.rng || Math.random);
  };

  const originalEvaluate = T.evaluateStrategy;
  T.evaluateStrategy = function evaluateWithExactLP(id, context, options = {}) {
    if (id !== ID) return originalEvaluate(id, context, options);
    const artifact = artifactForRules(context.rules);
    const policy = exactPolicy(context.state, context.rules);
    if (!artifact || !policy.length) {
      return {
        id: ID, name: NAME, metric: 'unavailable', metricLabel: 'Exact artifact unavailable',
        scaleLabel: 'offline solve required', rows: [], policy: [], bestMove: null, worlds: [],
        detail: 'No certified full-game sequence-form artifact is loaded for this configuration.'
      };
    }
    const rows = policy.map((item) => ({ move: item.move, score: item.prob, scaled: item.prob }))
      .sort((a, b) => b.score - a.score || a.move - b.move);
    return {
      id: ID,
      name: NAME,
      metric: 'probability',
      metricLabel: 'Exact equilibrium action probability',
      scaleLabel: '0% never · 100% always',
      rows,
      policy,
      bestMove: rows[0]?.move ?? null,
      worlds: [],
      detail: `Certified sequence-form policy · O value ${Number(artifact.valueO).toFixed(6)} · duality gap ${Number(artifact.dualityGap).toExponential(2)}`
    };
  };

  T.exactLPPolicy = exactPolicy;
  T.exactLPArtifactForRules = artifactForRules;

  function optionFor(select) {
    let option = select.querySelector('option[value="lp"]');
    if (!option) {
      option = document.createElement('option');
      option.value = ID;
      select.insertBefore(option, select.options[1] || null);
    }
    return option;
  }

  function refreshSelectors() {
    const cfg = selectedConfiguration();
    const available = artifacts.has(configKey(cfg.mask, cfg.startPlayer));
    for (const id of ['ai-strategy', 'decision-strategy']) {
      const select = document.getElementById(id);
      if (!select) continue;
      const option = optionFor(select);
      option.disabled = !available;
      option.textContent = available
        ? `${NAME} · certified online policy`
        : `${NAME} · exact artifact not generated for this setup`;
      if (!available && select.value === ID) {
        select.value = 'nash';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    const note = document.getElementById('lp-online-status');
    if (note) {
      note.textContent = available
        ? 'Certified exact LP policy loaded for the selected mystery cells and turn order. It is playable online by direct policy lookup.'
        : 'No certified LP artifact is currently published for this exact mystery-cell / starting-player configuration.';
    }
  }

  async function loadArtifacts() {
    try {
      const response = await fetch(MANIFEST_URL, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`manifest HTTP ${response.status}`);
      manifest = await response.json();
      const entries = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
      await Promise.all(entries.map(async (entry) => {
        try {
          const result = await fetch(`./equilibria/${entry.file}`, { cache: 'force-cache' });
          if (!result.ok) throw new Error(`HTTP ${result.status}`);
          const artifact = await result.json();
          if (!artifact.numericallySolved) return;
          artifacts.set(configKey(artifact.hiddenMask, artifact.startPlayer === 'O' ? T.O : T.X), artifact);
        } catch (error) {
          console.warn('Failed to load exact LP artifact', entry, error);
        }
      }));
    } catch (error) {
      console.warn('Exact LP manifest unavailable', error);
    }
    refreshSelectors();
    window.dispatchEvent(new CustomEvent('ttn-lp-artifacts-loaded', { detail: { count: artifacts.size } }));
  }

  function addStrategySection() {
    const root = document.getElementById('strategy-cards');
    if (!root || document.getElementById('strategy-lp')) return;
    const section = document.createElement('section');
    section.id = 'strategy-lp';
    section.className = 'strategy-doc-section';
    section.innerHTML = `
      <header><p class="strategy-section-number">LP · CERTIFIED EQUILIBRIUM</p><h2>${NAME}</h2>
      <p class="strategy-doc-meta">Sequence-form linear programming · Playable online when a certified artifact exists</p>
      <p class="strategy-verdict">The exact Nash benchmark is solved offline once, then the website plays it online with instantaneous information-set policy lookups.</p></header>
      <h3>How it works online</h3>
      <p>The expensive step is the full sparse LP solve. That solve exports a compact behavioral policy table and its certificate. GitHub Pages serves the resulting JSON. During a game the browser computes the current information key, reads <code>σ*(a|I)</code>, and samples one action. No approximation or browser-side re-solving is introduced.</p>
      <pre class="strategy-doc-formula"><code>offline:  max fᵀp  s.t. Ex=e, x≥0, Fᵀp≤Aᵀx
online:   a ~ σ*(·|I)</code></pre>
      <h3>Theoretical guarantee</h3>
      <p>If the complete unabstracted game was encoded correctly and both LPs solved to optimality, the published realization plans are a minimax/Nash equilibrium up to numerical LP tolerance. The artifact records the O lower bound, O upper bound, and their duality gap.</p>
      <p><strong>Availability rule.</strong> The website enables this strategy only when the exact selected mystery-cell configuration and starting player have a matching certified artifact. It never substitutes MCCFR under the LP name.</p>
      <p id="lp-online-status">Checking published exact-policy artifacts…</p>
      <p><a class="secondary-btn compact" href="${DETAIL_URL}">Full LP theory & guarantees</a></p>`;
    const closing = document.getElementById('strategy-interpretation');
    if (closing) root.insertBefore(section, closing); else root.appendChild(section);
    const toc = root.querySelector('.strategy-toc');
    if (toc && !toc.querySelector('a[href="#strategy-lp"]')) {
      const link = document.createElement('a'); link.href = '#strategy-lp'; link.textContent = NAME; toc.appendChild(link);
    }
  }

  function addAnalysisBenchmarkPanel() {
    const section = document.querySelector('#page-analysis .analysis-strategy-section');
    if (!section || document.getElementById('lp-analysis-benchmark')) return;
    const panel = document.createElement('section');
    panel.id = 'lp-analysis-benchmark';
    panel.className = 'panel analysis-training-panel';
    panel.innerHTML = `<div class="analysis-training-copy"><p class="kicker">EXACT EQUILIBRIUM BENCHMARK</p><h2>${NAME}</h2>
      <p class="muted">Certified LP artifacts are precomputed and published with the static site. When the current setup has one, the exact strategy is enabled in Play and its local equilibrium probabilities appear in Analysis.</p></div>
      <div class="analysis-training-metrics"><span>Mode <strong>precomputed exact policy</strong></span><a class="secondary-btn compact" href="${DETAIL_URL}">Theory & guarantees</a></div>`;
    section.parentNode.insertBefore(panel, section);
  }

  addStrategySection();
  addAnalysisBenchmarkPanel();
  refreshSelectors();
  document.getElementById('hidden-picker')?.addEventListener('click', () => setTimeout(refreshSelectors, 0));
  document.getElementById('turn-order')?.addEventListener('click', () => setTimeout(refreshSelectors, 0));
  document.getElementById('new-game')?.addEventListener('click', () => setTimeout(refreshSelectors, 0));
  loadArtifacts();
})();