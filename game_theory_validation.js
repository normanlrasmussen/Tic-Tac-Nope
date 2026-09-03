global.window = global;
require('./web/game_theory_engine.js');
const T = global.TTNTheory;
const { O, X } = T;

function assert(condition, message) { if (!condition) throw new Error(message); }
function seeded(seed) { const rng = new T.RNG(seed); return () => rng.next(); }

function structuralAudit() {
  const rules = T.makeRules([1, 3], O), rng = seeded(42), seen = new Map();
  for (let episode = 0; episode < 5000; episode++) {
    let state = T.makeRoot(rules);
    while (!T.terminal(state).done) {
      const key = T.informationKey(state, rules, state.turn);
      const signature = T.legalActions(state, rules).join(',');
      if (seen.has(key)) assert(seen.get(key) === signature, 'same information set produced different legal actions');
      else seen.set(key, signature);
      const actions = T.legalActions(state, rules);
      state = T.applyAction(state, rules, actions[Math.floor(rng() * actions.length)]);
      assert(state.moveNo <= 18, 'finite-horizon bound violated');
    }
    assert(T.utility(state, O) === -T.utility(state, X), 'zero-sum utility violated');
  }
}

function beliefAudit() {
  const rules = T.makeRules([1, 3], O), rng = seeded(11);
  for (let episode = 0; episode < 500; episode++) {
    let state = T.makeRoot(rules);
    const beliefs = new T.BeliefTracker(rules);
    while (!T.terminal(state).done) {
      const player = state.turn;
      const worlds = beliefs.for(player);
      assert(worlds.length > 0, 'acting player has empty belief set');
      const signature = T.legalActions(state, rules, player).join(',');
      for (const world of worlds) assert(T.legalActions(world, rules, player).join(',') === signature, 'belief legality mismatch');
      const actions = T.legalActions(state, rules);
      const before = state;
      state = T.applyAction(state, rules, actions[Math.floor(rng() * actions.length)]);
      beliefs.advance(before, state);
      if (!T.terminal(state).done) assert(beliefs.for(O).length && beliefs.for(X).length, 'belief update eliminated all reachable histories');
    }
  }
}

function solverAudit() {
  const rules = T.makeRules([1, 3], O);
  const solver = new T.OutcomeSamplingMCCFR(rules, 99).train(20000);
  const policy = solver.policy(T.makeRoot(rules));
  assert(Math.abs(policy.reduce((s, x) => s + x.prob, 0) - 1) < 1e-10, 'MCCFR policy not normalized');
  assert(policy.every((x) => x.prob >= 0 && Number.isFinite(x.prob)), 'MCCFR policy contains invalid probabilities');
}

function strategyPairSmokeAudit() {
  const ids = T.STRATEGIES.filter((s) => s.sim).map((s) => s.id);
  const solvers = new Map(), rng = seeded(123);
  function solverFor(rules) {
    const key = `${rules.hiddenMask}|${rules.startPlayer}`;
    if (!solvers.has(key)) solvers.set(key, new T.OutcomeSamplingMCCFR(rules, 7).train(3000));
    return solvers.get(key);
  }
  for (const oStrategy of ids) for (const xStrategy of ids) {
    for (let game = 0; game < 4; game++) {
      const rules = T.makeRules([1, 3], game % 2 ? X : O);
      let state = T.makeRoot(rules), guard = 0;
      const beliefs = new T.BeliefTracker(rules), solver = solverFor(rules);
      while (!T.terminal(state).done && guard++ < 24) {
        const player = state.turn;
        const strategy = player === O ? oStrategy : xStrategy;
        const move = T.chooseStrategy(strategy, { state, rules, beliefs: beliefs.for(player), solver, rng });
        assert(T.legalActions(state, rules).includes(move), `${strategy} returned an illegal move`);
        const before = state;
        state = T.applyAction(state, rules, move);
        beliefs.advance(before, state);
      }
      assert(T.terminal(state).done, `${oStrategy} vs ${xStrategy} did not terminate`);
    }
  }
}

structuralAudit();
beliefAudit();
solverAudit();
strategyPairSmokeAudit();
console.log('Tic-Tac-Nope game-theory validation passed.');
