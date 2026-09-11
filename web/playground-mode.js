(function (global) {
  'use strict';

  const T = global.TTNTheory;
  if (!T) return;
  const { O, X } = T;
  const ALL_ID = 'all';
  const LIVE_TRAINING_TARGET = 15000;
  const $ = (id) => document.getElementById(id);

  let installed = false;
  let hidden = new Set([1, 3]);
  let startPlayer = O;
  let selectedStrategy = ALL_ID;
  let rules = T.makeRules([...hidden], startPlayer);
  let state = T.makeRoot(rules);
  let tracker = new T.BeliefTracker(rules);
  const solverCache = new Map();

  function symbol(player) { return T.symbol(player) || (player === O ? 'O' : player === X ? 'X' : ''); }
  function isHidden(move) { return Boolean(rules.hiddenMask & T.bit(move)); }
  function rulesKey(r = rules) { return `${r.hiddenMask}|${r.startPlayer}`; }
  function solverFor(r = rules) {
    const key = rulesKey(r);
    if (!solverCache.has(key)) solverCache.set(key, new T.OutcomeSamplingMCCFR(r, 20260911));
    return solverCache.get(key);
  }
  function ensureSolver(target = LIVE_TRAINING_TARGET) {
    const solver = solverFor();
    if (solver.iterations < target) solver.train(target - solver.iterations);
    return solver;
  }
  function hashString(text) {
    let hash = 2166136261 >>> 0;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash || 1;
  }
  function seededRandom(key) {
    const rng = new T.RNG(hashString(key));
    return () => rng.next();
  }
  function beliefSignature(worlds) {
    return worlds.map((world) => T.stateKey(world)).sort().join('~');
  }

  function installStyles() {
    if ($('playground-mode-style')) return;
    const style = document.createElement('style');
    style.id = 'playground-mode-style';
    style.textContent = `
      #playground-play-shell{margin-top:18px}
      .playground-layout{display:grid;grid-template-columns:minmax(250px,330px) minmax(360px,1fr);gap:18px;align-items:start}
      .playground-analysis{margin-top:18px}
      .playground-board{display:grid;grid-template-columns:repeat(3,minmax(82px,1fr));gap:8px;max-width:520px;margin:18px auto}
      .playground-cell{position:relative;aspect-ratio:1;border:1px solid var(--line,#d8d4ca);border-radius:14px;background:var(--paper,#fff);font:700 clamp(2rem,6vw,4rem)/1 inherit;cursor:pointer}
      .playground-cell:disabled{cursor:default;opacity:.72}
      .playground-cell.mystery::after{content:'?';position:absolute;right:8px;top:6px;font-size:.75rem;font-weight:800;opacity:.42}
      .playground-cell.o{color:var(--o-color,#b14b37)}
      .playground-cell.x{color:var(--x-color,#315e77)}
      .playground-cell.fog{font-size:2rem}
      .playground-cell.best{outline:3px solid currentColor;outline-offset:-4px}
      .playground-recommendation-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
      .playground-strategy-card{border:1px solid var(--line,#d8d4ca);border-radius:16px;padding:14px;background:var(--paper,#fff);min-width:0}
      .playground-strategy-card.featured{border-width:2px}
      .playground-strategy-card header{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:10px}
      .playground-strategy-card h3{margin:2px 0 0;font-size:1.05rem}
      .playground-score-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}
      .playground-score-cell{position:relative;min-height:64px;border:1px solid var(--line,#d8d4ca);border-radius:10px;padding:6px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center}
      .playground-score-cell.best{outline:2px solid currentColor;outline-offset:-3px}
      .playground-score-cell .idx{position:absolute;top:4px;left:6px;font-size:.68rem;opacity:.5}
      .playground-score-cell b{font-size:1.05rem}.playground-score-cell small{font-size:.68rem;opacity:.7}
      .playground-summary{margin-top:9px;font-size:.88rem}
      .playground-oracle-note{font-size:.8rem;margin:8px 0;padding:8px;border-radius:8px;background:rgba(180,120,40,.10)}
      @media(max-width:900px){.playground-layout{grid-template-columns:1fr}.playground-recommendation-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function injectUi() {
    const modeGrid = $('play-mode-grid');
    if (modeGrid && !modeGrid.querySelector('[data-play-mode="playground"]')) {
      const button = document.createElement('button');
      button.className = 'play-mode-card';
      button.dataset.playMode = 'playground';
      button.innerHTML = '<span>PG</span><div><strong>Playground</strong><small>Control both sides + strategy advice</small></div>';
      modeGrid.appendChild(button);
    }

    const playPage = $('page-play');
    if (!playPage || $('playground-play-shell')) return;
    const shell = document.createElement('div');
    shell.id = 'playground-play-shell';
    shell.hidden = true;
    shell.innerHTML = `
      <div class="playground-layout">
        <aside class="panel setup-panel">
          <div class="panel-heading"><div><p class="kicker">PLAYGROUND</p><h2>Build the game yourself</h2></div><span id="playground-hidden-count" class="pill">2 hidden</span></div>
          <label class="field-label" for="playground-strategy">Recommendation strategy</label>
          <select id="playground-strategy" class="strategy-select"></select>
          <p class="setup-note">You make every move for both O and X. Recommendations use the current player's information set.</p>
          <div class="field-label row-label"><span>Who opens?</span><small>you control both</small></div>
          <div class="segmented" role="group" aria-label="Choose Playground starting player">
            <button class="segment active" data-playground-order="O"><strong>O first</strong><small>O opens</small></button>
            <button class="segment" data-playground-order="X"><strong>X first</strong><small>X opens</small></button>
          </div>
          <div class="field-label row-label"><span>Mystery cells</span><small>choose at least 2</small></div>
          <div id="playground-hidden-picker" class="hidden-picker" aria-label="Choose Playground mystery cells"></div>
          <button id="playground-new-game" class="primary-btn">Reset playground</button>
        </aside>

        <section class="panel board-panel">
          <div class="game-status-row"><div><p class="kicker">MANUAL GAME</p><h2 id="playground-status-title">O to move</h2><p id="playground-status-detail">Choose any legal move for O.</p></div><div class="turn-token"><span id="playground-turn-symbol">O</span><small>turn</small></div></div>
          <div id="playground-board" class="playground-board" role="grid" aria-label="Playground Tic-Tac-Nope board"></div>
          <div class="legend"><span><i class="dot you"></i>O</span><span><i class="dot ai"></i>X</span><span><i class="dot fog"></i>Mystery cell</span></div>
          <div id="playground-message" class="move-message" aria-live="polite">Choose a move. You control both players.</div>
        </section>
      </div>

      <section class="panel playground-analysis">
        <div class="panel-heading decision-map-heading">
          <div><p class="kicker">STRATEGY RECOMMENDATION</p><h2 id="playground-analysis-title">What should O do?</h2></div>
          <span id="playground-world-count" class="pill">1 compatible state</span>
        </div>
        <p id="playground-analysis-summary" class="muted">Recommendations are recomputed after every move.</p>
        <div id="playground-recommendations"></div>
      </section>`;
    playPage.appendChild(shell);
  }

  function populateStrategySelect() {
    const select = $('playground-strategy');
    if (!select) return;
    const strategies = [...T.STRATEGIES].filter((strategy) => strategy.play || strategy.sim);
    select.innerHTML = `<option value="${ALL_ID}">All · compare every strategy</option>` + strategies
      .map((strategy) => `<option value="${strategy.id}">${strategy.name} · ${strategy.family}</option>`)
      .join('');
    if ([...select.options].some((option) => option.value === selectedStrategy)) select.value = selectedStrategy;
  }

  function renderPicker() {
    const root = $('playground-hidden-picker');
    if (!root) return;
    root.innerHTML = '';
    for (let move = 0; move < 9; move++) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `picker-cell${hidden.has(move) ? ' selected' : ''}`;
      button.textContent = String(move + 1);
      button.setAttribute('aria-pressed', hidden.has(move) ? 'true' : 'false');
      button.addEventListener('click', () => {
        if (hidden.has(move) && hidden.size <= 2) {
          $('playground-message').textContent = 'Keep at least two mystery cells.';
          return;
        }
        if (hidden.has(move)) hidden.delete(move); else hidden.add(move);
        renderPicker();
        $('playground-message').textContent = 'Reset the playground to apply the mystery-cell change.';
      });
      root.appendChild(button);
    }
    $('playground-hidden-count').textContent = `${hidden.size} hidden`;
  }

  function currentWorlds() { return tracker.for(state.turn); }

  function observedCell(move, revealTruth = false) {
    const actual = T.boardArray(state)[move];
    if (revealTruth || !isHidden(move)) {
      return { text: symbol(actual), cls: actual === O ? 'o' : actual === X ? 'x' : '' };
    }
    const values = new Set(currentWorlds().map((world) => T.boardArray(world)[move]));
    if (values.size === 1) {
      const value = [...values][0];
      return { text: symbol(value) || '·', cls: value === O ? 'o' : value === X ? 'x' : '' };
    }
    return { text: '?', cls: 'fog' };
  }

  function formatScore(evaluation, score) {
    if (!Number.isFinite(Number(score))) return '—';
    if (evaluation?.metric === 'probability') return `${(100 * Number(score)).toFixed(Number(score) >= 0.1 ? 0 : 1)}%`;
    if (evaluation?.metric === 'utility') return `${Number(score) > 0 ? '+' : ''}${Number(score).toFixed(2)}`;
    return Number(score).toFixed(2);
  }

  function bestMoves(evaluation) {
    if (Array.isArray(evaluation?.bestMoves) && evaluation.bestMoves.length) return evaluation.bestMoves;
    if (Number.isInteger(evaluation?.bestMove)) return [evaluation.bestMove];
    const rows = (evaluation?.rows || []).filter((row) => Number.isFinite(Number(row.score)));
    if (!rows.length) return [];
    const best = Math.max(...rows.map((row) => Number(row.score)));
    const tol = 1e-9 * Math.max(1, Math.abs(best));
    return rows.filter((row) => Math.abs(Number(row.score) - best) <= tol).map((row) => row.move);
  }

  function evaluationFor(strategyId) {
    if (T.terminal(state).done) return null;
    const worlds = currentWorlds();
    const solver = T.strategyUsesRegretPolicy?.(strategyId) ? ensureSolver() : solverFor();
    const key = [strategyId, rulesKey(), T.informationKey(state, rules, state.turn), beliefSignature(worlds), solver.iterations].join('|');
    return T.evaluateStrategy(strategyId, {
      state,
      rules,
      beliefs: worlds,
      solver,
      rng: seededRandom(`playground|${key}`)
    }, {
      rolloutBudget: T.RESEARCH_CONFIG?.beliefRolloutTarget || 72,
      trainingTarget: Math.max(LIVE_TRAINING_TARGET, solver.iterations)
    });
  }

  function scoreGridHtml(evaluation) {
    const rows = new Map((evaluation?.rows || []).map((row) => [row.move, row]));
    const best = new Set(bestMoves(evaluation));
    return Array.from({ length: 9 }, (_, move) => {
      const display = observedCell(move);
      const row = rows.get(move);
      const classes = ['playground-score-cell'];
      if (best.has(move) && row) classes.push('best');
      if (isHidden(move)) classes.push('mystery');
      return `<div class="${classes.join(' ')}"><span class="idx">${move + 1}</span><b>${display.text}</b>${row ? `<strong>${formatScore(evaluation, row.score)}</strong><small>${evaluation.metricLabel || evaluation.metric || 'score'}</small>` : ''}</div>`;
    }).join('');
  }

  function strategyCard(strategy) {
    try {
      const evaluation = evaluationFor(strategy.id);
      const moves = bestMoves(evaluation);
      const recommendation = moves.length === 0 ? 'No legal recommendation' : moves.length === 1 ? `Best: cell ${moves[0] + 1}` : `Best: cells ${moves.map((move) => move + 1).join(', ')}`;
      return `<article class="playground-strategy-card${strategy.id === 'lp' ? ' featured' : ''}">
        <header><div><p class="kicker">${String(strategy.family || 'Strategy').toUpperCase()}</p><h3>${evaluation?.name || strategy.name}</h3></div><span class="pill">${evaluation?.scaleLabel || evaluation?.metricLabel || 'score'}</span></header>
        ${strategy.id === 'oracle' ? '<div class="playground-oracle-note"><strong>Omniscient benchmark:</strong> this strategy may use the true hidden board and can reveal information unavailable to a legal player.</div>' : ''}
        <div class="playground-score-grid">${scoreGridHtml(evaluation)}</div>
        <div class="playground-summary"><strong>${recommendation}</strong>${evaluation?.detail ? `<br><span class="muted">${evaluation.detail}</span>` : ''}</div>
      </article>`;
    } catch (error) {
      console.error(`Playground could not evaluate ${strategy.id}`, error);
      return `<article class="playground-strategy-card"><header><div><p class="kicker">${String(strategy.family || 'Strategy').toUpperCase()}</p><h3>${strategy.name}</h3></div><span class="pill">unavailable</span></header><p class="muted">${error?.message || 'Recommendation unavailable for this position.'}</p></article>`;
    }
  }

  function renderRecommendations() {
    const root = $('playground-recommendations');
    if (!root) return;
    const terminal = T.terminal(state);
    const actor = symbol(state.turn);
    $('playground-analysis-title').textContent = terminal.done ? 'Game complete' : `What should ${actor} do?`;
    if (terminal.done) {
      root.innerHTML = '<p class="muted">Start or reset the playground to inspect strategy recommendations again.</p>';
      return;
    }

    const worlds = currentWorlds();
    $('playground-world-count').textContent = `${worlds.length} compatible state${worlds.length === 1 ? '' : 's'}`;
    const strategies = [...T.STRATEGIES].filter((strategy) => strategy.play || strategy.sim);
    const selected = selectedStrategy === ALL_ID ? strategies : strategies.filter((strategy) => strategy.id === selectedStrategy);
    root.innerHTML = `<div class="playground-recommendation-grid">${selected.map(strategyCard).join('')}</div>`;
    $('playground-analysis-summary').textContent = selectedStrategy === ALL_ID
      ? 'Each card evaluates the same current information set. Different strategy families can use different score scales, so compare recommended moves rather than raw numbers across cards.'
      : 'The selected strategy is evaluated from the current player’s information set after every move.';
  }

  function renderBoard() {
    const root = $('playground-board');
    if (!root) return;
    root.innerHTML = '';
    const terminal = T.terminal(state);
    const legal = terminal.done ? new Set() : new Set(T.legalActions(state, rules, state.turn));
    for (let move = 0; move < 9; move++) {
      const display = observedCell(move, terminal.done);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'playground-cell';
      if (display.cls) cell.classList.add(...display.cls.split(' '));
      if (isHidden(move)) cell.classList.add('mystery');
      cell.textContent = display.text;
      cell.disabled = !legal.has(move);
      cell.setAttribute('aria-label', `Cell ${move + 1}${isHidden(move) ? ', mystery' : ''}${display.text ? `, ${display.text}` : ''}`);
      cell.addEventListener('click', () => makeMove(move));
      root.appendChild(cell);
    }
  }

  function renderStatus() {
    const terminal = T.terminal(state);
    if (terminal.done) {
      $('playground-status-title').textContent = terminal.winner ? `${symbol(terminal.winner)} wins` : 'Draw';
      $('playground-status-detail').textContent = 'The true board is revealed because the game is over.';
      $('playground-turn-symbol').textContent = '•';
      return;
    }
    const actor = symbol(state.turn);
    $('playground-status-title').textContent = `${actor} to move`;
    $('playground-status-detail').textContent = `You control ${actor}. The board is shown from ${actor}'s information set.`;
    $('playground-turn-symbol').textContent = actor;
  }

  function renderAll() {
    renderPicker();
    renderBoard();
    renderStatus();
    renderRecommendations();
  }

  function makeMove(move) {
    if (T.terminal(state).done) return;
    const actor = state.turn;
    const legal = T.legalActions(state, rules, actor);
    if (!legal.includes(move)) return;
    const before = state;
    const after = T.applyAction(before, rules, move);
    if (!after) return;
    tracker.advance(before, after);
    state = after;
    const hiddenMove = Boolean(after.last?.hidden);
    $('playground-message').textContent = hiddenMove
      ? `${symbol(actor)} attempted mystery cell ${move + 1}. The next view follows ${symbol(state.turn)}'s information only.`
      : `${symbol(actor)} played cell ${move + 1}.`;
    const terminal = T.terminal(state);
    if (terminal.done) $('playground-message').textContent = terminal.winner ? `${symbol(terminal.winner)} wins. True board revealed.` : 'Draw. True board revealed.';
    renderAll();
  }

  function reset() {
    rules = T.makeRules([...hidden], startPlayer);
    state = T.makeRoot(rules);
    tracker = new T.BeliefTracker(rules);
    $('playground-message').textContent = `Playground reset. ${symbol(startPlayer)} moves first.`;
    renderAll();
  }

  function setMode(mode) {
    const shell = $('playground-play-shell');
    if (!shell) return;
    const active = mode === 'playground';
    shell.hidden = !active;
    if (!active) return;
    $('ai-play-shell') && ($('ai-play-shell').hidden = true);
    $('local-play-shell') && ($('local-play-shell').hidden = true);
    document.querySelectorAll('[data-play-mode]').forEach((button) => button.classList.toggle('active', button.dataset.playMode === 'playground'));
    localStorage.setItem('ttn-play-mode', 'playground');
    renderAll();
  }

  function installModeSwitching() {
    const playgroundButton = document.querySelector('[data-play-mode="playground"]');
    playgroundButton?.addEventListener('click', () => setMode('playground'));

    document.querySelectorAll('[data-play-mode]:not([data-play-mode="playground"])').forEach((button) => {
      button.addEventListener('click', () => { $('playground-play-shell').hidden = true; });
    });
    document.querySelectorAll('[data-start-mode]').forEach((button) => {
      button.addEventListener('click', () => { $('playground-play-shell').hidden = true; });
    });

    if (localStorage.getItem('ttn-play-mode') === 'playground') setMode('playground');
  }

  function installControls() {
    $('playground-strategy')?.addEventListener('change', () => {
      selectedStrategy = $('playground-strategy').value;
      renderRecommendations();
    });
    document.querySelectorAll('[data-playground-order]').forEach((button) => {
      button.addEventListener('click', () => {
        startPlayer = button.dataset.playgroundOrder === 'X' ? X : O;
        document.querySelectorAll('[data-playground-order]').forEach((item) => item.classList.toggle('active', item === button));
        $('playground-message').textContent = `${symbol(startPlayer)} will open after the next reset.`;
      });
    });
    $('playground-new-game')?.addEventListener('click', reset);
  }

  function install() {
    if (installed) return;
    installed = true;
    installStyles();
    injectUi();
    populateStrategySelect();
    installControls();
    installModeSwitching();
    renderAll();
    global.addEventListener('ttn-lp-artifacts-loaded', () => {
      populateStrategySelect();
      renderRecommendations();
    });
  }

  global.TTNPlaygroundMode = { install, setMode, reset };
})(window);
