(function () {
  'use strict';

  const T = window.TTNTheory;
  if (!T) return;

  const ID = 'lp';
  const NAME = 'Exact Nash (Sequence-Form LP)';
  const DETAIL_URL = './strategy-lp.html';
  const MANIFEST_URL = './equilibria/manifest.json';
  const CERTIFICATE_TOLERANCE = 1e-7;
  const artifacts = new Map();
  let manifest = { artifacts: [] };
  let symmetryMap = { masks: {} };

  const lpStrategy = { id: ID, name: NAME, family: 'Certified sequence-form equilibrium', play: true, sim: false };
  if (!T.STRATEGIES.some((s) => s.id === ID)) T.STRATEGIES.splice(1, 0, lpStrategy);

  function symbol(player) {
    if (player === T.O) return 'O';
    if (player === T.X) return 'X';
    throw new Error(`Exact LP received invalid player id ${player}.`);
  }

  function configKey(mask, startPlayer) { return `${Number(mask)}|${symbol(startPlayer)}`; }

  function currentModelArtifact(value) {
    const gap = Number(value?.dualityGap);
    const rawExploitabilityGap = value?.certificate?.exploitabilityGap;
    const exploitabilityGap = rawExploitabilityGap === undefined ? null : Number(rawExploitabilityGap);
    return Boolean(
      value
      && value.schema === 2
      && value.numericallySolved === true
      && value.informationModel === T.INFORMATION_MODEL
      && Number.isFinite(gap)
      && gap >= -CERTIFICATE_TOLERANCE
      && gap <= CERTIFICATE_TOLERANCE
      && (exploitabilityGap === null || (
        Number.isFinite(exploitabilityGap)
        && exploitabilityGap >= -CERTIFICATE_TOLERANCE
        && exploitabilityGap <= CERTIFICATE_TOLERANCE
      ))
      && value.policy
      && typeof value.policy.O === 'object'
      && typeof value.policy.X === 'object'
    );
  }

  function validTransform(value) {
    return Array.isArray(value)
      && value.length === 9
      && value.every((move) => Number.isInteger(move) && move >= 0 && move < 9)
      && new Set(value).size === 9;
  }

  function symmetryForMask(mask) {
    const rawMask = Number(mask);
    const entry = symmetryMap?.masks?.[String(rawMask)];
    if (
      !entry
      || !Number.isInteger(Number(entry.canonicalMask))
      || !validTransform(entry.toCanonical)
      || !validTransform(entry.fromCanonical)
    ) {
      return null;
    }
    return {
      canonicalMask: Number(entry.canonicalMask),
      toCanonical: entry.toCanonical.map(Number),
      fromCanonical: entry.fromCanonical.map(Number),
      transform: entry.transform || 'unknown'
    };
  }

  function transformObservation(observation, transform) {
    if (!observation) return '';
    let cursor = 0;
    let transformed = '';
    while (cursor < observation.length) {
      if (observation.startsWith('H;', cursor)) {
        transformed += 'H;';
        cursor += 2;
        continue;
      }
      if (observation[cursor] === 'P') {
        const move = Number(observation[cursor + 1]);
        if (!Number.isInteger(move) || observation[cursor + 2] !== ';') {
          throw new Error(`Exact LP could not parse private observation ${observation}.`);
        }
        transformed += `P${transform[move]};`;
        cursor += 3;
        continue;
      }
      if (observation[cursor] === 'V') {
        const actor = Number(observation[cursor + 1]);
        const move = Number(observation[cursor + 2]);
        if ((actor !== T.O && actor !== T.X) || !Number.isInteger(move) || observation[cursor + 3] !== ';') {
          throw new Error(`Exact LP could not parse visible observation ${observation}.`);
        }
        transformed += `V${actor}${transform[move]};`;
        cursor += 4;
        continue;
      }
      throw new Error(`Exact LP encountered unknown observation token in ${observation}.`);
    }
    return transformed;
  }

  function canonicalInformationKey(state, rules, player, symmetry) {
    if (!symmetry) throw new Error(`Exact LP symmetry mapping is unavailable for mask ${rules.hiddenMask}.`);
    const rawKey = T.informationKey(state, rules, player);
    const parts = rawKey.split('|');
    if (parts.length !== 4) throw new Error(`Exact LP received malformed information key ${rawKey}.`);
    const transformedObservation = transformObservation(parts[3], symmetry.toCanonical);
    return `${parts[0]}|${parts[1]}|${symmetry.canonicalMask}|${transformedObservation}`;
  }

  function selectedConfiguration() {
    let mask = 0;
    document.querySelectorAll('#hidden-picker .picker-cell.selected').forEach((cell) => {
      const move = Number.parseInt(cell.textContent, 10) - 1;
      if (Number.isInteger(move) && move >= 0 && move < 9) mask |= (1 << move);
    });
    const opponentOpens = document.querySelector('[data-order="second"]')?.classList.contains('active');
    return { mask, startPlayer: opponentOpens ? T.X : T.O };
  }

  function artifactForRules(rules) {
    const symmetry = symmetryForMask(rules.hiddenMask);
    if (!symmetry) return null;
    const artifact = artifacts.get(configKey(symmetry.canonicalMask, rules.startPlayer)) || null;
    return currentModelArtifact(artifact) ? artifact : null;
  }

  function exactPolicy(state, rules) {
    const symmetry = symmetryForMask(rules.hiddenMask);
    if (!symmetry) {
      throw new Error(`Exact Nash unavailable: no valid symmetry mapping for hidden mask ${rules.hiddenMask}.`);
    }
    const artifact = artifacts.get(configKey(symmetry.canonicalMask, rules.startPlayer)) || null;
    if (!currentModelArtifact(artifact)) {
      throw new Error(
        `Exact Nash unavailable: no certified LP artifact for mask ${symmetry.canonicalMask}, `
        + `start ${symbol(rules.startPlayer)}.`
      );
    }

    const player = state.turn;
    const key = canonicalInformationKey(state, rules, player, symmetry);
    const table = artifact.policy[symbol(player)]?.[key];
    if (!table || typeof table !== 'object') {
      throw new Error(
        `Exact Nash policy lookup failed for ${symbol(player)} at information set ${key}. `
        + 'Refusing to substitute another policy.'
      );
    }

    const legal = T.legalActions(state, rules, player);
    if (!legal.length) throw new Error(`Exact Nash policy requested at terminal/no-action information set ${key}.`);

    // Policies are sparse: an absent legal action means exact probability zero.
    // Stored entries themselves must be finite and nonnegative; malformed data is fatal.
    const policy = legal.map((move) => {
      const canonicalMove = symmetry.toCanonical[move];
      const stored = table[String(canonicalMove)];
      if (stored === undefined) return { move, prob: 0 };
      const probability = Number(stored);
      if (!Number.isFinite(probability) || probability < 0) {
        throw new Error(`Exact Nash artifact has invalid probability ${stored} for move ${canonicalMove} at ${key}.`);
      }
      return { move, prob: probability };
    });
    const total = policy.reduce((sum, item) => sum + item.prob, 0);
    if (!Number.isFinite(total) || !(total > 0)) {
      throw new Error(
        `Exact Nash artifact has zero/invalid probability mass over legal actions at ${key}. `
        + 'Refusing to fall back to uniform play.'
      );
    }
    return policy.map((item) => ({ ...item, prob: item.prob / total }));
  }

  function sample(policy, rng = Math.random) {
    if (!policy.length) throw new Error('Exact Nash cannot sample an empty policy.');
    let draw = rng();
    if (!Number.isFinite(draw) || draw < 0 || draw >= 1) {
      throw new Error(`Exact Nash RNG returned invalid draw ${draw}.`);
    }
    for (const item of policy) {
      draw -= item.prob;
      if (draw <= 0) return item.move;
    }
    // Normalization can leave only floating-point roundoff after the final item.
    return policy[policy.length - 1].move;
  }

  const originalChoose = T.chooseStrategy;
  T.chooseStrategy = function chooseWithExactLP(id, context) {
    if (id !== ID) return originalChoose(id, context);
    return sample(exactPolicy(context.state, context.rules), context.rng || Math.random);
  };

  const originalEvaluate = T.evaluateStrategy;
  T.evaluateStrategy = function evaluateWithExactLP(id, context, options = {}) {
    if (id !== ID) return originalEvaluate(id, context, options);
    const artifact = artifactForRules(context.rules);
    if (!artifact) {
      return {
        id: ID, name: NAME, metric: 'unavailable', metricLabel: 'Exact artifact unavailable',
        scaleLabel: 'local solve required', rows: [], policy: [], bestMove: null, worlds: [],
        detail: 'No certified full-game sequence-form artifact for the current information model is loaded for this configuration.'
      };
    }
    let policy;
    try {
      policy = exactPolicy(context.state, context.rules);
    } catch (error) {
      return {
        id: ID, name: NAME, metric: 'error', metricLabel: 'Exact policy integrity error',
        scaleLabel: 'no fallback allowed', rows: [], policy: [], bestMove: null, worlds: [],
        detail: String(error?.message || error)
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
  T.exactLPSymmetryForMask = symmetryForMask;
  T.exactLPCanonicalInformationKey = canonicalInformationKey;

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
    const available = Boolean(artifactForRules({ hiddenMask: cfg.mask, startPlayer: cfg.startPlayer }));
    for (const id of ['ai-strategy', 'decision-strategy']) {
      const select = document.getElementById(id);
      if (!select) continue;
      const option = optionFor(select);
      option.disabled = !available;
      option.textContent = available
        ? `${NAME} · locally solved static policy`
        : `${NAME} · current-model local artifact not published`;
    }
    const note = document.getElementById('lp-online-status');
    if (note) {
      note.textContent = available
        ? 'A current-model LP policy generated locally is loaded for the selected mystery cells and turn order. Symmetric board configurations reuse the corresponding canonical artifact. The browser only performs a static policy lookup; it never solves an LP.'
        : 'No current-model LP artifact is published for this mystery-cell symmetry class / starting-player configuration. Exact Nash is unavailable; no substitute strategy will be used.';
    }
  }

  async function loadArtifacts() {
    artifacts.clear();
    try {
      const response = await fetch(MANIFEST_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`manifest HTTP ${response.status}`);
      manifest = await response.json();

      const symmetryPath = typeof manifest.symmetryMap === 'string' && manifest.symmetryMap
        ? manifest.symmetryMap
        : 'symmetry-map.json';
      try {
        const symmetryResponse = await fetch(`./equilibria/${symmetryPath}`, { cache: 'no-store' });
        if (!symmetryResponse.ok) throw new Error(`HTTP ${symmetryResponse.status}`);
        const loadedSymmetry = await symmetryResponse.json();
        if (!loadedSymmetry || typeof loadedSymmetry.masks !== 'object') throw new Error('invalid symmetry-map payload');
        symmetryMap = loadedSymmetry;
      } catch (error) {
        console.error('Exact LP symmetry map unavailable; Exact Nash is disabled.', error);
        symmetryMap = { masks: {} };
      }

      const entries = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
      const compatibleEntries = entries.filter((entry) => entry.informationModel === T.INFORMATION_MODEL);
      await Promise.all(compatibleEntries.map(async (entry) => {
        try {
          const result = await fetch(`./equilibria/${entry.file}`, { cache: 'no-store' });
          if (!result.ok) throw new Error(`HTTP ${result.status}`);
          const artifact = await result.json();
          if (!currentModelArtifact(artifact)) {
            throw new Error('artifact is stale, uncertified, or failed certificate validation');
          }
          if (
            Number(artifact.hiddenMask) !== Number(entry.hiddenMask)
            || artifact.startPlayer !== entry.startPlayer
            || artifact.informationModel !== entry.informationModel
          ) {
            throw new Error('artifact metadata does not match its manifest entry');
          }
          const startPlayer = artifact.startPlayer === 'O' ? T.O : artifact.startPlayer === 'X' ? T.X : null;
          if (startPlayer === null) throw new Error(`invalid startPlayer ${artifact.startPlayer}`);
          const key = configKey(artifact.hiddenMask, startPlayer);
          if (artifacts.has(key)) throw new Error(`duplicate exact artifact for ${key}`);
          artifacts.set(key, artifact);
        } catch (error) {
          console.error('Failed to load certified Exact Nash artifact', entry, error);
        }
      }));
      if (entries.length !== compatibleEntries.length) {
        console.info(`Ignored ${entries.length - compatibleEntries.length} LP manifest entries from an older information model.`);
      }
    } catch (error) {
      console.error('Exact LP manifest unavailable; Exact Nash is disabled.', error);
      manifest = { artifacts: [] };
      symmetryMap = { masks: {} };
      artifacts.clear();
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
      <p class="strategy-doc-meta">Sequence-form linear programming · solved locally, served as static data</p>
      <p class="strategy-verdict">The exact Nash benchmark is solved locally once per board-symmetry class. Deployment and browser play only serve and query the resulting policy table; neither path runs the LP solver.</p></header>
      <h3>How it works on the site</h3>
      <p>The expensive step is the full sparse LP solve, run explicitly on a local machine. That solve exports a behavioral policy table and its certificate. GitHub Pages can serve the resulting JSON. During a game the browser maps the selected board to its canonical symmetry representative, transforms the current information key, reads <code>σ*(a|I)</code>, maps the action probabilities back to the displayed board, and samples one action. There is no deployment-time or browser-side LP solve.</p>
      <pre class="strategy-doc-formula"><code>local:   max fᵀp  s.t. Ex=e, x≥0, Fᵀp≤Aᵀx\nsite:    raw I → canonical I → σ*(·|I) → raw action</code></pre>
      <h3>Theoretical guarantee</h3>
      <p>If the complete unabstracted game was encoded correctly and both LPs solved to optimality, the published realization plans are a minimax/Nash equilibrium up to numerical LP tolerance. Board rotations/reflections are exact game isomorphisms, so a canonical policy remains an equilibrium after the corresponding action and observation relabeling. The artifact records the O lower bound, O upper bound, duality gap, and information-model identifier.</p>
      <p><strong>Availability rule.</strong> The website enables this strategy only when the selected mystery-cell configuration maps to a certified canonical artifact for the same starting player and information model. Missing policy keys, malformed probability mass, missing symmetry data, or failed certificates are hard errors. The site never substitutes random play, MCCFR, or another Nash strategy under the Exact Nash name.</p>
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
      <p class="muted">Current-model LP artifacts are generated locally and may be published with the static site. One solved canonical board covers every rotationally/reflection-equivalent mystery-cell layout. When the current setup has one, the exact strategy is enabled in Play and its local equilibrium probabilities appear in Analysis. Deployment never runs the LP solver.</p></div>
      <div class="analysis-training-metrics"><span>Mode <strong>local solve → static symmetry lookup</strong></span><a class="secondary-btn compact" href="${DETAIL_URL}">Theory & guarantees</a></div>`;
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
