"""Lossless native enumeration and compact sequence catalogs.

The C++ traversal enumerates every history in the same order as the Python
reference. Terminal utilities are aggregated by sequence pair in bounded native
chunks, then copied directly into the final SciPy CSR payoff matrix.
"""
from __future__ import annotations

import ctypes
import hashlib
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tempfile
import threading
import time
from collections.abc import Mapping, Sequence

import numpy as np
from scipy.sparse import csr_matrix


class NativeUnavailable(RuntimeError):
    pass


_library = None
_TOKENS = ("", "H;") + tuple(f"P{i};" for i in range(9)) + tuple(
    f"V{actor}{i};" for actor in (1, 2) for i in range(9)
)
_ENCODE = {token: i for i, token in enumerate(_TOKENS) if token}
_ACTION_TABLE = tuple(tuple(i for i in range(9) if mask & (1 << i)) for mask in range(512))


def _memory_status() -> str:
    try:
        values = {}
        for line in Path("/proc/self/status").read_text().splitlines():
            if line.startswith(("VmRSS:", "VmHWM:")):
                key, rest = line.split(":", 1)
                values[key] = float(rest.split()[0]) / 1024.0
        if values:
            return f"rss={values.get('VmRSS', float('nan')):.1f} MiB peak={values.get('VmHWM', float('nan')):.1f} MiB"
    except OSError:
        pass
    return "rss=n/a"


def _log(message: str) -> None:
    print(f"[exact/native] {message} [{_memory_status()}]", flush=True)


def encode_observations(observations):
    code = 0
    for token in observations.split(";"):
        if token:
            code = (code << 5) | _ENCODE[token + ";"]
    if code.bit_length() > 128:
        raise ValueError("Observation history exceeds native encoding capacity")
    return code & ((1 << 64) - 1), code >> 64


def decode_observations(low, high):
    code = int(low) | (int(high) << 64)
    tokens = []
    while code:
        tokens.append(_TOKENS[code & 31])
        code >>= 5
    return "".join(reversed(tokens))


def load_native():
    global _library
    if _library is not None:
        return _library
    source = Path(__file__).with_suffix(".cpp")
    compiler = shutil.which("g++") or shutil.which("clang++")
    if compiler is None:
        raise NativeUnavailable("g++ or clang++ is needed for native enumeration")
    flags = ["-O3", "-std=c++17", "-shared", "-fPIC"]
    started = time.perf_counter()
    try:
        identity = f"{compiler}|{flags}|{platform.system()}|{platform.machine()}|abi3".encode()
        digest = hashlib.sha256(source.read_bytes() + identity).hexdigest()[:20]
        cache = source.parent / "__pycache__"
        cache.mkdir(exist_ok=True)
    except OSError as error:
        raise NativeUnavailable(str(error)) from error
    target = cache / f"sequence_form_native_{digest}.so"
    if not target.exists():
        _log(f"Compiling native enumerator with {Path(compiler).name}...")
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=cache, suffix=".so", delete=False) as stream:
                temporary = Path(stream.name)
            result = subprocess.run(
                [compiler, *flags, str(source), "-o", str(temporary)],
                capture_output=True, text=True, timeout=120,
            )
            if result.returncode:
                raise NativeUnavailable(f"Native compiler failed: {result.stderr.strip()}")
            os.replace(temporary, target)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise NativeUnavailable(str(error)) from error
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    try:
        lib = ctypes.CDLL(str(target))
    except OSError as error:
        raise NativeUnavailable(str(error)) from error

    u64, u16 = ctypes.c_uint64, ctypes.c_uint16
    lib.ttn_information_model.argtypes = []
    lib.ttn_information_model.restype = ctypes.c_char_p
    from sequence_form_lp import INFORMATION_MODEL
    if lib.ttn_information_model().decode() != INFORMATION_MODEL:
        raise NativeUnavailable("Native enumerator does not implement the current information model")
    lib.ttn_build.argtypes = [u16, ctypes.c_int, u16, u16, u16, u16, ctypes.c_int,
                              u64, u64, u64, u64, u64, ctypes.c_void_p]
    lib.ttn_build.restype = ctypes.c_void_p
    lib.ttn_error.argtypes = []
    lib.ttn_error.restype = ctypes.c_char_p
    lib.ttn_free.argtypes = [ctypes.c_void_p]
    lib.ttn_free.restype = None
    lib.ttn_count.argtypes = [ctypes.c_void_p, ctypes.c_int]
    lib.ttn_count.restype = u64
    lib.ttn_data.argtypes = [ctypes.c_void_p, ctypes.c_int]
    lib.ttn_data.restype = ctypes.c_void_p
    lib.ttn_payoff_csr.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p,
                                   ctypes.c_void_p, ctypes.POINTER(ctypes.c_double)]
    lib.ttn_payoff_csr.restype = ctypes.c_int
    lib.ttn_control_new.argtypes = []
    lib.ttn_control_new.restype = ctypes.c_void_p
    for name in ("ttn_control_cancel", "ttn_control_free"):
        getattr(lib, name).argtypes = [ctypes.c_void_p]
        getattr(lib, name).restype = None
    lib.ttn_best_response.argtypes = [u64, u64, ctypes.POINTER(u64), ctypes.POINTER(u64),
                                      ctypes.POINTER(u16), ctypes.POINTER(ctypes.c_double), ctypes.c_int]
    lib.ttn_best_response.restype = ctypes.c_int
    lib.ttn_best_response_plan.argtypes = [*lib.ttn_best_response.argtypes,
                                           ctypes.POINTER(ctypes.c_uint8), ctypes.POINTER(ctypes.c_double),
                                           ctypes.POINTER(ctypes.c_double)]
    lib.ttn_best_response_plan.restype = ctypes.c_int
    _library = lib
    _log(f"Native library ready in {time.perf_counter() - started:.2f}s")
    return lib


