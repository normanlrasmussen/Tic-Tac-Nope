const X = 1;
const O = 2;
const EMPTY = 0;

const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

const $ = (id) => document.getElementById(id);
const boardEl = $('board');
const hiddenPickerEl = $('hidden-picker');
const messageEl = $('move-message');

let selectedHidden = new Set([1, 3]);
let aiMode = 'optimal';
let state = null;
let stats = { wins: 0, losses: 0, draws: 0 };
let aiTimer = null;

function other(tile) { return tile === O ? X : O; }
function symbol(tile) { return tile === O ? 'O' : tile === X ? 'X' : ''; }
function cloneBoard(board) { return board.slice(); }
function boardKey(board) { return board.join(''); }
function setKey(setLike) { return [...setLike].sort((a, b) => a - b).join(','); }
function worldKey(world) { return `${boardKey(world.board)}|${setKey(world.oppTried)}`; }
function cloneWorld(world) {
  return { board: cloneBoard(world.board), oppTried: new Set(world.oppTried) };
}
function uniqueWorlds(worlds) {
  const map = new Map();
  for (const world of worlds) map.set(worldKey(world), world);
  return [...map.values()];
}

function winner(board) {
  for (const [a, b, c] of WIN_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return 0;
}
function full(board) { return board.every((v) => v !== EMPTY); }
function terminal(board) {
  const w = winner(board);
  if (w) return { done: true, winner: w };
  if (full(board)) return { done: true, winner: 0 };
  return { done: false, winner: null };
}
function utility(board, root) {
  const t = terminal(board);
  if (!t.done) return null;
  if (t.winner === 0) return 0;
  return t.winner === root ? 1 : -1;
}

// Perfect-information continuation evaluator.
// IMPORTANT: this is only the continuation approximation. The current action
// is still constrained to be one common action across the acting player's
// entire information set.
const mmMemo = new Map();
function minimax(board, toMove, root) {
  const term = utility(board, root);
  if (term !== null) return term;
  const key = `${boardKey(board)}|${toMove}|${root}`;
  if (mmMemo.has(key)) return mmMemo.get(key);
  const vals = [];
  for (let move = 0; move < 9; move++) {
    if (board[move] !== EMPTY) continue;
    const next = cloneBoard(board);
    next[move] = toMove;
    vals.push(minimax(next, other(toMove), root));
  }
  const answer = toMove === root ? Math.max(...vals) : Math.min(...vals);
  mmMemo.set(key, answer);
  return answer;
}

function makeState() {
  const hidden = [...selectedHidden].sort((a, b) => a - b);
  const baseWorld = { board: Array(9).fill(EMPTY), oppTried: new Set() };
  const next = {
    actual: Array(9).fill(EMPTY),
    hidden,
    turn: O,
    over: false,
    humanWorlds: [cloneWorld(baseWorld)],
    aiWorlds: [cloneWorld(baseWorld)],
    humanTried: new Set(),
    aiTried: new Set(),
    moveNo: 0,
    lastAction: null,
    history: [],
    moveLog: [],
  };
  return next;
}

function isHidden(move) { return state.hidden.includes(move); }
function worldsFor(tile) { return tile === O ? state.humanWorlds : state.aiWorlds; }
function setWorldsFor(tile, worlds) {
  const clean = uniqueWorlds(worlds);
  if (tile === O) state.humanWorlds = clean;
  else state.aiWorlds = clean;
}
function triedFor(tile) { return tile === O ? state.humanTried : state.aiTried; }

function legalMovesForActor(tile) {
  const tried = triedFor(tile);
  const moves = [];
  for (let move = 0; move < 9; move++) {
    if (isHidden(move)) {
      if (!tried.has(move)) moves.push(move);
    } else if (state.actual[move] === EMPTY) {
      moves.push(move);
    }
  }
  return moves;
}

function updateVisibleMove(move, tile) {
  for (const viewer of [O, X]) {
    const updated = worldsFor(viewer)
      .filter((world) => world.board[move] === EMPTY)
      .map((world) => {
        const next = cloneWorld(world);
        next.board[move] = tile;
        return next;
      });
    setWorldsFor(viewer, updated);
  }
}

// The actor observes which specific mystery cell they attempted and what is
// actually in that cell afterward. We filter their information states by that
// observation while preserving uncertainty everywhere else.
function updateActorAfterHidden(move, tile) {
  const actualOccupant = state.actual[move];
  const candidates = [];
  for (const world of worldsFor(tile)) {
    if (triedFor(tile).has(move)) continue;
    const next = cloneWorld(world);
    if (next.board[move] === EMPTY) next.board[move] = tile;
    if (next.board[move] === actualOccupant) candidates.push(next);
  }
  setWorldsFor(tile, candidates);
}

// The opponent sees only that a fog action occurred. Their information state
// therefore branches over every mystery square the actor might legally have
// attempted in that hypothetical world. We track a hypothetical opponent-tried
// set inside each world; board alone is not enough to represent the history.
function updateOpponentAfterHidden(tile) {
  const viewer = other(tile);
  const branches = [];
  for (const world of worldsFor(viewer)) {
    for (const hiddenMove of state.hidden) {
      if (world.oppTried.has(hiddenMove)) continue;
      const next = cloneWorld(world);
      next.oppTried.add(hiddenMove);
      if (next.board[hiddenMove] === EMPTY) next.board[hiddenMove] = tile;
      branches.push(next);
    }
  }
  setWorldsFor(viewer, branches);
}

function applyMove(move, tile) {
  if (!state || state.over || state.turn !== tile) return;
  if (!legalMovesForActor(tile).includes(move)) return;

  const hidden = isHidden(move);
  let success = false;

  if (hidden) {
    if (state.actual[move] === EMPTY) {
      state.actual[move] = tile;
      success = true;
    }
    updateActorAfterHidden(move, tile);
    triedFor(tile).add(move);
    updateOpponentAfterHidden(tile);
  } else {
    state.actual[move] = tile;
    success = true;
    updateVisibleMove(move, tile);
  }

  state.moveNo += 1;
  state.lastAction = { move, tile, hidden, success };
  state.moveLog.push({ move, tile, hidden, success });

  const finished = terminal(state.actual);
  if (finished.done) {
    state.over = true;
    if (finished.winner === O) stats.wins += 1;
    else if (finished.winner === X) stats.losses += 1;
    else stats.draws += 1;
    recordHistory(`${symbol(tile)}${state.moveNo}`, tile);
    saveStats();
    renderAll();
    messageEl.textContent = finished.winner === O
      ? 'You win. The real hidden board is revealed below.'
      : finished.winner === X
        ? 'AI wins. The real hidden board is revealed below.'
        : 'Draw. The real hidden board is revealed below.';
    return;
  }

  state.turn = other(tile);
  recordHistory(`${symbol(tile)}${state.moveNo}`, tile);
  renderAll();

  if (tile === O) {
    messageEl.textContent = hidden
      ? (success
        ? `You privately claimed mystery cell ${move + 1}. The AI knows only that you played somewhere in the fog.`
        : `Mystery cell ${move + 1} was already occupied. Your attempt consumed the turn.`)
      : `You placed O in cell ${move + 1}.`;
    scheduleAi();
  } else {
    messageEl.textContent = hidden
      ? 'The AI played somewhere in the fog. Your information set has branched.'
      : `The AI revealed X in cell ${move + 1}.`;
  }
}

function actionLegalInWorld(world, move, actor) {
  if (isHidden(move)) return !triedFor(actor).has(move);
  return world.board[move] === EMPTY;
}

function applyActionToWorld(world, move, actor) {
  const board = cloneBoard(world.board);
  if (isHidden(move)) {
    if (board[move] === EMPTY) board[move] = actor;
  } else if (board[move] === EMPTY) {
    board[move] = actor;
  }
  return board;
}

function scoreActionInWorld(world, actor, move) {
  if (!actionLegalInWorld(world, move, actor)) return null;
  const board = applyActionToWorld(world, move, actor);
  const immediate = utility(board, actor);
  return immediate !== null ? immediate : minimax(board, other(actor), actor);
}

function scoreActionForWorlds(actor, move) {
  const worlds = worldsFor(actor);
  if (!worlds.length) return -1;
  let sum = 0;
  let count = 0;
  for (const world of worlds) {
    const value = scoreActionInWorld(world, actor, move);
    if (value === null) continue;
    sum += value;
    count += 1;
  }
  return count ? sum / count : -1;
}

function actionScores(actor) {
  const rows = legalMovesForActor(actor).map((move) => ({
    move,
    score: scoreActionForWorlds(actor, move),
  }));
  rows.sort((a, b) => b.score - a.score || a.move - b.move);
  return rows;
}

function chooseAiMove() {
  const scores = actionScores(X);
  if (!scores.length) return null;
  if (aiMode === 'optimal') return scores[0].move;

  // Softmax normalization: better actions are exponentially more likely, but
  // every legal action retains positive probability.
  const beta = 2.2;
  const weights = scores.map((row) => Math.exp(beta * row.score));
  const total = weights.reduce((a, b) => a + b, 0);
  let draw = Math.random() * total;
  for (let i = 0; i < scores.length; i++) {
    draw -= weights[i];
    if (draw <= 0) return scores[i].move;
  }
  return scores[scores.length - 1].move;
}

function scheduleAi() {
  if (state.over || state.turn !== X) return;
  clearTimeout(aiTimer);
  $('thinking').hidden = false;
  aiTimer = setTimeout(() => {
    $('thinking').hidden = true;
    const move = chooseAiMove();
    if (move !== null) applyMove(move, X);
  }, 450);
}

function boardDisplayValue(move) {
  if (!state) return { text: '', cls: '' };
  const real = state.actual[move];
  if (state.over || !isHidden(move)) {
    return { text: symbol(real), cls: real === O ? 'o' : real === X ? 'x' : '' };
  }

  // A hidden cell is shown only when all of the human's information states
  // agree on its occupant. Otherwise it remains a question mark.
  const occupants = new Set(state.humanWorlds.map((world) => world.board[move]));
  if (occupants.size === 1) {
    const value = [...occupants][0];
    return { text: symbol(value) || '·', cls: value === O ? 'o known' : value === X ? 'x known' : 'known' };
  }
  return { text: '?', cls: 'fog' };
}

function renderBoard() {
  boardEl.innerHTML = '';
  const legal = state && state.turn === O && !state.over ? new Set(legalMovesForActor(O)) : new Set();
  for (let move = 0; move < 9; move++) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cell';
    button.setAttribute('role', 'gridcell');
    const display = boardDisplayValue(move);
    button.textContent = display.text;
    if (display.cls) button.classList.add(...display.cls.split(' '));
    if (isHidden(move)) button.classList.add('mystery');
    if (state?.lastAction?.move === move) button.classList.add('last');
    button.disabled = !legal.has(move);
    button.setAttribute('aria-label', `Cell ${move + 1}${isHidden(move) ? ', mystery cell' : ''}${display.text ? `, ${display.text}` : ''}`);
    button.addEventListener('click', () => applyMove(move, O));
    boardEl.appendChild(button);
  }
}

