"""Fast CLI/command wiring checks for the exact LP backend selector."""
import json
from pathlib import Path
import tempfile
from unittest.mock import patch

import precompute


def test_extract_lp_backend_preserves_batch_arguments():
    backend, argv = precompute._extract_lp_backend(
        ["precompute.py", "--solvers", "exact", "--lp-backend", "scipy", "--keep-going"]
    )
    assert backend == "scipy"
    assert argv == ["precompute.py", "--solvers", "exact", "--keep-going"]


def test_extract_lp_backend_equals_form():
    backend, argv = precompute._extract_lp_backend(
        ["precompute.py", "--lp-backend=highspy", "--mode", "two-hidden"]
    )
    assert backend == "highspy"
    assert argv == ["precompute.py", "--mode", "two-hidden"]


def test_compact_exact_command_matches_native_scipy_standalone_path():
    # mask 15 is hidden cells 1,2,3,4, the same production-scale case used
    # for the standalone native+SciPy benchmark.
    with tempfile.TemporaryDirectory() as directory:
        directory = Path(directory)
        with (
            patch.object(precompute.batch, "EXACT_DIR", directory),
            patch.object(precompute.batch, "run_command") as run,
            patch.object(precompute, "_lp_backend", "scipy"),
        ):
            precompute.solve_exact_compact(15, "O", 0, True)

        command = run.call_args.args[0]
        hidden_index = command.index("--hidden")
        start_index = command.index("--start")
        enumerator_index = command.index("--enumerator")
        backend_index = command.index("--lp-backend")
        assert command[hidden_index + 1] == "1,2,3,4"
        assert command[start_index + 1] == "O"
        assert command[enumerator_index + 1] == "native"
        assert command[backend_index + 1] == "scipy"


def _minimal_artifact(solver: str) -> dict:
    return {
        "schema": 2,
        "numericallySolved": True,
        "informationModel": precompute.INFORMATION_MODEL,
        "solver": solver,
    }


def test_forced_scipy_recomputes_existing_highspy_artifact():
    with tempfile.TemporaryDirectory() as directory:
        directory = Path(directory)
        out = directory / "mask-15-O.json"
        out.write_text(json.dumps(_minimal_artifact("highspy-streaming")), encoding="utf-8")
        with (
            patch.object(precompute.batch, "EXACT_DIR", directory),
            patch.object(precompute.batch, "run_command") as run,
            patch.object(precompute, "_lp_backend", "scipy"),
        ):
            precompute.solve_exact_compact(15, "O", 0, False)
        run.assert_called_once()


def test_forced_scipy_reuses_existing_scipy_artifact():
    with tempfile.TemporaryDirectory() as directory:
        directory = Path(directory)
        out = directory / "mask-15-O.json"
        out.write_text(
            json.dumps(_minimal_artifact("scipy.optimize.linprog(method='highs')")),
            encoding="utf-8",
        )
        with (
            patch.object(precompute.batch, "EXACT_DIR", directory),
            patch.object(precompute.batch, "run_command") as run,
            patch.object(precompute, "_lp_backend", "scipy"),
        ):
            precompute.solve_exact_compact(15, "O", 0, False)
        run.assert_not_called()
