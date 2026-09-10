(function (global) {
  'use strict';

  const T = global.TTNTheory;
  if (!T) return;

  const PAGE_ID = 'lp';
  let installed = false;

  function injectStyles() {
    if (document.getElementById('lp-research-page-styles')) return;
    const style = document.createElement('style');
    style.id = 'lp-research-page-styles';
    style.textContent = `
      #page-lp{--lp-soft:rgba(0,0,0,.035)}
      .lp-hero-grid{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(320px,.75fr);gap:22px;align-items:stretch;margin:22px 0}
      .lp-hero-card{padding:26px;border:1px solid var(--line,#d8d1c4);border-radius:20px;background:var(--panel,#fffdf8)}
      .lp-hero-card h2{font-size:clamp(1.65rem,3vw,2.6rem);margin:8px 0 12px;letter-spacing:-.035em}
      .lp-big-number{font-size:clamp(2.7rem,7vw,5.8rem);line-height:.92;font-weight:850;letter-spacing:-.07em;margin:12px 0 8px;font-variant-numeric:tabular-nums}
      .lp-metric-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:16px}
      .lp-metric{padding:13px 14px;border-radius:14px;background:var(--lp-soft)}
      .lp-metric span{display:block;font-size:.72rem;letter-spacing:.07em;text-transform:uppercase;color:var(--muted,#6f6a61)}
      .lp-metric strong{display:block;font-size:1.14rem;margin-top:4px;font-variant-numeric:tabular-nums}
      .lp-pipeline{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin:18px 0 26px}
      .lp-step{position:relative;padding:18px 16px;border:1px solid var(--line,#d8d1c4);border-radius:16px;background:var(--panel,#fffdf8);min-height:172px}
      .lp-step:not(:last-child)::after{content:'→';position:absolute;right:-10px;top:50%;transform:translate(50%,-50%);z-index:2;font-weight:900;font-size:1.2rem;background:var(--bg,#f7f3ea);padding:3px}
      .lp-step-index{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:999px;background:var(--ink,#171717);color:var(--bg,#fff);font-weight:800;font-size:.8rem}
      .lp-step h3{margin:12px 0 7px;font-size:1.03rem}
      .lp-step p{margin:0;color:var(--muted,#6f6a61);line-height:1.5;font-size:.9rem}
      .lp-two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;margin:22px 0}
      .lp-panel{padding:22px;border:1px solid var(--line,#d8d1c4);border-radius:18px;background:var(--panel,#fffdf8)}
      .lp-panel h2,.lp-panel h3{margin:7px 0 10px}
      .lp-formula{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;padding:18px;border-radius:14px;background:rgba(0,0,0,.055);overflow:auto;font-size:clamp(.88rem,1.5vw,1.08rem);line-height:1.7;margin:14px 0}
      .lp-flow-compare{display:grid;grid-template-columns:1fr auto 1fr;gap:14px;align-items:center;margin-top:15px}
      .lp-flow-side{padding:16px;border-radius:14px;background:var(--lp-soft)}
      .lp-flow-side strong{display:block;font-size:1.12rem;margin-bottom:4px}
      .lp-flow-arrow{font-size:1.7rem;font-weight:900}
      .lp-certificate{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:14px}
      .lp-cert-item{padding:14px;border-radius:14px;background:var(--lp-soft)}
      .lp-cert-item span{display:block;color:var(--muted,#6f6a61);font-size:.75rem;text-transform:uppercase;letter-spacing:.06em}
      .lp-cert-item strong{display:block;margin-top:5px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
      .lp-policy-layout{display:grid;grid-template-columns:minmax(230px,.75fr) minmax(0,1.25fr);gap:20px;align-items:center}
      .lp-policy-board{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;max-width:310px;width:100%;margin:auto}
      .lp-policy-cell{aspect-ratio:1;display:grid;place-items:center;border:1px solid var(--line,#d8d1c4);border-radius:12px;background:var(--panel,#fffdf8);font-variant-numeric:tabular-nums;font-weight:800;position:relative}
      .lp-policy-cell.hidden{outline:2px dashed rgba(0,0,0,.18);outline-offset:-5px}
      .lp-policy-cell small{position:absolute;top:7px;left:8px;color:var(--muted,#6f6a61);font-size:.62rem;font-weight:700}
      .lp-policy-cell.zero{color:var(--muted,#6f6a61);font-weight:500}
      .lp-symmetry-board{display:grid;grid-template-columns:repeat(3,30px);gap:4px;margin:12px 0}
      .lp-symmetry-board span{width:30px;height:30px;border-radius:7px;border:1px solid var(--line,#d8d1c4);display:grid;place-items:center;font-size:.68rem}
      .lp-symmetry-board span.hidden{background:rgba(0,0,0,.09);font-weight:800}
      .lp-guarantees{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin:22px 0}
      .lp-guarantee{padding:20px;border-radius:18px;border:1px solid var(--line,#d8d1c4);background:var(--panel,#fffdf8)}
      .lp-guarantee ul{padding-left:20px;line-height:1.65;margin-bottom:0}
      .lp-footer-actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:16px}
      @media(max-width:980px){.lp-pipeline{grid-template-columns:1fr 1fr}.lp-step::after{display:none}.lp-certificate{grid-template-columns:1fr 1fr}.lp-hero-grid,.lp-policy-layout{grid-template-columns:1fr}}
      @media(max-width:680px){.lp-pipeline,.lp-two,.lp-guarantees,.lp-metric-grid,.lp-certificate{grid-template-columns:1fr}.lp-flow-compare{grid-template-columns:1fr}.lp-flow-arrow{transform:rotate(90deg);justify-self:center}}
    `;
    document.head.appendChild(style);
  }

  function selectedHidden() {
    return [...document.querySelectorAll('#hidden-picker .picker-cell')]
      .flatMap((cell, index) => cell.classList.contains('selected') ? [index] : []);
  }

  function fmtCount(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return new Intl.NumberFormat('en-US').format(n);
  }

  function compact(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M`;
    if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K`;
    return String(n);
  }

  function fmtValue(value, digits = 4) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function boardHtml(hiddenMask, policy = []) {
    const probs = new Map(policy.map((item) => [Number(item.move), Number(item.prob) || 0]));
    return Array.from({ length: 9 }, (_, move) => {
      const p = probs.get(move) || 0;
      const hidden = Boolean(hiddenMask & T.bit(move));
      const label = p > 0 ? `${Math.round(p * 100)}%` : '—';
      return `<div class="lp-policy-cell${hidden ? ' hidden' : ''}${p <= 0 ? ' zero' : ''}"><small>${move + 1}${hidden ? ' · fog' : ''}</small>${label}</div>`;
    }).join('');
  }

  function tinyBoard(mask) {
    return `<div class="lp-symmetry-board">${Array.from({ length: 9 }, (_, move) => `<span class="${mask & T.bit(move) ? 'hidden' : ''}">${move + 1}</span>`).join('')}</div>`;
  }

  function installPage() {
    if (document.getElementById('page-lp')) return;
    injectStyles();

    const page = document.createElement('section');
    page.id = 'page-lp';
    page.className = 'page';
    page.setAttribute('aria-labelledby', 'lp-page-title');
    page.innerHTML = `
      <div class="page-head">
        <div>
          <p class="eyebrow">UNDER THE HOOD · EXACT EQUILIBRIUM</p>
          <h1 id="lp-page-title">How Tic-Tac-Nope gets an exact Nash equilibrium.</h1>
          <p class="lede">This is the one strategy on the site that does not approximate its way toward equilibrium. The full imperfect-information game is built, compressed into sequence form, solved as a sparse primal/dual linear program, certified, and then exported as a static behavioral policy.</p>
        </div>
        <a class="secondary-btn" href="#nash">See the live Nash certificate</a>
      </div>

      <div class="research-tabs" role="navigation" aria-label="Research sections">
        <button data-page="nash">Exact Nash</button>
        <button class="active" data-page="lp">LP Solver</button>
        <button data-page="simulate">Strategy Arena</button>
      </div>

      <div id="lp-live-story"><div class="panel"><p class="muted">Loading the exact-policy artifact for the current mystery-cell configuration…</p></div></div>

      <section aria-labelledby="lp-pipeline-title">
        <div class="detail-section-head"><p class="kicker">THE PIPELINE</p><h2 id="lp-pipeline-title">From hidden moves to a certified policy</h2></div>
        <div class="lp-pipeline">
          <article class="lp-step"><span class="lp-step-index">1</span><h3>Build the real game</h3><p>Enumerate legal Tic-Tac-Nope histories while preserving exactly what each player can and cannot observe.</p></article>
          <article class="lp-step"><span class="lp-step-index">2</span><h3>Merge information sets</h3><p>Histories that look identical to a player are tied together, forcing one behavioral decision across all of them.</p></article>
          <article class="lp-step"><span class="lp-step-index">3</span><h3>Compress to sequences</h3><p>Replace gigantic complete contingency plans with realization weights that obey probability-flow constraints.</p></article>
          <article class="lp-step"><span class="lp-step-index">4</span><h3>Solve primal + dual</h3><p>HiGHS solves the sparse zero-sum sequence-form LPs. Strong duality gives a direct optimality certificate.</p></article>
          <article class="lp-step"><span class="lp-step-index">5</span><h3>Ship only the policy</h3><p>The browser never solves an LP. It maps the live information set to a precomputed exact behavioral policy and samples an action.</p></article>
        </div>
      </section>

      <section class="lp-two">
        <article class="lp-panel">
          <p class="kicker">THE OPTIMIZATION</p>
          <h2>One global max–min problem</h2>
          <p>O chooses realization weights that maximize the payoff it can guarantee against every legal X strategy. X solves the dual minimization problem.</p>
          <div class="lp-formula">v* = maxₓ minᵧ xᵀAy = minᵧ maxₓ xᵀAy<br><br>Ex = e, &nbsp; x ≥ 0<br>Fy = f, &nbsp; y ≥ 0</div>
          <p class="muted">When the primal lower bound and dual upper bound meet, the remaining gap is the numerical optimality certificate.</p>
        </article>
        <article class="lp-panel">
          <p class="kicker">WHY SEQUENCE FORM IS THE TRICK</p>
          <h2>Do not enumerate every complete strategy</h2>
          <div class="lp-flow-compare">
            <div class="lp-flow-side"><strong>Normal form</strong><span>One variable per complete pure contingency plan.</span></div>
            <div class="lp-flow-arrow">→</div>
            <div class="lp-flow-side"><strong>Sequence form</strong><span>One realization weight per action sequence, linked by flow conservation.</span></div>
          </div>
          <p class="muted" style="margin-top:14px">Perfect recall is what makes those local sequence flows realization-equivalent to a behavioral strategy, so the compression keeps the equilibrium exact.</p>
        </article>
      </section>

      <section class="lp-two">
        <article class="lp-panel">
          <p class="kicker">SYMMETRY REUSE</p>
          <h2>One solve can cover rotated and reflected boards</h2>
          <div id="lp-symmetry-story"></div>
        </article>
        <article class="lp-panel">
          <p class="kicker">GLOBAL SOLVE → LOCAL MOVE</p>
          <h2>The LP becomes a behavioral policy</h2>
          <div id="lp-policy-story"></div>
        </article>
      </section>

      <section class="lp-guarantees">
        <article class="lp-guarantee">
          <p class="kicker">WHAT IS CERTIFIED</p>
          <h2>The strongest claim on the site</h2>
          <ul>
            <li>Nash/minimax equilibrium of the implemented finite two-player zero-sum game, assuming the full game encoding is correct.</li>
            <li>Behavioral policy is information-safe: one action distribution per information set, not per hidden true state.</li>
            <li>Primal/dual agreement supplies a numerical security-value certificate.</li>
            <li>Rotations and reflections reuse equilibrium policies only through exact game isomorphisms.</li>
          </ul>
        </article>
        <article class="lp-guarantee">
          <p class="kicker">WHAT IS NOT BEING CLAIMED</p>
          <h2>Exact game theory, numerical computation</h2>
          <ul>
            <li>The floating-point LP is not symbolic exact arithmetic; claims are up to solver tolerance.</li>
            <li>The equilibrium need not be unique or a stronger sequential-equilibrium refinement.</li>
            <li>Nash play guarantees security, not maximum exploitation of a particular weak opponent.</li>
            <li>The omniscient Oracle is outside the information structure, so the Nash guarantee does not apply against it.</li>
          </ul>
        </article>
      </section>

      <section class="lp-panel">
        <p class="kicker">WHY THIS MATTERS</p>
        <h2>The LP turns the rest of the project into measurable research.</h2>
        <p>Once an exact equilibrium exists, MCCFR is no longer judged by “it seems strong.” Its exploitability, value error, and convergence can be measured against a certified target. Heuristics can be evaluated by how they depart from equilibrium. The browser can play the true solved strategy without doing any expensive optimization online.</p>
        <div class="lp-footer-actions">
          <a class="primary-btn" href="#nash">Inspect the Nash value & benchmark</a>
          <a class="secondary-btn" href="#play">Play against Exact Nash</a>
        </div>
      </section>`;

    const nashPage = document.getElementById('page-nash');
    const simulatePage = document.getElementById('page-simulate');
    if (nashPage?.parentNode) nashPage.parentNode.insertBefore(page, simulatePage || nashPage.nextSibling);
    else document.querySelector('main')?.appendChild(page);
  }

  function refresh() {
    const root = document.getElementById('lp-live-story');
    if (!root) return;

    const hidden = selectedHidden();
    const rules = T.makeRules(hidden, T.O);
    const artifact = typeof T.exactLPArtifactForRules === 'function' ? T.exactLPArtifactForRules(rules) : null;
    const symmetry = typeof T.exactLPSymmetryForMask === 'function' ? T.exactLPSymmetryForMask(rules.hiddenMask) : null;

    if (!artifact) {
      root.innerHTML = `<div class="lp-hero-grid"><article class="lp-hero-card"><p class="kicker">CURRENT CONFIGURATION</p><h2>Mystery cells ${hidden.map((m) => m + 1).join(', ') || 'none'}</h2><p>No certified exact artifact is currently published for this symmetry class. Choose a solved layout on the Exact Nash page or generate the missing LP locally.</p></article><article class="lp-hero-card"><p class="kicker">STATUS</p><div class="lp-big-number">—</div><p class="muted">Exact certificate unavailable.</p></article></div>`;
      const symmetryRoot = document.getElementById('lp-symmetry-story');
      if (symmetryRoot) symmetryRoot.innerHTML = `<p class="muted">Symmetry information will appear when a solved configuration is selected.</p>`;
      const policyRoot = document.getElementById('lp-policy-story');
      if (policyRoot) policyRoot.innerHTML = `<p class="muted">The root behavioral policy will appear when a solved configuration is selected.</p>`;
      return;
    }

    const c = artifact.counts || {};
    const totalInfo = (Number(c.informationSetsO) || 0) + (Number(c.informationSetsX) || 0);
    const totalSeq = (Number(c.sequencesO) || 0) + (Number(c.sequencesX) || 0);
    const storedInfo = (Number(c.storedInformationSetsO) || 0) + (Number(c.storedInformationSetsX) || 0);
    const gap = Math.abs(Number(artifact.dualityGap) || 0);
    const solverName = String(artifact.solver || 'LP solver').replace("scipy.optimize.", '');

    root.innerHTML = `
      <div class="lp-hero-grid">
        <article class="lp-hero-card">
          <p class="kicker">CURRENT SOLVED GAME · MYSTERY CELLS ${hidden.map((m) => m + 1).join(', ')}</p>
          <h2>${fmtCount(c.histories)} game histories become one certified equilibrium.</h2>
          <p>The solver explores the complete imperfect-information game offline, compresses it into sequence form, and exports only the behavioral decisions the website needs.</p>
          <div class="lp-metric-grid">
            <div class="lp-metric"><span>Terminal histories</span><strong>${compact(c.terminals)}</strong></div>
            <div class="lp-metric"><span>Information sets</span><strong>${compact(totalInfo)}</strong></div>
            <div class="lp-metric"><span>Action sequences</span><strong>${compact(totalSeq)}</strong></div>
            <div class="lp-metric"><span>Stored policy states</span><strong>${fmtCount(storedInfo)}</strong></div>
            <div class="lp-metric"><span>First-player value</span><strong>${fmtValue(artifact.valueO)}</strong></div>
            <div class="lp-metric"><span>Solver</span><strong>${escapeHtml(solverName)}</strong></div>
          </div>
        </article>
        <article class="lp-hero-card">
          <p class="kicker">OPTIMALITY CERTIFICATE</p>
          <div class="lp-big-number">${gap === 0 ? '0' : gap.toExponential(2)}</div>
          <p><strong>LP duality gap.</strong> The primal security lower bound and dual upper bound meet${gap === 0 ? ' exactly at the stored precision' : ' within solver tolerance'}.</p>
          <div class="lp-certificate">
            <div class="lp-cert-item"><span>Lower bound</span><strong>${fmtValue(artifact.lowerBoundO)}</strong></div>
            <div class="lp-cert-item"><span>Upper bound</span><strong>${fmtValue(artifact.upperBoundO)}</strong></div>
            <div class="lp-cert-item"><span>Solved</span><strong>${artifact.numericallySolved ? 'Yes' : 'No'}</strong></div>
            <div class="lp-cert-item"><span>Model</span><strong>${escapeHtml(artifact.informationModel)}</strong></div>
          </div>
        </article>
      </div>`;

    const symmetryRoot = document.getElementById('lp-symmetry-story');
    if (symmetryRoot) {
      const canonical = Number(symmetry?.canonicalMask ?? rules.hiddenMask);
      symmetryRoot.innerHTML = `
        <div class="lp-flow-compare">
          <div class="lp-flow-side"><strong>Selected board</strong>${tinyBoard(rules.hiddenMask)}<span>mask ${rules.hiddenMask}</span></div>
          <div class="lp-flow-arrow">→</div>
          <div class="lp-flow-side"><strong>Canonical board</strong>${tinyBoard(canonical)}<span>mask ${canonical}${symmetry?.transform ? ` · ${escapeHtml(symmetry.transform)}` : ''}</span></div>
        </div>
        <p class="muted">The game is relabeled through an exact rotation/reflection isomorphism, queried in canonical coordinates, then mapped back to the board you see. That lets one expensive solve safely cover every symmetric layout.</p>`;
    }

    const policyRoot = document.getElementById('lp-policy-story');
    if (policyRoot) {
      const state = T.makeRoot(rules);
      const policy = typeof T.exactLPPolicy === 'function' ? T.exactLPPolicy(state, rules) : [];
      const positive = policy.filter((item) => Number(item.prob) > 1e-12);
      policyRoot.innerHTML = `
        <div class="lp-policy-layout">
          <div class="lp-policy-board">${boardHtml(rules.hiddenMask, policy)}</div>
          <div>
            <p><strong>Exact opening distribution.</strong> The global realization plan is converted back into a local behavioral distribution σ(a|I) at the current information set.</p>
            <p class="muted">${positive.length ? `At the root, the exact policy mixes across ${positive.length} move${positive.length === 1 ? '' : 's'}: ${positive.map((item) => `cell ${Number(item.move) + 1} at ${Math.round(Number(item.prob) * 100)}%`).join(', ')}.` : 'No root policy is available for this artifact.'}</p>
            <div class="lp-formula">σ(a|I) = x(σ(I)a) / x(σ(I))</div>
          </div>
        </div>`;
    }
  }

  function syncTabs() {
    document.querySelectorAll('.research-tabs').forEach((tabs) => {
      if (tabs.querySelector('[data-page="lp"]')) return;
      const nash = tabs.querySelector('[data-page="nash"]');
      const button = document.createElement('button');
      button.dataset.page = PAGE_ID;
      button.textContent = 'LP Solver';
      if (nash) nash.insertAdjacentElement('afterend', button); else tabs.appendChild(button);
    });
  }

  function openPage() {
    document.querySelectorAll('.page').forEach((page) => page.classList.toggle('active', page.id === 'page-lp'));
    document.querySelectorAll('.topbar .nav-btn').forEach((button) => button.classList.toggle('active', button.dataset.page === 'nash'));
    document.querySelectorAll('.research-tabs [data-page]').forEach((button) => button.classList.toggle('active', button.dataset.page === PAGE_ID));
    try { history.replaceState(null, '', '#lp'); } catch (_) { /* no-op */ }
    refresh();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openResearchPage(page) {
    if (page === PAGE_ID) {
      openPage();
      return;
    }
    if (page === 'nash' && global.TTNNashBenchmark?.openPage) {
      global.TTNNashBenchmark.openPage();
      return;
    }
    if (page === 'simulate') {
      const target = document.querySelector('#page-simulate .research-tabs [data-page="simulate"]');
      if (target) target.click();
    }
  }

  function installNavigation() {
    document.addEventListener('click', (event) => {
      const target = event.target.closest('[data-page]');
      if (!target) return;
      const page = target.dataset.page;
      if (page !== PAGE_ID && !target.closest('#page-lp')) return;
      if (!['lp', 'nash', 'simulate'].includes(page)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openResearchPage(page);
    }, true);
  }

  function install() {
    if (installed) return;
    installed = true;
    installPage();
    installNavigation();
    syncTabs();
    refresh();
    global.addEventListener('ttn-lp-artifacts-loaded', refresh);
    document.getElementById('hidden-picker')?.addEventListener('click', () => setTimeout(refresh, 0));
  }

  global.TTNLPResearch = { install, openPage, refresh, syncTabs };
})(window);
