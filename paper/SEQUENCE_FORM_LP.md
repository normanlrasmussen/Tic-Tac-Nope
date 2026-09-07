# Exact Nash via sequence-form linear programming

Tic-Tac-Nope is modeled as a finite, two-player, zero-sum extensive-form game with imperfect information and perfect recall. In that setting, a Nash/minimax equilibrium can be computed exactly (up to numerical LP tolerance) in **sequence form**.

## Why sequence form

A normal-form mixed strategy randomizes over complete pure contingency plans. That representation is prohibitively large. Sequence form instead stores a realization weight for each player action sequence. For player O, let `x` be O's realization plan and `E x = e` its sequence-flow constraints. For X, let `y` satisfy `F y = f`. Let `A` be the sparse terminal-payoff matrix from O's perspective.

The game value is

```text
max_x min_y x^T A y
s.t. E x = e, x >= 0
     F y = f, y >= 0.
```

Dualizing X's inner minimization gives O's LP:

```text
max_{x,p} f^T p
s.t. E x = e
     x >= 0
     F^T p <= A^T x.
```

The repository's `sequence_form_lp.py` solves this LP for O and the symmetric LP for X with SciPy/HiGHS.

## Converting the LP to browser play

For an information set `I`, let `s(I)` be its parent sequence. If the solved realization plan has positive parent weight, the behavioral action probability is

```text
sigma(a | I) = x(s(I)a) / x(s(I)).
```

Because the game has perfect recall, this behavioral strategy is realization-equivalent to the corresponding mixed strategy over complete pure plans.

If an information set has zero parent realization weight, sequence form does not uniquely identify its local conditional probabilities. The exporter uses a uniform completion there. This does not change the realization plan because that information set cannot be reached while the player follows its own zero-probability parent sequence.

## Guarantee

When all of the following are true:

1. the **complete unabstracted** Tic-Tac-Nope game tree is enumerated;
2. information sets and legal actions match the implemented game;
3. both sequence-form LPs solve successfully; and
4. the numerical feasibility/optimality residuals are within the chosen solver tolerance,

the exported realization plans are a Nash/minimax equilibrium of the implemented game up to numerical LP tolerance.

Solving both players gives an O lower bound and upper bound on the game value. Their difference is the numerical duality gap and is the natural equilibrium certificate stored with an exported policy.

## What the guarantee does not mean

- It is not symbolic exact arithmetic; HiGHS uses floating-point numerics.
- Nash equilibrium need not be unique.
- Nash equilibrium is not automatically a sequential-equilibrium refinement.
- A minimax strategy need not maximize payoff against one known weak opponent.
- Any abstraction, lossy information-set merge, heuristic pruning, or incomplete tree traversal changes/removes the full-game guarantee.

## Why this is an offline benchmark

Sequence form is dramatically smaller than normal form, but its size is still proportional to the number of information sets and action sequences. The unabstracted Tic-Tac-Nope game has millions of histories for ordinary mystery-cell configurations. A complete sparse LP is therefore an offline research workload, not a reasonable phone/browser solve.

The website intentionally does **not** relabel MCCFR as an LP result. Exact Nash appears as an offline benchmark until a full solved artifact is generated and bundled.

## Running the exporter

Install dependencies:

```bash
python -m pip install numpy scipy
```

Solve a configuration (cell numbers are 1-based):

```bash
python sequence_form_lp.py \
  --hidden 2,4 \
  --start O \
  --output web/equilibria/mask-10-start-O.json
```

Use `--node-limit N` as a safety guard while testing the enumerator. A full equilibrium claim requires a complete traversal; hitting the node limit aborts the solve.

### Faster resumable batch export

```bash
python precompute.py --mode all --solvers exact --keep-going
```

This command retains all 196 output configurations and the complete unabstracted
game. It now avoids redundant work in several ways:

- O/X relabeling requires only one tree build and two player LPs per board mask,
  instead of rebuilding and solving both LPs for each starter. The other output
  swaps player policies, player identifiers in observation keys, and player counts;
  its O interval is `[-upperBoundO, -lowerBoundO]`. This is an exact symmetry of
  the rules, not an approximation.
- Win and action-mask lookup tables replace repeated scans. The enumerator applies
  already-validated actions directly, retaining perfect-recall and legality checks
  at information sets and the public transition API's input validation.
- HiGHS uses native unrestricted bounds for the dual variables instead of doubled
  positive/negative columns. Both player LPs still run with the same tolerances.
- Zero payoff entries are omitted from sparse storage, while all terminal histories
  are still enumerated and counted. Manifest rebuilds cache unchanged file metadata
  rather than repeatedly decoding every policy.

Existing outputs are skipped. A compatible completed counterpart can supply a missing
starter output; otherwise the full solver runs. `--force` recomputes one starter and
derives the other from that fresh result. `--node-limit` and `--keep-going` retain
their behavior. Compact output files are published by atomic replacement so an
interrupted write does not appear complete.

Restart the command to use these changes in an already-running batch. Completed
files remain reusable. An in-progress solve has no intermediate checkpoint.

Validation: a full mask-3/O tree had identical catalogs and payoff entries across
4,465,480 histories, with enumeration taking 50.8 seconds before and 26.6 seconds
after in a local comparison (about 1.9x). This measures enumeration, not total batch
runtime. LP regression tests compare the original split-variable formulation,
realization feasibility, and independent best responses on complete smaller
subtrees. Equilibria can be nonunique, so equivalent LP formulations may choose
different valid policies.

Run the regression checks with:

```bash
python -m unittest discover -s tests -v
```

The JSON artifact records:

- the hidden-cell configuration and starting player;
- O's equilibrium value interval;
- the duality gap;
- solver success status;
- counts of histories, terminals, information sets, and sequences; and
- behavioral policies keyed by the same information keys used by the web engine.

## LP vs. MCCFR

Both methods target the same minimax/Nash set under the stated assumptions.

- **Sequence-form LP:** global sparse optimization; explicit optimality/duality certificate; expensive memory footprint.
- **Outcome-sampling MCCFR:** cheap sampled iterations; browser-friendly incremental training; asymptotic no-regret convergence but no exact finite-run certificate by itself.

The most informative experiment is to use the LP solution as ground truth and plot MCCFR exploitability or value error as training increases.
