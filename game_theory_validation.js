global.window = global;
require('./web/game_theory_engine.js');
require('./web/strategy-research-update.js');
const T = global.TTNTheory;
const { O, X } = T;

function assert(condition, message) { if (!condition) throw new Error(message); }
function seeded(seed) { const rng = new T.RNG(seed); return () => rng.next(); }

function hiddenInformationAudit() {
  const rules = T.makeRules([1, 3], O);

  // The same observed history can contain either a successful or failed own
  // mystery attempt. Those histories must remain in one information set.
  function history(opponentHiddenMove) {
    let state = T.makeRoot(rules);
    state = T.applyAction(state, rules, 0); // O visible cell 1.
    state = T.applyAction(state, rules, opponentHiddenMove); // X acts in fog.
    state = T.applyAction(state, rules, 1); // O attempts mystery cell 2.
    state = T.applyAction(state, rules, 2); // X visible cell 3; O acts next.
    return state;
  }

  const failedAttempt = history(1); // X actually owns cell 2.
  const successfulAttempt = history(3); // X used the other mystery cell.
  assert(T.boardArray(failedAttempt)[1] === X, 'fixture did not produce failed hidden attempt');
  assert(T.boardArray(successfulAttempt)[1] === O, 'fixture did not produce successful hidden attempt');
  assert(
    T.informationKey(failedAttempt, rules, O) === T.informationKey(successfulAttempt, rules, O),
    'success/failure leaked into the acting player information set'
  );
  assert(!failedAttempt.obsO.includes('S1;') && !failedAttempt.obsO.includes('F1;'), 'legacy S/F feedback token leaked into O observations');
  assert(failedAttempt.obsO.includes('P1;'), 'own mystery-attempt location was not remembered');

  // Exercise the belief tracker on the failed true history. O must preserve
  // both ownership possibilities after receiving no result signal.
  let state = T.makeRoot(rules);
  const tracker = new T.BeliefTracker(rules);
  for (const move of [0, 1, 1]) {
    const before = state;
    state = T.applyAction(state, rules, move);
    tracker.advance(before, state);
  }
  const possibleOwners = new Set(tracker.for(O).map((world) => T.boardArray(world)[1]));
  assert(possibleOwners.has(O) && possibleOwners.has(X), 'belief update revealed whether O\'s mystery attempt succeeded');

  // If O is literally the first player to touch any mystery cell, success is
  // inferable from the rules even though no explicit result signal is emitted.
  state = T.makeRoot(rules);
  const inferenceTracker = new T.BeliefTracker(rules);
  const before = state;
  state = T.applyAction(state, rules, 1);
  inferenceTracker.advance(before, state);
  assert(state.obsO === 'P1;', 'first hidden attempt should record only the attempted location');
  assert(
    inferenceTracker.for(O).every((world) => T.boardArray(world)[1] === O),
    'logically certain first hidden claim should remain inferable'
  );
}

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
  assert(Math.abs(policy.reduce((sum, item) => sum + item.prob, 0) - 1) < 1e-10, 'MCCFR policy not normalized');
  assert(policy.every((item) => item.prob >= 0 && Number.isFinite(item.prob)), 'MCCFR policy contains invalid probabilities');
}

function evaluationAudit() {
  const rules = T.makeRules([1, 3], O);
  const state = T.makeRoot(rules);
  const tracker = new T.BeliefTracker(rules);
  const solver = new T.OutcomeSamplingMCCFR(rules, 177).train(3000);
  const rng = seeded(1777);

  for (const strategy of T.STRATEGIES.filter((item) => item.play)) {
    const evaluation = T.evaluateStrategy(strategy.id, {
      state,
      rules,
      beliefs: tracker.for(O),
      solver,
      rng
    }, { rolloutBudget: 18, trainingTarget: 3000 });

    const legal = new Set(T.legalActions(state, rules, O));
    assert(evaluation.rows.length === legal.size, `${strategy.id} did not score every legal action`);
    assert(evaluation.rows.every((row) => legal.has(row.move)), `${strategy.id} scored an illegal action`);
    assert(evaluation.rows.every((row) => Number.isFinite(row.score) && row.scaled >= 0 && row.scaled <= 1), `${strategy.id} returned an invalid score`);
    assert(legal.has(evaluation.bestMove), `${strategy.id} returned an invalid best move`);
    const total = evaluation.policy.reduce((sum, item) => sum + item.prob, 0);
    assert(Math.abs(total - 1) < 1e-10, `${strategy.id} policy is not normalized`);
  }
}

function replayAudit() {
  const rules = T.makeRules([1, 3], O);
  let state = T.makeRoot(rules);
  for (const move of [1, 0, 3, 2]) {
    if (T.terminal(state).done) break;
    state = T.applyAction(state, rules, move);
    assert(state, 'replay audit fixture produced an illegal action');
  }
  const replay = T.replayBeliefsForWorld(state, rules);
  assert(replay, 'could not replay a reachable world');
  assert(T.stateKey(replay.state) === T.stateKey(state), 'replayed state differs from original state');
  assert(replay.tracker.for(state.turn).some((world) => T.stateKey(world) === T.stateKey(state)), 'replayed belief set lost the true world');
}

function strategyPairSmokeAudit() {
  const ids = T.STRATEGIES.filter((strategy) => strategy.sim).map((strategy) => strategy.id);
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

hiddenInformationAudit();
structuralAudit();
beliefAudit();
solverAudit();
evaluationAudit();
replayAudit();
strategyPairSmokeAudit();
console.log('Tic-Tac-Nope game-theory validation passed.');