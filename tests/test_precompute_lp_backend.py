"""Fast CLI/command wiring checks for the exact LP backend selector."""
import json
from pathlib import Path
import tempfile
from unittest.mock import patch

import precompute


def test_default_batch_arguments_are_safe_and_complete():
    assert precompute._apply_default_arguments(["precompute.py"]) == [
        "precompute.py",
        "--mode", "all",
        "--solvers", "exact",
        "--lp-backend", "auto",
        "--keep-going",
    ]


def test_default_batch_arguments_preserve_explicit_overrides():
    argv = [
        "precompute.py",
        "--mode=two-hidden",
        "--solvers", "mccfr",
        "--lp-backend=highspy",
        "--keep-going",
    ]
    assert precompute._apply_default_arguments(argv) == argv


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


def test_extract_lp_backend_accepts_reduced_solver_choices():
    choices = (
        "highspy-reduced-simplex", "highspy-reduced-hipo",
        "highspy-reduced-ipx", "gurobi-reduced-barrier",
    )
    for choice in choices:
        backend, argv = precompute._extract_lp_backend(
            ["precompute.py", "--lp-backend", choice]
        )
        assert backend == choice
        assert argv == ["precompute.py"]


def test_compact_exact_command_matches_native_scipy_standalone_path():
    with tempfile.TemporaryDirectory() as directory:
        directory = Path(directory)
        with (
            patch.object(precompute.batch, "EXACT_DIR", directory),
            patch.object(precompute.batch, "run_command") as run,
            patch.object(precompute, "_lp_backend", "scipy"),
        ):
            precompute.solve_exact_compact(3, "O", 0, True)

        command = run.call_args.args[0]
        hidden_index = command.index("--hidden")
        start_index = command.index("--start")
        enumerator_index = command.index("--enumerator")
        backend_index = command.index("--lp-backend")
        assert command[hidden_index + 1] == "1,2"
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
        out = directory / "mask-3-O.json"
        out.write_text(json.dumps(_minimal_artifact("highspy-streaming")), encoding="utf-8")
        with (
            patch.object(precompute.batch, "EXACT_DIR", directory),
            patch.object(precompute.batch, "run_command") as run,
            patch.object(precompute, "_lp_backend", "scipy"),
        ):
            precompute.solve_exact_compact(3, "O", 0, False)
        run.assert_called_once()


def test_forced_scipy_reuses_only_same_start_scipy_artifact():
    with tempfile.TemporaryDirectory() as directory:
        directory = Path(directory)
        out = directory / "mask-3-O.json"
        out.write_text(
            json.dumps(_minimal_artifact("scipy.optimize.linprog(method='highs')")),
            encoding="utf-8",
        )
        with (
            patch.object(precompute.batch, "EXACT_DIR", directory),
            patch.object(precompute.batch, "run_command") as run,
            patch.object(precompute, "_lp_backend", "scipy"),
        ):
            precompute.solve_exact_compact(3, "O", 0, False)
        run.assert_not_called()


def test_opposite_start_artifact_is_never_reused():
    with tempfile.TemporaryDirectory() as directory:
        directory = Path(directory)
        counterpart = directory / "mask-3-O.json"
        counterpart.write_text(
            json.dumps(_minimal_artifact("scipy-highs-augmented")),
            encoding="utf-8",
        )
        with (
            patch.object(precompute.batch, "EXACT_DIR", directory),
            patch.object(precompute.batch, "run_command") as run,
            patch.object(precompute, "_lp_backend", "scipy"),
        ):
            precompute.solve_exact_compact(3, "X", 0, False)
        run.assert_called_once()
        command = run.call_args.args[0]
        assert command[command.index("--start") + 1] == "X"
        assert command[command.index("--lp-backend") + 1] == "scipy"
