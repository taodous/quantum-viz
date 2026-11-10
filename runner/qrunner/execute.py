"""Run student code with real PennyLane and record every QNode call.

How the interception works (checked against PennyLane 0.45.1):

- `QNode.__call__` is wrapped. Each call first builds the tape with
  `qml.workflow.construct_tape(qnode)(*args)` (level "user": the operations as
  written, no compilation), then runs the real call so the student gets the
  real result. Prints during the tape construction are swallowed, so they
  appear once.
- `QueuingManager.append` is wrapped. While a tape is being constructed, every
  queued operation is stamped with the line of the student's code that created
  it (innermost frame in "<circuit>") and the sub-function it came from (the
  function called directly from the QNode body: oracle(), diffusion()…).
- `QNode.__init__` is wrapped to find QNodes that are defined but never called.
- `qml.device` is wrapped to refuse devices with too many qubits up front.
"""

from __future__ import annotations

import builtins
import inspect
import io
import json
import sys
import time
import warnings
from contextlib import redirect_stderr, redirect_stdout
from dataclasses import dataclass, field

import numpy as np
import pennylane as qml
from pennylane.tape import QuantumScript
from pennylane.workflow import construct_tape

from .errors import FILENAME, ErrorContext, python_message, translate
from .fmt import fmt_val, pretty
from .gates import OpMeta, OpSerializer, serialize_measurement, wire_key
from .limits import (
    MAX_CIRCUITS,
    MAX_CODE_CHARS,
    MAX_HISTOGRAM_QUBITS,
    MAX_OPS_PER_CIRCUIT,
    MAX_OUTPUT_BYTES,
    MAX_STDOUT_CHARS,
    MAX_WIRES,
    LimitError,
)

_MISSING = object()


@dataclass
class CallRecord:
    qnode: qml.QNode
    args: tuple
    kwargs: dict
    tape: QuantumScript
    result: object = _MISSING


@dataclass
class _State:
    active: bool = False
    recording: qml.QNode | None = None
    qnode_code: object = None
    ops_count: int = 0
    depth: int = 0
    meta: dict[int, OpMeta] = field(default_factory=dict)
    keepalive: list = field(default_factory=list)  # keeps ids in `meta` unique
    groups: dict[int, dict] = field(default_factory=dict)
    calls: list[CallRecord] = field(default_factory=list)
    qnodes: list[qml.QNode] = field(default_factory=list)
    called: set[int] = field(default_factory=set)
    current: CallRecord | None = None


STATE = _State()


class _Discard(io.TextIOBase):
    def write(self, s):
        return len(s)


class LimitedWriter(io.TextIOBase):
    """Captures the student's prints, keeping at most `limit` characters."""

    def __init__(self, limit: int):
        self.parts: list[str] = []
        self.size = 0
        self.limit = limit
        self.truncated = False

    def writable(self):
        return True

    def write(self, s):
        room = self.limit - self.size
        if room > 0:
            self.parts.append(s[:room])
            self.size += min(len(s), room)
        if len(s) > max(room, 0):
            self.truncated = True
        return len(s)

    def getvalue(self) -> str:
        return "".join(self.parts) + ("\n… (sortie tronquée)" if self.truncated else "")


# --------------------------------------------------------------------------
# Patches (installed once at import; inert unless a run is active)
# --------------------------------------------------------------------------

_orig_append = qml.QueuingManager.append.__func__
_orig_init = qml.QNode.__init__
_orig_call = qml.QNode.__call__
_orig_device = qml.device


