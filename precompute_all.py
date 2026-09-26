#!/usr/bin/env python3
"""Precompute Tic-Tac-Nope equilibrium policies for every symmetry class.

This driver intentionally computes one representative of each D4 board-symmetry
class, for both possible starting players. It stores:

  web/equilibria/<variant>/exact/mask-<canonical>-<O|X>.json
  web/equilibria/<variant>/mccfr/mask-<canonical>-<O|X>.json
  web/equilibria/<variant>/symmetry-map.json
  web/equilibria/<variant>/manifest.json

Default scope: every valid mystery-cell set of size >= 2 for the selected
variant and topology, with both starting players.

The run is resumable. Cached artifacts are reused only when their information
model, variant, rules version, board configuration, and solver parameters match
the requested game. Stale artifacts are never published in the manifest.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, List, Tuple
from variant_rules import VARIANTS, variant_spec

ROOT = Path(__file__).resolve().parent
WEB_EQ = ROOT / "web" / "equilibria"
EXACT_DIR = WEB_EQ / "exact"  # legacy wrapper/test compatibility for standard artifacts
MCCFR_DIR = WEB_EQ / "mccfr"
INFORMATION_MODEL = "hidden-attempt-location-no-result-v2"
CERTIFICATE_TOLERANCE = 1e-7
MCCFR_EXPLORATION = 0.6
LEGACY_STANDARD_RULES_VERSION = 1
_metadata_cache: Dict[Path, tuple] = {}


def artifact_rules_version(data: dict) -> int | None:
    value = data.get("rulesVersion")
    if value is None and data.get("variant", "standard") == "standard":
        return LEGACY_STANDARD_RULES_VERSION
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def exact_artifact_matches_configuration(data: dict, mask: int, start: str, variant: str) -> bool:
    spec = variant_spec(variant)
    try:
        gap = float(data.get("dualityGap"))
        hidden_mask = int(data.get("hiddenMask"))
    except (TypeError, ValueError):
        return False
    return (
        data.get("schema") in (1, 2)
        and data.get("numericallySolved") is True
        and data.get("informationModel") == INFORMATION_MODEL
        and data.get("variant", "standard") == variant
        and artifact_rules_version(data) == spec.rules_version
        and hidden_mask == int(mask)
        and data.get("startPlayer") == start
        and -CERTIFICATE_TOLERANCE <= gap <= CERTIFICATE_TOLERANCE
    )


def mccfr_artifact_matches_configuration(
    data: dict, mask: int, start: str, variant: str, iterations: int, seed: int,
    exploration: float = MCCFR_EXPLORATION,
) -> bool:
    spec = variant_spec(variant)
    try:
        hidden_mask = int(data.get("hiddenMask"))
        stored_iterations = int(data.get("iterations"))
        stored_seed = int(data.get("seed"))
        stored_exploration = float(data.get("exploration"))
    except (TypeError, ValueError):
        return False
    return (
        data.get("schema") == 1
        and data.get("solver") == "OutcomeSamplingMCCFR"
        and data.get("informationModel") == INFORMATION_MODEL
        and data.get("variant", "standard") == variant
        and artifact_rules_version(data) == spec.rules_version
        and hidden_mask == int(mask)
        and data.get("startPlayer") == start
        and stored_iterations >= int(iterations)
        and stored_seed == (int(seed) & 0xFFFFFFFF)
        and abs(stored_exploration - float(exploration)) <= 1e-15
    )


# A transform maps an OLD board index -> transformed board index.
def make_transform(kind: str) -> Tuple[int, ...]:
    out: List[int] = []
    for old in range(9):
        r, c = divmod(old, 3)
        if kind == "id":
            nr, nc = r, c
        elif kind == "r90":
            nr, nc = c, 2 - r
        elif kind == "r180":
            nr, nc = 2 - r, 2 - c
        elif kind == "r270":
            nr, nc = 2 - c, r
        elif kind == "mirror":
            nr, nc = r, 2 - c
        elif kind == "mirror_r90":
            mr, mc = r, 2 - c
            nr, nc = mc, 2 - mr
        elif kind == "mirror_r180":
            mr, mc = r, 2 - c
            nr, nc = 2 - mr, 2 - mc
        elif kind == "mirror_r270":
            mr, mc = r, 2 - c
            nr, nc = 2 - mc, mr
        else:
            raise ValueError(kind)
        out.append(3 * nr + nc)
    return tuple(out)


TRANSFORM_NAMES = (
    "id", "r90", "r180", "r270",
    "mirror", "mirror_r90", "mirror_r180", "mirror_r270",
)
TRANSFORMS: Dict[str, Tuple[int, ...]] = {name: make_transform(name) for name in TRANSFORM_NAMES}


def transform_mask(mask: int, transform: Tuple[int, ...]) -> int:
    result = 0
    for old in range(9):
        if mask & (1 << old):
            result |= 1 << transform[old]
    return result


def inverse_transform(transform: Tuple[int, ...]) -> Tuple[int, ...]:
    inverse = [0] * 9
    for old, new in enumerate(transform):
        inverse[new] = old
    return tuple(inverse)


def canonicalize(mask: int) -> Tuple[int, str, Tuple[int, ...], Tuple[int, ...]]:
    choices = []
    for name in TRANSFORM_NAMES:
        transform = TRANSFORMS[name]
        choices.append((transform_mask(mask, transform), name, transform))
    canonical_mask, name, transform = min(choices, key=lambda item: (item[0], item[1]))
    return canonical_mask, name, transform, inverse_transform(transform)


def raw_masks(mode: str, playable_mask: int, allow_hidden_opening: bool = True) -> Iterable[int]:
    for mask in range(1, 1 << 9):
        if mask & ~playable_mask:
            continue
        if not allow_hidden_opening and mask == playable_mask:
            continue
        count = mask.bit_count()
        if mode == "two-hidden":
            if count == 2:
                yield mask
        elif count >= 2:
            yield mask


def mask_cells(mask: int) -> List[int]:
    return [i + 1 for i in range(9) if mask & (1 << i)]


def write_symmetry_map(mode: str, variant: str) -> Tuple[List[int], Dict[str, dict]]:
    spec = variant_spec(variant)
    mapping: Dict[str, dict] = {}
    canonical_masks = set()
    for mask in raw_masks(mode, spec.playable_mask, spec.allow_hidden_opening):
        canonical, name, to_canonical, from_canonical = canonicalize(mask)
        canonical_masks.add(canonical)
        mapping[str(mask)] = {
            "canonicalMask": canonical,
            "transform": name,
            "toCanonical": list(to_canonical),
            "fromCanonical": list(from_canonical),
        }

    payload = {
        "schema": 1,
        "variant": variant,
        "mode": mode,
        "rawMaskCount": len(mapping),
        "canonicalMaskCount": len(canonical_masks),
        "transforms": {name: list(TRANSFORMS[name]) for name in TRANSFORM_NAMES},
        "masks": mapping,
    }
    WEB_EQ.mkdir(parents=True, exist_ok=True)
    (WEB_EQ / variant / "symmetry-map.json").parent.mkdir(parents=True, exist_ok=True)
    (WEB_EQ / variant / "symmetry-map.json").write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    return sorted(canonical_masks), mapping


def run_command(command: List[str]) -> None:
    print("$", " ".join(command), flush=True)
    subprocess.run(command, cwd=ROOT, check=True)


def solve_exact(mask: int, start: str, variant: str, node_limit: int, force: bool) -> Path:
    out = WEB_EQ / variant / "exact" / f"mask-{mask}-{start}.json"
    if out.exists() and not force:
        try:
            existing = json.loads(out.read_text(encoding="utf-8"))
        except (OSError, ValueError, TypeError):
            existing = None
        if isinstance(existing, dict) and exact_artifact_matches_configuration(existing, mask, start, variant):
            print(f"SKIP exact  mask={mask:03d} start={start}  ({out.name} is current)")
            return out
        print(f"STALE exact mask={mask:03d} start={start}  ({out.name} does not match the current game configuration)")
    cells = ",".join(map(str, mask_cells(mask)))
    command = [
        sys.executable,
        str(ROOT / "sequence_form_lp.py"),
        "--hidden", cells,
        "--start", start,
        "--variant", variant,
        "--output", str(out),
    ]
    if node_limit:
        command += ["--node-limit", str(node_limit)]
    run_command(command)
    return out


def solve_mccfr(mask: int, start: str, variant: str, iterations: int, seed: int, force: bool) -> Path:
    out = WEB_EQ / variant / "mccfr" / f"mask-{mask}-{start}.json"
    if out.exists() and not force:
        try:
            existing = json.loads(out.read_text(encoding="utf-8"))
            if mccfr_artifact_matches_configuration(
                existing, mask, start, variant, iterations, seed, MCCFR_EXPLORATION
            ):
                print(
                    f"SKIP mccfr  mask={mask:03d} start={start}  "
                    f"({existing.get('iterations', 0):,} iterations already stored)"
                )
                return out
        except Exception:
            pass

    cells = ",".join(map(str, mask_cells(mask)))
    command = [
        "node",
        str(ROOT / "precompute_mccfr.js"),
        "--hidden", cells,
        "--start", start,
        "--variant", variant,
        "--iterations", str(iterations),
        "--seed", str(seed),
        "--exploration", str(MCCFR_EXPLORATION),
        "--output", str(out),
    ]
    run_command(command)
    return out


def artifact_metadata(path: Path) -> dict:
    # Policies can be large; each manifest rebuild only needs their small headers.
    # Invalidate after either in-place writes or atomic replacement.
    stat = path.stat()
    signature = (stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)
    cached = _metadata_cache.get(path)
    if cached is not None and cached[0] == signature:
        return dict(cached[1])
    data = json.loads(path.read_text(encoding="utf-8"))
    result = {
        "file": path.relative_to(WEB_EQ).as_posix(),
        "schema": data.get("schema"),
        "solver": data.get("solver"),
        "informationModel": data.get("informationModel"),
        "variant": data.get("variant", "standard"),
        "rulesVersion": artifact_rules_version(data),
        "hiddenMask": data["hiddenMask"],
        "hidden": data["hidden"],
        "startPlayer": data["startPlayer"],
        "numericallySolved": data.get("numericallySolved"),
    }
    if "valueO" in data:
        result.update(
            valueO=data["valueO"],
            dualityGap=data.get("dualityGap"),
            numericallySolved=data.get("numericallySolved", False),
        )
    if "iterations" in data:
        result.update(
            iterations=data["iterations"],
            seed=data.get("seed"),
            exploration=data.get("exploration"),
            informationSets=data.get("informationSets"),
        )
    _metadata_cache[path] = (signature, result)
    return dict(result)


def rebuild_manifest(mode: str, variant: str) -> None:
    root = WEB_EQ / variant
    exact_all = [artifact_metadata(p) for p in sorted((root / "exact").glob("mask-*-?.json"))]
    mccfr_all = [artifact_metadata(p) for p in sorted((root / "mccfr").glob("mask-*-?.json"))]
    spec = variant_spec(variant)
    exact = [
        item for item in exact_all
        if exact_artifact_matches_configuration(
            item, int(item.get("hiddenMask", -1)), str(item.get("startPlayer", "")), variant
        )
    ]
    mccfr = [
        item for item in mccfr_all
        if (
            item.get("schema") == 1
            and item.get("solver") == "OutcomeSamplingMCCFR"
            and item.get("informationModel") == INFORMATION_MODEL
            and item.get("variant", "standard") == variant
            and item.get("rulesVersion") == spec.rules_version
        )
    ]
    payload = {
        "schema": 3,
        "mode": mode,
        "variant": variant,
        "informationModel": INFORMATION_MODEL,
        # Backward-compatible name used by the current exact-policy website loader.
        "artifacts": exact,
        "exactArtifacts": exact,
        "mccfrArtifacts": mccfr,
        "symmetryMap": "symmetry-map.json",
    }
    root.mkdir(parents=True, exist_ok=True)
    (root / "manifest.json").write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    stale_exact = len(exact_all) - len(exact)
    stale_mccfr = len(mccfr_all) - len(mccfr)
    print(
        f"Manifest: {len(exact)} exact artifacts, {len(mccfr)} MCCFR artifacts "
        f"({stale_exact} stale exact, {stale_mccfr} stale MCCFR excluded)"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--mode",
        choices=("all", "two-hidden"),
        default="all",
        help="all = every mask with >=2 hidden cells (196 canonical configs); two-hidden = 16 configs",
    )
    parser.add_argument("--variant", choices=tuple(VARIANTS), default="standard")
    parser.add_argument(
        "--solvers",
        choices=("both", "exact", "mccfr"),
        default="both",
        help="Which policies to compute.",
    )
    parser.add_argument(
        "--mccfr-iterations",
        type=int,
        default=1_000_000,
        help="MCCFR training iterations per canonical configuration (default: 1,000,000).",
    )
    parser.add_argument("--seed", type=int, default=20260903)
    parser.add_argument(
        "--node-limit",
        type=int,
        default=0,
        help="Optional exact-tree safety cap passed to sequence_form_lp.py; 0 means unlimited.",
    )
    parser.add_argument("--force", action="store_true", help="Recompute files that already exist.")
    parser.add_argument(
        "--keep-going",
        action="store_true",
        help="Continue to later configurations if one solver process fails.",
    )
    args = parser.parse_args()

    if args.mccfr_iterations <= 0:
        parser.error("--mccfr-iterations must be positive")
    if args.solvers in ("both", "mccfr") and shutil.which("node") is None:
        parser.error("Node.js is required for MCCFR export but `node` was not found on PATH.")

    print(f"[{datetime.now().astimezone().isoformat(timespec='seconds')}] Batch started", flush=True)
    spec = variant_spec(args.variant)
    canonical_masks, _ = write_symmetry_map(args.mode, args.variant)
    canonical_masks.sort(key=lambda mask: (mask.bit_count(), mask))
    configurations = [(mask, start) for mask in canonical_masks for start in ("O", "X")]

    raw_count = sum(1 for _ in raw_masks(args.mode, spec.playable_mask, spec.allow_hidden_opening))
    print(
        f"Scope: {raw_count} raw mystery masks -> {len(canonical_masks)} symmetry classes "
        f"-> {len(configurations)} start-player configurations."
    )
    print(f"Solvers: {args.solvers}; MCCFR iterations/config: {args.mccfr_iterations:,}")
    print("Order: increasing hidden-cell count, with both starters per mask.")
    print("Existing current-model completed files will be skipped; stale files are recomputed.\n")

    failures = []
    start_time = time.time()
    for index, (mask, start) in enumerate(configurations, start=1):
        print("=" * 72)
        print(
            f"[{index}/{len(configurations)}] canonical mask={mask} "
            f"cells={mask_cells(mask)} start={start}"
        )
        try:
            if args.solvers in ("both", "exact"):
                solve_exact(mask, start, args.variant, args.node_limit, args.force)
                rebuild_manifest(args.mode, args.variant)
            if args.solvers in ("both", "mccfr"):
                # Pass one base seed. OutcomeSamplingMCCFR salts it exactly once
                # with variant, hidden mask, and starting player.
                config_seed = args.seed & 0xFFFFFFFF
                solve_mccfr(mask, start, args.variant, args.mccfr_iterations, config_seed, args.force)
                rebuild_manifest(args.mode, args.variant)
        except subprocess.CalledProcessError as error:
            failures.append({"mask": mask, "start": start, "returncode": error.returncode})
            print(f"FAILED mask={mask} start={start}: process exited {error.returncode}", file=sys.stderr)
            rebuild_manifest(args.mode, args.variant)
            if not args.keep_going:
                raise

    rebuild_manifest(args.mode, args.variant)
    elapsed = time.time() - start_time
    print("=" * 72)
    print(f"[{datetime.now().astimezone().isoformat(timespec='seconds')}] "
          f"Finished in {elapsed / 60:.1f} minutes with {len(failures)} failed configuration(s).", flush=True)
    print(f"Saved outputs under: {WEB_EQ}")
    if failures:
        print(json.dumps(failures, indent=2))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
