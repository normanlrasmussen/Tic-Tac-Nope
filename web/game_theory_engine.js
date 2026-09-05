(function (global) {
  'use strict';

  const X = 1;
  const O = 2;
  const EMPTY = 0;
  const FULL_MASK = 0x1ff;
  const WIN_MASKS = [0x007, 0x038, 0x1c0, 0x049, 0x092, 0x124, 0x111, 0x054];
  const INFORMATION_MODEL = 'hidden-attempt-location-no-result-v2';

  function other(player) { return player === O ? X : O; }
  function symbol(player) { return player === O ? 'O' : player === X ? 'X' : ''; }
  function bit(move) { return 1 << move; }
  function popcount(n) { let c = 0; while (n) { n &= n - 1; c++; } return c; }
  function maskToMoves(mask) { const out = []; for (let i = 0; i < 9; i++) if (mask & bit(i)) out.push(i); return out; }
  function movesToMask(moves) { return moves.reduce((m, x) => m | bit(x), 0); }
  function hasWin(mask) { return WIN_MASKS.some((w) => (mask & w) === w); }

  function makeRules(hiddenMoves, startPlayer = O) {
    const hidden = [...new Set(hiddenMoves)].sort((a, b) => a - b);
    if (hidden.length < 2) throw new Error('Tic-Tac-Nope requires at least two mystery cells.');
    if (hidden.some((m) => m < 0 || m > 8 || !Number.isInteger(m))) throw new Error('Mystery cells must be integers 0..8.');
    return Object.freeze({ hidden, hiddenMask: movesToMask(hidden), startPlayer });
  }

  function makeRoot(rules) {
    return { oMask: 0, xMask: 0, triedO: 0, triedX: 0, turn: rules.startPlayer, obsO: '', obsX: '', moveNo: 0, last: null };
  }

  function occupiedMask(state) { return state.oMask | state.xMask; }
  function triedMask(state, player) { return player === O ? state.triedO : state.triedX; }
  function observation(state, player) { return player === O ? state.obsO : state.obsX; }

  function terminal(state) {
    if (hasWin(state.oMask)) return { done: true, winner: O };
    if (hasWin(state.xMask)) return { done: true, winner: X };
    if (occupiedMask(state) === FULL_MASK) return { done: true, winner: 0 };
    return { done: false, winner: null };
  }

  function utility(state, rootPlayer) {
    const t = terminal(state);
    if (!t.done) return null;
    if (t.winner === 0) return 0;
    return t.winner === rootPlayer ? 1 : -1;
  }

  function legalActions(state, rules, player = state.turn) {
    if (terminal(state).done) return [];
    const occ = occupiedMask(state);
    const tried = triedMask(state, player);
    const out = [];
    for (let move = 0; move < 9; move++) {
      const b = bit(move);
      if (rules.hiddenMask & b) {
        if (!(tried & b)) out.push(move);
      } else if (!(occ & b)) out.push(move);
    }
    return out;
  }

  function obsToken(before, after, actor, viewer, move, hidden) {
    if (!hidden) return `V${actor}${move};`;
    if (viewer !== actor) return 'H;';
    // A player remembers which mystery cell they attempted, but receives no
    // success/failure signal. Any certainty about ownership must be inferred
    // from the compatible histories, never injected as private feedback.
    return `P${move};`;
  }

  function applyAction(state, rules, move) {
    const actor = state.turn;
    if (!legalActions(state, rules, actor).includes(move)) return null;
    const b = bit(move);
    const hidden = Boolean(rules.hiddenMask & b);
    const success = !(occupiedMask(state) & b);
    const next = { ...state, moveNo: state.moveNo + 1, turn: other(actor) };

    if (hidden) {
      if (actor === O) next.triedO |= b; else next.triedX |= b;
      if (success) { if (actor === O) next.oMask |= b; else next.xMask |= b; }
    } else {
      if (actor === O) next.oMask |= b; else next.xMask |= b;
    }

    next.last = { actor, move, hidden, success };
    next.obsO = state.obsO + obsToken(state, next, actor, O, move, hidden);
    next.obsX = state.obsX + obsToken(state, next, actor, X, move, hidden);
    return next;
  }

  function informationKey(state, rules, player = state.turn) {
    return `${player}|${rules.startPlayer}|${rules.hiddenMask}|${observation(state, player)}`;
  }

  function stateKey(state) {
    return `${state.oMask}|${state.xMask}|${state.triedO}|${state.triedX}|${state.turn}|${state.obsO}|${state.obsX}`;
  }

  function boardArray(state) {
    const arr = Array(9).fill(EMPTY);
    for (let i = 0; i < 9; i++) {
      if (state.oMask & bit(i)) arr[i] = O;
      else if (state.xMask & bit(i)) arr[i] = X;
    }
    return arr;
  }

  function dedupeStates(states) {
    const map = new Map();
    for (const s of states) map.set(stateKey(s), s);
    return [...map.values()];
  }

  function updateBeliefs(worlds, rules, actualBefore, actualAfter, viewer) {
    if (!actualAfter || !actualAfter.last) return worlds;
    const { actor, move, hidden } = actualAfter.last;
    const actualTerm = terminal(actualAfter);
    const actualToken = observation(actualAfter, viewer).slice(observation(actualBefore, viewer).length);
    const candidates = [];

    for (const world of worlds) {
      let actions;
      if (viewer === actor || !hidden) actions = [move];
      else actions = legalActions(world, rules, actor).filter((a) => rules.hiddenMask & bit(a));

      for (const a of actions) {
        if (world.turn !== actor) continue;
        const next = applyAction(world, rules, a);
        if (!next) continue;
        const token = observation(next, viewer).slice(observation(world, viewer).length);
        if (token !== actualToken) continue;
        const t = terminal(next);
        if (t.done !== actualTerm.done) continue;
        if (actualTerm.done && t.winner !== actualTerm.winner) continue;
        candidates.push(next);
      }
    }
    return dedupeStates(candidates);
  }

  class BeliefTracker {
    constructor(rules) {
      this.rules = rules;
      const root = makeRoot(rules);
      this.worlds = { [O]: [root], [X]: [root] };
    }
    advance(before, after) {
      this.worlds[O] = updateBeliefs(this.worlds[O], this.rules, before, after, O);
      this.worlds[X] = updateBeliefs(this.worlds[X], this.rules, before, after, X);
    }
    for(player) { return this.worlds[player]; }
  }

  const oracleMemo = new Map();
  function oracleKey(state, rules, root) {
    return `${state.oMask}|${state.xMask}|${state.triedO}|${state.triedX}|${state.turn}|${rules.hiddenMask}|${root}`;
  }
  function oracleValue(state, rules, root) {
    const immediate = utility(state, root);
    if (immediate !== null) return immediate;
    const key = oracleKey(state, rules, root);
    if (oracleMemo.has(key)) return oracleMemo.get(key);
    const vals = legalActions(state, rules).map((a) => oracleValue(applyAction(state, rules, a), rules, root));
    const value = state.turn === root ? Math.max(...vals) : Math.min(...vals);
    oracleMemo.set(key, value);
    return value;
  }

  function assertInformationSetActions(worlds, rules, player) {
    if (!worlds.length) return [];
    const base = legalActions(worlds[0], rules, player);
    const sig = base.join(',');
    for (let i = 1; i < worlds.length; i++) {
      if (legalActions(worlds[i], rules, player).join(',') !== sig) throw new Error('Invalid information-set model: legal actions differ across indistinguishable histories.');
    }
    return base;
  }

  function beliefActionRows(worlds, rules, player) {
    const actions = assertInformationSetActions(worlds, rules, player);
    return actions.map((move) => {
      const values = [];
      for (const world of worlds) {
        const child = applyAction(world, rules, move);
        if (!child) throw new Error('Belief action unexpectedly illegal in one world.');
        values.push(oracleValue(child, rules, player));
      }
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      return { move, mean, worst: Math.min(...values), best: Math.max(...values), values };
    }).sort((a, b) => b.mean - a.mean || b.worst - a.worst || a.move - b.move);
  }

  function softmaxPolicy(rows, beta = 2.2) {
    if (!rows.length) return [];
    const max = Math.max(...rows.map((r) => beta * r.mean));
    const weights = rows.map((r) => Math.exp(beta * r.mean - max));
    const total = weights.reduce((a, b) => a + b, 0);
    return rows.map((r, i) => ({ move: r.move, prob: weights[i] / total, score: r.mean }));
  }

  function normalizePolicy(items) {
    const total = items.reduce((s, x) => s + Math.max(0, x.prob), 0);
    if (total <= 0) return items.map((x) => ({ ...x, prob: 1 / items.length }));
    return items.map((x) => ({ ...x, prob: Math.max(0, x.prob) / total }));
  }

  function samplePolicy(policy, rng = Math.random) {
    const p = normalizePolicy(policy);
    let draw = rng();
    for (const item of p) { draw -= item.prob; if (draw <= 0) return item.move; }
    return p[p.length - 1]?.move ?? null;
  }

  class RNG {
    constructor(seed = 0x9e3779b9) { this.s = seed >>> 0 || 1; }
    next() {
      let x = this.s;
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
      this.s = x >>> 0;
      return this.s / 4294967296;
    }
  }

  class OutcomeSamplingMCCFR {
    constructor(rules, seed = 20260903, exploration = 0.6) {
      this.rules = rules;
      this.nodes = new Map();
      this.iterations = 0;
      this.rng = new RNG(seed ^ rules.hiddenMask ^ (rules.startPlayer << 12));
      this.exploration = exploration;
      this.episodes = 0;
    }

    getNode(state) {
      const actor = state.turn;
      const key = informationKey(state, this.rules, actor);
      const actions = legalActions(state, this.rules, actor);
      let node = this.nodes.get(key);
      if (!node) {
        node = { key, player: actor, actions: actions.slice(), regrets: new Float64Array(actions.length), strategySum: new Float64Array(actions.length), regretVisits: 0, averageVisits: 0 };
        this.nodes.set(key, node);
      } else if (node.actions.join(',') !== actions.join(',')) {
        throw new Error('Perfect-recall/info-set violation: same information key has different legal actions.');
      }
      return node;
    }

    currentPolicy(node) {
      let total = 0;
      const pos = new Float64Array(node.regrets.length);
      for (let i = 0; i < node.regrets.length; i++) { pos[i] = Math.max(0, node.regrets[i]); total += pos[i]; }
      if (total <= 1e-15) { const u = 1 / node.regrets.length; return Array.from(pos, () => u); }
      return Array.from(pos, (x) => x / total);
    }

    averagePolicy(node) {
      let total = 0;
      for (const x of node.strategySum) total += x;
      if (total <= 1e-15) return this.currentPolicy(node);
      return Array.from(node.strategySum, (x) => x / total);
    }

    sampleIndex(probs) {
      let r = this.rng.next();
      for (let i = 0; i < probs.length; i++) { r -= probs[i]; if (r <= 0) return i; }
      return probs.length - 1;
    }

    episode(state, updatePlayer, myReach, oppReach, sampleReach) {
      const u = utility(state, updatePlayer);
      if (u !== null) return u;

      const actor = state.turn;
      const node = this.getNode(state);
      const policy = this.currentPolicy(node);
      const n = node.actions.length;
      const samplePolicy = policy.slice();
      if (actor === updatePlayer) {
        const uniform = 1 / n;
        for (let i = 0; i < n; i++) samplePolicy[i] = this.exploration * uniform + (1 - this.exploration) * policy[i];
      }

      const sampledIndex = this.sampleIndex(samplePolicy);
      const child = applyAction(state, this.rules, node.actions[sampledIndex]);
      const newMyReach = actor === updatePlayer ? myReach * policy[sampledIndex] : myReach;
      const newOppReach = actor === updatePlayer ? oppReach : oppReach * policy[sampledIndex];
      const newSampleReach = sampleReach * samplePolicy[sampledIndex];
      const childValue = this.episode(child, updatePlayer, newMyReach, newOppReach, newSampleReach);

      const childValues = new Float64Array(n);
      childValues[sampledIndex] = childValue / samplePolicy[sampledIndex];
      let valueEstimate = 0;
      for (let i = 0; i < n; i++) valueEstimate += policy[i] * childValues[i];

      if (actor === updatePlayer) {
        const cfValue = valueEstimate * oppReach / sampleReach;
        for (let i = 0; i < n; i++) {
          const cfActionValue = childValues[i] * oppReach / sampleReach;
          node.regrets[i] += cfActionValue - cfValue;
          node.strategySum[i] += myReach * policy[i] / sampleReach;
        }
        node.regretVisits += 1;
        node.averageVisits += 1;
      }
      return valueEstimate;
    }

    train(iterations = 1) {
      for (let i = 0; i < iterations; i++) {
        this.episode(makeRoot(this.rules), O, 1, 1, 1);
        this.episode(makeRoot(this.rules), X, 1, 1, 1);
        this.iterations += 1;
        this.episodes += 2;
      }
      return this;
    }

    policy(state, average = true) {
      const node = this.getNode(state);
      const probs = average ? this.averagePolicy(node) : this.currentPolicy(node);
      return node.actions.map((move, i) => ({ move, prob: probs[i] }));
    }
  }

  function chooseStrategy(name, context) {
    const { state, rules, beliefs, solver, rng = Math.random } = context;
    const player = state.turn;
    const rows = () => beliefActionRows(beliefs, rules, player);

    if (name === 'belief') return rows()[0]?.move ?? null;
    if (name === 'softmax') return samplePolicy(softmaxPolicy(rows()), rng);
    if (name === 'robust') return rows().slice().sort((a, b) => b.worst - a.worst || b.mean - a.mean || a.move - b.move)[0]?.move ?? null;
    if (name === 'thompson') {
      if (!beliefs.length) return legalActions(state, rules)[0] ?? null;
      const world = beliefs[Math.floor(rng() * beliefs.length)];
      let bestMove = null, best = -Infinity;
      for (const move of legalActions(world, rules, player)) {
        const v = oracleValue(applyAction(world, rules, move), rules, player);
        if (v > best || (v === best && (bestMove === null || move < bestMove))) { best = v; bestMove = move; }
      }
      return bestMove;
    }
    if (name === 'random') {
      const acts = legalActions(state, rules);
      return acts[Math.floor(rng() * acts.length)] ?? null;
    }
    if (name === 'oracle') {
      let bestMove = null, best = -Infinity;
      for (const move of legalActions(state, rules)) {
        const v = oracleValue(applyAction(state, rules, move), rules, player);
        if (v > best || (v === best && (bestMove === null || move < bestMove))) { best = v; bestMove = move; }
      }
      return bestMove;
    }
    if (name === 'extensive') {
      const policy = solver.policy(state, true).slice().sort((a, b) => b.prob - a.prob || a.move - b.move);
      return policy[0]?.move ?? null;
    }
    if (name === 'nash') return samplePolicy(solver.policy(state, true), rng);
    throw new Error(`Unknown strategy: ${name}`);
  }

  const STRATEGIES = [
    { id: 'belief', name: 'Belief Search', family: 'Deterministic heuristic', play: true, sim: true },
    { id: 'softmax', name: 'Softmax Mixed', family: 'Stochastic heuristic', play: true, sim: true },
    { id: 'extensive', name: 'Extensive CFR (modal)', family: 'Extensive-form projection', play: true, sim: true },
    { id: 'nash', name: 'Equilibrium Mixed (MCCFR)', family: 'Behavioral mixed strategy', play: true, sim: true },
    { id: 'robust', name: 'Robust Maximin', family: 'Ambiguity-averse', play: true, sim: true },
    { id: 'thompson', name: 'Thompson World Sampling', family: 'Bayesian-style randomized', play: true, sim: true },
    { id: 'random', name: 'Uniform Random', family: 'Baseline', play: true, sim: true },
    { id: 'oracle', name: 'Omniscient Oracle', family: 'Cheating benchmark', play: false, sim: true }
  ];

  global.TTNTheory = { X, O, EMPTY, WIN_MASKS, INFORMATION_MODEL, other, symbol, bit, popcount, maskToMoves, movesToMask, makeRules, makeRoot, terminal, utility, legalActions, applyAction, informationKey, boardArray, stateKey, updateBeliefs, BeliefTracker, oracleValue, beliefActionRows, softmaxPolicy, samplePolicy, RNG, OutcomeSamplingMCCFR, chooseStrategy, STRATEGIES };
})(window);