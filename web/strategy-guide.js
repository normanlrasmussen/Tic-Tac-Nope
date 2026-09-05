(function () {
  'use strict';

  const T = window.TTNTheory;
  const D = window.TTNStrategyData;
  const root = document.getElementById('strategy-cards');
  if (!T || !D || !root) return;

  if (!document.querySelector('link[data-strategy-guide]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = './strategy-guide.css';
    link.dataset.strategyGuide = 'true';
    document.head.appendChild(link);
  }

  const order = ['belief', 'nash', 'robust', 'thompson_uniform', 'thompson', 'random', 'oracle'];

  const REFERENCES = {
    kuhn: {
      label: 'Kuhn (1953), Extensive Games and the Problem of Information',
      href: 'https://doi.org/10.1515/9781400829156-011',
      note: 'Perfect recall and the equivalence of mixed and behavioral strategies.'
    },
    cfr: {
      label: 'Zinkevich, Johanson, Bowling & Piccione (2007), Regret Minimization in Games with Incomplete Information',
      href: 'https://papers.nips.cc/paper_files/paper/2007/hash/08d98638c6fcd194a4b1e6992063e944-Abstract.html',
      note: 'Counterfactual regret minimization and equilibrium convergence in two-player zero-sum extensive-form games.'
    },
    mccfr: {
      label: 'Lanctot, Waugh, Zinkevich & Bowling (2009), Monte Carlo Sampling for Regret Minimization in Extensive Games',
      href: 'https://papers.nips.cc/paper_files/paper/2009/hash/00411460f7c92d2124a67ea0f4cb5f85-Abstract.html',
      note: 'Monte Carlo CFR, including outcome-sampling regret estimation.'
    },
    openspiel: {
      label: 'OpenSpiel, outcome_sampling_mccfr.py',
      href: 'https://github.com/google-deepmind/open_spiel/blob/master/open_spiel/python/algorithms/outcome_sampling_mccfr.py',
      note: 'Implementation-level reference for the outcome-sampling estimator used as the site’s comparison point.'
    },
    thompson: {
      label: 'Thompson (1933), On the Likelihood that One Unknown Probability Exceeds Another in View of the Evidence of Two Samples',
      href: 'https://doi.org/10.1093/biomet/25.3-4.285',
      note: 'Classical probability-matching / posterior-sampling idea underlying the Thompson-style baselines.'
    },
    minimax: {
      label: 'von Neumann (1928), Zur Theorie der Gesellschaftsspiele',
      href: 'https://doi.org/10.1007/BF01448847',
      note: 'Foundational minimax result; the Oracle here applies exact minimax only after hidden information is removed.'
    }
  };

  const refsByStrategy = {
    belief: ['cfr', 'mccfr', 'kuhn'],
    nash: ['kuhn', 'cfr', 'mccfr', 'openspiel'],
    robust: ['minimax'],
    thompson_uniform: ['thompson'],
    thompson: ['thompson', 'cfr', 'mccfr'],
    random: ['kuhn'],
    oracle: ['minimax']
  };

  const pageHead = document.querySelector('#page-strategies .page-head');
  const title = pageHead?.querySelector('h1');
  const lede = pageHead?.querySelector('.lede');
  if (title) title.textContent = 'Strategy reference';
  if (lede) lede.textContent = 'A single continuous theory page: assumptions, objective, guarantees, failure modes, computational cost, and references for every strategy used in the lab.';

  root.className = 'strategy-document';
  root.innerHTML = `${renderOverview()}${renderContents()}${order.map(renderStrategySection).join('')}${renderClosingNotes()}`;

  function renderOverview() {
    return `
      <section class="strategy-doc-intro" id="strategy-overview">
        <p class="kicker">THE EXTENSIVE-FORM MODEL</p>
        <h2>Strategies act on information sets, not on the hidden true node.</h2>
        <p>Tic-Tac-Nope is a finite two-player zero-sum extensive-form game with imperfect information. A player’s information state contains the complete sequence of public moves, observed opponent fog events, and that player’s own mystery-cell attempt locations. A mystery attempt does not reveal a separate success/failure result; hidden ownership is known only when it is logically implied by the player’s observation history.</p>
        <p>Because nobody forgets an action or observation they previously knew, the implemented game has <strong>perfect recall</strong>. That fact is critical: by <strong>Kuhn’s theorem</strong>, in a perfect-recall extensive game a normal-form mixed strategy over complete pure contingency plans has an outcome-equivalent <strong>behavioral strategy</strong> that randomizes locally as <code>σ(a|I)</code>. That is why MCCFR stores action probabilities at information sets rather than attempting to enumerate enormous complete plans.</p>
        <blockquote><strong>“Best” depends on the question.</strong> If the goal is minimax security against an unknown strategic opponent, Regret-Matched Behavioral (MCCFR) is the strongest theoretical default here. A model-based heuristic can outperform it against a particular weak opponent, but that is exploitative performance rather than a universal dominance guarantee.</blockquote>
      </section>`;
  }

  function renderContents() {
    return `
      <nav class="strategy-toc" aria-label="Strategy section navigation">
        <strong>On this page</strong>
        ${order.map((id) => `<a href="#strategy-${id}">${D[id].name}</a>`).join('')}
      </nav>`;
  }

  function renderStrategySection(id, index) {
    const d = D[id];
    if (!d) return '';
    const theoryNote = id === 'nash'
      ? `<p class="strategy-theory-callout"><strong>Why behavioral play is valid here.</strong> Tic-Tac-Nope has perfect recall, so Kuhn’s theorem permits an outcome-equivalent behavioral representation <code>σ(a|I)</code> in place of a mixed strategy over complete pure plans. MCCFR therefore learns and deploys the mathematically appropriate local randomization at each information set.</p>`
      : id === 'random'
        ? `<p class="strategy-theory-callout"><strong>Random is not the same as mixed equilibrium play.</strong> Uniform randomization is simply a control policy. Strategic behavioral probabilities are determined by regret/indifference conditions; there is no reason for those probabilities to be uniform.</p>`
        : '';

    return `
      <section id="strategy-${id}" class="strategy-doc-section">
        <header>
          <p class="strategy-section-number">${String(index + 1).padStart(2, '0')} · ${escapeHtml(d.status)}</p>
          <h2>${escapeHtml(d.name)}</h2>
          <p class="strategy-doc-meta">${escapeHtml(d.family)} · ${d.playable ? 'Playable' : 'Simulation-only benchmark'}</p>
          <p class="strategy-verdict">${escapeHtml(d.verdict)}</p>
        </header>

        <h3>How it works</h3>
        <p>${escapeHtml(d.overview)}</p>
        <pre class="strategy-doc-formula"><code>${escapeHtml(d.formula)}</code></pre>
        ${theoryNote}

        <h3>Assumptions about the players</h3>
        <p><strong>Acting player.</strong> ${escapeHtml(d.player)}</p>
        <p><strong>Opponent model.</strong> ${escapeHtml(d.opponent)}</p>
        <p><strong>Hidden information.</strong> ${escapeHtml(d.hidden)}</p>

        <h3>Optimization objective</h3>
        <p>${escapeHtml(d.objective)}</p>

        <h3>Theoretical guarantees</h3>
        <p>${escapeHtml(d.guarantee)}</p>
        <p><strong>What it does not guarantee.</strong> ${escapeHtml(d.notGuarantee)}</p>

        <h3>Failure modes and computational cost</h3>
        <p>${escapeHtml(d.failure)}</p>
        <p><strong>Cost.</strong> ${escapeHtml(d.cost)}</p>

        <h3>When to use it</h3>
        <p>${escapeHtml(d.best)}</p>
        <p><strong>Relation to MCCFR.</strong> ${escapeHtml(d.nash)}</p>

        <h3>Theoretical references</h3>
        ${renderReferences(refsByStrategy[id] || [])}
      </section>`;
  }

  function renderReferences(keys) {
    if (!keys.length) return '<p>No special theoretical claim is made beyond legal game play.</p>';
    return `<ul class="strategy-reference-list">${keys.map((key) => {
      const ref = REFERENCES[key];
      return `<li><a href="${ref.href}" target="_blank" rel="noreferrer">${escapeHtml(ref.label)}</a><span>${escapeHtml(ref.note)}</span></li>`;
    }).join('')}</ul>`;
  }

  function renderClosingNotes() {
    return `
      <section class="strategy-doc-section strategy-doc-closing" id="strategy-interpretation">
        <p class="kicker">HOW TO INTERPRET THE SCORES</p>
        <h2>Do not compare unlike quantities as though they were the same value.</h2>
        <p>The Play and Analysis pages display <strong>utility on [−1,+1]</strong> for strategies whose decision rule directly scores continuation utility, and <strong>action probability on [0%,100%]</strong> for behavioral or sampling strategies. A 70% MCCFR action probability is not “better” than a +0.40 robust utility score; they answer different mathematical questions.</p>
        <p>Round-robin scores are empirical matchup evidence. They do not create a Nash guarantee, and the Omniscient Oracle remains an intentionally unfair information benchmark.</p>
      </section>`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }
})();