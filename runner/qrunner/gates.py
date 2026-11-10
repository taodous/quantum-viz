"""PennyLane operations and measurements → contract Op dicts.

The gate table is ported from the prototype's SPECS so the renderer gets the
same labels, families and shapes.
"""

from __future__ import annotations

from dataclasses import dataclass

from pennylane.ops.op_math import Adjoint, Controlled, Pow

from .fmt import as_scalar, fmt_num
from .limits import MAX_CHILDREN


@dataclass(frozen=True)
class Spec:
    label: str
    family: str = "neutral"
    shape: str = "box"
    wires: int | None = None  # expected wire count, for error messages
    controls: int = 0  # leading control wires; -1 = all but the last
    self_adjoint: bool = False
    skip_params: bool = False
    template: bool = False  # drawn as a named box that unfolds into children


def _one(label: str, family: str, **kw) -> Spec:
    return Spec(label, family, wires=1, **kw)


SPECS: dict[str, Spec] = {
    "Hadamard": _one("H", "h", self_adjoint=True),
    "PauliX": _one("X", "pauli", self_adjoint=True),
    "PauliY": _one("Y", "pauli", self_adjoint=True),
    "PauliZ": _one("Z", "pauli", self_adjoint=True),
    "Identity": Spec("I", "neutral", self_adjoint=True),
    "S": _one("S", "phase"),
    "T": _one("T", "phase"),
    "SX": _one("√X", "pauli"),
    "RX": _one("RX", "rot"),
    "RY": _one("RY", "rot"),
    "RZ": _one("RZ", "rot"),
    "PhaseShift": _one("P", "phase"),
    "U1": _one("U1", "phase"),
    "Rot": _one("Rot", "rot"),
    "U2": _one("U2", "rot"),
    "U3": _one("U3", "rot"),
    "CNOT": Spec("X", "pauli", "oplus", wires=2, controls=1, self_adjoint=True),
    "CY": Spec("Y", "pauli", wires=2, controls=1, self_adjoint=True),
    "CZ": Spec("Z", "pauli", "dot", wires=2, controls=1, self_adjoint=True),
    "CH": Spec("H", "h", wires=2, controls=1, self_adjoint=True),
    "SWAP": Spec("SWAP", "neutral", "swap", wires=2, self_adjoint=True),
    "CSWAP": Spec("SWAP", "neutral", "swap", wires=3, controls=1, self_adjoint=True),
    "ISWAP": Spec("iSWAP", "neutral", wires=2),
    "SISWAP": Spec("√iSWAP", "neutral", wires=2),
    "CRX": Spec("RX", "rot", wires=2, controls=1),
    "CRY": Spec("RY", "rot", wires=2, controls=1),
    "CRZ": Spec("RZ", "rot", wires=2, controls=1),
    "CRot": Spec("Rot", "rot", wires=2, controls=1),
    "ControlledPhaseShift": Spec("P", "phase", wires=2, controls=1),
    "Toffoli": Spec("X", "pauli", "oplus", wires=3, controls=2, self_adjoint=True),
    "CCZ": Spec("Z", "pauli", "dot", wires=3, controls=2, self_adjoint=True),
    "MultiControlledX": Spec("X", "pauli", "oplus", controls=-1, self_adjoint=True),
    "IsingXX": Spec("XX", "rot", wires=2),
    "IsingYY": Spec("YY", "rot", wires=2),
    "IsingZZ": Spec("ZZ", "rot", wires=2),
    "IsingXY": Spec("XY", "rot", wires=2),
    "GroverOperator": Spec("Grover", "h", template=True, self_adjoint=True),
    "QFT": Spec("QFT", "h", template=True),
    "FlipSign": Spec("FlipSign", "phase", skip_params=True, self_adjoint=True, template=True),
    "BasisState": Spec("|b⟩", "neutral", skip_params=True),
    "StatePrep": Spec("|ψ⟩", "neutral", skip_params=True),
    "QubitUnitary": Spec("U", "neutral", skip_params=True),
}

HIDDEN = {"GlobalPhase", "Snapshot", "WireCut"}

MEASUREMENT_KINDS = {
    "ProbabilityMP": "probs",
    "CountsMP": "counts",
    "SampleMP": "sample",
    "ExpectationMP": "expval",
    "VarianceMP": "var",
    "StateMP": "state",
    "DensityMatrixMP": "density_matrix",
    "VnEntropyMP": "vn_entropy",
    "PurityMP": "purity",
    "MutualInfoMP": "mutual_info",
    "ClassicalShadowMP": "classical_shadow",
    "ShadowExpvalMP": "shadow_expval",
}


def wire_key(w) -> str:
    """Stable key for a wire label: '#0' for integers, '$a' for anything else."""
    try:
        if float(w).is_integer() and not isinstance(w, str):
            return f"#{int(w)}"
    except (TypeError, ValueError):
        pass
    return f"${w}"


def _params(op, spec: Spec | None) -> list[str]:
    if spec and spec.skip_params:
        return []
    out = []
    for p in op.parameters:
        s = as_scalar(p)
        if s is not None:
            out.append(fmt_num(s))
    return out[:3]


def _generic_label(name: str) -> str:
    return name if len(name) <= 9 else name[:8] + "…"


@dataclass
class OpMeta:
    line: int | None
    group: dict | None


