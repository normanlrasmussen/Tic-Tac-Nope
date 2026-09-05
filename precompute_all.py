#!/usr/bin/env python3
"""Precompute Tic-Tac-Nope equilibrium policies for every symmetry class.

This driver intentionally computes one representative of each D4 board-symmetry
class, for both possible starting players. It stores:

  web/equilibria/exact/mask-<canonical>-<O|X>.json
  web/equilibria/mccfr/mask-<canonical>-<O|X>.json
  web/equilibria/symmetry-map.json
  web/equilibria/manifest.json

Default scope: every mystery-cell set of size >= 2.
That is 502 raw masks, 98 geometric symmetry classes, and 196 configurations
once the two starting players are included.

The run is resumable. Exact artifacts are reused only when they declare the
current information model; stale artifacts from older game semantics are never
published in the exact-policy manifest.
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

ROOT = Path(__file__).resolve().parent
WEB_EQ = ROOT / "web" / "equilibria"
EXACT_DIR = WEB_EQ / "exact"
MCCFR_DIR = WEB_EQ / "mccfr"
INFORMATION_MODEL = "hidden-attempt-location-no-result-v2"
_metadata_cache: Dict[Path, tuple] = {}


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


def raw_masks(mode: str) -> Iterable[int]:
    for mask in range(1, 1 << 9):
        count = mask.bit_count()
        if mode == "two-hidden":
            if count == 2:
                yield mask
        elif count >= 2:
            yield mask


def mask_cells(mask: int) -> List[int]:
    return [i + 1 for i in range(9) if mask & (1 << i)]


def write_symmetry_map(mode: str) -> Tuple[List[int], Dict[str, dict]]:
    mapping: Dict[str, dict] = {}
    canonical_masks = set()
    for mask in raw_masks(mode):
        canonical, name, to_canonical, from_canonical = canonicalize(mask)
        canonical_masks.add(canonical)
        mapping[str(mask)] = {
            "canonicalMask": canonical,
            "transform": name,
            "toCanonical": list(to_canonical),
            "fromCanonical": list(from_canonical),
        }

    expected = 8 if mode == "two-hidden" else 98
    if len(canonical_masks) != expected:
        raise RuntimeError(
            f"Symmetry enumeration produced {len(canonical_masks)} classes; expected {expected}."
        )

    payload = {
        "schema": 1,
        "mode": mode,
        "rawMaskCount": len(mapping),
        "canonicalMaskCount": len(canonical_masks),
        "transforms": {name: list(TRANSFORMS[name]) for name in TRANSFORM_NAMES},
        "masks": mapping,
    }
    WEB_EQ.mkdir(parents=True, exist_ok=True)
    (WEB_EQ / "symmetry-map.json").write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    return sorted(canonical_masks), mapping


def run_command(command: List[str]) -> None:
    print("$", " ".join(command), flush=True)
    subprocess.run(command, cwd=ROOT, check=True)


def solve_exact(mask: int, start: str, node_limit: int, force: bool) -> Path:
    out = EXACT_DIR / f"mask-{mask}-{start}.json"
    if out.exists() and not force:
        try:
            existing = json.loads(out.read_text(encoding="utf-8"))
        except (OSError, ValueError, TypeError):
            existing = None
        if isinstance(existing, dict) and existing.get("informationModel") == INFORMATION_MODEL:
            print(f"SKIP exact  mask={mask:03d} start={start}  ({out.name} is current)")
            return out
        print(f"STALE exact mask={mask:03d} start={start}  ({out.name} uses an older information model)")
    cells = ",".join(map(str, mask_cells(mask)))
    command = [
        sys.executable,
        str(ROOT / "sequence_form_lp.py"),
        "--hidden", cells,
        "--start", start,
        "--output", str(out),
    ]
    if node_limit:
        command += ["--node-limit", str(node_limit)]
    run_command(command)
    return out


def solve_mccfr(mask: int, start: str, iterations: int, seed: int, force: bool) -> Path:
    out = MCCFR_DIR / f"mask-{mask}-{start}.json"
    if out.exists() and not force:
        try:
            existing = json.loads(out.read_text(encoding="utf-8"))
            if (
                existing.get("informationModel") == INFORMATION_MODEL
                and int(existing.get("iterations", 0)) >= iterations
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
        "--iterations", str(iterations),
        "--seed", str(seed),
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
        "informationModel": data.get("informationModel"),
        "hiddenMask": data["hiddenMask"],
        "hidden": data["hidden"],
        "startPlayer": data["startPlayer"],
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


def rebuild_manifest(mode: str) -> None:
    exact_all = [artifact_metadata(p) for p in sorted(EXACT_DIR.glob("mask-*-?.json"))]
    mccfr_all = [artifact_metadata(p) for p in sorted(MCCFR_DIR.glob("mask-*-?.json"))]
    exact = [item for item in exact_all if item.get("informationModel") == INFORMATION_MODEL]
    mccfr = [item for item in mccfr_all if item.get("informationModel") == INFORMATION_MODEL]
    payload = {
        "schema": 3,
        "mode": mode,
        "informationModel": INFORMATION_MODEL,
        # Backward-compatible name used by the current exact-policy website loader.
        "artifacts": exact,
        "exactArtifacts": exact,
        "mccfrArtifacts": mccfr,
        "symmetryMap": "symmetry-map.json",
    }
    WEB_EQ.mkdir(parents=True, exist_ok=True)
    (WEB_EQ / "manifest.json").write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
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
    EXACT_DIR.mkdir(parents=True, exist_ok=True)
    MCCFR_DIR.mkdir(parents=True, exist_ok=True)
    canonical_masks, _ = write_symmetry_map(args.mode)
    canonical_masks.sort(key=lambda mask: (mask.bit_count(), mask))
    configurations = [(mask, start) for mask in canonical_masks for start in ("O", "X")]

    raw_count = 36 if args.mode == "two-hidden" else 502
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
                solve_exact(mask, start, args.node_limit, args.force)
                rebuild_manifest(args.mode)
            if args.solvers in ("both", "mccfr"):
                # Deterministic but distinct seed per configuration.
                config_seed = (args.seed ^ mask ^ (2 if start == "O" else 1) << 12) & 0xFFFFFFFF
                solve_mccfr(mask, start, args.mccfr_iterations, config_seed, args.force)
                rebuild_manifest(args.mode)
        except subprocess.CalledProcessError as error:
            failures.append({"mask": mask, "start": start, "returncode": error.returncode})
            print(f"FAILED mask={mask} start={start}: process exited {error.returncode}", file=sys.stderr)
            rebuild_manifest(args.mode)
            if not args.keep_going:
                raise

    rebuild_manifest(args.mode)
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