(function (global) {
  'use strict';

  const T = global.TTNTheory;
  if (!T) return;

  const ALL_ID = 'all';
  const SCORE_EPSILON = 1e-9;
  let installed = false;
  let allContext = null;
  let allOptions = {};
  let contextVersion = 0;
  let cachedVersion = -1;
  let cachedHtml = '';
  let rendering = false;

  function hashString(text) {
    let hash = 2166136261 >>> 0;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash || 1;
  }

  function seededRandom(key) {
    const rng = new T.RNG(hashString(key));
    return () => rng.next();
  }

  function bestMovesForRows(rows) {
    if (global.TTNBestTieHighlights?.bestMovesForRows) {
      return global.TTNBestTieHighlights.bestMovesForRows(rows);
    }
    const finiteRows = (rows || []).filter((row) => Number.isFinite(Number(row?.score)));
    if (!finiteRows.length) return [];
    const bestScore = Math.max(...finiteRows.map((row) => Number(row.score)));
    const tolerance = SCORE_EPSILON * Math.max(1, Math.abs(bestScore));
    return finiteRows
      .filter((row) => Math.abs(Number(row.score) - bestScore) <= tolerance)
      .map((row) => row.move)
      .filter(Number.isInteger)
      .sort((a, b) => a - b);
  }

  function humanMoveList(moves) {
    const labels = moves.map((move) => String(move + 1));
    if (labels.length <= 1) return labels[0] || '';
    if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
    return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
  }

  function formatScore(evaluation, score) {
    if (evaluation?.metric === 'probability') return `${(100 * score).toFixed(score >= 0.1 ? 0 : 1)}%`;
    if (evaluation?.metric === 'utility') return `${score > 0 ? '+' : ''}${Number(score).toFixed(2)}`;
    return '—';
  }

  function observedCell(move, context) {
    const actual = T.boardArray(context.state)[move];
    const hidden = Boolean(context.rules.hiddenMask & T.bit(move));
    if (T.terminal(context.state).done || !hidden) {
      return { text: T.symbol(actual), cls: actual === T.O ? 'o' : actual === T.X ? 'x' : '' };
    }
    const values = new Set((context.beliefs || []).map((world) => T.boardArray(world)[move]));
    if (values.size === 1) {
      const value = [...values][0];
      return {
        text: T.symbol(value) || '·',
        cls: value === T.O ? 'o known' : value === T.X ? 'x known' : 'known'
      };
    }
    return { text: '?', cls: 'fog' };
  }

  function evaluationSeedKey(strategyId, context, options) {
    const beliefs = context.beliefs || [];
    const rolloutBudget = options.rolloutBudget || T.RESEARCH_CONFIG?.beliefRolloutTarget || 72;
    const beliefSignature = beliefs.map((world) => T.stateKey(world)).sort().join('~');
    return [
      strategyId,
      `${context.rules.hiddenMask}|${context.rules.startPlayer}`,
      T.informationKey(context.state, context.rules, context.state.turn),
      beliefSignature,
      context.solver?.iterations || 0,
      rolloutBudget
    ].join('|');
  }

  function evaluateEveryStrategy(originalEvaluate) {
    if (!allContext) return [];

    const trainingTarget = allOptions.trainingTarget || T.RESEARCH_CONFIG?.regretTrainingTarget || 15000;
    if (allContext.solver && typeof T.ensureRegretPolicy === 'function') {
      T.ensureRegretPolicy(allContext.solver, trainingTarget);
    }

    return T.STRATEGIES.map((strategy) => {
      try {
        const key = evaluationSeedKey(strategy.id, allContext, allOptions);
        const context = { ...allContext, rng: seededRandom(`evaluation|${key}`) };
        return {
          strategy,
          evaluation: originalEvaluate.call(T, strategy.id, context, allOptions),
          error: null
        };
      } catch (error) {
        console.error(`Coach All could not evaluate ${strategy.id}`, error);
        return { strategy, evaluation: null, error };
      }
    });
  }

  function scoreBoardHtml(evaluation, context) {
    const rows = new Map((evaluation?.rows || []).map((row) => [row.move, row]));
    const bestSet = new Set(evaluation?.bestMoves || bestMovesForRows(evaluation?.rows));
    return Array.from({ length: 9 }, (_, move) => {
      const display = observedCell(move, context);
      const row = rows.get(move);
      const classes = ['strategy-score-cell'];
      if (context.rules.hiddenMask & T.bit(move)) classes.push('mystery');
      if (display.cls) classes.push(...display.cls.split(' '));
      if (row) classes.push('actionable');
      if (row && bestSet.has(move)) classes.push('best');
      return `<div class="${classes.join(' ')}">
        <span class="score-cell-index">${move + 1}</span>
        <b class="score-cell-mark">${display.text}</b>
        ${row ? `<strong>${formatScore(evaluation, row.score)}</strong><small>${evaluation.metric === 'probability' ? 'prob.' : 'utility'}</small>` : ''}
      </div>`;
    }).join('');
  }

  function strategyCardHtml(item) {
    const { strategy, evaluation, error } = item;
    const classes = ['strategy-analysis-card'];
    if (strategy.id === 'nash') classes.push('featured');
    if (strategy.id === 'oracle') classes.push('oracle-locked');

    if (!evaluation) {
      return `<article class="${classes.join(' ')}">
        <header><div><p class="kicker">${String(strategy.family || 'Strategy').toUpperCase()}</p><h2>${strategy.name}</h2></div><span class="pill">unavailable</span></header>
        <div class="strategy-analysis-summary"><strong>No recommendation available</strong><span>${error?.message || 'This strategy could not be evaluated for the current position.'}</span></div>
      </article>`;
    }

    const bestMoves = evaluation.bestMoves || bestMovesForRows(evaluation.rows);
    const bestRow = bestMoves.length ? evaluation.rows.find((row) => row.move === bestMoves[0]) : null;
    const bestLabel = bestMoves.length > 1
      ? `Best: cells ${humanMoveList(bestMoves)}`
      : bestMoves.length === 1
        ? `Best: cell ${bestMoves[0] + 1}`
        : 'No legal move';
    const bestScore = bestRow ? ` · ${formatScore(evaluation, bestRow.score)}` : '';

    return `<article class="${classes.join(' ')}">
      <header>
        <div><p class="kicker">${String(strategy.family || 'Strategy').toUpperCase()}</p><h2>${evaluation.name || strategy.name}</h2></div>
        <span class="pill">${evaluation.scaleLabel || evaluation.metricLabel || 'score'}</span>
      </header>
      ${strategy.id === 'oracle' ? '<p class="oracle-warning"><strong>Omniscient benchmark:</strong> these scores use the true hidden board and can spoil live information.</p>' : ''}
      <div class="strategy-score-board">${scoreBoardHtml(evaluation, allContext)}</div>
      <div class="strategy-analysis-summary"><strong>${bestLabel}${bestScore}</strong><span>${evaluation.detail || ''}</span></div>
    </article>`;
  }

  function buildAllCards(originalEvaluate) {
    const results = evaluateEveryStrategy(originalEvaluate);
    return `<div class="analysis-strategy-boards coach-all-strategy-grid">${results.map(strategyCardHtml).join('')}</div>`;
  }

  function humanCanUseCoach() {
    const title = document.getElementById('status-title')?.textContent || '';
    return title.startsWith('Your turn');
  }

  function renderAllMode(originalEvaluate) {
    if (rendering) return;
    const select = document.getElementById('decision-strategy');
    const root = document.getElementById('combined-value-map');
    if (!select || !root || select.value !== ALL_ID || !humanCanUseCoach() || !allContext) {
      root?.classList.remove('coach-all-mode');
      return;
    }

    if (cachedVersion !== contextVersion) {
      cachedHtml = buildAllCards(originalEvaluate);
      cachedVersion = contextVersion;
    }
    if (root.querySelector('.coach-all-strategy-grid') && root.dataset.allContextVersion === String(contextVersion)) return;

    rendering = true;
    root.classList.add('coach-all-mode');
    root.dataset.allContextVersion = String(contextVersion);
    root.innerHTML = cachedHtml;
    const scale = document.getElementById('combined-score-scale');
    if (scale) scale.textContent = 'all strategies';
    const summary = document.getElementById('combined-strategy-summary');
    if (summary) {
      summary.textContent = 'Each card shows what that strategy recommends from the same current information set. Utility scores and action probabilities use different scales and should not be compared numerically across methods.';
    }
    rendering = false;
  }

  function installStyles() {
    if (document.getElementById('coach-all-strategies-style')) return;
    const style = document.createElement('style');
    style.id = 'coach-all-strategies-style';
    style.textContent = `
      #combined-value-map.coach-all-mode{display:block;max-width:none}
      .coach-all-strategy-grid{width:100%;margin-top:4px}
      .coach-all-strategy-grid .strategy-analysis-card{min-width:0}
      @media(max-width:1050px){.coach-all-strategy-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function ensureAllOption() {
    const select = document.getElementById('decision-strategy');
    if (!select || select.querySelector(`option[value="${ALL_ID}"]`)) return;
    const option = document.createElement('option');
    option.value = ALL_ID;
    option.textContent = 'All · compare every strategy';
    select.insertBefore(option, select.firstChild);
  }

  function strategyArenaButton() {
    return document.querySelector('#page-simulate .research-tabs [data-page="simulate"]');
  }

  function redirectToStrategyArena(event) {
    event?.preventDefault();
    event?.stopImmediatePropagation();
    const target = strategyArenaButton();
    if (target) {
      target.click();
      return;
    }
    document.querySelectorAll('.page').forEach((page) => page.classList.toggle('active', page.id === 'page-simulate'));
    try { history.replaceState(null, '', '#simulate'); } catch (_) { /* no-op */ }
  }

  function retirePositionLab() {
    document.getElementById('page-analysis')?.remove();
    document.querySelectorAll('.research-tabs [data-page="analysis"]').forEach((button) => button.remove());
    document.querySelectorAll('[data-page="analysis"]').forEach((element) => {
      if (element.closest('.topbar')) return;
      element.dataset.page = 'simulate';
    });

    const labButton = document.querySelector('.topbar .nav-btn[data-page="analysis"]');
    if (labButton && !labButton.dataset.strategyArenaRedirect) {
      labButton.dataset.strategyArenaRedirect = 'true';
      labButton.addEventListener('click', redirectToStrategyArena, true);
    }

    document.querySelectorAll('.research-tabs [data-page="simulate"]').forEach((button) => {
      if (button.closest('#page-simulate') || button.dataset.directArenaRedirect) return;
      button.dataset.directArenaRedirect = 'true';
      button.addEventListener('click', redirectToStrategyArena, true);
    });

    if ((global.location.hash || '').replace('#', '') === 'analysis') {
      try { history.replaceState(null, '', '#simulate'); } catch (_) { /* no-op */ }
    }
  }

  function install() {
    if (installed) return;
    installed = true;
    installStyles();
    ensureAllOption();
    retirePositionLab();

    const originalEvaluate = T.evaluateStrategy;
    if (typeof originalEvaluate !== 'function') return;

    T.evaluateStrategy = function evaluateCoachAll(id, context, options = {}) {
      if (id !== ALL_ID) return originalEvaluate.call(T, id, context, options);

      // The retired timeline still performs hidden 24-rollout forecast calls.
      // Never let those simulated states replace the live Coach context.
      const forecastOnly = Number(options?.rolloutBudget) === 24;
      if (!forecastOnly) {
        allContext = context;
        allOptions = options || {};
        contextVersion += 1;
        cachedVersion = -1;
      }

      return {
        id: ALL_ID,
        name: 'All Strategies',
        metric: 'all',
        metricLabel: 'Per-strategy recommendation',
        scaleLabel: 'all strategies',
        rows: [],
        policy: [],
        bestMove: null,
        bestMoves: [],
        worlds: [],
        detail: 'Compare every strategy below.'
      };
    };

    const select = document.getElementById('decision-strategy');
    if (select) {
      select.addEventListener('change', () => {
        if (select.value !== ALL_ID) {
          document.getElementById('combined-value-map')?.classList.remove('coach-all-mode');
          return;
        }
        queueMicrotask(() => renderAllMode(originalEvaluate));
      });
      new MutationObserver(ensureAllOption).observe(select, { childList: true });
    }

    const root = document.getElementById('combined-value-map');
    if (root) {
      new MutationObserver(() => renderAllMode(originalEvaluate)).observe(root, { childList: true, subtree: false });
    }

    global.addEventListener('ttn-lp-artifacts-loaded', () => {
      cachedVersion = -1;
      ensureAllOption();
      retirePositionLab();
      renderAllMode(originalEvaluate);
    });
  }

  global.TTNCoachAllStrategies = { install };
})(window);
