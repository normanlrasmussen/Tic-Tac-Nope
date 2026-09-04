(function (global) {
  'use strict';

  const T = global.TTNTheory;
  if (!T) return;

  // Research-facing strategy set. Softmax and the deterministic modal projection
  // are intentionally removed: neither adds a distinct game-theoretic guarantee.
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

  const originalChooseStrategy = T.chooseStrategy;
  const REGRET_TRAINING_TARGET = 15000;
  const BELIEF_ROLLOUT_TARGET = 72;

  function ensureRegretPolicy(solver) {
    if (solver && solver.iterations < REGRET_TRAINING_TARGET) {
      solver.train(REGRET_TRAINING_TARGET - solver.iterations);
    }
    return solver;
  }

  function informationSafePolicy(state, rules, solver) {
    const actions = T.legalActions(state, rules, state.turn);
    if (!actions.length) return [];
    if (!solver) return actions.map((move) => ({ move, prob: 1 / actions.length }));

    // Do not create millions of new MCCFR nodes just to evaluate a rollout.
    // If training never reached this information set, use an explicit uniform
    // fallback rather than mutating the learned table during evaluation.
    const key = T.informationKey(state, rules, state.turn);
    const node = solver.nodes.get(key);
    if (!node) return actions.map((move) => ({ move, prob: 1 / actions.length }));

    const probs = solver.averagePolicy(node);
    return node.actions.map((move, i) => ({ move, prob: probs[i] }));
  }

  function samplePolicy(policy, rng) {
    if (!policy.length) return null;
    let total = 0;
    for (const item of policy) total += Math.max(0, item.prob);
    if (!(total > 0)) return policy[Math.floor(rng() * policy.length)]?.move ?? null;
    let draw = rng() * total;
    for (const item of policy) {
      draw -= Math.max(0, item.prob);
      if (draw <= 0) return item.move;
    }
    return policy[policy.length - 1].move;
  }

  function legalBehavioralRollout(start, rules, rootPlayer, solver, rng) {
    let state = start;
    let guard = 0;
    while (!T.terminal(state).done && guard++ < 24) {
      const policy = informationSafePolicy(state, rules, solver);
      const move = samplePolicy(policy, rng);
      if (move === null) break;
      const next = T.applyAction(state, rules, move);
      if (!next) break;
      state = next;
    }
    const u = T.utility(state, rootPlayer);
    return u === null ? 0 : u;
  }

  function commonInformationSetActions(worlds, rules, player) {
    if (!worlds.length) return [];
    const actions = T.legalActions(worlds[0], rules, player);
    const sig = actions.join(',');
    for (let i = 1; i < worlds.length; i++) {
      if (T.legalActions(worlds[i], rules, player).join(',') !== sig) {
        throw new Error('Belief-state violation: indistinguishable histories expose different legal actions.');
      }
    }
    return actions;
  }

  function chooseBeliefStateSearch(context) {
    const { state, rules, beliefs, solver, rng = Math.random } = context;
    const player = state.turn;
    if (!beliefs || !beliefs.length) return T.legalActions(state, rules, player)[0] ?? null;
    ensureRegretPolicy(solver);

    const actions = commonInformationSetActions(beliefs, rules, player);
    if (!actions.length) return null;

    // Every currently compatible history is evaluated. Future play never gets
    // the hidden board: each hypothetical state is continued by a policy keyed
    // only by the future acting player's own observation history. Both obsO and
    // obsX remain in the hypothetical state, so each player keeps its own
    // information state as the tree evolves.
    //
    // Exhaustive full-game continuation would effectively re-solve the entire
    // imperfect-information game at every move. Instead we use bounded Monte
    // Carlo continuation under the learned legal behavioral policy. The budget
    // is distributed across all compatible histories, with at least one rollout
    // per history, so no current possibility is silently discarded.
    const repetitions = Math.max(1, Math.ceil(BELIEF_ROLLOUT_TARGET / beliefs.length));
    let bestMove = null;
    let bestScore = -Infinity;

    for (const move of actions) {
      let total = 0;
      let count = 0;
      for (const world of beliefs) {
        const child = T.applyAction(world, rules, move);
        if (!child) throw new Error('Belief-State Search produced an illegal counterfactual action.');
        for (let r = 0; r < repetitions; r++) {
          total += legalBehavioralRollout(child, rules, player, solver, rng);
          count += 1;
        }
      }
      const score = count ? total / count : -Infinity;
      if (score > bestScore + 1e-12 || (Math.abs(score - bestScore) <= 1e-12 && (bestMove === null || move < bestMove))) {
        bestScore = score;
        bestMove = move;
      }
    }
    return bestMove;
  }

  function chooseOracleBestInWorld(world, rules, player) {
    let bestMove = null;
    let bestValue = -Infinity;
    for (const move of T.legalActions(world, rules, player)) {
      const child = T.applyAction(world, rules, move);
      const value = T.oracleValue(child, rules, player);
      if (value > bestValue || (value === bestValue && (bestMove === null || move < bestMove))) {
        bestValue = value;
        bestMove = move;
      }
    }
    return bestMove;
  }

  function chooseUniformThompson(context) {
    const { state, rules, beliefs, rng = Math.random } = context;
    const player = state.turn;
    if (!beliefs || !beliefs.length) return T.legalActions(state, rules, player)[0] ?? null;
    const world = beliefs[Math.floor(rng() * beliefs.length)];
    return chooseOracleBestInWorld(world, rules, player);
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

  function logReachUnderRegretPolicy(world, rules, solver) {
    const history = actionHistoryFromWorld(world, rules);
    if (!history) return -Infinity;
    let state = T.makeRoot(rules);
    let logReach = 0;

    for (const move of history) {
      const policy = informationSafePolicy(state, rules, solver);
      const item = policy.find((x) => x.move === move);
      const p = item ? item.prob : 0;
      if (!(p > 0)) return -Infinity;
      logReach += Math.log(p);
      state = T.applyAction(state, rules, move);
      if (!state) return -Infinity;
    }
    return logReach;
  }

  function sampleRegretWeightedWorld(beliefs, rules, solver, rng) {
    if (!beliefs.length) return null;
    ensureRegretPolicy(solver);
    const logs = beliefs.map((world) => logReachUnderRegretPolicy(world, rules, solver));
    const finite = logs.filter(Number.isFinite);
    if (!finite.length) return beliefs[Math.floor(rng() * beliefs.length)];
    const maxLog = Math.max(...finite);
    const weights = logs.map((x) => Number.isFinite(x) ? Math.exp(x - maxLog) : 0);
    const total = weights.reduce((a, b) => a + b, 0);
    if (!(total > 0)) return beliefs[Math.floor(rng() * beliefs.length)];
    let draw = rng() * total;
    for (let i = 0; i < beliefs.length; i++) {
      draw -= weights[i];
      if (draw <= 0) return beliefs[i];
    }
    return beliefs[beliefs.length - 1];
  }

  function chooseRegretWeightedThompson(context) {
    const { state, rules, beliefs, solver, rng = Math.random } = context;
    const player = state.turn;
    if (!beliefs || !beliefs.length) return T.legalActions(state, rules, player)[0] ?? null;
    const world = sampleRegretWeightedWorld(beliefs, rules, solver, rng);
    if (!world) return null;
    return chooseOracleBestInWorld(world, rules, player);
  }

  T.chooseStrategy = function chooseResearchStrategy(name, context) {
    if (name === 'belief') return chooseBeliefStateSearch(context);
    if (name === 'thompson_uniform') return chooseUniformThompson(context);
    if (name === 'thompson') return chooseRegretWeightedThompson(context);
    if (name === 'softmax' || name === 'extensive') throw new Error(`Retired strategy: ${name}`);
    return originalChooseStrategy(name, context);
  };

  const quickDetails = {
    belief: {
      status: 'Information-safe heuristic',
      short: 'Evaluates every current compatible history without giving future players hidden truth.',
      formula: 'Q(I,a) ≈ meanₕ Eσ̄R[u | h,a]'
    },
    nash: {
      status: 'Regret behavioral',
      short: 'Samples from the average MCCFR behavioral policy at the current information set.',
      formula: 'a ~ σ̄_MCCFR(·|I)'
    },
    robust: {
      status: 'Worst-case heuristic',
      short: 'Chooses the action with the best outcome in the worst compatible hidden history.',
      formula: 'a* = arg maxₐ minₕ V_oracle(T(h,a))'
    },
    thompson_uniform: {
      status: 'Uniform world sampling',
      short: 'Samples each compatible hidden history with equal probability, then best-responds in that sampled world.',
      formula: 'h ~ Uniform(I),  a* = arg maxₐ V_oracle(T(h,a))'
    },
    thompson: {
      status: 'Policy-weighted sampling',
      short: 'Samples a compatible history using reach probabilities from the learned regret policy.',
      formula: 'h ~ Pσ̄R(h|I),  a* = arg maxₐ V_oracle(T(h,a))'
    },
    random: {
      status: 'Baseline',
      short: 'Samples uniformly from legal actions.',
      formula: 'σ(a|I) = 1 / |A(I)|'
    },
    oracle: {
      status: 'Simulation only',
      short: 'Sees the true hidden state and solves perfect-information minimax.',
      formula: 'a* = arg maxₐ V_oracle(s,a)'
    }
  };

  function renderQuickOverride() {
    const select = document.getElementById('ai-strategy');
    const target = document.getElementById('strategy-quick');
    if (!select || !target) return;
    const d = quickDetails[select.value];
    if (!d) return;
    target.innerHTML = `<span class="status-chip">${d.status}</span><p>${d.short}</p><code>${d.formula}</code>`;
  }

  global.TTNResearchUpdate = {
    afterCore() {
      renderQuickOverride();
      const select = document.getElementById('ai-strategy');
      if (select) select.addEventListener('change', renderQuickOverride);
    }
  };
})(window);