function entropy(n) { return n > 0 ? Math.log2(n) : 0; }
function humanBest() { return state && !state.over ? actionScores(O)[0] : null; }

function classifyValue(value) {
  if (value > 0) return 'win';
  if (value < 0) return 'loss';
  return 'draw';
}

function forecastFromWorlds(worlds, root = O, toMove = state.turn) {
  if (!worlds.length) return { win: 0, draw: 0, loss: 0 };
  let win = 0;
  let draw = 0;
  let loss = 0;
  for (const world of worlds) {
    const immediate = utility(world.board, root);
    const value = immediate !== null ? immediate : minimax(world.board, toMove, root);
    const cls = classifyValue(value);
    if (cls === 'win') win += 1;
    else if (cls === 'loss') loss += 1;
    else draw += 1;
  }
  const n = worlds.length;
  return { win: win / n, draw: draw / n, loss: loss / n };
}

function trueStateClass(root = O, toMove = state.turn) {
  const immediate = utility(state.actual, root);
  const value = immediate !== null ? immediate : minimax(state.actual, toMove, root);
  return classifyValue(value);
}

function actualWorldMass() {
  const worlds = state.humanWorlds;
  if (!worlds.length) return 0;
  // Board-only match is used here because the player's information-state card
  // also contains a hypothetical opponent-tried history. Multiple history
  // states can share the same real board.
  const matches = worlds.filter((world) => boardKey(world.board) === boardKey(state.actual)).length;
  return matches / worlds.length;
}