class OpSerializer:
    """Turns tape operations into contract dicts. `meta` maps id(op) to the
    source line and sub-function recorded when the op was queued."""

    def __init__(self, meta: dict[int, OpMeta]):
        self.meta = meta
        self.children_budget = MAX_CHILDREN

    def serialize(self, op, inherited: OpMeta | None = None, depth: int = 0) -> dict | None:
        name = type(op).__name__ if type(op).__name__ in ("MidMeasure", "MidMeasureMP") else op.name
        if name in HIDDEN:
            return None
        meta = self.meta.get(id(op)) or inherited or OpMeta(None, None)
        d = self._describe(op, meta, depth)
        if d is None:
            return None
        d.update(line=meta.line, group=meta.group)
        return d

    def _base(self, name, label, family, shape, params, controls, cvals, targets, **extra) -> dict:
        return {
            "name": name, "label": label, "family": family, "shape": shape, "params": params,
            "controls": [wire_key(w) for w in controls], "controlValues": cvals,
            "targets": [wire_key(w) for w in targets], "children": None,
            "caption": None, "cond": False, "extra": 0, **extra,
        }

    def _describe(self, op, meta: OpMeta, depth: int) -> dict | None:
        cls = type(op).__name__
        if cls in ("MidMeasure", "MidMeasureMP"):
            return self._base("measure", "M", "meas", "meter", [], [], [], list(op.wires), caption="mesure")
        if cls == "Conditional":
            inner = self._describe(op.base, meta, depth)
            if inner:
                inner["cond"] = True
            return inner
        if op.name == "Barrier":
            return self._base("Barrier", "", "neutral", "barrier", [], [], [], list(op.wires))

        spec = SPECS.get(op.name)
        if spec is None and isinstance(op, Adjoint):
            inner = self._describe(op.base, meta, depth)
            if inner and not SPECS.get(op.base.name, Spec("")).self_adjoint:
                inner["label"] += "†"
            return inner
        if spec is None and isinstance(op, Pow):
            inner = self._describe(op.base, meta, depth)
            if inner:
                z = as_scalar(op.z)
                inner["label"] += "²" if z == 2 else "^" + (fmt_num(z) if z is not None else "?")
            return inner
        if spec is None and isinstance(op, Controlled):
            inner = self._describe(op.base, meta, depth)
            if inner:
                cw = list(op.control_wires)
                inner["controls"] = [wire_key(w) for w in cw] + inner["controls"]
                inner["controlValues"] = [int(bool(v)) for v in op.control_values] + inner["controlValues"]
                inner["extra"] += len(cw)
                if inner["shape"] == "box" and len(inner["targets"]) == 1 and not inner["params"] and len(inner["controls"]) == len(cw):
                    inner["shape"] = {"X": "oplus", "Z": "dot"}.get(inner["label"], "box")
            return inner

        wires = list(op.wires)
        if spec is None:
            spec = Spec(_generic_label(op.name), template=bool(getattr(op, "has_decomposition", False)))
        nc = spec.controls if spec.controls >= 0 else len(wires) - 1
        controls, targets = wires[:nc], wires[nc:]
        cvals = [1] * nc
        if nc and hasattr(op, "control_values"):
            cvals = [int(bool(v)) for v in op.control_values][:nc] or cvals
        d = self._base(op.name, spec.label, spec.family, spec.shape, _params(op, spec), controls, cvals, targets)
        if spec.template:
            d["children"] = self._children(op, meta, depth)
        return d

    def _children(self, op, meta: OpMeta, depth: int) -> list[dict] | None:
        if depth >= 2 or self.children_budget <= 0:
            return None
        try:
            parts = op.decomposition()
        except Exception:  # noqa: BLE001 - no decomposition: plain box
            return None
        out = []
        for child in parts:
            if self.children_budget <= 0:
                break
            d = self.serialize(child, inherited=meta, depth=depth + 1)
            if d:
                self.children_budget -= 1
                out.append(d)
        return out or None


def observable_label(obs) -> tuple[str, dict]:
    """Label of an observable ('Z', 'Z⊗Z', 'H') and the label per wire."""
    name = type(obs).__name__
    if name == "Prod":
        labels, per_wire = [], {}
        for factor in obs.operands:
            lbl, pw = observable_label(factor)
            labels.append(lbl)
            per_wire.update(pw)
        return "⊗".join(labels), per_wire
    if name in ("Sum", "LinearCombination", "Hamiltonian", "SProd"):
        return "H", {wire_key(w): "H" for w in obs.wires}
    spec = SPECS.get(obs.name)
    label = spec.label if spec else ("A" if obs.name == "Hermitian" else _generic_label(obs.name))
    return label, {wire_key(w): label for w in obs.wires}


def serialize_measurement(m, all_wires: list, line: int | None) -> dict:
    kind = MEASUREMENT_KINDS.get(type(m).__name__, type(m).__name__)
    obs = getattr(m, "obs", None)
    wires = list(m.wires) if len(m.wires) else list(all_wires)
    obs_label, per_wire = observable_label(obs) if obs is not None else (None, {})
    caps = {}
    for w in wires:
        k = wire_key(w)
        lbl = per_wire.get(k, obs_label)
        caps[k] = f"⟨{lbl}⟩" if kind == "expval" else f"var {lbl}" if kind == "var" else kind
    wide = kind in ("state", "density_matrix")
    return {
        "name": kind, "label": "|ψ⟩" if kind == "state" else "ρ", "family": "meas",
        "shape": "state" if wide else "meter", "params": [], "controls": [], "controlValues": [],
        "targets": [wire_key(w) for w in wires], "line": line, "group": None, "children": None,
        "caption": None, "cond": False, "extra": 0,
        "caps": caps, "joint": obs is not None and len(wires) > 1, "obs": obs_label,
        "all": len(m.wires) == 0, "terminal": True,
    }
