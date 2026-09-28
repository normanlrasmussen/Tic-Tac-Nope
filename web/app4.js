(function () {
  'use strict';

  function loadScript(src) {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing?.dataset.loaded === 'true') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = existing || document.createElement('script');
      script.src = src;
      script.async = false;
      script.onload = () => {
        script.dataset.loaded = 'true';
        resolve();
      };
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      if (!existing) document.head.appendChild(script);
    });
  }

  function rewriteLpTheoryLinks() {
    document.querySelectorAll('a[href="./strategy-lp.html"]').forEach((link) => {
      link.href = '#lp';
      if (/theory|guarantees/i.test(link.textContent || '')) link.textContent = 'How the exact solver works';
    });
  }

  function syncResearchTabs() {
    if (window.TTNLPResearch?.syncTabs) window.TTNLPResearch.syncTabs();
    if (window.TTNNashAtlas?.syncTabs) window.TTNNashAtlas.syncTabs();
  }

  function openHashPage() {
    const page = (window.location.hash || '').replace('#', '').split('?')[0];
    if (!['home', 'play', 'analysis', 'strategies', 'nash', 'nash-data', 'lp', 'simulate', 'rules'].includes(page)) return;
    if (page === 'nash' && window.TTNNashBenchmark?.openPage) {
      window.TTNNashBenchmark.openPage();
      return;
    }
    if (page === 'nash-data' && window.TTNNashAtlas?.openPage) {
      window.TTNNashAtlas.openPage();
      return;
    }
    if (page === 'lp' && window.TTNLPResearch?.openPage) {
      window.TTNLPResearch.openPage();
      return;
    }
    const target = document.querySelector(`.topbar [data-page="${page}"]`)
      || document.querySelector(`#page-analysis [data-page="${page}"]`)
      || document.querySelector(`[data-page="${page}"]`);
    if (target) target.click();
  }

  async function boot() {
    // The research update must run before the core initializes its selectors.
    await loadScript('./strategy-research-update.js');
    await loadScript('./app4-core.js');
    if (window.TTNResearchUpdate?.afterCore) window.TTNResearchUpdate.afterCore();

    // These modules only define their public hooks or operate on independent
    // pages. Loading them together removes the old request waterfall.
    await Promise.all([
      loadScript('./decision-strategy-control.js'),
      loadScript('./round-robin-controls.js'),
      loadScript('./strategy-data.js')
    ]);
    if (window.TTNDecisionStrategyControl?.install) window.TTNDecisionStrategyControl.install();
    if (window.TTNRoundRobinControls?.install) window.TTNRoundRobinControls.install();

    // The guide renders immediately and the LP extension appends its section
    // to that guide, so keep this small dependency chain explicit.
    await loadScript('./strategy-guide.js');
    await loadScript('./lp-strategy-extension.js');

    await Promise.all([
      loadScript('./best-tie-highlights.js'),
      loadScript('./nash-benchmark.js'),
      loadScript('./nash-atlas.js'),
      loadScript('./ux-refresh.js')
    ]);
    if (window.TTNBestTieHighlights?.install) window.TTNBestTieHighlights.install();

    await loadScript('./lp-research-page.js');
    if (window.TTNLPResearch?.install) window.TTNLPResearch.install();
    rewriteLpTheoryLinks();

    await loadScript('./coach-all-strategies.js');
    if (window.TTNCoachAllStrategies?.install) window.TTNCoachAllStrategies.install();
    syncResearchTabs();

    await loadScript('./playground-mode.js');
    if (window.TTNPlaygroundMode?.install) window.TTNPlaygroundMode.install();

    await loadScript('./lp-first-ordering.js');
    if (window.TTNLPFirstOrdering?.install) window.TTNLPFirstOrdering.install();
    syncResearchTabs();
    rewriteLpTheoryLinks();
    openHashPage();
  }

  boot().catch((error) => console.error('Tic-Tac-Nope failed to initialize', error));

  window.addEventListener('hashchange', openHashPage);
})();