def _enumerate_interruptibly(lib, arguments):
    """Keep Python responsive while C++ owns the large enumeration allocations."""
    control = lib.ttn_control_new()
    if not control:
        raise MemoryError(lib.ttn_error().decode())
    finished = threading.Event()
    result = {}

    def enumerate_tree():
        try:
            result["pointer"] = lib.ttn_build(*arguments, control)
            result["error"] = lib.ttn_error().decode("utf-8", errors="replace")
        except BaseException as error:
            result["exception"] = error
        finally:
            finished.set()

    worker = threading.Thread(target=enumerate_tree, name="exact-enumeration")
    worker.start()
    started = time.perf_counter()
    next_report = 10.0
    try:
        while not finished.wait(0.1):
            elapsed = time.perf_counter() - started
            if elapsed >= next_report:
                _log(f"Native enumeration still running: {elapsed:.1f}s elapsed")
                next_report += 10.0
    except BaseException:
        lib.ttn_control_cancel(control)
        while not finished.is_set():
            try:
                finished.wait(0.1)
            except KeyboardInterrupt:
                pass
        if result.get("pointer"):
            lib.ttn_free(result["pointer"])
        raise
    finally:
        lib.ttn_control_free(control)
    if "exception" in result:
        raise result["exception"]
    if not result.get("pointer"):
        raise RuntimeError(result.get("error") or "Unknown native enumeration failure")
    _log(f"Native traversal + payoff aggregation finished in {time.perf_counter() - started:.2f}s")
    return result["pointer"]


class _InfoMapping(Mapping):
    def __init__(self, catalog):
        self.catalog = catalog
    def __len__(self):
        return len(self.catalog.parent_sequences)
    def __iter__(self):
        for i in range(len(self)):
            yield self.catalog.key_at(i)
    def __getitem__(self, key):
        cat = self.catalog
        if not key.startswith(cat.prefix):
            raise KeyError(key)
        try:
            low, high = encode_observations(key[len(cat.prefix):])
        except (KeyError, ValueError):
            raise KeyError(key) from None
        indices = np.flatnonzero((cat.obs_low == low) & (cat.obs_high == high))
        if len(indices) != 1:
            raise KeyError(key)
        return cat.info_at(int(indices[0]), key)
    def items(self):
        for i in range(len(self)):
            key = self.catalog.key_at(i)
            yield key, self.catalog.info_at(i, key)
    def values(self):
        for i in range(len(self)):
            yield self.catalog.info_at(i)


