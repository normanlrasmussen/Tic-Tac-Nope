(function () {
  'use strict';

  const T = window.TTNTheory;
  const { O, X } = T;
  const $ = (id) => document.getElementById(id);

  const STRATEGY_DETAILS = {
    belief: { short: 'Deterministic equal-belief action search.', status: 'Heuristic', formula: 'Q(I,a) = meanₕ V_oracle(T(h,a))', explanation: 'Enumerates histories consistent with the acting player’s observations, applies one common action across the information set, and averages exact perfect-information continuation value. It respects the current information constraint but gives future players an omniscient continuation, so it is not an extensive-form equilibrium.' },
    softmax: { short: 'Randomizes according to belief-search quality.', status: 'Heuristic mixed', formula: 'σ(a|I) ∝ exp(β Q(I,a)), β = 2.2', explanation: 'A bounded-rational stochastic policy. Better belief-search actions receive exponentially more probability, while every legal action retains positive mass. This is useful as a noisy opponent but is not a Nash mixed strategy.' },
    extensive: { short: 'Takes the modal action of the learned extensive-form policy.', status: 'Deterministic projection', formula: 'a* = arg maxₐ σ̄_MCCFR(a|I)', explanation: 'Uses the exact extensive-form information key and the average MCCFR behavioral policy, then picks its highest-probability action deterministically. This exposes what the equilibrium learner currently favors, but removing the randomization can make the resulting policy exploitable.' },
    nash: { short: 'Samples from the MCCFR average behavioral policy.', status: 'Approx. equilibrium', formula: 'a ~ σ̄_MCCFR(·|I)', explanation: 'Outcome-sampling Monte Carlo CFR minimizes counterfactual regret using an importance-weighted sampled trajectory. In finite two-player zero-sum perfect-recall games, the average strategy approaches a Nash equilibrium. A finite training run is therefore an approximation, not an exact certificate.' },
    robust: { short: 'Optimizes the worst compatible hidden history.', status: 'Robust heuristic', formula: 'a* = arg maxₐ minₕ V_oracle(T(h,a))', explanation: 'Treats ambiguity adversarially rather than probabilistically. It can be attractive when the equal-weight belief assumption is not trusted, but it can sacrifice expected performance and is not generally an equilibrium policy.' },
    thompson: { short: 'Samples one compatible history, then best-responds to it.', status: 'Posterior-style heuristic', formula: 'h ~ Uniform(I),  a* = arg maxₐ V_oracle(T(h,a))', explanation: 'A probability-matching style baseline. It naturally randomizes when different hidden histories favor different moves, but its world distribution is the visualization’s equal-weight possibility model rather than an equilibrium reach distribution.' },
    random: { short: 'Uniform over legal actions.', status: 'Baseline', formula: 'σ(a|I) = 1 / |A(I)|', explanation: 'A deliberately strategy-free control. It is useful in simulation to quantify how much value the more sophisticated methods add.' },
    oracle: { short: 'Sees the true hidden state.', status: 'Simulation-only benchmark', formula: 'a* = arg maxₐ V_oracle(s,a)', explanation: 'Exact perfect-information minimax for the same move rules, including failed hidden attempts. It violates the information restrictions and therefore cannot be used as a legal Tic-Tac-Nope opponent; it exists only as an upper benchmark in simulation.' }
  };

  let selectedHidden = new Set([1, 3]);
  let humanStarts = true;
  let aiStrategy = 'belief';
  let rules = T.makeRules([...selectedHidden], O);
  let state = T.makeRoot(rules);
  let tracker = new T.BeliefTracker(rules);
  let aiTimer = null;
  let history = [];
  const solverCache = new Map();
  const sessionStats = loadStats();

  function loadStats() { try { return JSON.parse(localStorage.getItem('ttn-theory-stats') || '{}'); } catch { return {}; } }
  function saveStats() { try { localStorage.setItem('ttn-theory-stats', JSON.stringify(sessionStats)); } catch (_) {} }
  function rulesKey(r) { return `${r.hiddenMask}|${r.startPlayer}`; }
  function solverFor(r = rules) { const key = rulesKey(r); if (!solverCache.has(key)) solverCache.set(key, new T.OutcomeSamplingMCCFR(r, 20260903)); return solverCache.get(key); }
  function strategyNeedsSolver(id) { return id === 'nash' || id === 'extensive'; }
  function ensureSolver(r = rules, target = 15000) { const solver = solverFor(r); if (solver.iterations < target) solver.train(target - solver.iterations); return solver; }
  function currentHumanWorlds() { return tracker.for(O); }
  function entropyCount(n) { return n > 0 ? Math.log2(n) : 0; }
  function selectedRules(start = (humanStarts ? O : X)) { return T.makeRules([...selectedHidden], start); }
  function isHidden(move, r = rules) { return Boolean(r.hiddenMask & T.bit(move)); }

  function navigate(page) {
    document.querySelectorAll('.page').forEach((el) => el.classList.toggle('active', el.id === `page-${page}`));
    document.querySelectorAll('[data-page]').forEach((el) => el.classList.toggle('active', el.dataset.page === page && el.classList.contains('nav-btn')));
    if (page === 'analysis') renderAnalysis();
    if (page === 'simulate') populateSimulationSelectors();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function populateStrategySelect(select, includeOracle = false) {
    const current = select.value;
    select.innerHTML = T.STRATEGIES.filter((s) => includeOracle ? s.sim : s.play).map((s) => `<option value="${s.id}">${s.name} · ${s.family}</option>`).join('');
    if ([...select.options].some((o) => o.value === current)) select.value = current;
  }

  function installNavigation() { document.querySelectorAll('[data-page]').forEach((btn) => btn.addEventListener('click', () => navigate(btn.dataset.page))); }

  function installSetup() {
    populateStrategySelect($('ai-strategy'), false);
    $('ai-strategy').value = aiStrategy;
    $('ai-strategy').addEventListener('change', () => {
      aiStrategy = $('ai-strategy').value;
      renderStrategyQuick();
      if (strategyNeedsSolver(aiStrategy)) {
        const solver = solverFor(rules);
        $('setup-note').textContent = solver.iterations ? `This equilibrium table currently has ${solver.iterations.toLocaleString()} MCCFR iterations.` : 'The equilibrium solver will train when this strategy first needs to move.';
      }
    });

    document.querySelectorAll('[data-order]').forEach((btn) => btn.addEventListener('click', () => {
      humanStarts = btn.dataset.order === 'first';
      document.querySelectorAll('[data-order]').forEach((b) => b.classList.toggle('active', b === btn));
      $('setup-note').textContent = humanStarts ? 'You will open as O.' : 'The AI will open as X.';
    }));

    $('new-game').addEventListener('click', startGame);
    renderPicker();
    renderStrategyQuick();
  }

  function renderPicker() {
    const el = $('hidden-picker');
    el.innerHTML = '';
    for (let move = 0; move < 9; move++) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = move + 1; b.className = `picker-cell${selectedHidden.has(move) ? ' selected' : ''}`; b.setAttribute('aria-pressed', selectedHidden.has(move) ? 'true' : 'false');
      b.addEventListener('click', () => {
        if (selectedHidden.has(move) && selectedHidden.size <= 2) { $('setup-note').textContent = 'Keep at least two mystery cells.'; return; }
        if (selectedHidden.has(move)) selectedHidden.delete(move); else selectedHidden.add(move);
        renderPicker();
        $('setup-note').textContent = 'Start a new game to apply the new fog configuration.';
      });
      el.appendChild(b);
    }
    $('hidden-count-badge').textContent = `${selectedHidden.size} hidden`;
  }

  function renderStrategyQuick() { const detail = STRATEGY_DETAILS[aiStrategy]; $('strategy-quick').innerHTML = `<span class="status-chip">${detail.status}</span><p>${detail.short}</p><code>${detail.formula}</code>`; }

  function startGame() {
    clearTimeout(aiTimer); $('thinking').hidden = true;
    rules = selectedRules(); state = T.makeRoot(rules); tracker = new T.BeliefTracker(rules); history = []; recordHistory('Start');
    $('move-message').textContent = humanStarts ? 'New game. You move first as O.' : 'New game. The AI opens as X.';
    renderAll();
    if (state.turn === X) scheduleAi();
  }

  function applyGameMove(move, actor) {
    if (state.turn !== actor || T.terminal(state).done) return;
    const before = state; const after = T.applyAction(before, rules, move); if (!after) return;
    tracker.advance(before, after); state = after;
    const hidden = after.last.hidden, success = after.last.success;
    recordHistory(`${T.symbol(actor)}${after.moveNo}: ${hidden ? 'fog' : 'cell'} ${move + 1}`);

    const t = T.terminal(state);
    if (t.done) {
      const key = t.winner === O ? 'wins' : t.winner === X ? 'losses' : 'draws'; sessionStats[key] = (sessionStats[key] || 0) + 1; saveStats();
      $('move-message').textContent = t.winner === O ? 'You win. The true board is revealed.' : t.winner === X ? 'AI wins. The true board is revealed.' : 'Draw. The true board is revealed.';
      renderAll(); return;
    }

    if (actor === O) $('move-message').textContent = hidden ? (success ? `You privately claimed mystery cell ${move + 1}.` : `Mystery cell ${move + 1} was already owned by X. Your turn was consumed.`) : `You placed O in cell ${move + 1}.`;
    else $('move-message').textContent = hidden ? 'The AI acted somewhere in the fog.' : `The AI placed X in cell ${move + 1}.`;
    renderAll();
    if (state.turn === X) scheduleAi();
  }

  function scheduleAi() {
    if (T.terminal(state).done || state.turn !== X) return;
    clearTimeout(aiTimer); $('thinking').hidden = false;
    $('status-detail').textContent = strategyNeedsSolver(aiStrategy) ? 'AI is consulting the learned extensive-form policy.' : 'AI is evaluating its information set.';
    aiTimer = setTimeout(() => {
      const solver = strategyNeedsSolver(aiStrategy) ? ensureSolver(rules, 15000) : solverFor(rules);
      const move = T.chooseStrategy(aiStrategy, { state, rules, beliefs: tracker.for(X), solver, rng: Math.random });
      $('thinking').hidden = true;
      if (move !== null) applyGameMove(move, X);
    }, 100);
  }

  function humanMove(move) { if (state.turn === O && !T.terminal(state).done && T.legalActions(state, rules, O).includes(move)) applyGameMove(move, O); }

  function boardDisplay(move) {
    const t = T.terminal(state), actual = T.boardArray(state)[move];
    if (t.done || !isHidden(move)) return { text: T.symbol(actual), cls: actual === O ? 'o' : actual === X ? 'x' : '' };
    const vals = new Set(currentHumanWorlds().map((w) => T.boardArray(w)[move]));
    if (vals.size === 1) { const v = [...vals][0]; return { text: T.symbol(v) || '·', cls: v === O ? 'o known' : v === X ? 'x known' : 'known' }; }
    return { text: '?', cls: 'fog' };
  }

  function renderBoard() {
    const el = $('board'); el.innerHTML = '';
    const legal = state.turn === O && !T.terminal(state).done ? new Set(T.legalActions(state, rules, O)) : new Set();
    for (let move = 0; move < 9; move++) {
      const cell = document.createElement('button'); cell.type = 'button'; cell.className = 'cell';
      const d = boardDisplay(move); cell.textContent = d.text; if (d.cls) cell.classList.add(...d.cls.split(' ')); if (isHidden(move)) cell.classList.add('mystery'); if (state.last?.move === move) cell.classList.add('last');
      cell.disabled = !legal.has(move); cell.setAttribute('aria-label', `Cell ${move + 1}${isHidden(move) ? ', mystery' : ''}${d.text ? `, ${d.text}` : ''}`); cell.addEventListener('click', () => humanMove(move)); el.appendChild(cell);
    }
  }

  function beliefRowsForHuman() { if (T.terminal(state).done || !currentHumanWorlds().length) return []; try { return T.beliefActionRows(currentHumanWorlds(), rules, O); } catch (err) { console.error(err); return []; } }

  function renderStatus() {
    const t = T.terminal(state);
    if (t.done) { $('status-title').textContent = t.winner === O ? 'You won · O' : t.winner === X ? 'AI won · X' : 'Draw'; $('status-detail').textContent = 'The underlying hidden board is now revealed.'; $('turn-symbol').textContent = '•'; return; }
    $('status-title').textContent = state.turn === O ? 'Your turn · O' : `AI turn · ${T.STRATEGIES.find((s) => s.id === aiStrategy)?.name || 'X'}`;
    $('status-detail').textContent = state.turn === O ? 'Choose one action using only what you know.' : STRATEGY_DETAILS[aiStrategy].short;
    $('turn-symbol').textContent = T.symbol(state.turn);
  }

  function renderLiveInsights() {
    const worlds = currentHumanWorlds(); $('live-worlds').textContent = worlds.length.toLocaleString(); $('live-entropy').textContent = `${entropyCount(worlds.length).toFixed(2)} bits`;
    const rows = beliefRowsForHuman(); $('live-best').textContent = rows.length ? `Cell ${rows[0].move + 1}` : '—'; $('live-best-detail').textContent = rows.length ? `mean ${rows[0].mean.toFixed(2)} · worst ${rows[0].worst.toFixed(2)}` : 'game complete';
    const solver = solverFor(rules); $('live-cfr-iters').textContent = solver.iterations.toLocaleString();
    const policyEl = $('live-equilibrium-policy'); if (T.terminal(state).done) { policyEl.innerHTML = '<small>game complete</small>'; return; }
    const p = solver.policy(state, true).slice().sort((a, b) => b.prob - a.prob).slice(0, 3); policyEl.innerHTML = p.map((x) => `<span>c${x.move + 1}<b>${Math.round(x.prob * 100)}%</b></span>`).join('');
  }

  function renderCombinedMap() {
    const el = $('combined-value-map'), rows = beliefRowsForHuman(), map = new Map(rows.map((r) => [r.move, r])), best = rows[0]?.mean; el.innerHTML = '';
    for (let move = 0; move < 9; move++) {
      const cell = document.createElement('div'); cell.className = 'combined-value-cell'; if (isHidden(move)) cell.classList.add('mystery'); const row = map.get(move);
      if (!row) { cell.classList.add('unavailable'); cell.innerHTML = `<span class="combined-cell-number">${move + 1}</span><strong>—</strong><small>unavailable</small>`; }
      else { if (row.mean > 0.2) cell.classList.add('positive'); else if (row.mean < -0.2) cell.classList.add('negative'); else cell.classList.add('neutral'); if (best !== undefined && Math.abs(row.mean - best) < 1e-9) cell.classList.add('best'); cell.innerHTML = `<span class="combined-cell-number">${move + 1}${isHidden(move) ? ' ?' : ''}</span><strong>${row.mean.toFixed(2)}</strong><small>worst ${row.worst.toFixed(2)}</small>`; }
      el.appendChild(cell);
    }
  }

  function miniBoard(stateLike) { return T.boardArray(stateLike).map((v, move) => `<i class="${v === O ? 'o' : v === X ? 'x' : ''} ${isHidden(move) ? 'fog' : ''}">${T.symbol(v)}</i>`).join(''); }

  function renderPlayWorlds() {
    const worlds = currentHumanWorlds(); $('play-world-prob').textContent = worlds.length ? `${(100 / worlds.length).toFixed(worlds.length > 12 ? 1 : 0)}% equal-weight` : '—'; const max = 12;
    $('play-info-states').innerHTML = worlds.slice(0, max).map((w, i) => `<div class="world-card info-world-card"><div class="world-label">HISTORY ${String(i + 1).padStart(2, '0')} · your tries ${T.popcount(w.triedO)} · opp tries ${T.popcount(w.triedX)}</div><div class="world-grid">${miniBoard(w)}</div></div>`).join('') + (worlds.length > max ? `<div class="world-more">+${worlds.length - max}<br><small>more compatible histories</small></div>` : '');
  }

  function recordHistory(label) { const worlds = tracker.for(O); history.push({ label, moveNo: state.moveNo, worlds: worlds.length, entropy: entropyCount(worlds.length), actual: T.boardArray(state), last: state.last ? { ...state.last } : null }); }

  function renderTimeline() {
    $('confidence-timeline').innerHTML = history.map((h) => `<div class="timeline-step"><strong>${h.label}</strong><span>${h.worlds} histories</span><small>${h.entropy.toFixed(2)} bits</small></div>`).join('');
    const t = T.terminal(state), reveal = $('truth-reveal'); reveal.hidden = !t.done;
    if (t.done) reveal.innerHTML = `<div><p class="kicker">TRUE TERMINAL BOARD</p><h3>${t.winner ? `${T.symbol(t.winner)} wins` : 'Draw'}</h3></div><div class="truth-grid">${T.boardArray(state).map((v) => `<i>${T.symbol(v)}</i>`).join('')}</div>`;
  }

  function renderAll() { renderBoard(); renderStatus(); renderLiveInsights(); renderCombinedMap(); renderPlayWorlds(); renderTimeline(); }

  function renderAnalysis() {
    const worlds = currentHumanWorlds(), solver = solverFor(rules); $('analysis-worlds').textContent = worlds.length.toLocaleString(); $('analysis-infosets').textContent = solver.nodes.size.toLocaleString(); $('analysis-iters').textContent = solver.iterations.toLocaleString();
    const rows = beliefRowsForHuman(); $('analysis-action-table').innerHTML = rows.length ? rows.map((r) => `<div class="strategy-row"><span>Cell ${r.move + 1}${isHidden(r.move) ? ' ?' : ''}</span><b>${r.mean.toFixed(3)}</b><small>worst ${r.worst.toFixed(2)} · best ${r.best.toFixed(2)}</small></div>`).join('') : '<p class="muted">No live decision.</p>';
    if (!T.terminal(state).done) { const p = solver.policy(state, true).slice().sort((a, b) => b.prob - a.prob || a.move - b.move); $('analysis-policy').innerHTML = p.map((x) => `<div class="strategy-row"><span>Cell ${x.move + 1}${isHidden(x.move) ? ' ?' : ''}</span><b>${(x.prob * 100).toFixed(1)}%</b><div class="prob-track"><i style="width:${x.prob * 100}%"></i></div></div>`).join(''); } else $('analysis-policy').innerHTML = '<p class="muted">Game complete.</p>';
    $('analysis-world-cards').innerHTML = worlds.slice(0, 24).map((w, i) => `<div class="world-card"><div class="world-label">${String(i + 1).padStart(2, '0')} · O tries ${T.popcount(w.triedO)} · X tries ${T.popcount(w.triedX)}</div><div class="world-grid">${miniBoard(w)}</div></div>`).join('') + (worlds.length > 24 ? `<div class="world-more">+${worlds.length - 24}<br><small>more</small></div>` : '');
  }

  function installAnalysis() { $('train-more').addEventListener('click', () => { const solver = solverFor(rules); solver.train(10000); renderAnalysis(); renderLiveInsights(); }); }

  function renderStrategyCards() {
    $('strategy-cards').innerHTML = T.STRATEGIES.map((s, i) => { const d = STRATEGY_DETAILS[s.id]; return `<article class="panel strategy-card"><div class="strategy-card-head"><span>${String(i + 1).padStart(2, '0')}</span><div><p class="kicker">${d.status.toUpperCase()}</p><h2>${s.name}</h2></div></div><p>${d.explanation}</p><div class="formula">${d.formula}</div><div class="strategy-tags"><span>${s.family}</span><span>${s.play ? 'Playable' : 'Simulation only'}</span></div></article>`; }).join('');
  }

  function populateSimulationSelectors() { const o = $('sim-o'), x = $('sim-x'); if (!o.options.length) { populateStrategySelect(o, true); populateStrategySelect(x, true); o.value = 'nash'; x.value = 'belief'; } }
  function seededRandom(seed) { const r = new T.RNG(seed); return () => r.next(); }
  function simulationRules(index, openingRule) { let start; if (openingRule === 'o') start = O; else if (openingRule === 'x') start = X; else start = index % 2 === 0 ? O : X; return T.makeRules([...selectedHidden], start); }

  function playSimulationGame(strategyO, strategyX, simRules, rng) {
    let s = T.makeRoot(simRules); const b = new T.BeliefTracker(simRules); const solver = (strategyNeedsSolver(strategyO) || strategyNeedsSolver(strategyX)) ? ensureSolver(simRules, 20000) : solverFor(simRules); let guard = 0;
    while (!T.terminal(s).done && guard++ < 24) {
      const actor = s.turn, strategy = actor === O ? strategyO : strategyX; const move = T.chooseStrategy(strategy, { state: s, rules: simRules, beliefs: b.for(actor), solver, rng });
      if (move === null) throw new Error(`Strategy ${strategy} produced no legal action.`); const before = s; s = T.applyAction(before, simRules, move); if (!s) throw new Error(`Strategy ${strategy} produced illegal move ${move}.`); b.advance(before, s);
    }
    if (guard >= 24) throw new Error('Simulation exceeded the finite-horizon guard.');
    return { winner: T.terminal(s).winner, moves: s.moveNo };
  }

  async function runMatchup(strategyO, strategyX, games, openingRule, updateUi = true) {
    const result = { o: 0, x: 0, draw: 0, moves: 0 }, rng = seededRandom(0x5eed1234 ^ games ^ strategyO.length ^ (strategyX.length << 8));
    if (strategyNeedsSolver(strategyO) || strategyNeedsSolver(strategyX)) { ensureSolver(T.makeRules([...selectedHidden], O), 20000); ensureSolver(T.makeRules([...selectedHidden], X), 20000); }
    for (let i = 0; i < games; i++) {
      const one = playSimulationGame(strategyO, strategyX, simulationRules(i, openingRule), rng); if (one.winner === O) result.o++; else if (one.winner === X) result.x++; else result.draw++; result.moves += one.moves;
      if (updateUi && i % 25 === 24) { $('sim-progress').textContent = `${i + 1}/${games}`; await new Promise((resolve) => setTimeout(resolve, 0)); }
    }
    return result;
  }

  function renderSimResult(strategyO, strategyX, games, r) {
    const oName = T.STRATEGIES.find((s) => s.id === strategyO).name, xName = T.STRATEGIES.find((s) => s.id === strategyX).name; $('sim-title').textContent = `${oName} (O) vs ${xName} (X)`; $('sim-progress').textContent = `${games} complete`;
    const oPct = r.o / games, xPct = r.x / games, dPct = r.draw / games;
    $('sim-metrics').innerHTML = `<div><span>O wins</span><strong>${(100 * oPct).toFixed(1)}%</strong></div><div><span>Draws</span><strong>${(100 * dPct).toFixed(1)}%</strong></div><div><span>X wins</span><strong>${(100 * xPct).toFixed(1)}%</strong></div><div><span>Avg moves</span><strong>${(r.moves / games).toFixed(2)}</strong></div>`;
    $('sim-bars').innerHTML = `<div><span>O · ${oName}</span><div class="bar"><i class="good" style="width:${oPct * 100}%"></i></div><strong>${r.o}</strong></div><div><span>Draw</span><div class="bar"><i class="draw" style="width:${dPct * 100}%"></i></div><strong>${r.draw}</strong></div><div><span>X · ${xName}</span><div class="bar"><i class="bad" style="width:${xPct * 100}%"></i></div><strong>${r.x}</strong></div>`;
    $('sim-detail').innerHTML = `<p>O score: <strong>${((r.o + 0.5 * r.draw) / games).toFixed(3)}</strong>. Opening rule: <strong>${$('sim-start').selectedOptions[0].textContent}</strong>. Fog: <strong>${[...selectedHidden].map((x) => x + 1).join(', ')}</strong>.</p>`;
  }

  function installSimulation() {
    populateSimulationSelectors();
    $('run-sim').addEventListener('click', async () => {
      const games = Math.max(10, Math.min(5000, Number($('sim-games').value) || 250)), so = $('sim-o').value, sx = $('sim-x').value, opening = $('sim-start').value; $('run-sim').disabled = true; $('sim-progress').textContent = 'running';
      try { const r = await runMatchup(so, sx, games, opening, true); renderSimResult(so, sx, games, r); } catch (err) { console.error(err); $('sim-progress').textContent = 'error'; $('sim-detail').textContent = err.message; } finally { $('run-sim').disabled = false; }
    });

    $('run-round-robin').addEventListener('click', async () => {
      const ids = T.STRATEGIES.filter((s) => s.sim).map((s) => s.id), cellGames = 30; $('run-round-robin').disabled = true; $('round-robin').innerHTML = '<p class="muted">Running cross-strategy games…</p>'; const scores = [];
      try {
        for (let i = 0; i < ids.length; i++) { scores[i] = []; for (let j = 0; j < ids.length; j++) { const r = await runMatchup(ids[i], ids[j], cellGames, 'alternate', false); scores[i][j] = (r.o + 0.5 * r.draw) / cellGames; await new Promise((resolve) => setTimeout(resolve, 0)); } }
        const names = ids.map((id) => T.STRATEGIES.find((s) => s.id === id).name.replace('Equilibrium Mixed (MCCFR)', 'Nash Mixed').replace('Extensive CFR (modal)', 'Extensive'));
        $('round-robin').innerHTML = `<div class="rr-table"><div class="rr-row rr-head"><b>O \\ X</b>${names.map((n) => `<b>${n}</b>`).join('')}</div>${scores.map((row, i) => `<div class="rr-row"><b>${names[i]}</b>${row.map((v) => `<span>${v.toFixed(2)}</span>`).join('')}</div>`).join('')}</div><p class="muted">Each cell is O's score over ${cellGames} alternating-opener games: 1 for a win, 0.5 for a draw, 0 for a loss. Oracle cells are intentionally information-advantaged benchmarks.</p>`;
      } catch (err) { console.error(err); $('round-robin').textContent = err.message; } finally { $('run-round-robin').disabled = false; }
    });
  }

  function validateModelSampled() {
    const r = T.makeRules([1, 3], O), rng = seededRandom(12345), seen = new Map();
    for (let episode = 0; episode < 500; episode++) {
      let s = T.makeRoot(r);
      while (!T.terminal(s).done) {
        const key = T.informationKey(s, r, s.turn), sig = T.legalActions(s, r).join(','); if (seen.has(key) && seen.get(key) !== sig) throw new Error('Information-set action consistency test failed.'); seen.set(key, sig);
        const acts = T.legalActions(s, r); s = T.applyAction(s, r, acts[Math.floor(rng() * acts.length)]);
      }
      if (T.utility(s, O) !== -T.utility(s, X)) throw new Error('Zero-sum utility test failed.');
    }
    return true;
  }

  installNavigation(); installSetup(); installAnalysis(); renderStrategyCards(); installSimulation(); validateModelSampled(); recordHistory('Start'); renderAll();
})();