function recordHistory(label, actor = null) {
  const confidence = forecastFromWorlds(state.humanWorlds, O, state.turn);
  state.history.push({
    step: state.history.length,
    moveNo: state.moveNo,
    label,
    actor,
    confidence,
    worlds: state.humanWorlds.length,
    entropy: entropy(state.humanWorlds.length),
    trueClass: trueStateClass(O, state.turn),
    truthMass: actualWorldMass(),
    actual: cloneBoard(state.actual),
  });
}

function renderLiveInsights() {
  const n = state.humanWorlds.length;
  $('live-worlds').textContent = n;
  $('live-worlds-detail').textContent = n === 1 ? 'one information state fits' : `${n} information states remain`;
  $('live-entropy').textContent = `${entropy(n).toFixed(2)} bits`;
  const best = humanBest();
  $('live-best').textContent = best ? `Cell ${best.move + 1}` : '—';
  $('live-best-detail').textContent = best ? `aggregate value ${best.score.toFixed(2)}` : 'game complete';

  const f = forecastFromWorlds(state.humanWorlds, O, state.turn);
  $('forecast-bars').innerHTML = [
    ['Win', f.win, 'good'], ['Draw', f.draw, 'draw'], ['Loss', f.loss, 'bad'],
  ].map(([label, value, cls]) => `<div><span>${label}</span><div class="bar"><i class="${cls}" style="width:${value * 100}%"></i></div><strong>${Math.round(value * 100)}%</strong></div>`).join('');
}

