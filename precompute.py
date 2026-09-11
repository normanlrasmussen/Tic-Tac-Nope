#!/usr/bin/env python3
"""One-command precompute entrypoint.

Uses precompute_all.py for symmetry enumeration / resume / manifests, but routes
exact solves through the compact support-pruned sequence-form exporter.
"""

from __future__ import annotations

import sys
import json
import math
import re
import os
import shutil
from pathlib import Path

import precompute_all as batch
from sequence_form_lp import INFORMATION_MODEL

_completed_this_run: set[Path] = set()
_lp_backend = "auto"


def _extract_lp_backend(argv: list[str]) -> tuple[str, list[str]]:
    """Remove precompute.py's compact-solver-only backend option from argv.

    precompute_all.py owns the common batch CLI. This wrapper consumes the
    extra exact-LP option before delegating to that parser, while preserving it
    across the keep-awake re-exec below.
    """
    backend = "auto"
    cleaned = [argv[0]]
    index = 1
    while index < len(argv):
        argument = argv[index]
        if argument == "--lp-backend":
            if index + 1 >= len(argv):
                raise SystemExit("--lp-backend requires one of: auto, highspy, scipy")
            value = argv[index + 1]
            index += 2
        elif argument.startswith("--lp-backend="):
            value = argument.split("=", 1)[1]
            index += 1
        else:
            cleaned.append(argument)
            index += 1
            continue
        if value not in ("auto", "highspy", "scipy"):
            raise SystemExit(
                f"invalid --lp-backend {value!r}; choose auto, highspy, or scipy"
            )
        backend = value
    return backend, cleaned


def keep_awake() -> None:
    """Re-execute under a Linux inhibitor held for the entire batch lifetime."""
    marker = "TIC_TAC_NOPE_SLEEP_INHIBITED"
    if os.environ.pop(marker, None) == "1":
        print("Keep-awake active for this batch; normal power settings resume on exit.", flush=True)
        return
    if "--help" in sys.argv or "-h" in sys.argv:
        return
    inhibitor = shutil.which("systemd-inhibit")
    if not sys.platform.startswith("linux") or inhibitor is None:
        raise SystemExit("Keep-awake requires Linux with systemd-inhibit installed.")
    print("Requesting sleep, idle, lid-close and shutdown inhibition for this batch...", flush=True)
    command = [
        inhibitor,
        "--what=sleep:idle:shutdown:handle-lid-switch",
        "--mode=block",
        "--who=Tic-Tac-Nope precompute",
        "--why=Computing exact equilibrium web data",
        "--",
        sys.executable, str(Path(__file__).resolve()), *sys.argv[1:],
    ]
    environment = os.environ.copy()
    environment[marker] = "1"
    os.execve(inhibitor, command, environment)


def artifact_matches_information_model(artifact: dict) -> bool:
    return (
        artifact.get("schema") == 2
        and artifact.get("numericallySolved") is True
        and artifact.get("informationModel") == INFORMATION_MODEL
    )