class _SequenceLabels(Sequence):
    def __init__(self, catalog):
        self.catalog = catalog
    def __len__(self):
        return self.catalog.n_sequences
    def __getitem__(self, index):
        if isinstance(index, slice):
            return [self[i] for i in range(*index.indices(len(self)))]
        if index < 0:
            index += len(self)
        if not 0 <= index < len(self):
            raise IndexError(index)
        if index == 0:
            return "∅"
        i = int(np.searchsorted(self.catalog.first_children, index, side="right")) - 1
        action = _ACTION_TABLE[int(self.catalog.action_masks[i])][index - int(self.catalog.first_children[i])]
        return f"{self.catalog.key_at(i)}::a{action}"


class NativeSequenceCatalog:
    def __init__(self, player, rules, arrays, n_sequences):
        self.player = player
        self.rules = rules
        self.prefix = f"{player}|{rules.start_player}|{rules.hidden_mask}|"
        self.obs_low, self.obs_high, self.parent_sequences, self.first_children, self.action_masks = arrays
        self._n_sequences = n_sequences
        self.infos = _InfoMapping(self)
        self.sequence_labels = _SequenceLabels(self)
        self._realization = None
        self._sequence_metadata = None

    @property
    def n_sequences(self):
        return self._n_sequences
    @property
    def n_constraints(self):
        return 1 + len(self.parent_sequences)
    def key_at(self, i):
        return self.prefix + decode_observations(self.obs_low[i], self.obs_high[i])
    def info_at(self, i, key=None):
        from sequence_form_lp import InfoSet
        actions = _ACTION_TABLE[int(self.action_masks[i])]
        first = int(self.first_children[i])
        return InfoSet(self.key_at(i) if key is None else key, int(self.parent_sequences[i]),
                       actions, tuple(range(first, first + len(actions))))
    def iter_supported_infos(self, realization):
        for index in np.flatnonzero(realization[self.parent_sequences] > 0):
            key = self.key_at(index)
            yield key, self.info_at(index, key)

    def realization_matrix(self):
        if self._realization is not None:
            return self._realization
        n_info = len(self.parent_sequences)
        dtype = np.int32 if self.n_sequences + n_info < 2**31 else np.int64
        starts = self.first_children.astype(dtype)
        indptr = np.empty(n_info + 2, dtype=dtype)
        indptr[0] = 0
        indptr[1:-1] = starts + np.arange(n_info, dtype=dtype)
        indptr[-1] = self.n_sequences + n_info
        indices = np.empty(int(indptr[-1]), dtype=dtype)
        data = np.full(len(indices), -1.0)
        indices[0], data[0] = 0, 1.0
        parent_positions = indptr[1:-1]
        indices[parent_positions] = self.parent_sequences
        data[parent_positions] = 1.0
        child_positions = np.ones(len(indices), dtype=bool)
        child_positions[0] = False
        child_positions[parent_positions] = False
        indices[child_positions] = np.arange(1, self.n_sequences, dtype=dtype)
        rhs = np.zeros(n_info + 1)
        rhs[0] = 1.0
        matrix = csr_matrix((data, indices, indptr), shape=(n_info + 1, self.n_sequences), copy=False)
        self._realization = matrix, rhs
        return self._realization

    def best_response_value(self, coefficients, maximize=False):
        values = np.array(coefficients, dtype=np.float64, order="C", copy=True)
        if values.shape != (self.n_sequences,) or not np.isfinite(values).all():
            raise ValueError("Invalid best-response coefficients")
        u64, u16 = ctypes.c_uint64, ctypes.c_uint16
        status = load_native().ttn_best_response(
            len(self.parent_sequences), self.n_sequences,
            self.parent_sequences.ctypes.data_as(ctypes.POINTER(u64)),
            self.first_children.ctypes.data_as(ctypes.POINTER(u64)),
            self.action_masks.ctypes.data_as(ctypes.POINTER(u16)),
            values.ctypes.data_as(ctypes.POINTER(ctypes.c_double)), int(maximize),
        )
        if status or not np.isfinite(values[0]):
            raise RuntimeError("Invalid catalog or nonfinite best response")
        return float(values[0])

    def best_response(self, coefficients, maximize=False, tie_break=None):
        values = np.array(coefficients, dtype=np.float64, order="C", copy=True)
        if values.shape != (self.n_sequences,) or not np.isfinite(values).all():
            raise ValueError("Invalid best-response coefficients")
        plan = np.zeros(self.n_sequences, dtype=np.uint8)
        potentials = np.empty(self.n_constraints, dtype=float)
        secondary = None if tie_break is None else np.array(tie_break, dtype=float, copy=True)
        if secondary is not None and (secondary.shape != values.shape or not np.isfinite(secondary).all()):
            raise ValueError("Invalid best-response tie-break coefficients")
        u64, u16 = ctypes.c_uint64, ctypes.c_uint16
        status = load_native().ttn_best_response_plan(
            len(self.parent_sequences), self.n_sequences,
            self.parent_sequences.ctypes.data_as(ctypes.POINTER(u64)),
            self.first_children.ctypes.data_as(ctypes.POINTER(u64)),
            self.action_masks.ctypes.data_as(ctypes.POINTER(u16)),
            values.ctypes.data_as(ctypes.POINTER(ctypes.c_double)), int(maximize),
            plan.ctypes.data_as(ctypes.POINTER(ctypes.c_uint8)),
            potentials.ctypes.data_as(ctypes.POINTER(ctypes.c_double)),
            None if secondary is None else secondary.ctypes.data_as(ctypes.POINTER(ctypes.c_double)),
        )
        if status or not np.isfinite(potentials).all():
            raise RuntimeError("Invalid catalog or nonfinite best response")
        return float(values[0]), np.flatnonzero(plan), potentials

    def sequence_metadata(self):
        if self._sequence_metadata is None:
            counts = np.diff(np.append(self.first_children, np.uint64(self.n_sequences))).astype(np.int64)
            owners = np.empty(self.n_sequences, dtype=np.int64)
            owners[0] = -1
            owners[1:] = np.repeat(np.arange(len(counts), dtype=np.int64), counts)
            bits = np.zeros(self.n_sequences, dtype=np.uint16)
            popcounts = np.array([i.bit_count() for i in range(512)], dtype=np.uint64)
            for move in range(9):
                selected = (self.action_masks & (1 << move)) != 0
                positions = self.first_children[selected] + popcounts[self.action_masks[selected] & ((1 << move) - 1)]
                bits[positions] = 1 << move
            self._sequence_metadata = owners, bits, counts
        return self._sequence_metadata

    def uniform_realization(self):
        owners, _, counts = self.sequence_metadata()
        parents = self.parent_sequences[owners[1:]]
        denominators = counts[owners[1:]]
        values = np.ones(self.n_sequences)
        for _ in range(9):
            values[1:] = values[parents] / denominators
        return values

    def restricted(self, keep):
        keep = np.asarray(keep, dtype=np.int64)
        if keep.ndim != 1 or len(keep) == 0 or keep[0] != 0 or keep[-1] >= self.n_sequences or np.any(np.diff(keep) <= 0):
            raise ValueError("Restricted sequences must be sorted, unique, and include the empty sequence")
        owners, bits, _ = self.sequence_metadata()
        infos, starts = np.unique(owners[keep[1:]], return_index=True)
        parents = np.searchsorted(keep, self.parent_sequences[infos])
        if np.any(parents >= len(keep)) or not np.array_equal(keep[parents], self.parent_sequences[infos]):
            raise ValueError("Restricted sequences are missing an ancestor")
        active = np.zeros(self.n_sequences, dtype=bool)
        active[keep] = True
        if not np.array_equal(infos, np.flatnonzero(active[self.parent_sequences])):
            raise ValueError("Restricted game omits a decision at a reachable information set")
        masks = (np.bitwise_or.reduceat(bits[keep[1:]], starts) if len(starts) else np.empty(0, dtype=np.uint16))
        arrays = [self.obs_low[infos], self.obs_high[infos], parents.astype(np.uint64),
                  (starts + 1).astype(np.uint64), masks]
        return NativeSequenceCatalog(self.player, self.rules, arrays, len(keep))