function renderStatus() {
  if (state.over) {
    const result = terminal(state.actual);
    $('status-title').textContent = result.winner === O ? 'You won · O' : result.winner === X ? 'AI won · X' : 'Draw';
    $('status-detail').textContent = 'The true hidden board is now revealed.';
    $('turn-symbol').textContent = '•';
    return;
  }
  $('status-title').textContent = state.turn === O ? 'Your turn · O' : 'AI thinking · X';
  $('status-detail').textContent = state.turn === O
    ? 'Choose one action using only what you know.'
    : aiMode === 'optimal'
      ? 'AI is choosing the highest equal-belief current-action value.'
      : 'AI is sampling from softmax-normalized action values.';
  $('turn-symbol').textContent = symbol(state.turn);
}

function renderPicker() {
  hiddenPickerEl.innerHTML = '';
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
      $('setup-note').textContent = 'The locations are known. Moves made inside them are private.';
      renderPicker();
    });
    hiddenPickerEl.appendChild(button);
  }
  $('hidden-count-badge').textContent = `${selectedHidden.size} hidden`;
}

function renderStats() {
  const total = stats.wins + stats.losses + stats.draws;
  $('record-total').textContent = total;
  const entries = [['Wins', stats.wins, 'good'], ['Draws', stats.draws, 'draw'], ['Losses', stats.losses, 'bad']];
  $('record-bars').innerHTML = entries.map(([label, value, cls]) => {
    const p = total ? value / total : 0;
    return `<div><span>${label}</span><div class="bar"><i class="${cls}" style="width:${p * 100}%"></i></div><strong>${Math.round(p * 100)}%</strong></div>`;
  }).join('');

  const worlds = state.humanWorlds;
  $('stats-worlds').textContent = worlds.length;
  $('stats-entropy').textContent = `${entropy(worlds.length).toFixed(2)} bits`;
  $('world-prob').textContent = `${(100 / worlds.length).toFixed(worlds.length > 9 ? 1 : 0)}% each`;
  renderFogPressure(worlds);
  renderActionSpectrum();
  renderWorlds(worlds);
}

function renderFogPressure(worlds) {
  const html = [];
  for (let move = 0; move < 9; move++) {
    let o = 0;
    let x = 0;
    for (const world of worlds) {
      if (world.board[move] === O) o += 1;
      else if (world.board[move] === X) x += 1;
    }
    const n = worlds.length || 1;
    html.push(`<div class="pressure-cell ${isHidden(move) ? 'mystery' : ''}"><b>${move + 1}</b><span class="pressure-o" style="width:${o / n * 100}%"></span><span class="pressure-x" style="width:${x / n * 100}%"></span><small>${Math.round(o / n * 100)}O · ${Math.round(x / n * 100)}X</small></div>`);
  }
  $('fog-pressure').innerHTML = html.join('');
}