def swap_players(artifact: dict) -> dict:
    """Relabel an exact equilibrium under the O <-> X game isomorphism."""
    if not artifact_matches_information_model(artifact):
        raise ValueError("A solved compact exact artifact for the current information model is required")
    start = artifact["startPlayer"]
    if start not in ("O", "X"):
        raise ValueError("Invalid starting player")
    for field in ("valueO", "lowerBoundO", "upperBoundO", "dualityGap"):
        if not math.isfinite(artifact[field]):
            raise ValueError(f"Nonfinite {field}")
    if artifact["lowerBoundO"] > artifact["upperBoundO"] + 1e-7:
        raise ValueError("Invalid value interval")
    swapped = dict(artifact)
    swapped["startPlayer"] = "X" if start == "O" else "O"
    swapped["valueO"] = -artifact["valueO"]
    swapped["lowerBoundO"] = -artifact["upperBoundO"]
    swapped["upperBoundO"] = -artifact["lowerBoundO"]
    if "certificate" in artifact:
        certificate = dict(artifact["certificate"])
        for self_field, opponent_field in (
            ("selfFlowResidual", "opponentFlowResidual"),
            ("selfNonnegativityResidual", "opponentNonnegativityResidual"),
            ("lowerBoundResidual", "upperBoundResidual"),
        ):
            certificate[self_field], certificate[opponent_field] = (
                certificate[opponent_field], certificate[self_field]
            )
        certificate["payoff"] = -certificate["payoff"]
        if "bestResponseLowerBound" in certificate:
            certificate["bestResponseLowerBound"], certificate["bestResponseUpperBound"] = (
                -certificate["bestResponseUpperBound"], -certificate["bestResponseLowerBound"]
            )
        swapped["certificate"] = certificate
    counts = dict(artifact["counts"])
    for stem in ("informationSets", "sequences", "storedInformationSets"):
        counts[stem + "O"], counts[stem + "X"] = counts[stem + "X"], counts[stem + "O"]
    swapped["counts"] = counts
    policies = {}
    for player, target in (("O", "X"), ("X", "O")):
        policy = {}
        for key, probabilities in artifact["policy"][player].items():
            actor, starter, mask, observations = key.split("|", 3)
            if (
                actor != ("2" if player == "O" else "1")
                or starter != ("2" if start == "O" else "1")
                or int(mask) != artifact["hiddenMask"]
            ):
                raise ValueError("Inconsistent information key")
            # Only visible public observations encode the actor identity. P and H
            # observation tokens are invariant under O/X relabeling.
            observations = re.sub(r"V([12])", lambda m: "V" + str(3 - int(m[1])), observations)
            policy[f"{3-int(actor)}|{3-int(starter)}|{mask}|{observations}"] = probabilities
        policies[target] = policy
    swapped["policy"] = policies
    return swapped


def solve_exact_compact(mask: int, start: str, node_limit: int, force: bool) -> Path:
    out = batch.EXACT_DIR / f"mask-{mask}-{start}.json"
    if out.exists() and not force:
        try:
            existing = json.loads(out.read_text(encoding="utf-8"))
        except (ValueError, TypeError, OSError):
            existing = None
        if isinstance(existing, dict) and artifact_matches_information_model(existing):
            print(f"SKIP exact  mask={mask:03d} start={start}  ({out.name} is current)")
            return out
        print(f"STALE exact mask={mask:03d} start={start}  ({out.name} uses an older information model; recomputing)")

    counterpart = batch.EXACT_DIR / f"mask-{mask}-{'X' if start == 'O' else 'O'}.json"
    if counterpart.exists() and (not force or counterpart in _completed_this_run):
        try:
            source = json.loads(counterpart.read_text(encoding="utf-8"))
            if source["hiddenMask"] != mask or source["startPlayer"] == start:
                raise ValueError("Counterpart configuration mismatch")
            if source["hidden"] != batch.mask_cells(mask):
                raise ValueError("Counterpart hidden cells mismatch")
            if node_limit and source["counts"]["histories"] > node_limit:
                raise ValueError("Counterpart exceeds requested node limit")
            artifact = swap_players(source)
        except (ValueError, KeyError, TypeError, AttributeError, OSError):
            # An incompatible, stale, or incomplete counterpart never replaces a full solve.
            pass
        else:
            from sequence_form_lp_compact import write_artifact
            write_artifact(out, artifact)
            _completed_this_run.add(out)
            print(f"REUSE exact mask={mask:03d} start={start} (O/X relabeling of {counterpart.name})")
            return out
    cells = ",".join(map(str, batch.mask_cells(mask)))
    command = [
        sys.executable,
        str(batch.ROOT / "sequence_form_lp_compact.py"),
        "--hidden", cells,
        "--start", start,
        "--lp-backend", _lp_backend,
        "--output", str(out),
    ]
    if node_limit:
        command += ["--node-limit", str(node_limit)]
    batch.run_command(command)
    _completed_this_run.add(out)
    return out


batch.solve_exact = solve_exact_compact

if __name__ == "__main__":
    keep_awake()
    _lp_backend, cleaned_argv = _extract_lp_backend(sys.argv)
    sys.argv[:] = cleaned_argv
    if "--help" in sys.argv or "-h" in sys.argv:
        print("precompute.py exact-solver option: --lp-backend {auto,highspy,scipy}\n")
    elif _lp_backend != "auto":
        print(f"Exact LP backend forced to: {_lp_backend}", flush=True)
    batch.main()
