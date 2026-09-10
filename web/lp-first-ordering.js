(function (global) {
  'use strict';

  const T = global.TTNTheory;
  if (!T) return;

  const LP_ID = 'lp';
  const ALL_ID = 'all';
  const SELECT_IDS = ['ai-strategy', 'decision-strategy'];
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
    SELECT_IDS.forEach((id) => pinLpFirstInSelect(document.getElementById(id)));
  }

  function userHasChosen(select) {
    return select?.dataset.lpUserChosen === 'true';
  }

  function exactLpIsAvailable(select) {
    const lp = select?.querySelector(`option[value="${LP_ID}"]`);
    return Boolean(lp && !lp.disabled);
  }

  function enforceExactLpDefault(select) {
    if (!select || userHasChosen(select) || !exactLpIsAvailable(select)) return false;

    if (select.value !== LP_ID) {
      select.value = LP_ID;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    select.dataset.defaultExact = 'true';
    select.dataset.currentStrategy = select.value;
    return select.value === LP_ID;
  }

  function normalizeAndEnforceDefaults() {
    normalizeVisibleOrdering();
    SELECT_IDS.forEach((id) => enforceExactLpDefault(document.getElementById(id)));
  }

  function markUserChoice(select) {
    if (!select) return;
    select.dataset.lpUserChosen = 'true';
  }

  function observeSelect(id) {
    const select = document.getElementById(id);
    if (!select || select.dataset.lpFirstObserver) return;
    select.dataset.lpFirstObserver = 'true';

    // Pointer/keyboard interaction means subsequent strategy changes are intentional.
    select.addEventListener('pointerdown', () => markUserChoice(select), { capture: true });
    select.addEventListener('keydown', () => markUserChoice(select), { capture: true });

    // If another initialization layer programmatically resets the strategy before
    // the user has interacted, restore the intended Exact LP default.
    select.addEventListener('change', () => {
      select.dataset.currentStrategy = select.value;
      if (!userHasChosen(select) && select.value !== LP_ID) {
        queueMicrotask(() => enforceExactLpDefault(select));
      }
    });

    new MutationObserver(() => normalizeAndEnforceDefaults()).observe(select, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled']
    });
  }

  function install() {
    if (installed) return;
    installed = true;

    SELECT_IDS.forEach(observeSelect);
    normalizeAndEnforceDefaults();
    global.addEventListener('ttn-lp-artifacts-loaded', normalizeAndEnforceDefaults);

    // Cover both sides of the asynchronous LP-artifact/script initialization race.
    [0, 50, 250, 1000, 2500].forEach((delay) => {
      global.setTimeout(normalizeAndEnforceDefaults, delay);
    });
  }

  global.TTNLPFirstOrdering = { install, normalizeVisibleOrdering, normalizeAndEnforceDefaults };
})(window);