function renderActionSpectrum() {
  if (state.over) {
    $('action-spectrum').innerHTML = '<p class="muted">Start a new match to evaluate actions.</p>';
    return;
  }
  const rows = actionScores(O);
  if (!rows.length) {
    $('action-spectrum').innerHTML = '<p class="muted">No legal actions remain.</p>';
    return;
  }
  $('action-spectrum').innerHTML = rows.map((row, index) => {
    const pos = (row.score + 1) / 2 * 100;
    return `<div class="action-row ${index === 0 ? 'best' : ''}"><span>Cell ${row.move + 1}${isHidden(row.move) ? ' ?' : ''}</span><div class="value-track"><i style="width:${pos}%"></i><em></em></div><strong>${row.score.toFixed(2)}</strong></div>`;
  }).join('');
}

function miniBoardHtml(board) {
  return board.map((value, move) => `<i class="${value === O ? 'o' : value === X ? 'x' : ''} ${isHidden(move) ? 'fog' : ''}">${symbol(value)}</i>`).join('');
}

function renderWorlds(worlds) {
  const max = 18;
  const shown = worlds.slice(0, max);
  $('possible-worlds').innerHTML = shown.map((world, index) => `<div class="world-card"><div class="world-label">STATE ${String(index + 1).padStart(2, '0')} · opp tries ${world.oppTried.size}</div><div class="world-grid">${miniBoardHtml(world.board)}</div></div>`).join('')
    + (worlds.length > max ? `<div class="world-more">+${worlds.length - max}<br><small>more equal-weight information states</small></div>` : '');
}

function stateMoveValues(world) {
  const values = [];
  for (let move = 0; move < 9; move++) {
    if (!legalMovesForActor(O).includes(move)) {
      values.push(null);
      continue;
    }
    values.push(scoreActionInWorld(world, O, move));
  }
  return values;
}

function valueClass(value) {
  if (value === null) return 'na';
  if (value > 0) return 'positive';
  if (value < 0) return 'negative';
  return 'neutral';
}

function renderPlayInfoStates() {
  const worlds = state.humanWorlds;
  $('play-world-prob').textContent = `${(100 / worlds.length).toFixed(worlds.length > 9 ? 1 : 0)}% each`;
  const max = 18;
  const shown = worlds.slice(0, max);
  $('play-info-states').innerHTML = shown.map((world, index) => {
    const values = stateMoveValues(world);
    const valueGrid = values.map((value, move) => `<div class="state-value ${valueClass(value)}"><span>${move + 1}</span><strong>${value === null ? '—' : value.toFixed(0)}</strong></div>`).join('');
    const oppTries = world.oppTried.size ? [...world.oppTried].sort((a, b) => a - b).map((m) => m + 1).join(', ') : 'none';
    return `<article class="info-state-card"><header><span>STATE ${String(index + 1).padStart(2, '0')}</span><small>possible AI fog tries: ${oppTries}</small></header><div class="info-state-body"><div class="world-grid large">${miniBoardHtml(world.board)}</div><div><div class="value-caption">O move values</div><div class="state-value-grid">${valueGrid}</div></div></div></article>`;
  }).join('') + (worlds.length > max ? `<div class="world-more">+${worlds.length - max}<br><small>more states in Analysis</small></div>` : '');
}

function linePoints(values, width, height, pad) {
  if (values.length === 1) return `${pad},${height - pad - values[0] * (height - 2 * pad)}`;
  return values.map((value, index) => {
    const x = pad + index * (width - 2 * pad) / (values.length - 1);
    const y = height - pad - value * (height - 2 * pad);
    return `${x},${y}`;
  }).join(' ');
}

