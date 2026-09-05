#!/usr/bin/env python3
"""One-command precompute entrypoint.

Uses precompute_all.py for symmetry enumeration / resume / manifests, but routes
exact solves through the compact support-pruned sequence-form exporter.
"""

from __future__ import annotations

import sys
from pathlib import Path

import precompute_all as batch


def solve_exact_compact(mask: int, start: str, node_limit: int, force: bool) -> Path:
    out = batch.EXACT_DIR / f"mask-{mask}-{start}.json"
    if out.exists() and not force:
        print(f"SKIP exact  mask={mask:03d} start={start}  ({out.name} exists)")
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
    return out


batch.solve_exact = solve_exact_compact

if __name__ == "__main__":
    batch.main()
