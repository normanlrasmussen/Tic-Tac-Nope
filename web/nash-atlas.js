(function (global) {
  'use strict';

  const T = global.TTNTheory;
  if (!T) return;

  const PAGE_ID = 'nash-data';
  const MANIFEST_URL = './equilibria/manifest.json';
  const SYMMETRY_URL = './equilibria/symmetry-map.json';
  const ROLE_FIRST = 'first';
  const ROLE_SECOND = 'second';
  const VIEW_CANONICAL = 'canonical';
  const VIEW_ALL = 'all';

  let installed = false;
  let loadPromise = null;
  let pairs = [];
  let symmetryMap = { masks: {} };
  let selectedRole = ROLE_FIRST;
  let selectedView = VIEW_CANONICAL;
  let selectedFogCount = 'all';

  function injectStyles() {
    if (document.getElementById('nash-atlas-styles')) return;
    const style = document.createElement('style');
    style.id = 'nash-atlas-styles';
    style.textContent = `
      #page-nash-data{--atlas-soft:rgba(0,0,0,.035)}
      .atlas-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:20px 0}
      .atlas-summary-card{padding:16px;border:1px solid var(--line,#d8d1c4);border-radius:16px;background:var(--panel,#fffdf8)}
      .atlas-summary-card span{display:block;color:var(--muted,#6f6a61);font-size:.72rem;letter-spacing:.07em;text-transform:uppercase}
      .atlas-summary-card strong{display:block;margin-top:6px;font-size:clamp(1.35rem,3vw,2rem);font-variant-numeric:tabular-nums;letter-spacing:-.035em}
      .atlas-toolbar{display:flex;align-items:end;justify-content:space-between;gap:18px;flex-wrap:wrap;margin:20px 0}
      .atlas-filter-group{display:flex;gap:16px;flex-wrap:wrap;align-items:end}
      .atlas-filter{display:grid;gap:6px}
      .atlas-filter>span,.atlas-filter label{font-size:.72rem;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--muted,#6f6a61)}
      .atlas-segment{display:flex;gap:4px;padding:4px;border:1px solid var(--line,#d8d1c4);border-radius:12px;background:var(--panel,#fffdf8)}
      .atlas-segment button{border:0;background:transparent;color:inherit;border-radius:8px;padding:8px 11px;font:inherit;font-size:.86rem;cursor:pointer}
      .atlas-segment button.active{background:var(--ink,#171717);color:var(--bg,#fff)}
      .atlas-filter select{min-width:150px;padding:9px 11px;border:1px solid var(--line,#d8d1c4);border-radius:10px;background:var(--panel,#fffdf8);color:inherit;font:inherit}
      .atlas-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:16px 0 26px}
      .atlas-card{padding:18px;border:1px solid var(--line,#d8d1c4);border-radius:18px;background:var(--panel,#fffdf8);display:grid;gap:15px;min-width:0}
      .atlas-card-head{display:flex;justify-content:space-between;gap:12px;align-items:start}
      .atlas-card-head h3{margin:4px 0 0;font-size:1.02rem}
      .atlas-mask{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.72rem;color:var(--muted,#6f6a61);white-space:nowrap}
      .atlas-card-body{display:grid;grid-template-columns:124px minmax(0,1fr);gap:16px;align-items:center}
      .atlas-board{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;width:124px}
      .atlas-cell{aspect-ratio:1;display:grid;place-items:center;border:1px solid var(--line,#d8d1c4);border-radius:8px;font-size:.68rem;color:var(--muted,#6f6a61);background:rgba(255,255,255,.12)}
      .atlas-cell.hidden{background:rgba(0,0,0,.09);color:inherit;font-weight:900;outline:1px dashed rgba(0,0,0,.18);outline-offset:-4px}
      .atlas-value{font-size:clamp(2rem,5vw,3.2rem);line-height:.95;font-weight:850;letter-spacing:-.06em;font-variant-numeric:tabular-nums}
      .atlas-value-label{margin-top:6px;font-size:.78rem;color:var(--muted,#6f6a61);line-height:1.4}
      .atlas-certs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
      .atlas-cert{padding:9px 10px;border-radius:10px;background:var(--atlas-soft);min-width:0}
      .atlas-cert span{display:block;font-size:.64rem;text-transform:uppercase;letter-spacing:.055em;color:var(--muted,#6f6a61)}
      .atlas-cert strong{display:block;margin-top:3px;font-size:.8rem;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
      .atlas-guarantee{padding:11px 12px;border-left:3px solid currentColor;background:var(--atlas-soft);font-size:.82rem;line-height:1.5}
      .atlas-guarantee.good{color:#24643e}.atlas-guarantee.watch{color:#88580f}
      .atlas-empty{padding:24px;border:1px dashed var(--line,#d8d1c4);border-radius:16px;color:var(--muted,#6f6a61)}
      .atlas-explainer{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin:24px 0}
      .atlas-explainer article{padding:20px;border:1px solid var(--line,#d8d1c4);border-radius:18px;background:var(--panel,#fffdf8)}
      .atlas-explainer h2{margin:7px 0 10px}
      .atlas-explainer ul{padding-left:20px;line-height:1.65;margin-bottom:0}
      @media(max-width:1050px){.atlas-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.atlas-summary{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:700px){.atlas-grid,.atlas-summary,.atlas-explainer{grid-template-columns:1fr}.atlas-card-body{grid-template-columns:106px minmax(0,1fr)}.atlas-board{width:106px}.atlas-toolbar{align-items:stretch}.atlas-filter-group{display:grid;width:100%}}
    `;
    document.head.appendChild(style);
  }

  function finite(value, fallback = NaN) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function fmtValue(value, digits = 4) {
    const n = finite(value);
    if (!Number.isFinite(n)) return '—';
    return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}`;
  }

  function fmtGap(value) {
    const n = Math.abs(finite(value));
    return Number.isFinite(n) ? n.toExponential(2) : '—';
  }

  function boardHtml(mask) {
    return Array.from({ length: 9 }, (_, move) => {
      const hidden = Boolean(Number(mask) & T.bit(move));
      return `<span class="atlas-cell${hidden ? ' hidden' : ''}">${hidden ? '?' : move + 1}</span>`;
    }).join('');
  }

  function hiddenFromMask(mask) {
    return Array.from({ length: 9 }, (_, move) => move).filter((move) => Number(mask) & T.bit(move));
  }

  function hiddenLabel(mask) {
    return hiddenFromMask(mask).map((move) => move + 1).join(', ');
  }

  function pairFromEntries(entries) {
    const grouped = new Map();
    for (const entry of entries) {
      const mask = Number(entry.hiddenMask);
      if (!Number.isInteger(mask)) continue;
      if (!grouped.has(mask)) grouped.set(mask, { mask, hidden: Array.isArray(entry.hidden) ? entry.hidden.map(Number) : hiddenFromMask(mask).map((m) => m + 1), O: null, X: null });
      const pair = grouped.get(mask);
      if (entry.startPlayer === 'O') pair.O = entry;
      if (entry.startPlayer === 'X') pair.X = entry;
    }
    return [...grouped.values()].sort((a, b) => a.hidden.length - b.hidden.length || a.mask - b.mask);
  }

  function roleStats(pair) {
    const o = pair.O;
    const x = pair.X;
    const firstCandidates = [];
    const secondCandidates = [];
    if (o) {
      firstCandidates.push(finite(o.valueO));
      secondCandidates.push(-finite(o.valueO));
    }
    if (x) {
      firstCandidates.push(-finite(x.valueO));
      secondCandidates.push(finite(x.valueO));
    }
    const clean = (items) => items.filter(Number.isFinite);
    const average = (items) => {
      const values = clean(items);
      return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN;
    };
    const firstValues = clean(firstCandidates);
    const secondValues = clean(secondCandidates);
    const mismatch = firstValues.length >= 2 ? Math.max(...firstValues) - Math.min(...firstValues) : NaN;
    const gaps = [o?.dualityGap, x?.dualityGap].map((value) => Math.abs(finite(value))).filter(Number.isFinite);
    const maxGap = gaps.length ? Math.max(...gaps) : NaN;
    const certified = Boolean(o?.numericallySolved && x?.numericallySolved && Number.isFinite(maxGap));
    return {
      first: average(firstValues),
      second: average(secondValues),
      mismatch: Math.abs(mismatch),
      maxGap,
      certified
    };
  }

  function rawMasksForCanonical(canonicalMask) {
    const matches = [];
    for (const [rawMask, data] of Object.entries(symmetryMap?.masks || {})) {
      if (Number(data?.canonicalMask) === Number(canonicalMask)) matches.push(Number(rawMask));
    }
    if (!matches.includes(Number(canonicalMask))) matches.push(Number(canonicalMask));
    return [...new Set(matches)].sort((a, b) => a - b);
  }

  function expandedRecords() {
    const base = pairs.map((pair) => ({ pair, displayMask: pair.mask, canonicalMask: pair.mask, coverage: rawMasksForCanonical(pair.mask) }));
    if (selectedView === VIEW_CANONICAL) return base;
    return base.flatMap((record) => record.coverage.map((mask) => ({ ...record, displayMask: mask })));
  }

  function guaranteeText(stats, roleValue) {
    const toleranceOk = Number.isFinite(stats.maxGap) && stats.maxGap <= 1e-9;
    const symmetryOk = !Number.isFinite(stats.mismatch) || stats.mismatch <= 1e-9;
    if (stats.certified && toleranceOk && symmetryOk) {
      return { cls: 'good', text: `Certified minimax/Nash security value ${fmtValue(roleValue)} for this role, up to the reported floating-point LP tolerance.` };
    }
    return { cls: 'watch', text: 'Exact artifacts are present, but inspect the numerical gap or O/X role-symmetry check before treating this row as fully certified.' };
  }

  function renderSummary(records) {
    const root = document.getElementById('atlas-summary');
    if (!root) return;
    const canonicalCount = pairs.length;
    const artifactCount = pairs.reduce((sum, pair) => sum + Boolean(pair.O) + Boolean(pair.X), 0);
    const allRaw = new Set(pairs.flatMap((pair) => rawMasksForCanonical(pair.mask)));
    const maxGap = Math.max(...pairs.map((pair) => roleStats(pair).maxGap).filter(Number.isFinite), 0);
    root.innerHTML = `
      <div class="atlas-summary-card"><span>Canonical solved layouts</span><strong>${canonicalCount}</strong></div>
      <div class="atlas-summary-card"><span>Exact LP artifacts</span><strong>${artifactCount}</strong></div>
      <div class="atlas-summary-card"><span>Board geometries covered</span><strong>${allRaw.size}</strong></div>
      <div class="atlas-summary-card"><span>Largest duality gap</span><strong>${maxGap.toExponential(2)}</strong></div>`;
  }

  function renderGrid() {
    const root = document.getElementById('atlas-grid');
    const count = document.getElementById('atlas-result-count');
    if (!root) return;
    const records = expandedRecords().filter((record) => selectedFogCount === 'all' || record.pair.hidden.length === Number(selectedFogCount));
    if (count) count.textContent = `${records.length} ${selectedView === VIEW_CANONICAL ? 'canonical solve' : 'board layout'}${records.length === 1 ? '' : 's'}`;
    if (!records.length) {
      root.innerHTML = '<div class="atlas-empty">No published exact LP artifacts match this filter.</div>';
      return;
    }
    root.innerHTML = records.map((record) => {
      const stats = roleStats(record.pair);
      const value = selectedRole === ROLE_FIRST ? stats.first : stats.second;
      const guarantee = guaranteeText(stats, value);
      const coverage = record.coverage.length;
      const sameAsCanonical = record.displayMask === record.canonicalMask;
      return `
        <article class="atlas-card" data-atlas-mask="${record.displayMask}" data-atlas-canonical-mask="${record.canonicalMask}">
          <div class="atlas-card-head">
            <div><span class="kicker">${selectedView === VIEW_CANONICAL ? 'CANONICAL SOLVE' : sameAsCanonical ? 'CANONICAL BOARD' : 'SYMMETRY-EQUIVALENT BOARD'}</span><h3>Fog cells ${hiddenLabel(record.displayMask)}</h3></div>
            <span class="atlas-mask">mask ${record.displayMask}${sameAsCanonical ? '' : ` → ${record.canonicalMask}`}</span>
          </div>
          <div class="atlas-card-body">
            <div class="atlas-board" aria-label="Fog cells ${hiddenLabel(record.displayMask)}">${boardHtml(record.displayMask)}</div>
            <div>
              <div class="atlas-value">${fmtValue(value)}</div>
              <div class="atlas-value-label">${selectedRole === ROLE_FIRST ? 'First-player' : 'Second-player'} equilibrium expected utility · win +1 / draw 0 / loss −1</div>
            </div>
          </div>
          <div class="atlas-certs">
            <div class="atlas-cert"><span>Duality gap</span><strong>${fmtGap(stats.maxGap)}</strong></div>
            <div class="atlas-cert"><span>O/X role mismatch</span><strong>${fmtGap(stats.mismatch)}</strong></div>
            <div class="atlas-cert"><span>Artifact pair</span><strong>${record.pair.O && record.pair.X ? 'O-start + X-start' : 'Partial'}</strong></div>
            <div class="atlas-cert"><span>Symmetry coverage</span><strong>${coverage} layout${coverage === 1 ? '' : 's'}</strong></div>
          </div>
          <div class="atlas-guarantee ${guarantee.cls}"><strong>${stats.certified ? 'Nash guarantee.' : 'Certificate status.'}</strong> ${guarantee.text}</div>
        </article>`;
    }).join('');
  }

  function renderFilters() {
    document.querySelectorAll('[data-atlas-role]').forEach((button) => button.classList.toggle('active', button.dataset.atlasRole === selectedRole));
    document.querySelectorAll('[data-atlas-view]').forEach((button) => button.classList.toggle('active', button.dataset.atlasView === selectedView));
    const select = document.getElementById('atlas-fog-count');
    if (select) select.value = selectedFogCount;
  }

  function render() {
    renderSummary(expandedRecords());
    renderFilters();
    renderGrid();
  }

  async function loadData() {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      const [manifestResponse, symmetryResponse] = await Promise.all([
        fetch(MANIFEST_URL, { cache: 'no-cache' }),
        fetch(SYMMETRY_URL, { cache: 'force-cache' })
      ]);
      if (!manifestResponse.ok) throw new Error(`manifest HTTP ${manifestResponse.status}`);
      const manifest = await manifestResponse.json();
      if (symmetryResponse.ok) symmetryMap = await symmetryResponse.json();
      const entries = (Array.isArray(manifest.artifacts) ? manifest.artifacts : [])
        .filter((entry) => entry?.informationModel === T.INFORMATION_MODEL && entry?.numericallySolved);
      pairs = pairFromEntries(entries);
      return pairs;
    })();
    return loadPromise;
  }

  async function refresh() {
    const grid = document.getElementById('atlas-grid');
    try {
      await loadData();
      render();
    } catch (error) {
      console.error('Failed to load Nash Atlas data', error);
      if (grid) grid.innerHTML = `<div class="atlas-empty"><strong>Could not load the published Nash artifacts.</strong><br>${String(error?.message || error)}</div>`;
    }
  }

  function installPage() {
    if (document.getElementById('page-nash-data')) return;
    injectStyles();
    const page = document.createElement('section');
    page.id = 'page-nash-data';
    page.className = 'page';
    page.setAttribute('aria-labelledby', 'nash-atlas-title');
    page.innerHTML = `
      <div class="page-head">
        <div>
          <p class="eyebrow">EXACT EQUILIBRIUM LIBRARY</p>
          <h1 id="nash-atlas-title">The Nash Atlas.</h1>
          <p class="lede">Every published exact Tic-Tac-Nope solve in one place. Compare how the equilibrium value changes with the fog geometry, switch between first- and second-player security values, and inspect the numerical certificate behind every number.</p>
        </div>
        <button class="secondary-btn" data-page="lp">How the LP proves these values</button>
      </div>

      <div class="research-tabs" role="navigation" aria-label="Research sections">
        <button data-page="nash">Exact Nash</button>
        <button class="active" data-page="nash-data">Nash Atlas</button>
        <button data-page="lp">LP Solver</button>
        <button data-page="simulate">Strategy Arena</button>
      </div>

      <div id="atlas-summary" class="atlas-summary"><div class="atlas-empty">Loading exact artifacts…</div></div>

      <section class="panel">
        <div class="atlas-toolbar">
          <div class="atlas-filter-group">
            <div class="atlas-filter"><span>Player role</span><div class="atlas-segment"><button type="button" class="active" data-atlas-role="first">Starts 1st</button><button type="button" data-atlas-role="second">Starts 2nd</button></div></div>
            <div class="atlas-filter"><span>Board view</span><div class="atlas-segment"><button type="button" class="active" data-atlas-view="canonical">Canonical solves</button><button type="button" data-atlas-view="all">All equivalent boards</button></div></div>
            <div class="atlas-filter"><label for="atlas-fog-count">Fog count</label><select id="atlas-fog-count"><option value="all">All solved counts</option><option value="2">2 hidden cells</option><option value="3">3 hidden cells</option><option value="4">4 hidden cells</option><option value="5">5 hidden cells</option><option value="6">6 hidden cells</option><option value="7">7 hidden cells</option><option value="8">8 hidden cells</option><option value="9">9 hidden cells</option></select></div>
          </div>
          <strong id="atlas-result-count">Loading…</strong>
        </div>
        <div id="atlas-grid" class="atlas-grid"><div class="atlas-empty">Reading the published sequence-form certificates…</div></div>
      </section>

      <section class="atlas-explainer">
        <article>
          <p class="kicker">HOW TO READ THE VALUE</p>
          <h2>A security value, not a win percentage</h2>
          <p>Utility is +1 for a win, 0 for a draw, and −1 for a loss. A value of +0.50 means the selected role can guarantee expected utility +0.50 against any legal information-safe opponent when it follows the exact equilibrium policy. Switching to “Starts 2nd” shows the same statement from the second mover's perspective.</p>
        </article>
        <article>
          <p class="kicker">WHAT MAKES IT A GUARANTEE</p>
          <h2>Primal/dual agreement certifies the solve</h2>
          <ul>
            <li>Each card comes from locally solved sequence-form LP artifacts for both O-start and X-start labelings.</li>
            <li>The duality gap measures the remaining numerical separation between the security lower and upper bounds.</li>
            <li>The O/X role mismatch checks that relabeling the symbols leaves the role-normalized value unchanged.</li>
            <li>Rotations/reflections share a value only when the symmetry map identifies them as exact game isomorphisms.</li>
          </ul>
        </article>
      </section>`;

    const lpPage = document.getElementById('page-lp');
    if (lpPage?.parentNode) lpPage.parentNode.insertBefore(page, lpPage);
    else document.querySelector('main')?.appendChild(page);

    page.querySelectorAll('[data-atlas-role]').forEach((button) => button.addEventListener('click', () => {
      selectedRole = button.dataset.atlasRole === ROLE_SECOND ? ROLE_SECOND : ROLE_FIRST;
      render();
    }));
    page.querySelectorAll('[data-atlas-view]').forEach((button) => button.addEventListener('click', () => {
      selectedView = button.dataset.atlasView === VIEW_ALL ? VIEW_ALL : VIEW_CANONICAL;
      render();
    }));
    document.getElementById('atlas-fog-count')?.addEventListener('change', (event) => {
      selectedFogCount = event.target.value || 'all';
      render();
    });
  }

  function syncTabs() {
    document.querySelectorAll('.research-tabs').forEach((tabs) => {
      if (tabs.querySelector('[data-page="nash-data"]')) return;
      const nash = tabs.querySelector('[data-page="nash"]');
      const button = document.createElement('button');
      button.dataset.page = PAGE_ID;
      button.textContent = 'Nash Atlas';
      if (nash) nash.insertAdjacentElement('afterend', button); else tabs.prepend(button);
    });
  }

  function openPage() {
    document.querySelectorAll('.page').forEach((page) => page.classList.toggle('active', page.id === 'page-nash-data'));
    document.querySelectorAll('.topbar .nav-btn').forEach((button) => button.classList.toggle('active', button.dataset.page === 'nash'));
    document.querySelectorAll('.research-tabs [data-page]').forEach((button) => button.classList.toggle('active', button.dataset.page === PAGE_ID));
    try { history.replaceState(null, '', '#nash-data'); } catch (_) { /* no-op */ }
    refresh();
    global.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function installNavigation() {
    document.addEventListener('click', (event) => {
      const target = event.target.closest('[data-page="nash-data"]');
      if (!target) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openPage();
    }, true);
  }

  function install() {
    if (installed) return;
    installed = true;
    installPage();
    installNavigation();
    syncTabs();
    refresh();
  }

  global.TTNNashAtlas = { install, openPage, refresh, syncTabs };
})(window);