def _stamp(obj) -> None:
    st = STATE
    frames = []
    f = sys._getframe(2)
    while f is not None:
        if f.f_code.co_filename == FILENAME:
            frames.append(f)
        f = f.f_back
    if not frames:
        return
    group = None
    qnode_index = next((i for i, fr in enumerate(frames) if fr.f_code is st.qnode_code), None)
    if qnode_index:
        named = [fr for fr in frames[:qnode_index] if not fr.f_code.co_name.startswith("<")]
        if named:
            gf = named[-1]  # the function called directly from the QNode body
            group = st.groups.get(id(gf))
            if group is None:
                group = {"id": len(st.groups) + 1, "name": gf.f_code.co_name}
                st.groups[id(gf)] = group
                st.keepalive.append(gf)
    st.meta[id(obj)] = OpMeta(frames[0].f_lineno, group)
    st.keepalive.append(obj)


def _append(cls, obj, **kwargs):
    st = STATE
    if st.recording is not None:
        st.ops_count += 1
        if st.ops_count > MAX_OPS_PER_CIRCUIT:
            raise LimitError(f"Circuit trop grand pour être affiché (plus de {MAX_OPS_PER_CIRCUIT} portes)")
        _stamp(obj)
    return _orig_append(cls, obj, **kwargs)


def _init(self, *args, **kwargs):
    _orig_init(self, *args, **kwargs)
    if STATE.active:
        STATE.qnodes.append(self)


def _call(self, *args, **kwargs):
    st = STATE
    if not st.active or st.depth > 0:
        return _orig_call(self, *args, **kwargs)
    st.depth += 1
    try:
        st.called.add(id(self.func))
        st.current = None
        st.recording, st.qnode_code, st.ops_count = self, getattr(self.func, "__code__", None), 0
        try:
            with redirect_stdout(_Discard()), redirect_stderr(_Discard()):
                tape = construct_tape(self)(*args, **kwargs)
        finally:
            st.recording = None
        if len(tape.wires) > MAX_WIRES:
            raise LimitError(f"Trop de qubits : {MAX_WIRES} au maximum (ce circuit en utilise {len(tape.wires)})")
        record = CallRecord(self, args, kwargs, tape)
        if len(st.calls) < MAX_CIRCUITS:
            st.calls.append(record)
        st.current = record
        record.result = _orig_call(self, *args, **kwargs)
        return record.result
    finally:
        st.depth -= 1


def _device(name, *args, **kwargs):
    wires = kwargs.get("wires", args[0] if args else None)
    n = wires if isinstance(wires, int) else len(wires) if hasattr(wires, "__len__") and not isinstance(wires, str) else None
    if n is not None and n > MAX_WIRES:
        raise LimitError(f"Trop de qubits : {MAX_WIRES} au maximum (le device en demande {n})")
    return _orig_device(name, *args, **kwargs)


qml.QueuingManager.append = classmethod(_append)
qml.QNode.__init__ = _init
qml.QNode.__call__ = _call
qml.device = _device


# --------------------------------------------------------------------------
# Run
# --------------------------------------------------------------------------


def run_code(code: str) -> dict:
    """Execute student code. Always returns a contract RunResponse dict."""
    global STATE
    t0 = time.perf_counter()
    STATE = _State(active=True)
    out = LimitedWriter(MAX_STDOUT_CHARS)
    lines = code.splitlines()
    try:
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                if len(code) > MAX_CODE_CHARS:
                    raise LimitError(f"Code trop long ({MAX_CODE_CHARS} caractères au maximum)")
                compiled = compile(code, FILENAME, "exec")
                namespace = {"__name__": "__main__", "__builtins__": builtins}
                with redirect_stdout(out), redirect_stderr(out):
                    try:
                        exec(compiled, namespace)
                    except SystemExit:
                        pass
                    hint = _call_forgotten_qnodes(namespace)
        except BaseException as exc:  # noqa: BLE001 - the student's mistake is a normal answer
            if isinstance(exc, KeyboardInterrupt):
                raise
            return _finish({"ok": False, "error": translate(exc, _error_context(lines))}, t0)

        try:
            circuits = _build_circuits()
        except Exception as exc:  # noqa: BLE001 - our bug, not the student's
            error = {"kind": "infra", "message": "Affichage impossible pour ce circuit", "line": None, "python": python_message(exc)}
            return _finish({"ok": False, "error": error}, t0)
        return _finish({"ok": True, "circuits": circuits, "stdout": out.getvalue(), "hint": hint}, t0)
    finally:
        STATE.active = False


