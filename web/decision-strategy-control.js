(function () {
  'use strict';

  const DEFAULT_STRATEGY = 'belief';

  function installStyles() {
    if (document.getElementById('decision-strategy-control-fix')) return;
    const style = document.createElement('style');
    style.id = 'decision-strategy-control-fix';
    style.textContent = `
      .combined-map-panel,
      .decision-map-heading,
      .decision-strategy-control { overflow: visible; }

      .decision-map-heading {
        display: grid !important;
        grid-template-columns: minmax(0, 1fr) minmax(320px, 460px);
        align-items: start !important;
        gap: 18px 28px;
      }

      .decision-map-heading > div:first-child { min-width: 0; }

      .decision-strategy-control {
        display: flex !important;
        flex-direction: column;
        align-items: stretch;
        gap: 7px;
        width: 100%;
        min-width: 0 !important;
        max-width: 460px;
        justify-self: end;
      }

      .decision-strategy-control label {
        display: block;
        width: 100%;
      }

      .decision-strategy-control .strategy-select {
        display: block;
        width: 100% !important;
        min-width: 0 !important;
        max-width: none !important;
        box-sizing: border-box;
      }

      .decision-strategy-control .pill {
        align-self: flex-end;
        justify-self: auto !important;
      }

      @media (max-width: 1050px) {
        .decision-map-heading {
          grid-template-columns: 1fr;
        }

        .decision-strategy-control {
          max-width: none;
          justify-self: stretch;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureDefault() {
    const select = document.getElementById('decision-strategy');
    if (!select || !select.options.length) return;

    const values = Array.from(select.options, (option) => option.value);
    const currentIsValid = Boolean(select.value) && values.includes(select.value);
    if (currentIsValid) return;

    const nextValue = values.includes(DEFAULT_STRATEGY) ? DEFAULT_STRATEGY : values[0];
    if (!nextValue) return;

    select.value = nextValue;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function install() {
    installStyles();
    ensureDefault();

    const select = document.getElementById('decision-strategy');
    if (!select || select.dataset.defaultGuardInstalled) return;
    select.dataset.defaultGuardInstalled = 'true';

    // Guard against future repopulation leaving the native select blank.
    new MutationObserver(ensureDefault).observe(select, { childList: true });
  }

  window.TTNDecisionStrategyControl = { install };
})(window);
