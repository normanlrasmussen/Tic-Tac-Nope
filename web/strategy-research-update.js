(function (global) {
  'use strict';

  const T = global.TTNTheory;
  if (!T) return;

  const REGRET_TRAINING_TARGET = 15000;
  const BELIEF_ROLLOUT_TARGET = 72;

  const activeStrategies = [
    { id: 'belief', name: 'Belief-State Search', family: 'Information-safe belief heuristic', play: true, sim: true },
    { id: 'nash', name: 'Regret-Matched Behavioral (MCCFR)', family: 'Regret-minimizing behavioral strategy', play: true, sim: true },
    { id: 'robust', name: 'Worst-Case Assumption', family: 'Ambiguity-averse heuristic', play: true, sim: true },
    { id: 'thompson_uniform', name: 'Uniform Thompson Sampling', family: 'Uniform probability matching', play: true, sim: true },
    { id: 'thompson', name: 'Regret-Weighted Thompson Sampling', family: 'Policy-weighted probability matching', play: true, sim: true },
    { id: 'random', name: 'Uniform Random', family: 'Baseline', play: true, sim: true },
    { id: 'oracle', name: 'Omniscient Oracle', family: 'Cheating benchmark', play: false, sim: true }
  ];
  T.STRATEGIES.splice(0, T.STRATEGIES.length, ...activeStrategies);

  function canonicalStrategyId(id) {
    // Backward compatibility for stale links / saved state from the retired alias.
    return id === 'softmax' ? 'thompson_uniform' : id;
  }

  function clamp01(value) { return Math.max(0, Math.min(1, value)); }

  function ensureRegretPolicy(solver, target = REGRET_TRAINING_TARGET) {
    if (solver && solver.iterations < target) solver.train(target - solver.iterations);
    return solver;
  }

  function strategyUsesRegretPolicy(id) {
    id = canonicalStrategyId(id);
    return id === 'belief' || id === 'nash' || id === 'thompson';
  }

  function informationSafePolicy(state, rules, solver) {
    const actions = T.legalActions(state, rules, state.turn);
    if (!actions.length) return [];
    if (!solver) return actions.map((move) => ({ move, prob: 1 / actions.length }));

    const key = T.informationKey(state, rules, state.turn);
    const node = solver.nodes.get(key);
    if (!node) return actions.map((move) => ({ move, prob: 1 / actions.length }));

    const probs = solver.averagePolicy(node);
    return node.actions.map((move, i) => ({ move, prob: probs[i] }));
  }

  function normalizePolicy(policy) {
    if (!policy.length) return [];
    const total = policy.reduce((sum, item) => sum + Math.max(0, Number(item.prob) || 0), 0);
    if (!(total > 0)) return policy.map((item) => ({ ...item, prob: 1 / policy.length }));
    return policy.map((item) => ({ ...item, prob: Math.max(0, Number(item.prob) || 0) / total }));
  }

  function samplePolicy(policy, rng = Math.random) {
    const normalized = normalizePolicy(policy);
    if (!normalized.length) return null;
    let draw = rng();
    for (const item of normalized) {
      draw -= item.prob;
      if (draw <= 0) return item.move;
    }
    return normalized[normalized.length - 1].move;
  }

  function legalBehavioralRollout(start, rules, rootPlayer, solver, rng) {
    let state = start;
    let guard = 0;
    while (!T.terminal(state).done && guard++ < 24) {
      const policy = informationSafePolicy(state, rules, solver);
      const move = samplePolicy(policy, rng);
      if (move === null) break;
      const next = T.applyAction(state, rules, move);
      if (!next) throw new Error('Information-safe rollout produced an illegal action.');
      state = next;
    }
    const utility = T.utility(state, rootPlayer);
    return utility === null ? 0 : utility;
  }

  function commonInformationSetActions(worlds, rules, player) {
    if (!worlds || !worlds.length) return [];
    const actions = T.legalActions(worlds[0], rules, player);
    const signature = actions.join(',');
    for (let i = 1; i < worlds.length; i++) {
      if (T.legalActions(worlds[i], rules, player).join(',') !== signature) {
        throw new Error('Belief-state violation: indistinguishable histories expose different legal actions.');
      }
    }
    return actions;
  }

  function oracleActionValues(world, rules, player, actions = T.legalActions(world, rules, player)) {
    return actions.map((move) => {
      const child = T.applyAction(world, rules, move);
      if (!child) throw new Error('Oracle evaluation encountered an illegal action.');
      return { move, value: T.oracleValue(child, rules, player) };
    });
  }

  function oracleBestInWorld(world, rules, player, actions) {
    const values = oracleActionValues(world, rules, player, actions);
    const sorted = values.slice().sort((a, b) => b.value - a.value || a.move - b.move);
    return { move: sorted[0]?.move ?? null, value: sorted[0]?.value ?? null, values };
  }

  function deterministicPolicy(bestMove, actions) {
    if (bestMove === null || bestMove === undefined) return [];
    return actions.map((move) => ({ move, prob: move === bestMove ? 1 : 0 }));
  }

  function makeUtilityEvaluation(id, name, rows, policy, worlds, detail = '') {
    return {
      id,
      name,
      metric: 'utility',
      metricLabel: 'Utility score',
      scaleLabel: '−1 loss · 0 draw · +1 win',
      rows,
      policy: normalizePolicy(policy),
      bestMove: rows[0]?.move ?? null,
      worlds: worlds || [],
      detail
    };
  }

  function makeProbabilityEvaluation(id, name, rows, policy, worlds, detail = '') {
    return {
      id,
      name,
      metric: 'probability',
      metricLabel: 'Action probability',
      scaleLabel: '0% never · 100% always',
      rows,
      policy: normalizePolicy(policy),
      bestMove: rows[0]?.move ?? null,
      worlds: worlds || [],
      detail
    };
  }

  function evaluateBelief(context, options) {
    const { state, rules, beliefs = [], solver, rng = Math.random } = context;
    const player = state.turn;
    const actions = commonInformationSetActions(beliefs, rules, player);
    if (!actions.length) return makeUtilityEvaluation('belief', 'Belief-State Search', [], [], [], 'No legal action.');

    ensureRegretPolicy(solver, options.trainingTarget || REGRET_TRAINING_TARGET);
    const rolloutBudget = Math.max(1, Number(options.rolloutBudget) || BELIEF_ROLLOUT_TARGET);
    const repetitions = Math.max(1, Math.ceil(rolloutBudget / Math.max(1, beliefs.length)));
    const worldDetails = beliefs.map((world) => ({ key: T.stateKey(world), scores: [] }));
    const rows = [];

    for (const move of actions) {
      let total = 0;
      let count = 0;
      for (let w = 0; w < beliefs.length; w++) {
        const child = T.applyAction(beliefs[w], rules, move);
        if (!child) throw new Error('Belief-State Search produced an illegal counterfactual action.');
        let worldTotal = 0;
        for (let r = 0; r < repetitions; r++) {
          const value = legalBehavioralRollout(child, rules, player, solver, rng);
          worldTotal += value;
          total += value;
          count += 1;
        }
        worldDetails[w].scores.push({ move, score: worldTotal / repetitions });
      }
      const score = count ? total / count : -1;
      rows.push({ move, score, scaled: clamp01((score + 1) / 2) });
    }

    rows.sort((a, b) => b.score - a.score || a.move - b.move);
    for (const detail of worldDetails) {
      detail.scores.sort((a, b) => b.score - a.score || a.move - b.move);
      detail.bestMove = detail.scores[0]?.move ?? null;
    }
    return makeUtilityEvaluation(
      'belief',
      'Belief-State Search',
      rows,
      deterministicPolicy(rows[0]?.move, actions),
      worldDetails,
      `Estimated with ${repetitions * Math.max(1, beliefs.length)} information-safe continuation rollouts per action.`
    );
  }

  function evaluateRobust(context) {
    const { state, rules, beliefs = [] } = context;
    const player = state.turn;
    const baseRows = beliefs.length ? T.beliefActionRows(beliefs, rules, player) : [];
    const rows = baseRows.map((row) => ({
      move: row.move,
      score: row.worst,
      scaled: clamp01((row.worst + 1) / 2),
      mean: row.mean,
      best: row.best
    })).sort((a, b) => b.score - a.score || b.mean - a.mean || a.move - b.move);
    const worldDetails = beliefs.map((world, index) => {
      const scores = baseRows.map((row) => ({ move: row.move, score: row.values[index] }))
        .sort((a, b) => b.score - a.score || a.move - b.move);
      return { key: T.stateKey(world), scores, bestMove: scores[0]?.move ?? null };
    });
    return makeUtilityEvaluation(
      'robust',
      'Worst-Case Assumption',
      rows,
      deterministicPolicy(rows[0]?.move, rows.map((row) => row.move)),
      worldDetails,
      'Score is the worst perfect-information continuation utility among currently compatible histories.'
    );
  }

  function splitObservationTokens(obs) {
    return String(obs || '').split(';').filter(Boolean);
  }

  function actionHistoryFromWorld(world, rules) {
    const oTokens = splitObservationTokens(world.obsO);
    const xTokens = splitObservationTokens(world.obsX);
    const history = [];
    let actor = rules.startPlayer;

    for (let ply = 0; ply < world.moveNo; ply++) {
      const token = actor === T.O ? oTokens[ply] : xTokens[ply];
      if (!token || token === 'H') return null;
      let move;
      if (token[0] === 'V') move = Number(token.slice(2));
      else if (token[0] === 'S' || token[0] === 'F') move = Number(token.slice(1));
      else return null;
      if (!Number.isInteger(move) || move < 0 || move > 8) return null;
      history.push(move);
      actor = T.other(actor);
    }
    return history;
  }

  function replayBeliefsForWorld(world, rules) {
    const history = actionHistoryFromWorld(world, rules);
    if (!history) return null;
    let state = T.makeRoot(rules);
    const tracker = new T.BeliefTracker(rules);
    for (const move of history) {
      const before = state;
      state = T.applyAction(before, rules, move);
      if (!state) return null;
      tracker.advance(before, state);
    }
    if (T.stateKey(state) !== T.stateKey(world)) return null;
    return { state, tracker };
  }

  function logReachUnderRegretPolicy(world, rules, solver) {
    const history = actionHistoryFromWorld(world, rules);
    if (!history) return -Infinity;
    let state = T.makeRoot(rules);
    let logReach = 0;
    for (const move of history) {
      const policy = informationSafePolicy(state, rules, solver);
      const item = policy.find((x) => x.move === move);
      const probability = item ? item.prob : 0;
      if (!(probability > 0)) return -Infinity;
      logReach += Math.log(probability);
      state = T.applyAction(state, rules, move);
      if (!state) return -Infinity;
    }
    return logReach;
  }

  function regretWorldWeights(beliefs, rules, solver, trainingTarget = REGRET_TRAINING_TARGET) {
    if (!beliefs.length) return [];
    ensureRegretPolicy(solver, trainingTarget);
    const logs = beliefs.map((world) => logReachUnderRegretPolicy(world, rules, solver));
    const finite = logs.filter(Number.isFinite);
    if (!finite.length) return beliefs.map(() => 1 / beliefs.length);
    const maxLog = Math.max(...finite);
    const raw = logs.map((value) => Number.isFinite(value) ? Math.exp(value - maxLog) : 0);
    const total = raw.reduce((a, b) => a + b, 0);
    if (!(total > 0)) return beliefs.map(() => 1 / beliefs.length);
    return raw.map((value) => value / total);
  }

  function evaluateThompson(context, options, weighted) {
    const { state, rules, beliefs = [], solver } = context;
    const player = state.turn;
    const actions = commonInformationSetActions(beliefs, rules, player);
    if (!actions.length) {
      const id = weighted ? 'thompson' : 'thompson_uniform';
      const name = weighted ? 'Regret-Weighted Thompson Sampling' : 'Uniform Thompson Sampling';
      return makeProbabilityEvaluation(id, name, [], [], [], 'No legal action.');
    }

    const weights = weighted
      ? regretWorldWeights(beliefs, rules, solver, options.trainingTarget || REGRET_TRAINING_TARGET)
      : beliefs.map(() => 1 / beliefs.length);
    const probabilities = new Map(actions.map((move) => [move, 0]));
    const worldDetails = [];

    for (let i = 0; i < beliefs.length; i++) {
      const best = oracleBestInWorld(beliefs[i], rules, player, actions);
      probabilities.set(best.move, (probabilities.get(best.move) || 0) + weights[i]);
      worldDetails.push({
        key: T.stateKey(beliefs[i]),
        weight: weights[i],
        bestMove: best.move,
        scores: best.values.map((item) => ({ move: item.move, score: item.value }))
          .sort((a, b) => b.score - a.score || a.move - b.move)
      });
    }

    const rows = actions.map((move) => ({ move, score: probabilities.get(move) || 0, scaled: probabilities.get(move) || 0 }))
      .sort((a, b) => b.score - a.score || a.move - b.move);
    const id = weighted ? 'thompson' : 'thompson_uniform';
    const name = weighted ? 'Regret-Weighted Thompson Sampling' : 'Uniform Thompson Sampling';
    return makeProbabilityEvaluation(
      id,
      name,
      rows,
      rows.map((row) => ({ move: row.move, prob: row.score })),
      worldDetails,
      weighted
        ? 'Probability is induced by regret-policy reach weights over compatible histories.'
        : 'Probability is the fraction of equally weighted compatible histories whose oracle-best action is this cell.'
    );
  }

  function evaluateNash(context, options) {
    const { state, rules, solver } = context;
    ensureRegretPolicy(solver, options.trainingTarget || REGRET_TRAINING_TARGET);
    const policy = solver ? solver.policy(state, true) : [];
    const rows = policy.map((item) => ({ move: item.move, score: item.prob, scaled: clamp01(item.prob) }))
      .sort((a, b) => b.score - a.score || a.move - b.move);
    return makeProbabilityEvaluation(
      'nash',
      'Regret-Matched Behavioral (MCCFR)',
      rows,
      policy,
      [],
      `Average behavioral policy after ${solver ? solver.iterations.toLocaleString() : '0'} MCCFR iterations.`
    );
  }

  function evaluateRandom(context) {
    const { state, rules } = context;
    const actions = T.legalActions(state, rules, state.turn);
    const probability = actions.length ? 1 / actions.length : 0;
    const rows = actions.map((move) => ({ move, score: probability, scaled: probability }));
    return makeProbabilityEvaluation(
      'random',
      'Uniform Random',
      rows,
      rows.map((row) => ({ move: row.move, prob: row.score })),
      [],
      'Every legal action receives exactly the same probability.'
    );
  }

  function evaluateOracle(context) {
    const { state, rules } = context;
    const player = state.turn;
    const values = oracleActionValues(state, rules, player);
    const rows = values.map((item) => ({ move: item.move, score: item.value, scaled: clamp01((item.value + 1) / 2) }))
      .sort((a, b) => b.score - a.score || a.move - b.move);
    return makeUtilityEvaluation(
      'oracle',
      'Omniscient Oracle',
      rows,
      deterministicPolicy(rows[0]?.move, values.map((item) => item.move)),
      [],
      'Perfect-information minimax on the true hidden state. This is not legal live-game information.'
    );
  }

  function evaluateStrategy(id, context, options = {}) {
    id = canonicalStrategyId(id);
    if (!context || !context.state || !context.rules) throw new Error('Strategy evaluation requires state and rules.');
    if (T.terminal(context.state).done) {
      const strategy = T.STRATEGIES.find((item) => item.id === id);
      return {
        id,
        name: strategy?.name || id,
        metric: 'terminal',
        metricLabel: 'Game complete',
        scaleLabel: 'No legal action',
        rows: [],
        policy: [],
        bestMove: null,
        worlds: [],
        detail: 'The game is already terminal.'
      };
    }
    if (id === 'belief') return evaluateBelief(context, options);
    if (id === 'nash') return evaluateNash(context, options);
    if (id === 'robust') return evaluateRobust(context, options);
    if (id === 'thompson_uniform') return evaluateThompson(context, options, false);
    if (id === 'thompson') return evaluateThompson(context, options, true);
    if (id === 'random') return evaluateRandom(context);
    if (id === 'oracle') return evaluateOracle(context);
    throw new Error(`Unknown strategy: ${id}`);
  }

  const originalChooseStrategy = T.chooseStrategy;
  T.chooseStrategy = function chooseResearchStrategy(id, context) {
    id = canonicalStrategyId(id);
    if (id === 'oracle') return originalChooseStrategy('oracle', context);
    if (!activeStrategies.some((strategy) => strategy.id === id)) return originalChooseStrategy(id, context);
    const evaluation = evaluateStrategy(id, context);
    return samplePolicy(evaluation.policy, context.rng || Math.random);
  };

  T.evaluateStrategy = evaluateStrategy;
  T.strategyUsesRegretPolicy = strategyUsesRegretPolicy;
  T.ensureRegretPolicy = ensureRegretPolicy;
  T.informationSafePolicy = informationSafePolicy;
  T.actionHistoryFromWorld = actionHistoryFromWorld;
  T.replayBeliefsForWorld = replayBeliefsForWorld;
  T.regretWorldWeights = regretWorldWeights;
  T.sampleResearchPolicy = samplePolicy;
  T.RESEARCH_CONFIG = Object.freeze({
    regretTrainingTarget: REGRET_TRAINING_TARGET,
    beliefRolloutTarget: BELIEF_ROLLOUT_TARGET
  });

  global.TTNResearchUpdate = { afterCore() {} };
})(window);