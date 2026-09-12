# LP Solver Tester

This harness benchmarks only the production exact sequence-form LP backends on
two-hidden-cell games. It reuses the production enumerator and full-game
certificate, and runs every candidate in a fresh subprocess for independent
Linux peak-memory measurements.

Allowed backends are `highspy`, `auto`, and `scipy`. Highspy settings are limited
to HiGHS presolve plus `choose` or explicit dual simplex. IPM/HiPO, Double
Oracle, abstraction, sampling, strategic pruning, and relaxed tolerances are
not included.

Run the controlled direct-highspy comparison with:

```bash
python "lp solver tester/run_benchmarks.py" \
  --backends highspy,auto \
  --simplex-modes choose,dual \
  --chunk-sizes 50000
```

The default cases are hidden cells `(1,3)` and `(1,9)`. Add SciPy explicitly
when a fallback/reference comparison is wanted:

```bash
python "lp solver tester/run_benchmarks.py" --backends highspy,auto,scipy
```

Results are checkpointed after every child in `results/latest.json` and
`results/latest.csv`, with timestamped copies. Timings include separate flow
preparation, highspy assembly, streaming, solve, certificate, and total fields;
the process peak is read from Linux `VmHWM` in the fresh worker.