def _finish(result: dict, t0: float) -> dict:
    result["durationMs"] = round((time.perf_counter() - t0) * 1000, 1)
    return result


def to_json(result: dict) -> bytes:
    """Serialize a RunResponse, replacing it by a limit error if too big."""
    data = json.dumps(result, ensure_ascii=False, allow_nan=False).encode("utf-8")
    if len(data) > MAX_OUTPUT_BYTES:
        error = {"kind": "limit", "message": "Résultat trop gros pour être affiché", "line": None, "python": None}
        data = json.dumps({"ok": False, "error": error, "durationMs": result.get("durationMs", 0)}, ensure_ascii=False).encode("utf-8")
    return data


def _error_context(lines: list[str]) -> ErrorContext:
    rec = STATE.current
    if rec is None or rec.qnode.device.wires is None:
        return ErrorContext(lines)
    dev_wires = list(rec.qnode.device.wires)
    wire_line = None
    for op in [*rec.tape.operations, *rec.tape.measurements]:
        if any(w not in dev_wires for w in op.wires):
            meta = STATE.meta.get(id(op))
            wire_line = meta.line if meta else None
            break
    return ErrorContext(lines, dev_wires, wire_line)


def _call_forgotten_qnodes(namespace: dict) -> str | None:
    """Run QNodes defined but never called (when they need no argument)."""
    by_func: dict[int, qml.QNode] = {id(q.func): q for q in STATE.qnodes}
    # Prefer the object the student holds (e.g. the set_shots copy of the QNode).
    by_func.update({id(v.func): v for v in namespace.values() if isinstance(v, qml.QNode)})
    needs_args = []
    for func_id, q in by_func.items():
        code = getattr(q.func, "__code__", None)
        if func_id in STATE.called or code is None or code.co_filename != FILENAME:
            continue
        params = inspect.signature(q.func).parameters.values()
        required = [p for p in params if p.default is p.empty and p.kind not in (p.VAR_POSITIONAL, p.VAR_KEYWORD)]
        if required:
            needs_args.append((q.func.__name__, required))
        else:
            q()
    if STATE.calls:
        return None
    if needs_args:
        name, required = needs_args[0]
        return f"Appelle ton circuit, par exemple `{name}({', '.join('np.pi/4' for _ in required)})`"
    return "Aucun circuit trouvé : écris une fonction décorée par `@qml.qnode(dev)`, puis appelle-la"


# --------------------------------------------------------------------------
# Tape → contract
# --------------------------------------------------------------------------


def _build_circuits() -> list[dict]:
    circuits, seen = [], set()
    for rec in STATE.calls:
        c = _circuit(rec)
        sig = json.dumps(
            [c["label"], c["wires"], [[o["name"], o["label"], o["params"], o["controls"], o["controlValues"], o["targets"], o["group"] and o["group"]["name"]] for o in c["ops"]],
             [[m["name"], m["targets"], m["caps"]] for m in c["meas"]], c["shots"]],
            ensure_ascii=False,
        )
        if sig not in seen:
            seen.add(sig)
            circuits.append(c)
    return circuits


def _wire_order(rec: CallRecord) -> list:
    dev = rec.qnode.device.wires
    wires, keys = [], set()
    for w in [*(list(dev) if dev is not None else []), *rec.tape.wires]:
        if wire_key(w) not in keys:
            keys.add(wire_key(w))
            wires.append(w)
    if all(wire_key(w).startswith("#") for w in wires):
        wires.sort(key=lambda w: int(w))
    return wires


