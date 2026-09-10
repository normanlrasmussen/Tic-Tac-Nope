(function () {
  'use strict';

  function loadStyle(href) {
    if (document.querySelector(`link[href="${href}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }

  function loadScript(src, onload) {
    const script = document.createElement('script');
    script.src = src;
    script.onload = onload || null;
    script.onerror = () => console.error(`Failed to load ${src}`);
    document.head.appendChild(script);
  }

  function openHashPage() {
    const page = (window.location.hash || '').replace('#', '');
    if (!['home', 'play', 'analysis', 'strategies', 'nash', 'lp', 'simulate', 'rules'].includes(page)) return;
    if (page === 'nash' && window.TTNNashBenchmark?.openPage) {
      window.TTNNashBenchmark.openPage();
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

  loadStyle('./legacy-reset.css');

  loadScript('./strategy-research-update.js', () => {
    loadScript('./app4-core.js', () => {
      if (window.TTNResearchUpdate?.afterCore) window.TTNResearchUpdate.afterCore();
      loadScript('./decision-strategy-control.js', () => {
        if (window.TTNDecisionStrategyControl?.install) window.TTNDecisionStrategyControl.install();
        loadScript('./round-robin-controls.js', () => {
          if (window.TTNRoundRobinControls?.install) window.TTNRoundRobinControls.install();
          loadScript('./strategy-data.js', () => {
            loadScript('./strategy-guide.js', () => {
              loadScript('./lp-strategy-extension.js', () => {
                loadScript('./best-tie-highlights.js', () => {
                  if (window.TTNBestTieHighlights?.install) window.TTNBestTieHighlights.install();
                  loadScript('./nash-benchmark.js', () => {
                    loadScript('./lp-research-page.js', () => {
                      if (window.TTNLPResearch?.install) window.TTNLPResearch.install();
                      loadScript('./ux-refresh.js', () => {
                        if (window.TTNLPResearch?.syncTabs) window.TTNLPResearch.syncTabs();
                        loadScript('./coach-all-strategies.js', () => {
                          if (window.TTNCoachAllStrategies?.install) window.TTNCoachAllStrategies.install();
                          if (window.TTNLPResearch?.syncTabs) window.TTNLPResearch.syncTabs();
                          loadScript('./lp-first-ordering.js', () => {
                            if (window.TTNLPFirstOrdering?.install) window.TTNLPFirstOrdering.install();
                            openHashPage();
                          });
                        });
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });

  window.addEventListener('hashchange', openHashPage);
})();