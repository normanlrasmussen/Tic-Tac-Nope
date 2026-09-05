(function () {
  'use strict';

  const T = window.TTNTheory;
  const { O, X } = T;
  const $ = (id) => document.getElementById(id);

  const LIVE_TRAINING_TARGET = 15000;
  const ANALYSIS_TRAINING_TARGET = 100000;
  const ANALYSIS_TRAINING_CHUNK = 2500;
  const TIMELINE_FORECAST_SAMPLES = 48;

  const STRATEGY_DETAILS = {
    belief: {
      status: 'Information-safe heuristic',
      short: 'Scores one common action across every compatible history using legal behavioral continuation.',
      formula: 'Q(I,a) ≈ meanₕ Eσ̄R[u | h,a]'
    },
    nash: {
      status: 'Equilibrium target',
      short: 'Samples from the average MCCFR behavioral policy at the current information set.',
      formula: 'a ~ σ̄_MCCFR(·|I)'
    },
    robust: {
      status: 'Worst-case heuristic',
      short: 'Maximizes the worst continuation value among compatible hidden histories.',
      formula: 'a* = arg maxₐ minₕ V_oracle(T(h,a))'
    },
    thompson_uniform: {
      status: 'Uniform world sampling',
      short: 'Samples compatible histories uniformly and plays the oracle-best action in the sampled history.',
      formula: 'h ~ Uniform(I)'
    },
    thompson: {
      status: 'Policy-weighted sampling',
      short: 'Weights compatible histories by regret-policy reach before Thompson sampling.',
      formula: 'h ~ Pσ̄R(h|I)'
    },
    random: {
      status: 'Baseline',
      short: 'Samples uniformly from legal actions.',
      formula: 'σ(a|I) = 1 / |A(I)|'
    },
    oracle: {
      status: 'Simulation only',
      short: 'Uses the true hidden state and exact perfect-information minimax.',
      formula: 'a* = arg maxₐ V_oracle(s,a)'
    }
  };

  let selectedHidden = new Set([1, 3]);
  let humanStarts = true;
  let aiStrategy = 'belief';
  let decisionStrategy = 'belief';
  let rules = T.makeRules([...selectedHidden], O);
  let state = T.makeRoot(rules);
  let tracker = new T.BeliefTracker(rules);
  let aiTimer = null;
  let history = [];
  let timelineRenderToken = 0;
  let analysisTrainingRun = 0;

  const solverCache = new Map();
  const evaluationCache = new Map();
  const forecastPolicyCache = new Map();
  const forecastCache = new Map();
  const analysisTargets = new Map();

  function rulesKey(r = rules) { return `${r.hiddenMask}|${r.startPlayer}`; }
  function solverFor(r = rules) {
    const key = rulesKey(r);
    if (!solverCache.has(key)) solverCache.set(key, new T.OutcomeSamplingMCCFR(r, 20260903));
    return solverCache.get(key);
  }
  function ensureSolver(r = rules, target = LIVE_TRAINING_TARGET) {
    const solver = solverFor(r);
    if (solver.iterations < target) solver.train(target - solver.iterations);
    return solver;
  }
  function selectedRules(start = (humanStarts ? O : X)) { return T.makeRules([...selectedHidden], start); }
  function currentHumanWorlds() { return tracker.for(O); }
  function entropyCount(n) { return n > 0 ? Math.log2(n) : 0; }
  function isHidden(move, r = rules) { return Boolean(r.hiddenMask & T.bit(move)); }
  function cloneState(s) { return { ...s, last: s.last ? { ...s.last } : null }; }
  function strategyName(id) { return T.STRATEGIES.find((strategy) => strategy.id === id)?.name || id; }
  function detailFor(id) { return STRATEGY_DETAILS[id] || { status: 'Strategy', short: '', formula: '' }; }
  function pageIsActive(id) { return $(`page-${id}`)?.classList.contains('active'); }
  function yieldToBrowser() { return new Promise((resolve) => setTimeout(resolve, 0)); }

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

  function invalidateDerivedViews() {
    evaluationCache.clear();
    forecastPolicyCache.clear();
    forecastCache.clear();
    timelineRenderToken += 1;
  }

  function navigate(page) {
    document.querySelectorAll('.page').forEach((el) => el.classList.toggle('active', el.id === `page-${page}`));
    document.querySelectorAll('[data-page]').forEach((el) => {
      el.classList.toggle('active', el.dataset.page === page && el.classList.contains('nav-btn'));
    });
    if (page === 'analysis') {
      renderAnalysis();
      startAnalysisTraining();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function installNavigation() {
    document.querySelectorAll('[data-page]').forEach((btn) => btn.addEventListener('click', () => navigate(btn.dataset.page)));
  }

  function populateStrategySelect(select, includeOracle = false) {
    if (!select) return;
    const current = select.value;
    select.innerHTML = T.STRATEGIES
      .filter((strategy) => includeOracle ? strategy.sim : strategy.play)
      .map((strategy) => `<option value="${strategy.id}">${strategy.name} · ${strategy.family}</option>`)
      .join('');
    if ([...select.options].some((option) => option.value === current)) select.value = current;
  }

  function installSetup() {
    populateStrategySelect($('ai-strategy'));
    $('ai-strategy').value = aiStrategy;
    $('ai-strategy').addEventListener('change', () => {
      aiStrategy = $('ai-strategy').value;
      const solver = solverFor(rules);
      if (T.strategyUsesRegretPolicy?.(aiStrategy)) {
        $('setup-note').textContent = solver.iterations
          ? `The opponent reference table currently has ${solver.iterations.toLocaleString()} MCCFR iterations.`
          : 'This opponent will train its regret-policy reference when it first needs it.';
      } else {
        $('setup-note').textContent = 'The strategy change applies immediately to the current opponent.';
      }
      invalidateDerivedViews();
      renderTimeline();
      if (pageIsActive('analysis')) renderAnalysis();
    });

    document.querySelectorAll('[data-order]').forEach((btn) => btn.addEventListener('click', () => {
      humanStarts = btn.dataset.order === 'first';
      document.querySelectorAll('[data-order]').forEach((item) => item.classList.toggle('active', item === btn));
      $('setup-note').textContent = humanStarts ? 'You will open as O.' : 'The opponent will open as X.';
    }));

    $('new-game').addEventListener('click', startGame);
    renderPicker();
  }

  function installDecisionStrategy() {
    const select = $('decision-strategy');
    if (!select) return;
    populateStrategySelect(select, false);
    select.value = decisionStrategy;
    select.addEventListener('change', () => {
      decisionStrategy = select.value;
      invalidateDerivedViews();
      renderDecisionViews();
      renderTimeline();
      if (pageIsActive('analysis')) renderAnalysisStrategyBoards();
    });
  }

  function renderPicker() {
    const el = $('hidden-picker');
    el.innerHTML = '';
    for (let move = 0; move < 9; move++) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = move + 1;
      button.className = `picker-cell${selectedHidden.has(move) ? ' selected' : ''}`;
      button.setAttribute('aria-pressed', selectedHidden.has(move) ? 'true' : 'false');
      button.addEventListener('click', () => {
        if (selectedHidden.has(move) && selectedHidden.size <= 2) {
          $('setup-note').textContent = 'Keep at least two mystery cells.';
          return;
        }
        if (selectedHidden.has(move)) selectedHidden.delete(move);
        else selectedHidden.add(move);
        renderPicker();
        $('setup-note').textContent = 'Start a new game to apply the new mystery-cell configuration.';
      });
      el.appendChild(button);
    }
    $('hidden-count-badge').textContent = `${selectedHidden.size} hidden`;
  }

  function startGame() {
    clearTimeout(aiTimer);
    $('thinking').hidden = true;
    rules = selectedRules();
    state = T.makeRoot(rules);
    tracker = new T.BeliefTracker(rules);
    history = [];
    invalidateDerivedViews();
    recordHistory('Start');
    $('move-message').textContent = humanStarts ? 'New game. You move first as O.' : 'New game. The opponent opens as X.';
    renderAll();
    if (state.turn === X) scheduleOpponent();
  }

  function applyGameMove(move, actor) {
    if (state.turn !== actor || T.terminal(state).done) return;
    const before = state;
    const after = T.applyAction(before, rules, move);
    if (!after) return;
    tracker.advance(before, after);
    state = after;
    invalidateDerivedViews();

    const hidden = after.last.hidden;
    const actorSymbol = T.symbol(actor);
    const historyLabel = hidden && actor !== O
      ? `${actorSymbol}${after.moveNo}: fog action`
      : `${actorSymbol}${after.moveNo}: ${hidden ? 'fog cell' : 'cell'} ${move + 1}`;
    recordHistory(historyLabel);

    const terminal = T.terminal(state);
    if (terminal.done) {
      $('move-message').textContent = terminal.winner === O
        ? 'You win. The true board is revealed.'
        : terminal.winner === X
          ? 'Opponent wins. The true board is revealed.'
          : 'Draw. The true board is revealed.';
      renderAll();
      return;
    }

    if (actor === O) {
      $('move-message').textContent = hidden
        ? `You attempted mystery cell ${move + 1}. No success or failure signal is revealed.`
        : `You placed O in cell ${move + 1}.`;
    } else {
      $('move-message').textContent = hidden ? 'The opponent acted somewhere in the fog.' : `The opponent placed X in cell ${move + 1}.`;
    }

    renderAll();
    if (state.turn === X) scheduleOpponent();
  }

  function scheduleOpponent() {
    if (T.terminal(state).done || state.turn !== X) return;
    clearTimeout(aiTimer);
    $('thinking').hidden = false;
    $('status-detail').textContent = T.strategyUsesRegretPolicy?.(aiStrategy)
      ? 'Opponent is consulting its learned regret-policy reference.'
      : 'Opponent is evaluating its information set.';

    aiTimer = setTimeout(() => {
      const solver = T.strategyUsesRegretPolicy?.(aiStrategy) ? ensureSolver(rules, LIVE_TRAINING_TARGET) : solverFor(rules);
      const move = T.chooseStrategy(aiStrategy, {
        state,
        rules,
        beliefs: tracker.for(X),
        solver,
        rng: Math.random
      });
      $('thinking').hidden = true;
      if (move !== null) applyGameMove(move, X);
    }, 100);
  }

  function humanMove(move) {
    if (state.turn === O && !T.terminal(state).done && T.legalActions(state, rules, O).includes(move)) applyGameMove(move, O);
  }

  function observedCell(move, stateLike, worlds, revealTruth = false) {
    const actual = T.boardArray(stateLike)[move];
    if (revealTruth || !isHidden(move)) {
      return { text: T.symbol(actual), cls: actual === O ? 'o' : actual === X ? 'x' : '' };
    }
    const values = new Set((worlds || []).map((world) => T.boardArray(world)[move]));
    if (values.size === 1) {
      const value = [...values][0];
      return {
        text: T.symbol(value) || '·',
        cls: value === O ? 'o known' : value === X ? 'x known' : 'known'
      };
    }
    return { text: '?', cls: 'fog' };
  }

  function boardDisplay(move) {
    return observedCell(move, state, currentHumanWorlds(), T.terminal(state).done);
  }

  function renderBoard() {
    const el = $('board');
    el.innerHTML = '';
    const legal = state.turn === O && !T.terminal(state).done ? new Set(T.legalActions(state, rules, O)) : new Set();
    for (let move = 0; move < 9; move++) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cell';
      const display = boardDisplay(move);
      cell.textContent = display.text;
      if (display.cls) cell.classList.add(...display.cls.split(' '));
      if (isHidden(move)) cell.classList.add('mystery');
      const lastMoveVisibleToHuman = state.last && (!state.last.hidden || state.last.actor === O);
      if (lastMoveVisibleToHuman && state.last.move === move) cell.classList.add('last');
      cell.disabled = !legal.has(move);
      cell.setAttribute('aria-label', `Cell ${move + 1}${isHidden(move) ? ', mystery' : ''}${display.text ? `, ${display.text}` : ''}`);
      cell.addEventListener('click', () => humanMove(move));
      el.appendChild(cell);
    }
  }

  function renderStatus() {
    const terminal = T.terminal(state);
    if (terminal.done) {
      $('status-title').textContent = terminal.winner === O ? 'You won · O' : terminal.winner === X ? 'Opponent won · X' : 'Draw';
      $('status-detail').textContent = 'The underlying hidden board is now revealed.';
      $('turn-symbol').textContent = '•';
      return;
    }
    $('status-title').textContent = state.turn === O ? 'Your turn · O' : `Opponent turn · ${strategyName(aiStrategy)}`;
    $('status-detail').textContent = state.turn === O ? 'Choose one action using only what you know.' : detailFor(aiStrategy).short;
    $('turn-symbol').textContent = T.symbol(state.turn);
  }

  function beliefSignature(worlds) {
    return worlds.map((world) => T.stateKey(world)).sort().join('~');
  }

  function evaluationFor(strategy, options = {}) {
    if (T.terminal(state).done || state.turn !== O || strategy === 'oracle') return null;
    const solver = solverFor(rules);
    if (T.strategyUsesRegretPolicy?.(strategy) && solver.iterations < LIVE_TRAINING_TARGET) ensureSolver(rules, LIVE_TRAINING_TARGET);
    const worlds = currentHumanWorlds();
    const rolloutBudget = options.rolloutBudget || T.RESEARCH_CONFIG?.beliefRolloutTarget || 72;
    const key = [
      strategy,
      rulesKey(),
      T.informationKey(state, rules, O),
      beliefSignature(worlds),
      solver.iterations,
      rolloutBudget
    ].join('|');
    if (evaluationCache.has(key)) return evaluationCache.get(key);
    const evaluation = T.evaluateStrategy(strategy, {
      state,
      rules,
      beliefs: worlds,
      solver,
      rng: seededRandom(`evaluation|${key}`)
    }, {
      rolloutBudget,
      trainingTarget: Math.max(LIVE_TRAINING_TARGET, solver.iterations)
    });
    evaluationCache.set(key, evaluation);
    return evaluation;
  }

  function formatScore(evaluation, score) {
    if (evaluation?.metric === 'probability') return `${(100 * score).toFixed(score >= 0.1 ? 0 : 1)}%`;
    if (evaluation?.metric === 'utility') return `${score > 0 ? '+' : ''}${score.toFixed(2)}`;
    return '—';
  }

  function renderCombinedMap() {
    const el = $('combined-value-map');
    const scale = $('combined-score-scale');
    const summary = $('combined-strategy-summary');
    if (!el) return;
    el.innerHTML = '';

    const evaluation = evaluationFor(decisionStrategy);
    if (!evaluation) {
      if (scale) scale.textContent = T.terminal(state).done ? 'game complete' : 'wait for your turn';
      if (summary) summary.textContent = T.terminal(state).done
        ? 'No next move: the match is complete.'
        : 'The opponent is moving. Scores will update when it is your turn.';
      for (let move = 0; move < 9; move++) {
        const cell = document.createElement('div');
        cell.className = `combined-value-cell unavailable${isHidden(move) ? ' mystery' : ''}`;
        const display = boardDisplay(move);
        cell.innerHTML = `<span class="combined-cell-number">${move + 1}</span><strong>${display.text || '—'}</strong><small>${display.text ? 'occupied / observed' : 'not actionable'}</small>`;
        el.appendChild(cell);
      }
      return;
    }

    if (scale) scale.textContent = evaluation.scaleLabel;
    const rowsByMove = new Map(evaluation.rows.map((row) => [row.move, row]));
    const best = evaluation.bestMove;
    const bestRow = rowsByMove.get(best);
    if (summary) {
      summary.textContent = bestRow
        ? `${evaluation.name} currently favors cell ${best + 1} with ${evaluation.metricLabel.toLowerCase()} ${formatScore(evaluation, bestRow.score)}. ${evaluation.detail}`
        : evaluation.detail;
    }

    for (let move = 0; move < 9; move++) {
      const row = rowsByMove.get(move);
      const cell = document.createElement('div');
      cell.className = `combined-value-cell${isHidden(move) ? ' mystery' : ''}`;
      if (!row) {
        const display = boardDisplay(move);
        cell.classList.add('unavailable');
        cell.innerHTML = `<span class="combined-cell-number">${move + 1}</span><strong>${display.text || '—'}</strong><small>${display.text ? 'occupied / known' : 'unavailable'}</small>`;
      } else {
        if (row.scaled > 0.6) cell.classList.add('positive');
        else if (row.scaled < 0.4) cell.classList.add('negative');
        else cell.classList.add('neutral');
        if (move === best) cell.classList.add('best');
        cell.innerHTML = `
          <span class="combined-cell-number">${move + 1}${isHidden(move) ? ' ?' : ''}</span>
          <strong>${formatScore(evaluation, row.score)}</strong>
          <small>${evaluation.metricLabel}</small>
          <div class="score-meter${evaluation.metric === 'utility' ? ' utility' : ''}" aria-hidden="true"><i style="left:${(100 * row.scaled).toFixed(2)}%"></i></div>`;
      }
      el.appendChild(cell);
    }
  }

  function miniBoard(world) {
    return T.boardArray(world).map((value, move) => `<i class="${value === O ? 'o' : value === X ? 'x' : ''} ${isHidden(move) ? 'fog' : ''}">${T.symbol(value)}</i>`).join('');
  }

  function worldStrategyDetail(evaluation, world) {
    if (!evaluation) return '<span class="world-strategy-note">Scores resume on your turn.</span>';
    const detail = evaluation.worlds?.find((item) => item.key === T.stateKey(world));
    if (detail) {
      const top = (detail.scores || []).slice(0, 3).map((item) => `<span>c${item.move + 1}<b>${item.score > 0 ? '+' : ''}${item.score.toFixed(2)}</b></span>`).join('');
      const weight = Number.isFinite(detail.weight) ? `<small>history weight ${(100 * detail.weight).toFixed(1)}%</small>` : '';
      const best = detail.bestMove !== null && detail.bestMove !== undefined ? `<strong>world favors c${detail.bestMove + 1}</strong>` : '';
      return `<div class="world-strategy-head">${best}${weight}</div><div class="world-score-list">${top}</div>`;
    }
    const topPolicy = (evaluation.policy || []).slice().sort((a, b) => b.prob - a.prob || a.move - b.move).slice(0, 3)
      .map((item) => `<span>c${item.move + 1}<b>${(100 * item.prob).toFixed(0)}%</b></span>`).join('');
    return `<div class="world-strategy-head"><strong>same information-set policy</strong></div><div class="world-score-list">${topPolicy}</div>`;
  }

  function renderPlayWorlds() {
    const worlds = currentHumanWorlds();
    const evaluation = evaluationFor(decisionStrategy);
    const probability = $('play-world-prob');
    if (probability) probability.textContent = worlds.length
      ? `${(100 / worlds.length).toFixed(worlds.length > 12 ? 1 : 0)}% equal-weight each · ${strategyName(decisionStrategy)}`
      : '—';
    const max = 12;
    $('play-info-states').innerHTML = worlds.slice(0, max).map((world, index) => `
      <div class="world-card info-world-card">
        <div class="world-label">HISTORY ${String(index + 1).padStart(2, '0')} · your tries ${T.popcount(world.triedO)} · opp tries ${T.popcount(world.triedX)}</div>
        <div class="info-world-body">
          <div class="world-grid">${miniBoard(world)}</div>
          <div class="world-strategy-detail">${worldStrategyDetail(evaluation, world)}</div>
        </div>
      </div>`).join('') + (worlds.length > max ? `<div class="world-more">+${worlds.length - max}<br><small>more compatible histories</small></div>` : '');
  }

  function recordHistory(label) {
    const worlds = tracker.for(O).map(cloneState);
    history.push({
      label,
      moveNo: state.moveNo,
      worlds: worlds.length,
      entropy: entropyCount(worlds.length),
      worldStates: worlds,
      actualState: cloneState(state),
      terminal: T.terminal(state)
    });
  }

  function snapshotBoard(snapshot) {
    return Array.from({ length: 9 }, (_, move) => {
      const display = observedCell(move, snapshot.actualState, snapshot.worldStates, snapshot.terminal.done);
      const classes = [display.cls, isHidden(move) ? 'fog' : ''].filter(Boolean).join(' ');
      return `<i class="${classes}">${display.text}</i>`;
    }).join('');
  }

  function forecastPolicy(strategy, simState, simRules, beliefs, solver) {
    if (T.strategyUsesRegretPolicy?.(strategy) && solver.iterations < LIVE_TRAINING_TARGET) ensureSolver(simRules, LIVE_TRAINING_TARGET);
    const key = [
      strategy,
      rulesKey(simRules),
      T.informationKey(simState, simRules, simState.turn),
      beliefSignature(beliefs),
      solver.iterations
    ].join('|');
    if (forecastPolicyCache.has(key)) return forecastPolicyCache.get(key);
    const evaluation = T.evaluateStrategy(strategy, {
      state: simState,
      rules: simRules,
      beliefs,
      solver,
      rng: seededRandom(`forecast-policy|${key}`)
    }, {
      rolloutBudget: 24,
      trainingTarget: Math.max(LIVE_TRAINING_TARGET, solver.iterations)
    });
    const policy = evaluation.policy?.length
      ? evaluation.policy
      : T.legalActions(simState, simRules).map((move, _, actions) => ({ move, prob: 1 / actions.length }));
    forecastPolicyCache.set(key, policy);
    return policy;
  }

  function forecastSnapshot(snapshot) {
    if (snapshot.terminal.done) {
      return {
        win: snapshot.terminal.winner === O ? 1 : 0,
        draw: snapshot.terminal.winner === 0 ? 1 : 0,
        loss: snapshot.terminal.winner === X ? 1 : 0,
        samples: 1
      };
    }
    const solver = solverFor(rules);
    if (T.strategyUsesRegretPolicy?.(decisionStrategy) || T.strategyUsesRegretPolicy?.(aiStrategy)) ensureSolver(rules, LIVE_TRAINING_TARGET);
    const cacheKey = [
      snapshot.moveNo,
      snapshot.label,
      beliefSignature(snapshot.worldStates),
      decisionStrategy,
      aiStrategy,
      solver.iterations,
      TIMELINE_FORECAST_SAMPLES
    ].join('|');
    if (forecastCache.has(cacheKey)) return forecastCache.get(cacheKey);

    const rng = seededRandom(`timeline|${cacheKey}`);
    const counts = { win: 0, draw: 0, loss: 0 };
    const worldWeights = (decisionStrategy === 'nash' || decisionStrategy === 'thompson')
      ? T.regretWorldWeights(snapshot.worldStates, rules, solver, Math.max(LIVE_TRAINING_TARGET, solver.iterations))
      : snapshot.worldStates.map(() => 1 / Math.max(1, snapshot.worldStates.length));
    const sampleWorld = () => {
      let draw = rng();
      for (let index = 0; index < snapshot.worldStates.length; index++) {
        draw -= worldWeights[index] || 0;
        if (draw <= 0) return snapshot.worldStates[index];
      }
      return snapshot.worldStates[snapshot.worldStates.length - 1];
    };
    for (let sample = 0; sample < TIMELINE_FORECAST_SAMPLES; sample++) {
      const world = sampleWorld();
      const replay = T.replayBeliefsForWorld?.(world, rules);
      if (!replay) continue;
      let simState = replay.state;
      const simTracker = replay.tracker;
      let guard = 0;
      while (!T.terminal(simState).done && guard++ < 24) {
        const actor = simState.turn;
        const strategy = actor === O ? decisionStrategy : aiStrategy;
        const policy = forecastPolicy(strategy, simState, rules, simTracker.for(actor), solver);
        const move = T.sampleResearchPolicy(policy, rng);
        if (move === null) break;
        const before = simState;
        simState = T.applyAction(before, rules, move);
        if (!simState) break;
        simTracker.advance(before, simState);
      }
      const terminal = T.terminal(simState);
      if (!terminal.done || terminal.winner === 0) counts.draw += 1;
      else if (terminal.winner === O) counts.win += 1;
      else counts.loss += 1;
    }
    const total = counts.win + counts.draw + counts.loss || 1;
    const result = { win: counts.win / total, draw: counts.draw / total, loss: counts.loss / total, samples: total };
    forecastCache.set(cacheKey, result);
    return result;
  }

  function renderForecast(target, forecast) {
    target.innerHTML = `
      <span class="timeline-prob win"><b>${(100 * forecast.win).toFixed(0)}%</b><small>win</small></span>
      <span class="timeline-prob draw"><b>${(100 * forecast.draw).toFixed(0)}%</b><small>tie</small></span>
      <span class="timeline-prob loss"><b>${(100 * forecast.loss).toFixed(0)}%</b><small>loss</small></span>`;
  }

  function scheduleTimelineForecasts(token) {
    setTimeout(async () => {
      for (let index = 0; index < history.length; index++) {
        if (token !== timelineRenderToken) return;
        const target = $(`timeline-forecast-${index}`);
        if (!target) continue;
        try {
          renderForecast(target, forecastSnapshot(history[index]));
        } catch (error) {
          console.error(error);
          target.innerHTML = '<small class="muted">forecast unavailable</small>';
        }
        await yieldToBrowser();
      }
    }, 0);
  }

  function renderTimeline() {
    const label = $('timeline-strategy-label');
    if (label) label.textContent = `${strategyName(decisionStrategy)} (you) vs ${strategyName(aiStrategy)} (opponent) · ${TIMELINE_FORECAST_SAMPLES}-rollout forecasts`;
    $('confidence-timeline').innerHTML = history.map((snapshot, index) => `
      <article class="timeline-card">
        <header><strong>${snapshot.label}</strong><span>${snapshot.worlds} histories · ${snapshot.entropy.toFixed(2)} bits</span></header>
        <div class="timeline-card-body">
          <div class="timeline-board world-grid">${snapshotBoard(snapshot)}</div>
          <div id="timeline-forecast-${index}" class="timeline-probabilities"><small class="muted">estimating…</small></div>
        </div>
      </article>`).join('');

    const terminal = T.terminal(state);
    const reveal = $('truth-reveal');
    reveal.hidden = !terminal.done;
    if (terminal.done) {
      reveal.innerHTML = `
        <div class="truth-head"><div><p class="kicker">TRUE TERMINAL BOARD</p><h3>${terminal.winner ? `${T.symbol(terminal.winner)} wins` : 'Draw'}</h3></div><strong class="truth-result">final truth</strong></div>
        <div class="terminal-board-grid">${T.boardArray(state).map((value) => `<i class="${value === O ? 'o' : value === X ? 'x' : ''}">${T.symbol(value)}</i>`).join('')}</div>`;
    }
    const token = ++timelineRenderToken;
    scheduleTimelineForecasts(token);
  }

  function renderDecisionViews() {
    renderCombinedMap();
    renderPlayWorlds();
  }

  function renderAll() {
    renderBoard();
    renderStatus();
    renderDecisionViews();
    renderTimeline();
    if (pageIsActive('analysis')) renderAnalysis();
  }

  function analysisBoardHtml() {
    return Array.from({ length: 9 }, (_, move) => {
      const display = boardDisplay(move);
      return `<div class="analysis-live-cell ${display.cls || ''} ${isHidden(move) ? 'mystery' : ''}"><span>${move + 1}</span><b>${display.text}</b></div>`;
    }).join('');
  }

  function renderAnalysisContext() {
    const setup = $('analysis-match-setup');
    if (setup) {
      setup.innerHTML = `
        <div class="analysis-setup-row"><span>Opponent strategy</span><strong>${strategyName(aiStrategy)}</strong></div>
        <div class="analysis-setup-row"><span>Turn order</span><strong>${humanStarts ? 'You open' : 'Opponent opens'}</strong></div>
        <div class="analysis-setup-row"><span>Mystery cells</span><strong>${rules.hidden.map((move) => move + 1).join(', ')}</strong></div>
        <div class="analysis-hidden-mini">${Array.from({ length: 9 }, (_, move) => `<i class="${isHidden(move) ? 'selected' : ''}">${move + 1}</i>`).join('')}</div>`;
    }
    const board = $('analysis-live-board');
    if (board) board.innerHTML = analysisBoardHtml();
    const title = $('analysis-live-title');
    if (title) title.textContent = $('status-title').textContent;
    const detail = $('analysis-live-detail');
    if (detail) detail.textContent = $('status-detail').textContent;
  }

  function scoreBoardHtml(evaluation) {
    const rows = new Map((evaluation?.rows || []).map((row) => [row.move, row]));
    return Array.from({ length: 9 }, (_, move) => {
      const display = boardDisplay(move);
      const row = rows.get(move);
      const classes = ['strategy-score-cell'];
      if (isHidden(move)) classes.push('mystery');
      if (display.cls) classes.push(...display.cls.split(' '));
      if (row) classes.push('actionable');
      if (evaluation?.bestMove === move) classes.push('best');
      return `<div class="${classes.join(' ')}">
        <span class="score-cell-index">${move + 1}</span>
        <b class="score-cell-mark">${display.text}</b>
        ${row ? `<strong>${formatScore(evaluation, row.score)}</strong><small>${evaluation.metric === 'probability' ? 'prob.' : 'utility'}</small>` : ''}
      </div>`;
    }).join('');
  }

  function renderStrategyAnalysisCard(strategy) {
    const detail = detailFor(strategy.id);
    let evaluation = null;
    if (!T.terminal(state).done && state.turn === O) {
      if (strategy.id === 'oracle') {
        const solver = solverFor(rules);
        evaluation = T.evaluateStrategy('oracle', {
          state,
          rules,
          beliefs: currentHumanWorlds(),
          solver,
          rng: seededRandom(`analysis-oracle|${rulesKey()}|${T.stateKey(state)}`)
        });
      } else if (strategy.play) {
        evaluation = evaluationFor(strategy.id);
      }
    }
    if (!evaluation) {
      return `<article class="strategy-analysis-card">
        <header><div><p class="kicker">${detail.status.toUpperCase()}</p><h2>${strategy.name}</h2></div><span class="pill">no current action</span></header>
        <div class="strategy-score-board">${scoreBoardHtml(null)}</div>
        <p>${T.terminal(state).done ? 'The game is complete, so there is no next action to score.' : 'The opponent is currently to move. This board will score actions on your next turn.'}</p>
      </article>`;
    }

    const bestRow = evaluation.rows.find((row) => row.move === evaluation.bestMove);
    return `<article class="strategy-analysis-card${strategy.id === 'nash' ? ' featured' : ''}${strategy.id === 'oracle' ? ' oracle-locked' : ''}">
      <header>
        <div><p class="kicker">${detail.status.toUpperCase()}</p><h2>${strategy.name}</h2></div>
        <span class="pill">${evaluation.scaleLabel}</span>
      </header>
      ${strategy.id === 'oracle' ? '<p class="oracle-warning"><strong>Omniscient benchmark:</strong> these scores use the true hidden board and can spoil live information.</p>' : ''}
      <div class="strategy-score-board">${scoreBoardHtml(evaluation)}</div>
      <div class="strategy-analysis-summary"><strong>${bestRow ? `Best: cell ${evaluation.bestMove + 1} · ${formatScore(evaluation, bestRow.score)}` : 'No legal move'}</strong><span>${evaluation.detail}</span></div>
    </article>`;
  }

  function renderAnalysisStrategyBoards() {
    const root = $('analysis-strategy-boards');
    if (!root) return;
    root.innerHTML = T.STRATEGIES.map(renderStrategyAnalysisCard).join('');
  }

  function analysisTarget(r = rules) {
    const key = rulesKey(r);
    if (!analysisTargets.has(key)) analysisTargets.set(key, ANALYSIS_TRAINING_TARGET);
    return analysisTargets.get(key);
  }

  function updateAnalysisTrainingUi(solver = solverFor(rules), target = analysisTarget()) {
    if ($('analysis-iters')) $('analysis-iters').textContent = solver.iterations.toLocaleString();
    if ($('analysis-target')) $('analysis-target').textContent = target.toLocaleString();
    const progress = $('analysis-training-progress');
    if (progress) progress.style.width = `${Math.min(100, 100 * solver.iterations / Math.max(1, target)).toFixed(2)}%`;
    const status = $('analysis-training-status');
    if (status) status.textContent = solver.iterations >= target ? 'target reached' : `training ${solver.iterations.toLocaleString()} / ${target.toLocaleString()}`;
  }

  async function startAnalysisTraining(extraIterations = 0) {
    const trainingRules = rules;
    const key = rulesKey(trainingRules);
    const solver = solverFor(trainingRules);
    let target = analysisTarget(trainingRules);
    if (extraIterations > 0) {
      target = Math.max(target, solver.iterations) + extraIterations;
      analysisTargets.set(key, target);
    }

    const run = ++analysisTrainingRun;
    const button = $('train-more');
    if (button) button.disabled = true;
    updateAnalysisTrainingUi(solver, target);

    while (run === analysisTrainingRun && rulesKey(rules) === key && solver.iterations < target) {
      solver.train(Math.min(ANALYSIS_TRAINING_CHUNK, target - solver.iterations));
      updateAnalysisTrainingUi(solver, target);
      await yieldToBrowser();
    }

    if (run !== analysisTrainingRun || rulesKey(rules) !== key) return;
    evaluationCache.clear();
    forecastPolicyCache.clear();
    forecastCache.clear();
    updateAnalysisTrainingUi(solver, target);
    if (button) {
      button.disabled = false;
      button.textContent = 'Train +100,000';
    }
    renderAnalysisStrategyBoards();
    renderDecisionViews();
    renderTimeline();
  }

  function renderAnalysis() {
    renderAnalysisContext();
    updateAnalysisTrainingUi();
    renderAnalysisStrategyBoards();
  }

  function installAnalysis() {
    const button = $('train-more');
    if (button) button.addEventListener('click', () => startAnalysisTraining(100000));
  }

  function renderStrategyFallback() {
    const root = $('strategy-cards');
    if (!root) return;
    root.innerHTML = T.STRATEGIES.map((strategy) => {
      const detail = detailFor(strategy.id);
      return `<section class="strategy-fallback"><p class="kicker">${detail.status.toUpperCase()}</p><h2>${strategy.name}</h2><p>${detail.short}</p><div class="formula">${detail.formula}</div></section>`;
    }).join('');
  }

  function validateModelSampled() {
    const sampleRules = T.makeRules([1, 3], O);
    const rng = seededRandom('structural-validation');
    const seen = new Map();
    for (let episode = 0; episode < 500; episode++) {
      let sampleState = T.makeRoot(sampleRules);
      while (!T.terminal(sampleState).done) {
        const key = T.informationKey(sampleState, sampleRules, sampleState.turn);
        const signature = T.legalActions(sampleState, sampleRules).join(',');
        if (seen.has(key) && seen.get(key) !== signature) throw new Error('Information-set action consistency test failed.');
        seen.set(key, signature);
        const actions = T.legalActions(sampleState, sampleRules);
        sampleState = T.applyAction(sampleState, sampleRules, actions[Math.floor(rng() * actions.length)]);
      }
      if (T.utility(sampleState, O) !== -T.utility(sampleState, X)) throw new Error('Zero-sum utility test failed.');
    }
  }

  installNavigation();
  installSetup();
  installDecisionStrategy();
  installAnalysis();
  renderStrategyFallback();
  validateModelSampled();
  recordHistory('Start');
  renderAll();
})();