function renderTimeline() {
  const el = $('confidence-timeline');
  const history = state.history;
  if (!history.length) {
    el.innerHTML = '<p class="muted">Make a move to start the confidence timeline.</p>';
    return;
  }
  const width = 900;
  const height = 290;
  const pad = 34;
  const win = history.map((h) => h.confidence.win);
  const draw = history.map((h) => h.confidence.draw);
  const loss = history.map((h) => h.confidence.loss);
  const ticks = history.map((h, index) => {
    const x = history.length === 1 ? pad : pad + index * (width - 2 * pad) / (history.length - 1);
    return `<g><line x1="${x}" y1="${height - pad}" x2="${x}" y2="${height - pad + 5}"/><text x="${x}" y="${height - 8}" text-anchor="middle">${h.label}</text></g>`;
  }).join('');
  const grid = [0, .25, .5, .75, 1].map((v) => {
    const y = height - pad - v * (height - 2 * pad);
    return `<g><line class="gridline" x1="${pad}" y1="${y}" x2="${width - pad}" y2="${y}"/><text x="${pad - 8}" y="${y + 4}" text-anchor="end">${Math.round(v * 100)}%</text></g>`;
  }).join('');
  el.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Win draw loss confidence over time">${grid}<polyline class="timeline-line win" points="${linePoints(win, width, height, pad)}"/><polyline class="timeline-line draw" points="${linePoints(draw, width, height, pad)}"/><polyline class="timeline-line loss" points="${linePoints(loss, width, height, pad)}"/>${ticks}</svg><div class="timeline-table">${history.map((h) => `<div><strong>${h.label}</strong><span class="green">W ${Math.round(h.confidence.win * 100)}%</span><span class="gold">D ${Math.round(h.confidence.draw * 100)}%</span><span class="red">L ${Math.round(h.confidence.loss * 100)}%</span><small>${h.worlds} states · truth mass ${Math.round(h.truthMass * 100)}%</small></div>`).join('')}</div>`;
}

function renderTruthReveal() {
  const el = $('truth-reveal');
  if (!state.over) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  el.hidden = false;
  const result = terminal(state.actual);
  const resultLabel = result.winner === O ? 'WIN' : result.winner === X ? 'LOSS' : 'DRAW';
  const resultClass = result.winner === O ? 'green' : result.winner === X ? 'red' : 'gold';
  const before = state.history.length > 1 ? state.history[state.history.length - 2] : state.history[0];
  const actualBoard = `<div class="world-grid truth-board">${miniBoardHtml(state.actual)}</div>`;
  el.innerHTML = `<div class="truth-head"><div><p class="kicker">TRUTH REVEAL</p><h3>What was actually underneath the uncertainty</h3></div><strong class="truth-result ${resultClass}">${resultLabel}</strong></div><div class="truth-grid"><div>${actualBoard}</div><div><span>Belief just before the final reveal</span><strong>W ${Math.round(before.confidence.win * 100)}% · D ${Math.round(before.confidence.draw * 100)}% · L ${Math.round(before.confidence.loss * 100)}%</strong><small>${before.worlds} equal-weight information states</small></div><div><span>Realized outcome</span><strong class="${resultClass}">${resultLabel} 100%</strong><small>Once the actual world is revealed, the realized outcome is no longer uncertain.</small></div><div><span>Mass assigned to the true board</span><strong>${Math.round(before.truthMass * 100)}%</strong><small>Fraction of your equal-weight information states whose board matched reality.</small></div></div>`;
}

function saveStats() {
  try { window.localStorage.setItem('ttn-stats', JSON.stringify(stats)); } catch {}
}
function loadStats() {
  try {
    const saved = JSON.parse(window.localStorage.getItem('ttn-stats') || 'null');
    if (saved && Number.isFinite(saved.wins) && Number.isFinite(saved.losses) && Number.isFinite(saved.draws)) stats = saved;
  } catch {}
}

function renderAll() {
  renderBoard();
  renderStatus();
  renderLiveInsights();
  renderStats();
  renderPlayInfoStates();
  renderTimeline();
  renderTruthReveal();
}

function newGame() {
  clearTimeout(aiTimer);
  $('thinking').hidden = true;
  state = makeState();
  recordHistory('Start');
  messageEl.textContent = 'New game. You move first as O.';
  renderAll();
}

function setPage(page) {
  document.querySelectorAll('.page').forEach((el) => el.classList.toggle('active', el.id === `page-${page}`));
  document.querySelectorAll('.nav-btn').forEach((el) => el.classList.toggle('active', el.dataset.page === page));
  if (page === 'stats') renderStats();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.querySelectorAll('[data-page]').forEach((button) => button.addEventListener('click', () => setPage(button.dataset.page)));
document.querySelectorAll('[data-ai]').forEach((button) => button.addEventListener('click', () => {
  aiMode = button.dataset.ai;
  document.querySelectorAll('[data-ai]').forEach((candidate) => candidate.classList.toggle('active', candidate.dataset.ai === aiMode));
  if (state) renderStatus();
}));
$('new-game').addEventListener('click', newGame);

loadStats();
renderPicker();
newGame();
