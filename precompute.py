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
from pathlib import Path

import precompute_all as batch
from sequence_form_lp import INFORMATION_MODEL

_completed_this_run: set[Path] = set()


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
    counts = dict(artifact["counts"])
    for stem in ("informationSets", "sequences", "storedInformationSets"):
        counts[stem + "O"], counts[stem + "X"] = counts[stem + "X"], counts[stem + "O"]
    swapped["counts"] = counts
    policies = {}
    for player, target in (("O", "X"), ("X", "O")):
        policy = {}
        for key, probabilities in artifact["policy"][player].items():
            actor, starter, mask, observations = key.split("|", 3)
            if actor != ("2" if player == "O" else "1")
                    or starter != ("2" if start == "O" else "1")
                    or int(mask) != artifact["hiddenMask"]):
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
        "--output", str(out),
    ]
    if node_limit:
        command += ["--node-limit", str(node_limit)]
    batch.run_command(command)
    _completed_this_run.add(out)
    return out


batch.solve_exact = solve_exact_compact

if __name__ == "__main__":
    batch.main()