def build_native(rules, root, node_limit=0):
    from sequence_form_lp import O, X, SequenceGame
    if node_limit < 0 or node_limit >= 2**64:
        raise ValueError("node_limit must be in 0..2**64-1")
    if not 0 <= rules.hidden_mask <= 511 or rules.start_player not in (O, X):
        raise ValueError("Invalid rules")
    if any(not 0 <= value <= 511 for value in (root.o_mask, root.x_mask, root.tried_o, root.tried_x)):
        raise ValueError("Invalid root board masks")
    if root.turn not in (O, X) or root.o_mask & root.x_mask:
        raise ValueError("Invalid root state")

    total_started = time.perf_counter()
    lib = load_native()
    _log("Starting complete native history traversal and chunked payoff aggregation")
    pointer = _enumerate_interruptibly(lib, (rules.hidden_mask, rules.start_player,
                            root.o_mask, root.x_mask, root.tried_o, root.tried_x, root.turn,
                            *encode_observations(root.obs_o), *encode_observations(root.obs_x), node_limit))

    def array(field, count, ctype):
        if not count:
            return np.empty(0, dtype=np.dtype(ctype))
        raw = ctypes.cast(lib.ttn_data(pointer, field), ctypes.POINTER(ctype))
        return np.ctypeslib.as_array(raw, shape=(count,))

    try:
        histories, terminals, no, nx, so, sx, nnz, decisive, flushes = [int(lib.ttn_count(pointer, i)) for i in range(9)]
        if max(so, sx) >= 2**63 or histories >= 2**53:
            raise RuntimeError("Game exceeds exact sparse-index/payoff representation capacity")
        ratio = decisive / nnz if nnz else float("inf")
        _log(
            f"Enumeration counts: histories={histories:,} terminals={terminals:,} decisive={decisive:,}; "
            f"O infos={no:,} X infos={nx:,}; O seq={so:,} X seq={sx:,}; "
            f"payoff nnz={nnz:,} compression={ratio:.2f}x flushes={flushes:,}"
        )

        started = time.perf_counter()
        catalogs = []
        for offset, player, count, seqs in ((0, O, no, so), (5, X, nx, sx)):
            arrays = [array(offset + j, count, ctypes.c_uint16 if j == 4 else ctypes.c_uint64).copy()
                      for j in range(5)]
            catalogs.append(NativeSequenceCatalog(player, rules, arrays, seqs))
        _log(f"Copied compact sequence catalogs in {time.perf_counter() - started:.2f}s")

        started = time.perf_counter()
        use32 = max(so, sx, nnz) < 2**31
        index_dtype = np.int32 if use32 else np.int64
        indptr = np.empty(so + 1, dtype=index_dtype)
        indices = np.empty(nnz, dtype=index_dtype)
        values = np.empty(nnz, dtype=np.float64)
        status = lib.ttn_payoff_csr(
            pointer, 32 if use32 else 64,
            ctypes.c_void_p(indptr.ctypes.data), ctypes.c_void_p(indices.ctypes.data),
            values.ctypes.data_as(ctypes.POINTER(ctypes.c_double)),
        )
        if status:
            raise RuntimeError(lib.ttn_error().decode() or f"Native payoff CSR export failed with status {status}")
        payoff = csr_matrix((values, indices, indptr), shape=(so, sx), copy=False)
        _log(
            f"Materialized final payoff CSR directly in {time.perf_counter() - started:.2f}s: "
            f"shape={payoff.shape} nnz={payoff.nnz:,} index={index_dtype.__name__}"
        )
        _log(f"Native game build complete in {time.perf_counter() - total_started:.2f}s")
        return SequenceGame(rules, *catalogs, payoff, histories, terminals)
    finally:
        lib.ttn_free(pointer)
