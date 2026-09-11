"""Fast CLI/command wiring checks for the exact LP backend selector."""
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


def test_compact_exact_command_forwards_scipy_backend():
    with tempfile.TemporaryDirectory() as directory:
        directory = Path(directory)
        with (
            patch.object(precompute.batch, "EXACT_DIR", directory),
            patch.object(precompute.batch, "run_command") as run,
            patch.object(precompute, "_lp_backend", "scipy"),
        ):
            precompute.solve_exact_compact(3, "O", 0, True)

        command = run.call_args.args[0]
        backend_index = command.index("--lp-backend")
        assert command[backend_index + 1] == "scipy"
        hidden_index = command.index("--hidden")
        assert command[hidden_index + 1] == "1,2"
