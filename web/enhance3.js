let humanStarts = true;

function installOrderControl() {
  const aiMode = document.getElementById('ai-mode');
  if (!aiMode || document.getElementById('turn-order')) return;

  const label = document.createElement('div');
  label.className = 'field-label row-label';
  label.innerHTML = '<span>Turn order</span><small>choose who opens</small>';

  const control = document.createElement('div');
  control.id = 'turn-order';
  control.className = 'segmented order-segmented';
  control.setAttribute('role', 'group');
  control.setAttribute('aria-label', 'Choose whether to play first or second');
  control.innerHTML = `
    <button type="button" class="segment active" data-order="first"><strong>First</strong><small>You are O and open</small></button>
    <button type="button" class="segment" data-order="second"><strong>Second</strong><small>AI is X and opens</small></button>
  `;

  aiMode.insertAdjacentElement('afterend', control);
  aiMode.insertAdjacentElement('afterend', label);

  control.querySelectorAll('[data-order]').forEach((button) => {
    button.addEventListener('click', () => {
      humanStarts = button.dataset.order === 'first';
      control.querySelectorAll('[data-order]').forEach((candidate) => {
        candidate.classList.toggle('active', candidate === button);
      });
      const note = document.getElementById('setup-note');
      if (note) note.textContent = humanStarts
        ? 'You will open as O. Start a new game to apply this choice.'
        : 'The AI will open as X. Start a new game to apply this choice.';
    });
  });
}

function installCombinedMap() {
  if (document.getElementById('combined-value-map')) return;
  const infoPanel = document.querySelector('.play-analysis-panel');
  if (!infoPanel) return;

  const panel = document.createElement('section');
  panel.className = 'panel combined-map-panel';
  panel.innerHTML = `
    <div class="panel-heading">
      <div>
        <p class="kicker">COMBINED DECISION MAP</p>
        <h2>Value of every square across your entire information set</h2>
      </div>
      <span class="pill">average across all states</span>
    </div>
    <p class="muted">This is the main decision view: each square is the equal-weight average of that move's value across every information state you currently consider possible.</p>
    <div class="combined-map-wrap">
      <div id="combined-value-map" class="combined-value-map" aria-label="Combined value of each board square"></div>
      <div class="combined-map-key">
        <span><i class="key-swatch bad"></i>negative</span>
        <span><i class="key-swatch neutral"></i>draw-like</span>
        <span><i class="key-swatch good"></i>positive</span>
        <span><i class="key-swatch best"></i>best move</span>
      </div>
    </div>
  `;
  infoPanel.parentNode.insertBefore(panel, infoPanel);
}

function renderCombinedValueMap() {
  const map = document.getElementById('combined-value-map');
  if (!map || !state) return;

  const rows = state.over ? [] : actionScores(O);
  const byMove = new Map(rows.map((row) => [row.move, row.score]));
  const best = rows.length ? rows[0].score : null;

  map.innerHTML = '';
  for (let move = 0; move < 9; move += 1) {
    const cell = document.createElement('div');
    cell.className = 'combined-value-cell';
    const value = byMove.has(move) ? byMove.get(move) : null;

    if (isHidden(move)) cell.classList.add('mystery');
    if (value === null) {
      cell.classList.add('unavailable');
      cell.innerHTML = `<span class="combined-cell-number">${move + 1}</span><strong>—</strong><small>unavailable</small>`;
    } else {
      if (value > 0.2) cell.classList.add('positive');
      else if (value < -0.2) cell.classList.add('negative');
      else cell.classList.add('neutral');
      if (best !== null && Math.abs(value - best) < 1e-9) cell.classList.add('best');
      cell.innerHTML = `<span class="combined-cell-number">${move + 1}${isHidden(move) ? ' ?' : ''}</span><strong>${value.toFixed(2)}</strong><small>${best !== null && Math.abs(value - best) < 1e-9 ? 'best' : 'combined value'}</small>`;
    }
    map.appendChild(cell);
  }
}

// Keep the existing state model. Playing second simply means X gets the first turn.
const baseMakeState = makeState;
makeState = function makeStateWithOrder() {
  const next = baseMakeState();
  next.turn = humanStarts ? O : X;
  return next;
};

// Extend all existing renders with the combined decision map.
const baseRenderAll = renderAll;
renderAll = function renderAllWithCombinedMap() {
  baseRenderAll();
  renderCombinedValueMap();
};

// Replace the already-bound Start button so turn-order selection is honored.
function startConfiguredGame() {
  clearTimeout(aiTimer);
  document.getElementById('thinking').hidden = true;
  state = makeState();
  recordHistory('Start');
  messageEl.textContent = humanStarts
    ? 'New game. You move first as O.'
    : 'New game. You are second; the AI opens as X.';
  renderAll();
  if (!humanStarts) scheduleAi();
}

installOrderControl();
installCombinedMap();

const oldStart = document.getElementById('new-game');
if (oldStart) {
  const freshStart = oldStart.cloneNode(true);
  oldStart.replaceWith(freshStart);
  freshStart.addEventListener('click', startConfiguredGame);
}

renderCombinedValueMap();
