(function () {
  'use strict';

  const T = window.TTNTheory;
  if (!T) return;
  const { O, X } = T;
  const $ = (id) => document.getElementById(id);
  const VALID_MODES = new Set(['local', 'ai', 'coach']);

  let playMode = localStorage.getItem('ttn-play-mode');
  if (!VALID_MODES.has(playMode)) playMode = 'ai';
  let coachAdvanced = false;

  let localHidden = new Set(readPrimaryHidden().length >= 2 ? readPrimaryHidden() : [1, 3]);
  let localStartPlayer = O;
  let localRules = T.makeRules([...localHidden], localStartPlayer);
  let localState = T.makeRoot(localRules);
  let localTracker = new T.BeliefTracker(localRules);
  let localStarted = false;
  let localReady = false;

  function symbol(player) { return T.symbol(player) || (player === O ? 'O' : player === X ? 'X' : ''); }
  function isLocalHidden(move) { return Boolean(localRules.hiddenMask & T.bit(move)); }

  function readPrimaryHidden() {
    return [...document.querySelectorAll('#hidden-picker .picker-cell')]
      .flatMap((cell, index) => cell.classList.contains('selected') ? [index] : []);
  }

  function navigateTo(page) {
    let target = document.querySelector(`.topbar [data-page="${page}"]`);
    if (!target) target = document.querySelector(`#page-analysis [data-page="${page}"]`);
    if (!target) target = document.querySelector(`[data-page="${page}"]`);
    if (target) {
      target.click();
      return;
    }
    document.querySelectorAll('.page').forEach((el) => el.classList.toggle('active', el.id === `page-${page}`));
    updateNavForPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function updateNavForPage(page) {
    document.querySelectorAll('.topbar .nav-btn').forEach((button) => button.classList.remove('active'));
    const topPage = page === 'simulate' ? 'analysis' : page;
    document.querySelector(`.topbar .nav-btn[data-page="${topPage}"]`)?.classList.add('active');
    document.querySelectorAll('.research-tabs button').forEach((button) => button.classList.toggle('active', button.dataset.page === page));
  }

  function setHash(page) {
    if (!page) return;
    try { history.replaceState(null, '', `#${page}`); } catch (_) { /* no-op */ }
  }

  function setPlayMode(mode, options = {}) {
    if (!VALID_MODES.has(mode)) return;
    playMode = mode;
    localStorage.setItem('ttn-play-mode', mode);
    document.querySelectorAll('[data-play-mode]').forEach((button) => button.classList.toggle('active', button.dataset.playMode === mode));

    const aiShell = $('ai-play-shell');
    const localShell = $('local-play-shell');
    const coachShell = $('coach-shell');
    if (aiShell) aiShell.hidden = mode === 'local';
    if (localShell) localShell.hidden = mode !== 'local';
    if (coachShell) coachShell.hidden = mode !== 'coach';
    renderCoachAdvanced();

    if (mode === 'local' && !localStarted) renderLocal();
    if (options.navigate) navigateTo('play');
  }

  function installPlayModes() {
    document.querySelectorAll('[data-play-mode]').forEach((button) => {
      button.addEventListener('click', () => setPlayMode(button.dataset.playMode));
    });
    document.querySelectorAll('[data-start-mode]').forEach((button) => {
      button.addEventListener('click', () => setPlayMode(button.dataset.startMode, { navigate: true }));
    });
    $('coach-advanced-toggle')?.addEventListener('click', () => {
      coachAdvanced = !coachAdvanced;
      renderCoachAdvanced();
    });
    setPlayMode(playMode);
  }

  function renderCoachAdvanced() {
    document.querySelectorAll('.coach-advanced').forEach((panel) => { panel.hidden = !coachAdvanced || playMode !== 'coach'; });
    const button = $('coach-advanced-toggle');
    if (button) button.textContent = coachAdvanced ? 'Hide deeper analysis' : 'Show deeper analysis';
  }

  function renderLocalPicker() {
    const root = $('local-hidden-picker');
    if (!root) return;
    root.innerHTML = '';
    for (let move = 0; move < 9; move++) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `picker-cell${localHidden.has(move) ? ' selected' : ''}`;
      button.textContent = String(move + 1);
      button.setAttribute('aria-pressed', localHidden.has(move) ? 'true' : 'false');
      button.addEventListener('click', () => {
        if (localHidden.has(move) && localHidden.size <= 2) {
          if ($('local-setup-note')) $('local-setup-note').textContent = 'Keep at least two mystery cells.';
          return;
        }
        if (localHidden.has(move)) localHidden.delete(move); else localHidden.add(move);
        renderLocalPicker();
        if ($('local-setup-note')) $('local-setup-note').textContent = 'Start a new local game to apply the new mystery cells.';
      });
      root.appendChild(button);
    }
    if ($('local-hidden-count')) $('local-hidden-count').textContent = `${localHidden.size} hidden`;
  }

  function startLocalGame() {
    localRules = T.makeRules([...localHidden], localStartPlayer);
    localState = T.makeRoot(localRules);
    localTracker = new T.BeliefTracker(localRules);
    localStarted = true;
    localReady = false;
    if ($('local-message')) $('local-message').textContent = `New local game. Pass the computer to Player ${symbol(localState.turn)}.`;
    renderLocal();
  }

  function localObservedCell(move, player, revealTruth = false) {
    const actual = T.boardArray(localState)[move];
    if (revealTruth || !isLocalHidden(move)) {
      return { text: symbol(actual), cls: actual === O ? 'o' : actual === X ? 'x' : '' };
    }
    const worlds = localTracker.for(player);
    const values = new Set(worlds.map((world) => T.boardArray(world)[move]));
    if (values.size === 1) {
      const value = [...values][0];
      return { text: symbol(value) || '·', cls: value === O ? 'o' : value === X ? 'x' : '' };
    }
    return { text: '?', cls: 'fog' };
  }

  function localMove(move) {
    if (!localStarted || !localReady || T.terminal(localState).done) return;
    const actor = localState.turn;
    const legal = T.legalActions(localState, localRules, actor);
    if (!legal.includes(move)) return;
    const before = localState;
    const after = T.applyAction(before, localRules, move);
    if (!after) return;
    localTracker.advance(before, after);
    localState = after;

    const terminal = T.terminal(localState);
    if (terminal.done) {
      localReady = true;
      const result = terminal.winner ? `Player ${symbol(terminal.winner)} wins.` : 'Draw.';
      if ($('local-message')) $('local-message').textContent = `${result} The true board is revealed.`;
    } else {
      localReady = false;
      if ($('local-message')) $('local-message').textContent = `Move recorded. Pass the computer to Player ${symbol(localState.turn)}.`;
    }
    renderLocal();
  }

  function renderLocalBoard() {
    const root = $('local-board');
    if (!root) return;
    root.innerHTML = '';
    const terminal = T.terminal(localState);
    const actor = localState.turn;
    const legal = localStarted && localReady && !terminal.done ? new Set(T.legalActions(localState, localRules, actor)) : new Set();
    root.classList.toggle('privacy-covered', localStarted && !localReady && !terminal.done);

    for (let move = 0; move < 9; move++) {
      const display = localObservedCell(move, actor, terminal.done);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = `local-cell${isLocalHidden(move) ? ' mystery' : ''}${display.cls ? ` ${display.cls}` : ''}`;
      cell.textContent = display.text;
      cell.disabled = !legal.has(move);
      cell.setAttribute('aria-label', `Cell ${move + 1}${isLocalHidden(move) ? ', mystery' : ''}${display.text ? `, ${display.text}` : ''}`);
      cell.addEventListener('click', () => localMove(move));
      root.appendChild(cell);
    }
  }

  function renderLocalHandoff() {
    const handoff = $('local-handoff');
    if (!handoff) return;
    const terminal = T.terminal(localState);
    handoff.hidden = !localStarted || localReady || terminal.done;
    if (handoff.hidden) return;
    const player = symbol(localState.turn);
    if ($('local-handoff-symbol')) $('local-handoff-symbol').textContent = player;
    if ($('local-handoff-title')) $('local-handoff-title').textContent = `Pass to Player ${player}`;
    if ($('local-handoff-copy')) $('local-handoff-copy').textContent = `Make sure only Player ${player} is looking at the screen. Hidden actions from the other player remain private.`;
  }

  function renderLocalStatus() {
    const terminal = T.terminal(localState);
    if (!localStarted) {
      if ($('local-status-title')) $('local-status-title').textContent = 'Start a local game';
      if ($('local-status-detail')) $('local-status-detail').textContent = 'Two players can share this computer without revealing hidden actions.';
      if ($('local-turn-symbol')) $('local-turn-symbol').textContent = '•';
      return;
    }
    if (terminal.done) {
      if ($('local-status-title')) $('local-status-title').textContent = terminal.winner ? `Player ${symbol(terminal.winner)} wins` : 'Draw';
      if ($('local-status-detail')) $('local-status-detail').textContent = 'The underlying hidden board is now revealed.';
      if ($('local-turn-symbol')) $('local-turn-symbol').textContent = '•';
      return;
    }
    const player = symbol(localState.turn);
    if ($('local-status-title')) $('local-status-title').textContent = localReady ? `Player ${player} · your turn` : `Waiting for Player ${player}`;
    if ($('local-status-detail')) $('local-status-detail').textContent = localReady ? 'Choose one action from your information only.' : 'Use the privacy handoff before showing the board.';
    if ($('local-turn-symbol')) $('local-turn-symbol').textContent = player;
  }

  function renderLocal() {
    renderLocalPicker();
    renderLocalBoard();
    renderLocalHandoff();
    renderLocalStatus();
  }

  function installLocalGame() {
    document.querySelectorAll('[data-local-order]').forEach((button) => {
      button.addEventListener('click', () => {
        localStartPlayer = button.dataset.localOrder === 'X' ? X : O;
        document.querySelectorAll('[data-local-order]').forEach((item) => item.classList.toggle('active', item === button));
        if ($('local-setup-note')) $('local-setup-note').textContent = `Player ${symbol(localStartPlayer)} will open the next local game.`;
      });
    });
    $('local-new-game')?.addEventListener('click', startLocalGame);
    $('local-ready')?.addEventListener('click', () => {
      if (!localStarted || T.terminal(localState).done) return;
      localReady = true;
      if ($('local-message')) $('local-message').textContent = `Player ${symbol(localState.turn)}, choose your move.`;
      renderLocal();
    });
    renderLocal();
  }

  function clickPrimaryHidden(move) {
    const button = document.querySelectorAll('#hidden-picker .picker-cell')[move];
    if (button) button.click();
  }

  function syncPickerHtml(id) {
    return `<div class="sync-picker" id="${id}">${Array.from({ length: 9 }, (_, move) => `<button type="button" data-sync-move="${move}">${move + 1}</button>`).join('')}</div>`;
  }

  function installResearchConfig() {
    const simulationRoot = $('simulation-config');
    if (simulationRoot && !simulationRoot.dataset.installed) {
      simulationRoot.dataset.installed = 'true';
      simulationRoot.innerHTML = `<div class="inline-config"><div><p class="kicker">SIMULATION CONFIGURATION</p><h3>Mystery cells</h3><p>This is shared with the Play setup so the arena and live game use the same board geometry.</p></div>${syncPickerHtml('simulation-sync-picker')}</div>`;
    }

    const nashPage = $('page-nash');
    if (nashPage) {
      const title = $('nash-title');
      if (title) title.textContent = 'The exact Nash equilibrium.';
      const lede = nashPage.querySelector('.page-head .lede');
      if (lede) lede.textContent = 'Read the certified game value, inspect the numerical certificate, then test the equilibrium security guarantee against the other strategies.';

      if (!nashPage.querySelector('.research-tabs')) {
        const tabs = document.createElement('div');
        tabs.className = 'research-tabs';
        tabs.setAttribute('role', 'navigation');
        tabs.setAttribute('aria-label', 'Research sections');
        tabs.innerHTML = '<button data-page="analysis">Position Lab</button><button class="active" data-page="nash">Exact Nash</button><button data-page="simulate">Strategy Arena</button>';
        nashPage.querySelector('.page-head')?.insertAdjacentElement('afterend', tabs);
        tabs.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => navigateTo(button.dataset.page)));
      }

      if (!$('nash-inline-config')) {
        const config = document.createElement('div');
        config.id = 'nash-inline-config';
        config.className = 'inline-config';
        config.innerHTML = `<div><p class="kicker">EQUILIBRIUM CONFIGURATION</p><h3>Mystery cells</h3><p>Select a solved layout. The page reports both first-player and second-player equilibrium values.</p></div>${syncPickerHtml('nash-sync-picker')}`;
        const tabs = nashPage.querySelector('.research-tabs');
        tabs?.insertAdjacentElement('afterend', config);
      }
    }

    document.querySelectorAll('[data-sync-move]').forEach((button) => {
      if (button.dataset.syncInstalled) return;
      button.dataset.syncInstalled = 'true';
      button.addEventListener('click', () => {
        clickPrimaryHidden(Number(button.dataset.syncMove));
        setTimeout(refreshSyncPickers, 0);
      });
    });
    refreshSyncPickers();
  }

  function refreshSyncPickers() {
    const selected = new Set(readPrimaryHidden());
    document.querySelectorAll('[data-sync-move]').forEach((button) => button.classList.toggle('selected', selected.has(Number(button.dataset.syncMove))));
  }

  function installNavigationPolish() {
    document.addEventListener('click', (event) => {
      const pageTarget = event.target.closest('[data-page]');
      if (!pageTarget) return;
      const page = pageTarget.dataset.page;
      setTimeout(() => {
        updateNavForPage(page);
        setHash(page);
      }, 0);
    });
    window.addEventListener('hashchange', () => {
      const page = (window.location.hash || '').replace('#', '');
      if (page) setTimeout(() => updateNavForPage(page), 0);
    });
  }

  function install() {
    installNavigationPolish();
    installPlayModes();
    installLocalGame();
    installResearchConfig();
    window.addEventListener('ttn-lp-artifacts-loaded', () => {
      installResearchConfig();
      refreshSyncPickers();
    });
    document.getElementById('hidden-picker')?.addEventListener('click', () => setTimeout(refreshSyncPickers, 0));

    const currentPage = document.querySelector('.page.active')?.id?.replace('page-', '') || 'home';
    updateNavForPage(currentPage);
  }

  install();
  window.TTNUXRefresh = { setPlayMode, navigateTo, refreshSyncPickers };
})(window);
