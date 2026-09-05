#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

global.window = global;
require('./web/game_theory_engine.js');
const T = global.TTNTheory;

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

function parseHidden(text) {
  const cells = [...new Set(String(text || '').split(',').map((x) => Number.parseInt(x.trim(), 10)).filter(Number.isFinite))].sort((a, b) => a - b);
  if (cells.length < 2 || cells.some((x) => x < 1 || x > 9)) {
    throw new Error('--hidden must contain at least two 1-based cells in 1..9, e.g. --hidden 2,4');
  }
  return cells;
}

const hidden = parseHidden(arg('hidden'));
const startText = String(arg('start', 'O')).toUpperCase();
if (!['O', 'X'].includes(startText)) throw new Error('--start must be O or X');
const iterations = Math.max(1, Number.parseInt(arg('iterations', '1000000'), 10));
const seed = Number.parseInt(arg('seed', '20260903'), 10) >>> 0;
const exploration = Number.parseFloat(arg('exploration', '0.6'));
const output = arg('output');
if (!output) throw new Error('--output is required');

const hiddenMoves = hidden.map((x) => x - 1);
const startPlayer = startText === 'O' ? T.O : T.X;
const rules = T.makeRules(hiddenMoves, startPlayer);
const solver = new T.OutcomeSamplingMCCFR(rules, seed, exploration);

const chunk = Math.min(100000, iterations);
let done = 0;
while (done < iterations) {
  const n = Math.min(chunk, iterations - done);
  solver.train(n);
  done += n;
  process.stdout.write(`\rMCCFR hidden=${hidden.join(',')} start=${startText}: ${done.toLocaleString()} / ${iterations.toLocaleString()} iterations`);
}
process.stdout.write('\n');

const policy = { O: {}, X: {} };
for (const [key, node] of solver.nodes.entries()) {
  const probs = solver.averagePolicy(node);
  const table = {};
  node.actions.forEach((move, i) => { table[String(move)] = probs[i]; });
  policy[node.player === T.O ? 'O' : 'X'][key] = table;
}

const artifact = {
  schema: 1,
  solver: 'OutcomeSamplingMCCFR',
  game: 'Tic-Tac-Nope',
  hidden,
  hiddenMask: rules.hiddenMask,
  startPlayer: startText,
  iterations: solver.iterations,
  episodes: solver.episodes,
  seed,
  exploration,
  informationSets: solver.nodes.size,
  policy,
  notes: [
    'This is the time-averaged behavioral policy produced by the same OutcomeSamplingMCCFR implementation used by the website.',
    'Finite MCCFR training is approximate; it is not an exact Nash certificate.',
    'Information sets not visited during sampling are omitted and should use a documented fallback if queried.'
  ]
};

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(artifact));
const mb = fs.statSync(output).size / 1024 / 1024;
console.log(`Wrote ${output} (${mb.toFixed(2)} MiB, ${solver.nodes.size.toLocaleString()} information sets)`);
