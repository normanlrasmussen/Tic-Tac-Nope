(function () {
  'use strict';

  const NAME = 'Exact Nash (Sequence-Form LP)';
  const DETAIL_URL = './strategy-lp.html';

  function addDisabledSelectorOption(id) {
    const select = document.getElementById(id);
    if (!select || select.querySelector('option[value="lp"]')) return;
    const option = document.createElement('option');
    option.value = 'lp';
    option.disabled = true;
    option.textContent = `${NAME} · offline exact benchmark`;
    select.appendChild(option);
  }

  function addStrategySection() {
    const root = document.getElementById('strategy-cards');
    if (!root || document.getElementById('strategy-lp')) return;

    const section = document.createElement('section');
    section.id = 'strategy-lp';
    section.className = 'strategy-doc-section';
    section.innerHTML = `
      <header>
        <p class="strategy-section-number">LP · EXACT EQUILIBRIUM FORMULATION</p>
        <h2>${NAME}</h2>
        <p class="strategy-doc-meta">Sequence-form linear programming · Offline exact benchmark</p>
        <p class="strategy-verdict">The clean exact Nash formulation for the full two-player zero-sum perfect-recall game—when the complete sequence-form LP is actually solved.</p>
      </header>

      <h3>How it works</h3>
      <p>A normal-form mixed strategy would assign probabilities to complete contingency plans and is far too large to enumerate. Sequence form instead assigns realization weights to a player's action sequences. For O, let <code>x</code> be the realization plan, <code>E x = e</code> the sequence-flow constraints, <code>F y = f</code> X's constraints, and <code>A</code> the sparse terminal-payoff matrix. O's minimax problem is converted to a linear program by dualizing X's inner minimization.</p>
      <pre class="strategy-doc-formula"><code>maxₓ,ₚ  fᵀp
s.t.   Ex = e,  x ≥ 0
       Fᵀp ≤ Aᵀx</code></pre>
      <p>The solved realization plan is converted back to the behavioral policy used by the game via <code>σ(a|I) = x(σ(I)a) / x(σ(I))</code> whenever the parent sequence has positive realization probability. Perfect recall is what makes this behavioral representation realization-equivalent to mixed play over complete plans.</p>

      <h3>Assumptions about the players</h3>
      <p><strong>Acting player.</strong> Both players are fully strategic expected-utility maximizers in the implemented finite zero-sum game and remember their own actions and observations.</p>
      <p><strong>Opponent model.</strong> No fixed heuristic opponent is assumed. The LP solves the minimax interaction against the entire legal opponent strategy space represented by sequence form.</p>
      <p><strong>Hidden information.</strong> Information sets come from the same observation histories used by Tic-Tac-Nope. The LP does not reveal the true hidden state to either player.</p>

      <h3>Optimization objective</h3>
      <p>Compute realization plans <code>x*</code> and <code>y*</code> whose expected zero-sum payoff equals the game value: neither player can improve by unilaterally switching to another legal strategy.</p>

      <h3>Theoretical guarantees</h3>
      <p><strong>Guarantee.</strong> If the complete unabstracted game tree is encoded correctly and both sequence-form LPs are solved to optimality, the resulting realization plans are a minimax/Nash equilibrium of Tic-Tac-Nope up to numerical LP tolerance. Strong LP duality supplies a direct lower/upper value certificate; the reported duality gap is the numerical equilibrium certificate.</p>
      <p><strong>What it does not guarantee.</strong> “Exact” does not mean symbolic rational arithmetic: a floating-point LP is exact only within solver feasibility/optimality tolerances. Nash equilibrium also does not imply a unique equilibrium, a sequential-equilibrium refinement, or maximum exploitation of a known weak opponent.</p>

      <h3>Why it is not a live browser opponent yet</h3>
      <p>The sequence-form representation avoids the catastrophic normal-form strategy explosion, but it is still linear in the number of information sets and action sequences. The unabstracted Tic-Tac-Nope tree contains millions of histories for ordinary mystery-cell configurations, so building and solving the complete sparse LP on a phone is not a responsible interactive path. The repository therefore includes an offline HiGHS exporter. The website only calls an LP policy “exact Nash” after a full solved artifact with a value interval and duality gap exists; it never falls back to MCCFR while keeping the exact label.</p>

      <h3>Relation to MCCFR</h3>
      <p>MCCFR and sequence-form LP target the same Nash/minimax set under the game's finite two-player zero-sum perfect-recall assumptions. The difference is computational: MCCFR learns an approximate behavioral policy from sampled trajectories, while sequence-form LP solves a global sparse optimization problem and can provide an explicit optimality certificate. MCCFR remains the practical live equilibrium-seeking strategy; the LP is the exact benchmark.</p>

      <p><a class="secondary-btn compact" href="${DETAIL_URL}">Open the full LP strategy page</a></p>`;

    const closing = document.getElementById('strategy-interpretation');
    if (closing) root.insertBefore(section, closing);
    else root.appendChild(section);

    const toc = root.querySelector('.strategy-toc');
    if (toc && !toc.querySelector('a[href="#strategy-lp"]')) {
      const link = document.createElement('a');
      link.href = '#strategy-lp';
      link.textContent = NAME;
      toc.appendChild(link);
    }
  }

  function addAnalysisBenchmarkPanel() {
    const section = document.querySelector('#page-analysis .analysis-strategy-section');
    if (!section || document.getElementById('lp-analysis-benchmark')) return;
    const panel = document.createElement('section');
    panel.id = 'lp-analysis-benchmark';
    panel.className = 'panel analysis-training-panel';
    panel.innerHTML = `
      <div class="analysis-training-copy">
        <p class="kicker">EXACT EQUILIBRIUM BENCHMARK</p>
        <h2>${NAME}</h2>
        <p class="muted">Sequence form turns the full imperfect-information minimax problem into a sparse LP. A solved full-game artifact would provide an equilibrium value interval and duality-gap certificate. It is intentionally not substituted with the browser MCCFR table when no exact artifact is loaded.</p>
      </div>
      <div class="analysis-training-metrics">
        <span>Status <strong>offline solve</strong></span>
        <a class="secondary-btn compact" href="${DETAIL_URL}">Theory & guarantees</a>
      </div>`;
    section.parentNode.insertBefore(panel, section);
  }

  addDisabledSelectorOption('ai-strategy');
  addDisabledSelectorOption('decision-strategy');
  addStrategySection();
  addAnalysisBenchmarkPanel();
})();
