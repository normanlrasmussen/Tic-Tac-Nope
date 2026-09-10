(function (global) {
  'use strict';

  const T = global.TTNTheory;
  if (!T) return;

  const LP_ID = 'lp';
  const ALL_ID = 'all';
  let installed = false;
  let defaultsApplied = false;

  function pinLpFirstInRegistry() {
    const index = T.STRATEGIES.findIndex((strategy) => strategy.id === LP_ID);
    if (index <= 0) return;
    const [lp] = T.STRATEGIES.splice(index, 1);
    T.STRATEGIES.unshift(lp);
  }

  function pinLpFirstInSelect(select) {
    if (!select) return;
    const lp = select.querySelector(`option[value="${LP_ID}"]`);
    if (!lp) return;
    const all = select.querySelector(`option[value="${ALL_ID}"]`);
    if (all) {
      if (all.nextElementSibling !== lp) all.insertAdjacentElement('afterend', lp);
      return;
    }
    if (select.firstElementChild !== lp) select.insertBefore(lp, select.firstElementChild);
  }

  function normalizeVisibleOrdering() {
    pinLpFirstInRegistry();
    pinLpFirstInSelect(document.getElementById('ai-strategy'));
    pinLpFirstInSelect(document.getElementById('decision-strategy'));
  }

  function selectExactLpByDefault(select) {
    if (!select) return false;
    const lp = select.querySelector(`option[value="${LP_ID}"]`);
    if (!lp || lp.disabled) return false;
    if (select.value !== LP_ID) {
      select.value = LP_ID;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  }

  function applyInitialLpDefaults() {
    if (defaultsApplied) return;
    const aiReady = selectExactLpByDefault(document.getElementById('ai-strategy'));
    const coachReady = selectExactLpByDefault(document.getElementById('decision-strategy'));
    defaultsApplied = aiReady && coachReady;
  }

  function handleArtifactsLoaded() {
    normalizeVisibleOrdering();
    applyInitialLpDefaults();
  }

  function observeSelect(id) {
    const select = document.getElementById(id);
    if (!select || select.dataset.lpFirstObserver) return;
    select.dataset.lpFirstObserver = 'true';
    new MutationObserver(() => normalizeVisibleOrdering()).observe(select, { childList: true });
  }

  function install() {
    if (installed) return;
    installed = true;
    normalizeVisibleOrdering();
    observeSelect('ai-strategy');
    observeSelect('decision-strategy');
    applyInitialLpDefaults();
    global.addEventListener('ttn-lp-artifacts-loaded', handleArtifactsLoaded);
  }

  global.TTNLPFirstOrdering = { install, normalizeVisibleOrdering };
})(window);
