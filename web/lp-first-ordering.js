(function (global) {
  'use strict';

  const T = global.TTNTheory;
  if (!T) return;

  const LP_ID = 'lp';
  const ALL_ID = 'all';
  let installed = false;

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
    global.addEventListener('ttn-lp-artifacts-loaded', normalizeVisibleOrdering);
  }

  global.TTNLPFirstOrdering = { install, normalizeVisibleOrdering };
})(window);
