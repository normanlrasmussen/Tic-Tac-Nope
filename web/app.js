const X = 1;
const O = 2;
const EMPTY = 0;

const WIN_LINES = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6],
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

function other(tile){ return tile === O ? X : O; }
function symbol(tile){ return tile === O ? 'O' : tile === X ? 'X' : ''; }
function cloneBoard(board){ return board.slice(); }
function keyBoard(board){ return board.join(''); }
function uniqueBoards(boards){
  const map = new Map();
  for(const b of boards) map.set(keyBoard(b), b);
  return [...map.values()];
}
function winner(board){
  for(const [a,b,c] of WIN_LINES){
    if(board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return 0;
}
function full(board){ return board.every(v => v !== EMPTY); }
function terminal(board){
  const w = winner(board);
  if(w) return {done:true, winner:w};
  if(full(board)) return {done:true, winner:0};
  return {done:false, winner:null};
}
function utility(board, root){
  const t = terminal(board);
  if(!t.done) return null;
  if(t.winner === 0) return 0;
  return t.winner === root ? 1 : -1;
}

const mmMemo = new Map();
function minimax(board, toMove, root){
  const term = utility(board, root);
  if(term !== null) return term;
  const k = `${keyBoard(board)}|${toMove}|${root}`;
  if(mmMemo.has(k)) return mmMemo.get(k);
  const vals = [];
  for(let i=0;i<9;i++){
    if(board[i] !== EMPTY) continue;
    const b = cloneBoard(board);
    b[i] = toMove;
    vals.push(minimax(b, other(toMove), root));
  }
  const ans = toMove === root ? Math.max(...vals) : Math.min(...vals);
  mmMemo.set(k, ans);
  return ans;
}

function baseBeliefBoard(hidden){
  return Array(9).fill(EMPTY);
}

function makeState(){
  const hidden = [...selectedHidden].sort((a,b)=>a-b);
  return {
    actual: Array(9).fill(EMPTY),
    hidden,
    turn: O,
    over: false,
    humanBeliefs: [baseBeliefBoard(hidden)],
    aiBeliefs: [baseBeliefBoard(hidden)],
    humanTried: new Set(),
    aiTried: new Set(),
    humanKnown: new Map(),
    aiKnown: new Map(),
    moveNo: 0,
    lastAction: null,
  };
}

function isHidden(i){ return state.hidden.includes(i); }

function legalMovesForActor(tile){
  const tried = tile === O ? state.humanTried : state.aiTried;
  const known = tile === O ? state.humanKnown : state.aiKnown;
  const moves = [];
  for(let i=0;i<9;i++){
    if(isHidden(i)){
      if(!tried.has(i)) moves.push(i);
    } else if(state.actual[i] === EMPTY){
      moves.push(i);
    }
  }
  return moves;
}

function beliefsFor(tile){ return tile === O ? state.humanBeliefs : state.aiBeliefs; }
function setBeliefsFor(tile, beliefs){
  if(tile === O) state.humanBeliefs = uniqueBoards(beliefs);
  else state.aiBeliefs = uniqueBoards(beliefs);
}
function triedFor(tile){ return tile === O ? state.humanTried : state.aiTried; }
function knownFor(tile){ return tile === O ? state.humanKnown : state.aiKnown; }

function updateVisibleMove(move, tile){
  for(const p of [O,X]){
    const updated = beliefsFor(p).map(b => {
      const n = cloneBoard(b); n[move] = tile; return n;
    });
    setBeliefsFor(p, updated);
    knownFor(p).set(move, tile);
  }
}

function updateHiddenMove(move, tile, success){
  triedFor(tile).add(move);
  knownFor(tile).set(move, state.actual[move]);

  // Actor knows exactly what happened at the attempted square.
  const actorUpdated = beliefsFor(tile).map(b => {
    const n = cloneBoard(b);
    n[move] = state.actual[move];
    return n;
  }).filter(b => b[move] === state.actual[move]);
  setBeliefsFor(tile, actorUpdated.length ? actorUpdated : [cloneBoard(state.actual)]);

  // Opponent only observes: "a move occurred somewhere in the fog".
  // Branch every current belief across hidden locations where this tile could have landed.
  const opp = other(tile);
  const oppTried = triedFor(opp);
  const branches = [];
  for(const b of beliefsFor(opp)){
    for(const h of state.hidden){
      if(oppTried.has(h) && knownFor(opp).has(h) && knownFor(opp).get(h) !== EMPTY) continue;
      const n = cloneBoard(b);
      if(n[h] === EMPTY) n[h] = tile;
      branches.push(n);
    }
  }
  if(branches.length) setBeliefsFor(opp, branches);
}

function applyMove(move, tile){
  if(state.over || tile !== state.turn) return;
  const legal = legalMovesForActor(tile);
  if(!legal.includes(move)) return;

  let success = false;
  if(isHidden(move)){
    if(state.actual[move] === EMPTY){
      state.actual[move] = tile;
      success = true;
    }
    updateHiddenMove(move, tile, success);
  } else {
    state.actual[move] = tile;
    success = true;
    updateVisibleMove(move, tile);
  }

  state.moveNo += 1;
  state.lastAction = {move, tile, hidden:isHidden(move), success};

  const t = terminal(state.actual);
  if(t.done){
    state.over = true;
    if(t.winner === O) stats.wins++;
    else if(t.winner === X) stats.losses++;
    else stats.draws++;
    saveStats();
    renderAll();
    messageEl.textContent = t.winner === O ? 'You win. The fog worked for you.' : t.winner === X ? 'AI wins. The hidden board is revealed.' : 'Draw. Every line is closed.';
    return;
  }

  state.turn = other(tile);
  renderAll();

  if(tile === O){
    messageEl.textContent = isHidden(move)
      ? (success ? `You privately claimed mystery cell ${move+1}. The AI does not know which fog cell you chose.` : `Your attempt at mystery cell ${move+1} found it already occupied. The turn is spent.`)
      : `You placed O in cell ${move+1}.`;
    scheduleAi();
  } else {
    messageEl.textContent = isHidden(move)
      ? 'The AI played somewhere in the fog. Your possible-world set has branched.'
      : `The AI revealed X in cell ${move+1}.`;
  }
}

function legalOnBelief(board, move, actor){
  if(isHidden(move)) return !triedFor(actor).has(move);
  return board[move] === EMPTY;
}

function scoreActionForBeliefs(actor, move){
  const beliefs = beliefsFor(actor);
  if(!beliefs.length) return -1;
  let sum = 0;
  let used = 0;
  for(const b0 of beliefs){
    const b = cloneBoard(b0);
    if(!legalOnBelief(b, move, actor)) continue;
    if(b[move] === EMPTY) b[move] = actor;
    const immediate = utility(b, actor);
    sum += immediate !== null ? immediate : minimax(b, other(actor), actor);
    used++;
  }
  return used ? sum/used : -1;
}

function actionScores(actor){
  const rows = legalMovesForActor(actor).map(move => ({move, score:scoreActionForBeliefs(actor, move)}));
  rows.sort((a,b)=> b.score-a.score || a.move-b.move);
  return rows;
}

function chooseAiMove(){
  const scores = actionScores(X);
  if(!scores.length) return null;
  if(aiMode === 'optimal') return scores[0].move;

  // Shift scores from [-1,1] into positive weights and sharpen toward good play.
  // exp(beta * score) is a softmax: all legal actions remain possible.
  const beta = 2.2;
  const weights = scores.map(r => Math.exp(beta*r.score));
  const total = weights.reduce((a,b)=>a+b,0);
  let u = Math.random()*total;
  for(let i=0;i<scores.length;i++){
    u -= weights[i];
    if(u <= 0) return scores[i].move;
  }
  return scores[scores.length-1].move;
}

function scheduleAi(){
  if(state.over || state.turn !== X) return;
  clearTimeout(aiTimer);
  $('thinking').hidden = false;
  aiTimer = setTimeout(()=>{
    $('thinking').hidden = true;
    const move = chooseAiMove();
    if(move !== null) applyMove(move, X);
  }, 500);
}

function boardDisplayValue(i){
  if(!state) return {text:'', cls:''};
  const real = state.actual[i];
  if(state.over) return {text:symbol(real), cls:real===O?'o':real===X?'x':''};

  if(!isHidden(i)) return {text:symbol(real), cls:real===O?'o':real===X?'x':''};

  // The human sees their own confirmed knowledge, not the AI's private hidden choice.
  if(state.humanKnown.has(i)){
    const v = state.humanKnown.get(i);
    return {text:symbol(v) || '·', cls:v===O?'o known':v===X?'x known':'known'};
  }
  return {text:'?', cls:'fog'};
}

function renderBoard(){
  boardEl.innerHTML = '';
  const legal = state && state.turn === O && !state.over ? new Set(legalMovesForActor(O)) : new Set();
  for(let i=0;i<9;i++){
    const btn = document.createElement('button');
    btn.type='button';
    btn.className='cell';
    btn.setAttribute('role','gridcell');
    const d = boardDisplayValue(i);
    btn.textContent=d.text;
    if(d.cls) btn.classList.add(...d.cls.split(' '));
    if(isHidden(i)) btn.classList.add('mystery');
    if(state?.lastAction?.move===i) btn.classList.add('last');
    btn.disabled=!legal.has(i);
    btn.setAttribute('aria-label', `Cell ${i+1}${isHidden(i)?', mystery cell':''}${d.text?`, ${d.text}`:''}`);
    btn.addEventListener('click',()=>applyMove(i,O));
    boardEl.appendChild(btn);
  }
}

function entropy(n){ return n > 0 ? Math.log2(n) : 0; }
function humanBest(){ return state && !state.over ? actionScores(O)[0] : null; }
function outcomeForecast(actor){
  const beliefs = beliefsFor(actor);
  if(!beliefs.length) return {win:0,draw:0,loss:0};
  let win=0,draw=0,loss=0;
  for(const b of beliefs){
    const u = utility(b, actor);
    if(u===1) win++;
    else if(u===0) draw++;
    else if(u===-1) loss++;
    else {
      const v = minimax(b, actor, actor);
      if(v>0) win++; else if(v<0) loss++; else draw++;
    }
  }
  const n=beliefs.length;
  return {win:win/n,draw:draw/n,loss:loss/n};
}

function renderLiveInsights(){
  const n=state.humanBeliefs.length;
  $('live-worlds').textContent=n;
  $('live-worlds-detail').textContent=n===1?'one world fits what you know':`${n} boards remain plausible`;
  $('live-entropy').textContent=`${entropy(n).toFixed(2)} bits`;
  const best=humanBest();
  $('live-best').textContent=best?`Cell ${best.move+1}`:'—';
  $('live-best-detail').textContent=best?`value ${best.score.toFixed(2)} across your beliefs`:'game complete';
  const f=outcomeForecast(O);
  $('forecast-bars').innerHTML = [
    ['Win',f.win,'good'],['Draw',f.draw,'draw'],['Loss',f.loss,'bad']
  ].map(([label,v,c])=>`<div><span>${label}</span><div class="bar"><i class="${c}" style="width:${v*100}%"></i></div><strong>${Math.round(v*100)}%</strong></div>`).join('');
}

function renderStatus(){
  if(state.over){
    const t=terminal(state.actual);
    $('status-title').textContent=t.winner===O?'You won · O':t.winner===X?'AI won · X':'Draw';
    $('status-detail').textContent='The true hidden board is now revealed.';
    $('turn-symbol').textContent='•';
    return;
  }
  $('status-title').textContent=state.turn===O?'Your turn · O':'AI thinking · X';
  $('status-detail').textContent=state.turn===O?'Choose a legal action from what you can observe.':aiMode==='optimal'?'Optimal AI is evaluating equal-weight beliefs.':'Probabilistic AI is sampling from normalized action strength.';
  $('turn-symbol').textContent=symbol(state.turn);
}

function renderPicker(){
  hiddenPickerEl.innerHTML='';
  for(let i=0;i<9;i++){
    const b=document.createElement('button');
    b.type='button'; b.textContent=i+1;
    b.className='picker-cell'+(selectedHidden.has(i)?' selected':'');
    b.setAttribute('aria-pressed',selectedHidden.has(i)?'true':'false');
    b.addEventListener('click',()=>{
      if(selectedHidden.has(i) && selectedHidden.size<=2){
        $('setup-note').textContent='Keep at least two mystery cells.'; return;
      }
      selectedHidden.has(i)?selectedHidden.delete(i):selectedHidden.add(i);
      $('setup-note').textContent='The locations are known. Moves made inside them are private.';
      renderPicker();
    });
    hiddenPickerEl.appendChild(b);
  }
  $('hidden-count-badge').textContent=`${selectedHidden.size} hidden`;
}

function renderStats(){
  const total=stats.wins+stats.losses+stats.draws;
  $('record-total').textContent=total;
  const entries=[['Wins',stats.wins,'good'],['Draws',stats.draws,'draw'],['Losses',stats.losses,'bad']];
  $('record-bars').innerHTML=entries.map(([l,v,c])=>{
    const p=total?v/total:0;
    return `<div><span>${l}</span><div class="bar"><i class="${c}" style="width:${p*100}%"></i></div><strong>${Math.round(p*100)}%</strong></div>`;
  }).join('');

  const beliefs=state.humanBeliefs;
  $('stats-worlds').textContent=beliefs.length;
  $('stats-entropy').textContent=`${entropy(beliefs.length).toFixed(2)} bits`;
  $('world-prob').textContent=`${(100/beliefs.length).toFixed(beliefs.length>9?1:0)}% each`;

  renderFogPressure(beliefs);
  renderActionSpectrum();
  renderWorlds(beliefs);
}

function renderFogPressure(beliefs){
  const html=[];
  for(let i=0;i<9;i++){
    let o=0,x=0,e=0;
    for(const b of beliefs){ if(b[i]===O)o++; else if(b[i]===X)x++; else e++; }
    const n=beliefs.length||1;
    html.push(`<div class="pressure-cell ${isHidden(i)?'mystery':''}"><b>${i+1}</b><span class="pressure-o" style="width:${o/n*100}%"></span><span class="pressure-x" style="width:${x/n*100}%"></span><small>${Math.round(o/n*100)}O · ${Math.round(x/n*100)}X</small></div>`);
  }
  $('fog-pressure').innerHTML=html.join('');
}

function renderActionSpectrum(){
  if(state.over){ $('action-spectrum').innerHTML='<p class="muted">Start a new match to evaluate actions.</p>'; return; }
  const rows=actionScores(O);
  if(!rows.length){ $('action-spectrum').innerHTML='<p class="muted">No legal actions remain.</p>'; return; }
  $('action-spectrum').innerHTML=rows.map((r,idx)=>{
    const pos=(r.score+1)/2*100;
    return `<div class="action-row ${idx===0?'best':''}"><span>Cell ${r.move+1}${isHidden(r.move)?' ?':''}</span><div class="value-track"><i style="width:${pos}%"></i><em></em></div><strong>${r.score.toFixed(2)}</strong></div>`;
  }).join('');
}

function renderWorlds(beliefs){
  const max=18;
  const shown=beliefs.slice(0,max);
  $('possible-worlds').innerHTML=shown.map((b,idx)=>{
    const cells=b.map((v,i)=>`<i class="${v===O?'o':v===X?'x':''} ${isHidden(i)?'fog':''}">${symbol(v)||''}</i>`).join('');
    return `<div class="world-card"><div class="world-label">WORLD ${String(idx+1).padStart(2,'0')}</div><div class="world-grid">${cells}</div></div>`;
  }).join('') + (beliefs.length>max?`<div class="world-more">+${beliefs.length-max}<br><small>more equally likely boards</small></div>`:'');
}

function saveStats(){
  try{ window.localStorage.setItem('ttn-stats', JSON.stringify(stats)); }catch{}
}
function loadStats(){
  try{
    const s=JSON.parse(window.localStorage.getItem('ttn-stats')||'null');
    if(s && Number.isFinite(s.wins)&&Number.isFinite(s.losses)&&Number.isFinite(s.draws)) stats=s;
  }catch{}
}

function renderAll(){
  renderBoard(); renderStatus(); renderLiveInsights(); renderStats();
}

function newGame(){
  clearTimeout(aiTimer); $('thinking').hidden=true;
  state=makeState();
  messageEl.textContent='New game. You move first as O.';
  renderAll();
}

function setPage(page){
  document.querySelectorAll('.page').forEach(el=>el.classList.toggle('active',el.id===`page-${page}`));
  document.querySelectorAll('.nav-btn').forEach(el=>el.classList.toggle('active',el.dataset.page===page));
  if(page==='stats') renderStats();
  window.scrollTo({top:0,behavior:'smooth'});
}

document.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>setPage(b.dataset.page)));
document.querySelectorAll('[data-ai]').forEach(b=>b.addEventListener('click',()=>{
  aiMode=b.dataset.ai;
  document.querySelectorAll('[data-ai]').forEach(x=>x.classList.toggle('active',x.dataset.ai===aiMode));
  if(state) renderStatus();
}));
$('new-game').addEventListener('click',newGame);

loadStats();
renderPicker();
newGame();
