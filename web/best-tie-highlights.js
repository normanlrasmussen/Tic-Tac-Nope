(function (global) {
  'use strict';

  const T = global.TTNTheory;
  if (!T) return;

  const SCORE_EPSILON = 1e-9;
  const latestEvaluations = new Map();
  let installed = false;

  function bestMovesForRows(rows) {
    const finiteRows = (rows || []).filter((row) => Number.isFinite(Number(row?.score)));
    if (!finiteRows.length) return [];
    const bestScore = Math.max(...finiteRows.map((row) => Number(row.score)));
    const tolerance = SCORE_EPSILON * Math.max(1, Math.abs(bestScore));
    return finiteRows
      .filter((row) => Math.abs(Number(row.score) - bestScore) <= tolerance)
      .map((row) => row.move)
      .filter((move) => Number.isInteger(move))
      .sort((a, b) => a - b);
  }

  function annotateEvaluation(evaluation) {
    if (!evaluation || typeof evaluation !== 'object') return evaluation;
    evaluation.bestMoves = bestMovesForRows(evaluation.rows);
    for (const detail of evaluation.worlds || []) {
      detail.bestMoves = bestMovesForRows(detail.scores);
    }
    return evaluation;
  }

  function wrapEvaluator() {
    const originalEvaluate = T.evaluateStrategy;
    if (typeof originalEvaluate !== 'function' || originalEvaluate.__ttnTieAware) return;

    function evaluateWithTieMetadata(id, context, options) {
      const evaluation = annotateEvaluation(originalEvaluate.call(T, id, context, options));
      latestEvaluations.set(String(id), evaluation);
      if (evaluation?.id !== undefined) latestEvaluations.set(String(evaluation.id), evaluation);
      return evaluation;
    }

    evaluateWithTieMetadata.__ttnTieAware = true;
    T.evaluateStrategy = evaluateWithTieMetadata;
  }

  function moveFromCell(cell, selector) {
    const label = cell.querySelector(selector)?.textContent || '';
    const number = Number.parseInt(label, 10);
    return Number.isInteger(number) ? number - 1 : null;
  }

  function humanMoveList(moves) {
    const labels = moves.map((move) => String(move + 1));
    if (labels.length <= 1) return labels[0] || '';
    if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
    return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
  }

  function normalizeCoachRecommendation() {
    const root = document.getElementById('combined-value-map');
    const strategyId = document.getElementById('decision-strategy')?.value;
    const evaluation = strategyId ? latestEvaluations.get(String(strategyId)) : null;
    if (!root || !evaluation) return;

    const bestMoves = evaluation.bestMoves || bestMovesForRows(evaluation.rows);
    const bestSet = new Set(bestMoves);
    const cells = [...root.querySelectorAll('.combined-value-cell')];

    for (const cell of cells) {
      const move = moveFromCell(cell, '.combined-cell-number');
      cell.classList.toggle('best', move !== null && bestSet.has(move) && !cell.classList.contains('unavailable'));
    }

    if (bestMoves.length > 1) {
      const summary = document.getElementById('combined-strategy-summary');
      const firstBestCell = cells.find((cell) => bestSet.has(moveFromCell(cell, '.combined-cell-number')));
      const scoreText = firstBestCell?.querySelector('strong')?.textContent?.trim() || '';
      if (summary) {
        summary.textContent = `${evaluation.name} currently has cells ${humanMoveList(bestMoves)} tied for best with ${evaluation.metricLabel.toLowerCase()} ${scoreText}. ${evaluation.detail}`;
      }
    }
  }

  function strategyIdForCard(card) {
    const name = card.querySelector('header h2')?.textContent?.trim();
    return T.STRATEGIES.find((strategy) => strategy.name === name)?.id || null;
  }

  function normalizeAnalysisRecommendations() {
    const root = document.getElementById('analysis-strategy-boards');
    if (!root) return;

    for (const card of root.querySelectorAll('.strategy-analysis-card')) {
      const strategyId = strategyIdForCard(card);
      const evaluation = strategyId ? latestEvaluations.get(String(strategyId)) : null;
      if (!evaluation) continue;

      const bestMoves = evaluation.bestMoves || bestMovesForRows(evaluation.rows);
      const bestSet = new Set(bestMoves);
      const cells = [...card.querySelectorAll('.strategy-score-cell.actionable')];
      for (const cell of cells) {
        const move = moveFromCell(cell, '.score-cell-index');
        cell.classList.toggle('best', move !== null && bestSet.has(move));
      }

      if (bestMoves.length > 1) {
        const summary = card.querySelector('.strategy-analysis-summary strong');
        const firstBestCell = cells.find((cell) => bestSet.has(moveFromCell(cell, '.score-cell-index')));
        const scoreText = firstBestCell?.querySelector('strong')?.textContent?.trim() || '';
        if (summary) summary.textContent = `Best: cells ${humanMoveList(bestMoves)} · ${scoreText}`;
      }
    }
  }

  function normalizeWorldRecommendations() {
    const root = document.getElementById('play-info-states');
    const strategyId = document.getElementById('decision-strategy')?.value;
    const evaluation = strategyId ? latestEvaluations.get(String(strategyId)) : null;
    if (!root || !evaluation?.worlds?.length) return;

    const cards = [...root.querySelectorAll('.world-card')];
    cards.forEach((card, index) => {
      const detail = evaluation.worlds[index];
      const bestMoves = detail?.bestMoves || bestMovesForRows(detail?.scores);
      if (!bestMoves || bestMoves.length <= 1) return;
      const heading = card.querySelector('.world-strategy-head strong');
      if (heading) heading.textContent = `world favors c${bestMoves.map((move) => move + 1).join(', c')}`;
    });
  }

  function observe(rootId, callback) {
    const root = document.getElementById(rootId);
    if (!root) return;
    new MutationObserver(callback).observe(root, { childList: true, subtree: true });
    callback();
  }

  function install() {
    if (installed) return;
    installed = true;
    wrapEvaluator();

    observe('combined-value-map', normalizeCoachRecommendation);
    observe('analysis-strategy-boards', normalizeAnalysisRecommendations);
    observe('play-info-states', normalizeWorldRecommendations);

    // app4-core may have rendered once before this extension loaded. Re-run the
    // current decision view so the first visible recommendation also carries
    // exact, unrounded tie metadata.
    const decisionSelect = document.getElementById('decision-strategy');
    if (decisionSelect) decisionSelect.dispatchEvent(new Event('change', { bubbles: true }));
  }

  global.TTNBestTieHighlights = { install, bestMovesForRows };
})(window);
