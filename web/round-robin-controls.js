(function () {
  'use strict';

  const T = window.TTNTheory;
  if (!T) return;

  const O = T.O;
  const X = T.X;
  const solverCache = new Map();

  function selectedHiddenMoves() {
    return [...document.querySelectorAll('#hidden-picker .picker-cell')]
      .map((el, i) => el.classList.contains('selected') ? i : null)
      .filter((x) => x !== null);
  }

  function rulesKey(r) { return `${r.hiddenMask}|${r.startPlayer}`; }

  function solverFor(rules) {
    const key = rulesKey(rules);
    if (!solverCache.has(key)) solverCache.set(key, new T.OutcomeSamplingMCCFR(rules, 20260903));
    return solverCache.get(key);
  }

  function strategyUsesRegretPolicy(id) {
    return id === 'nash' || id === 'belief' || id === 'thompson';
  }

  function ensureSolver(rules, target = 20000) {
    const solver = solverFor(rules);
    if (solver.iterations < target) solver.train(target - solver.iterations);
    return solver;
  }

  function seededRandom(seed) {
    const r = new T.RNG(seed);
    return () => r.next();
  }

  function playGame(strategyO, strategyX, rules, rng) {
    let state = T.makeRoot(rules);
    const beliefs = new T.BeliefTracker(rules);
    const needsRegret = strategyUsesRegretPolicy(strategyO) || strategyUsesRegretPolicy(strategyX);
    const solver = needsRegret ? ensureSolver(rules, 20000) : solverFor(rules);
    let guard = 0;

    while (!T.terminal(state).done && guard++ < 24) {
      const actor = state.turn;
      const strategy = actor === O ? strategyO : strategyX;
      const move = T.chooseStrategy(strategy, {
        state,
        rules,
        beliefs: beliefs.for(actor),
        solver,
        rng
      });
      if (move === null) throw new Error(`Strategy ${strategy} produced no legal action.`);
      const before = state;
      state = T.applyAction(before, rules, move);
      if (!state) throw new Error(`Strategy ${strategy} produced illegal move ${move}.`);
      beliefs.advance(before, state);
    }

    if (guard >= 24) throw new Error('Simulation exceeded the finite-horizon guard.');
    return T.terminal(state).winner;
  }

  async function runMatchup(strategyO, strategyX, games, hiddenMoves, seed) {
    const result = { o: 0, x: 0, draw: 0 };
    const rng = seededRandom(seed);
    for (let g = 0; g < games; g++) {
      const start = g % 2 === 0 ? O : X;
      const rules = T.makeRules(hiddenMoves, start);
      const winner = playGame(strategyO, strategyX, rules, rng);
      if (winner === O) result.o++;
      else if (winner === X) result.x++;
      else result.draw++;
      if (g % 25 === 24) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return result;
  }

  function installStyle() {
    if (document.getElementById('rr-custom-style')) return;
    const style = document.createElement('style');
    style.id = 'rr-custom-style';
    style.textContent = `
      .rr-games-control{display:flex;align-items:center;gap:.5rem}
      .rr-games-control label{font-size:.78rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
      .rr-games-control input{width:92px;padding:.55rem .65rem;border:1px solid var(--line,#cfc8bb);border-radius:8px;background:var(--paper,#fff);font:inherit}
      .rr-self{display:flex;align-items:center;justify-content:center;opacity:.45;background:repeating-linear-gradient(135deg,transparent,transparent 5px,rgba(90,90,90,.08) 5px,rgba(90,90,90,.08) 10px)!important;color:inherit!important}
    `;
    document.head.appendChild(style);
  }

  function install() {
    const oldButton = document.getElementById('run-round-robin');
    const actions = document.querySelector('.round-robin-actions');
    const table = document.getElementById('round-robin');
    if (!oldButton || !actions || !table) return;

    installStyle();

    if (!document.getElementById('rr-games')) {
      const control = document.createElement('div');
      control.className = 'rr-games-control';
      control.innerHTML = '<label for="rr-games">Games / matchup</label><input id="rr-games" type="number" min="2" max="5000" step="2" value="100" inputmode="numeric" />';
      actions.insertBefore(control, oldButton);
    }

    // Clone the button to remove the original anonymous click listener from app4-core.
    const button = oldButton.cloneNode(true);
    oldButton.replaceWith(button);

    button.addEventListener('click', async () => {
      const ids = T.STRATEGIES.filter((s) => s.sim).map((s) => s.id);
      const input = document.getElementById('rr-games');
      let games = Math.max(2, Math.min(5000, Number(input.value) || 100));
      // Alternating openers is balanced most cleanly with an even number of games.
      if (games % 2 !== 0) games += 1;
      input.value = games;

      const hiddenMoves = selectedHiddenMoves();
      const scores = Array.from({ length: ids.length }, () => Array(ids.length).fill(null));
      button.disabled = true;
      table.innerHTML = '<p class="muted">Running cross-strategy games… self-matchups are skipped.</p>';

      try {
        let matchupIndex = 0;
        for (let i = 0; i < ids.length; i++) {
          for (let j = 0; j < ids.length; j++) {
            if (i === j) continue;
            const r = await runMatchup(ids[i], ids[j], games, hiddenMoves, 0x5eed1234 ^ (i << 12) ^ (j << 4) ^ games);
            scores[i][j] = (r.o + 0.5 * r.draw) / games;
            matchupIndex++;
            table.innerHTML = `<p class="muted">Running cross-strategy games… ${matchupIndex}/${ids.length * (ids.length - 1)} matchups complete.</p>`;
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }

        const names = ids.map((id) => T.STRATEGIES.find((s) => s.id === id)?.name || id);
        table.innerHTML = `<div class="rr-table"><div class="rr-row rr-head"><b>O \\ X</b>${names.map((n) => `<b>${n}</b>`).join('')}</div>${scores.map((row, i) => `<div class="rr-row"><b>${names[i]}</b>${row.map((v, j) => i === j ? '<span class="rr-self" title="Self-matchup skipped">—</span>' : `<span>${v.toFixed(2)}</span>`).join('')}</div>`).join('')}</div><p class="muted">Each off-diagonal cell is O's score over ${games} games with alternating openers: 1 for a win, 0.5 for a draw, 0 for a loss. Diagonal self-matchups are intentionally not run. Oracle cells remain information-advantaged benchmarks.</p>`;
      } catch (err) {
        console.error(err);
        table.textContent = err.message;
      } finally {
        button.disabled = false;
      }
    });
  }

  window.TTNRoundRobinControls = { install };
})(window);
