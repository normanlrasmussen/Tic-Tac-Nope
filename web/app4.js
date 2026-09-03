(function () {
  'use strict';
  function loadScript(src, onload) {
    const script = document.createElement('script');
    script.src = src;
    script.onload = onload || null;
    script.onerror = () => console.error(`Failed to load ${src}`);
    document.head.appendChild(script);
  }
  loadScript('./app4-core.js', () => loadScript('./strategy-guide.js'));
})();
