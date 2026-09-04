(function () {
  'use strict';
  const T = window.TTNTheory;
  if (!T) return;
  const { O, X } = T;
  const solvers = new Map();
  const sleep = () => new Promise((resolve) => setTimeout(resolve, 0));

  function hiddenMoves() {
    return [...document.querySelectorAll('#hidden-picker .picker-cell')]
      .flatMap((cell, i) => cell.classList.contains('selected') ? [i] : []);
  }
  function solverFor(rules) {
    const key = `${rules.hiddenMask}|${rules.startPlayer}`;
    if (!solvers.has(key)) solvers.set(key, new T.OutcomeSamplingMCCFR(rules, 20260903));
    const solver = solvers.get(key);
    if (solver.iterations < 20000) solver.train(20000 - solver.iterations);
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
      if (!T.legalActions(state, rules, actor).includes(move)) throw new Error(`${strategy} returned an illegal move.`);
      const before = state;
      state = T.applyAction(before, rules, move);
      beliefs.advance(before, state);
    }
    const terminal = T.terminal(state);
    if (!terminal.done) throw new Error('A simulated game exceeded the finite-horizon guard.');
    return terminal.winner;
  }
  async function matchup(oStrategy, xStrategy, rounds, hidden, seed) {
    const random = new T.RNG(seed >>> 0 || 1);
    const rng = () => random.next();
    let o = 0, draw = 0;
    for (let round = 0; round < rounds; round++) {
      for (const opener of [O, X]) {
        const winner = play(oStrategy, xStrategy, T.makeRules(hidden, opener), rng);
        if (winner === O) o++;
        else if (winner === 0) draw++;
      }
      if (round % 10 === 9) await sleep();
    }
    return (o + 0.5 * draw) / (2 * rounds);
  }
  function install() {
    const button = document.getElementById('run-round-robin');
    const actions = document.querySelector('.round-robin-actions');
    const root = document.getElementById('round-robin');
    if (!button || !actions || !root || button.dataset.roundsInstalled) return;
    button.dataset.roundsInstalled = 'true';

    const control = document.createElement('div');
    control.className = 'rr-rounds-control';
    control.innerHTML = '<label for="rr-rounds">Rounds / matchup</label><input id="rr-rounds" type="number" min="1" max="2500" step="1" value="25" inputmode="numeric">';
    actions.insertBefore(control, button);

    button.addEventListener('click', async () => {
      const input = document.getElementById('rr-rounds');
      const rounds = Math.max(1, Math.min(2500, Math.floor(Number(input.value) || 25)));
      input.value = rounds;
      const ids = T.STRATEGIES.filter((s) => s.sim).map((s) => s.id);
      const names = ids.map((id) => T.STRATEGIES.find((s) => s.id === id).name);
      const scores = ids.map(() => ids.map(() => null));
      const total = ids.length * (ids.length - 1);
      const hidden = hiddenMoves();
      let done = 0;
      button.disabled = input.disabled = true;
      try {
        for (let r = 0; r < ids.length; r++) for (let c = 0; c < ids.length; c++) {
          if (r === c) continue;
          root.innerHTML = `<p class="muted">Running round robin… ${done}/${total} matchups complete · ${rounds} balanced rounds each.</p>`;
          scores[r][c] = await matchup(ids[r], ids[c], rounds, hidden, 0x5eed1234 ^ (r << 12) ^ (c << 4) ^ rounds);
          done++;
          await sleep();
        }
        root.innerHTML = `<div class="rr-table" style="--rr-cols:${ids.length}"><div class="rr-row rr-head"><b>O \\ X</b>${names.map((n) => `<b>${n}</b>`).join('')}</div>${scores.map((row, r) => `<div class="rr-row"><b>${names[r]}</b>${row.map((v, c) => r === c ? '<span class="rr-self">—</span>' : `<span>${v.toFixed(2)}</span>`).join('')}</div>`).join('')}</div><p class="muted">Each off-diagonal cell uses <strong>${rounds} rounds = ${2 * rounds} games</strong>: one O-opening and one X-opening game per round. Score is 1 for an O win, 0.5 for a draw, and 0 for an O loss. Self-matchups are skipped.</p>`;
      } catch (error) {
        console.error(error);
        root.innerHTML = `<p class="muted">${error.message}</p>`;
      } finally {
        button.disabled = input.disabled = false;
      }
    });
  }
  window.TTNRoundRobinControls = { install };
})(window);