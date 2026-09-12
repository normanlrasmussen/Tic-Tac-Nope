"""Shared utilities for the exact LP backend benchmark harness."""

from __future__ import annotations

from datetime import datetime, timezone
import importlib.metadata
import os
from pathlib import Path
import platform
import sys
from typing import Any

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import sequence_form_lp as prod


def memory_status() -> dict[str, float]:
    """Return Linux process memory counters in MiB when available."""
    values: dict[str, float] = {}
    try:
        for line in Path("/proc/self/status").read_text(encoding="utf-8").splitlines():
            if line.startswith(("VmRSS:", "VmHWM:")):
                name, rest = line.split(":", 1)
                values[name] = float(rest.split()[0]) / 1024.0
    except (OSError, ValueError):
        pass
    return {
        "rssMiB": values.get("VmRSS", float("nan")),
        "peakRssMiB": values.get("VmHWM", float("nan")),
    }


def environment() -> dict[str, Any]:
    payload: dict[str, Any] = {
        "timestampUtc": datetime.now(timezone.utc).isoformat(),
        "python": sys.version,
        "platform": platform.platform(),
        "machine": platform.machine(),
        "cpuCount": os.cpu_count(),
        "numpy": np.__version__,
        "informationModel": prod.INFORMATION_MODEL,
        "solverTolerance": prod.FEASIBILITY_TOLERANCE,
    }
    for package in ("scipy", "highspy"):
        try:
            payload[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            payload[package] = None
    return payload


def certificate_summary(certificate: dict[str, float]) -> dict[str, Any]:
    required = (
        "selfFlowResidual",
        "opponentFlowResidual",
        "selfNonnegativityResidual",
        "opponentNonnegativityResidual",
        "lowerBoundResidual",
        "upperBoundResidual",
        "objectiveResidual",
        "dualityGap",
        "payoffBoundsResidual",
        "bestResponseBoundsResidual",
        "exploitabilityGap",
    )
    maximum = max((abs(float(certificate[name])) for name in required), default=0.0)
    return {
        "passed": bool(maximum <= prod.FEASIBILITY_TOLERANCE),
        "maximumResidual": maximum,
        **{name: float(certificate[name]) for name in required},
    }


def flatten_run(row: dict[str, Any]) -> dict[str, Any]:
    timings = row.get("timings") or {}
    dimensions = row.get("dimensions") or {}
    certificate = row.get("certificate") or {}
    return {
        "case": row.get("case"),
        "hiddenCells": ",".join(map(str, row.get("hiddenCells", []))),
        "backend": row.get("backend"),
        "simplexMode": row.get("simplexMode"),
        "chunkColumns": row.get("chunkColumns"),
        "payoffTransposeCached": row.get("payoffTransposeCached"),
        "status": row.get("status"),
        "enumerationSeconds": row.get("enumerationSeconds"),
        "assemblySeconds": timings.get("assemblySeconds"),
        "streamingSeconds": timings.get("streamingSeconds"),
        "highsSolveSeconds": timings.get("solveSeconds"),
        "simplexIterations": timings.get("simplexIterations"),
        "ipmIterations": timings.get("ipmIterations"),
        "certificateSeconds": timings.get("certificateSeconds"),
        "totalSeconds": timings.get("totalSeconds"),
        "peakRssMiB": row.get("peakRssMiB", (row.get("memory") or {}).get("peakRssMiB")),
        "lpVariables": dimensions.get("lpVariables"),
        "lpRows": dimensions.get("lpRows"),
        "payoffNnz": dimensions.get("payoffNnz"),
        "certificatePassed": certificate.get("passed"),
        "maximumResidual": certificate.get("maximumResidual"),
        "error": row.get("error"),
    }
