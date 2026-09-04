(function () {
  'use strict';

  function loadScript(src, onload) {
    const script = document.createElement('script');
    script.src = src;
    script.onload = onload || null;
    script.onerror = () => console.error(`Failed to load ${src}`);
    document.head.appendChild(script);
  }

  function openHashPage() {
    const page = (window.location.hash || '').replace('#', '');
    if (!['play', 'analysis', 'strategies', 'simulate', 'rules'].includes(page)) return;
    const target = document.querySelector(`[data-page="${page}"]`);
    if (target) target.click();
  }

  loadScript('./strategy-research-update.js', () => {
    loadScript('./app4-core.js', () => {
      if (window.TTNResearchUpdate?.afterCore) window.TTNResearchUpdate.afterCore();
      loadScript('./decision-strategy-control.js', () => {
        if (window.TTNDecisionStrategyControl?.install) window.TTNDecisionStrategyControl.install();
        loadScript('./round-robin-controls.js', () => {
          if (window.TTNRoundRobinControls?.install) window.TTNRoundRobinControls.install();
          loadScript('./strategy-data.js', () => {
            loadScript('./strategy-guide.js', () => {
              loadScript('./lp-strategy-extension.js', openHashPage);
            });
          });
        });
      });
    });
  });

  window.addEventListener('hashchange', openHashPage);
})();