def _circuit(rec: CallRecord) -> dict:
    tape = rec.tape
    wires = _wire_order(rec)
    all_keys = [wire_key(w) for w in wires]
    serializer = OpSerializer(STATE.meta)
    ops = []
    for op in tape.operations:
        d = serializer.serialize(op)
        if d is None:
            continue
        if d["shape"] == "barrier" and not d["targets"]:
            d["targets"] = all_keys
        if d["targets"] or d["controls"]:
            ops.append(d)
    meas = []
    for m in tape.measurements:
        meta = STATE.meta.get(id(m))
        meas.append(serialize_measurement(m, wires, meta.line if meta else None))
    histogram, kind = _histogram(rec, wires)
    name = getattr(rec.qnode.func, "__name__", "circuit")
    parts = [fmt_val(a) for a in rec.args] + [f"{pretty(k)}={fmt_val(v)}" for k, v in rec.kwargs.items()]
    return {
        "name": name,
        "label": f"{name}({', '.join(parts)})",
        "wires": [{"key": wire_key(w), "label": str(w)} for w in wires],
        "ops": ops,
        "meas": meas,
        "shots": tape.shots.total_shots if tape.shots else None,
        "histogram": histogram,
        "histogramKind": kind,
    }


def _bars(n: int, freq: dict[str, float]) -> list[dict]:
    return [{"state": s, "value": round(float(freq.get(s, 0.0)), 4)} for s in (format(i, f"0{n}b") for i in range(2**n))]


def _histogram(rec: CallRecord, wires: list) -> tuple[list | None, str | None]:
    tape = rec.tape
    if rec.result is _MISSING or (tape.shots and tape.shots.has_partitioned_shots):
        return None, None
    ms = list(tape.measurements)
    if len(ms) == 1:
        results = [rec.result]
    elif isinstance(rec.result, (tuple, list)) and len(rec.result) == len(ms):
        results = list(rec.result)
    else:
        return None, None

    for wanted in (("CountsMP", "SampleMP"), ("ProbabilityMP",)):
        for m, r in zip(ms, results):
            if type(m).__name__ not in wanted or getattr(m, "obs", None) is not None or getattr(m, "mv", None) is not None:
                continue
            n = len(m.wires) or len(wires)
            if n == 0 or n > MAX_HISTOGRAM_QUBITS:
                return None, None
            bars = _bars_from(type(m).__name__, r, n)
            if bars is not None:
                return bars, "probs" if wanted == ("ProbabilityMP",) else "counts"

    # No counts/sample/probs (e.g. expval): theoretical probabilities.
    if not wires or len(wires) > MAX_HISTOGRAM_QUBITS:
        return None, None
    try:
        script = QuantumScript(tape.operations, [qml.probs(wires=wires)], shots=None)
        (probs,) = qml.execute([script], rec.qnode.device)
        return _bars(len(wires), {format(i, f"0{len(wires)}b"): p for i, p in enumerate(np.asarray(probs))}), "theory"
    except Exception:  # noqa: BLE001 - e.g. mid-circuit measurements: no histogram
        return None, None


def _bars_from(kind: str, r, n: int) -> list[dict] | None:
    if kind == "CountsMP":
        if not isinstance(r, dict) or not r:
            return None
        counts = {str(k): float(v) for k, v in r.items()}
        if not all(len(k) == n and set(k) <= {"0", "1"} for k in counts):
            return None
        total = sum(counts.values())
        return _bars(n, {k: v / total for k, v in counts.items()})
    if kind == "SampleMP":
        arr = np.asarray(r)
        if arr.size == 0:
            return None
        arr = arr.reshape(-1, n) if arr.ndim == 1 else arr
        strings = ["".join(str(int(b)) for b in row) for row in arr]
        freq: dict[str, float] = {}
        for s in strings:
            freq[s] = freq.get(s, 0.0) + 1.0 / len(strings)
        return _bars(n, freq)
    probs = np.asarray(r, dtype=float).ravel()
    if probs.size != 2**n:
        return None
    return _bars(n, {format(i, f"0{n}b"): p for i, p in enumerate(probs)})
