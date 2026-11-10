"""Number and value formatting, ported from the prototype (fmtNum, pretty)."""

from __future__ import annotations

import math
import re
from numbers import Number

import numpy as np

_PI_DENOMINATORS = (1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 32)
_GREEK = {
    "theta": "θ", "phi": "φ", "varphi": "φ", "alpha": "α", "beta": "β", "gamma": "γ", "delta": "δ",
    "lambda": "λ", "lam": "λ", "lmbda": "λ", "omega": "ω", "psi": "ψ", "epsilon": "ε", "eps": "ε",
    "mu": "μ", "tau": "τ", "sigma": "σ", "eta": "η", "rho": "ρ", "chi": "χ", "xi": "ξ", "zeta": "ζ",
    "kappa": "κ", "nu": "ν",
}
_SUBSCRIPTS = str.maketrans("0123456789", "₀₁₂₃₄₅₆₇₈₉")
_PRETTY_RE = re.compile(r"^([A-Za-z]+?)_?(\d+)?$")


def _minus(s: str) -> str:
    return s.replace("-", "−")


def fmt_num(v: float) -> str:
    """Multiples of π as fractions (π/4, 2π/3), otherwise 3 decimals."""
    v = float(v)
    if not math.isfinite(v):
        return "∞" if v > 0 else "−∞" if v < 0 else "?"
    if v.is_integer() and abs(v) < 1e15:
        return _minus(str(int(v)))
    r = v / math.pi
    for q in _PI_DENOMINATORS:
        pn = r * q
        pr = round(pn)
        if pr != 0 and abs(pn - pr) < 1e-9:
            a = abs(pr)
            return ("−" if pr < 0 else "") + ("" if a == 1 else str(a)) + "π" + ("" if q == 1 else f"/{q}")
    s = f"{v:.1f}" if abs(v) >= 100 else f"{v:.3f}"
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return _minus(s)


def pretty(name: str) -> str:
    """theta → θ, phi_1 → φ₁."""
    m = _PRETTY_RE.match(name)
    if not m:
        return name
    base = _GREEK.get(m.group(1).lower(), m.group(1))
    return base + (m.group(2).translate(_SUBSCRIPTS) if m.group(2) else "")


def as_scalar(v) -> float | None:
    """A real scalar (python number, numpy scalar, 0-d array/tensor), else None."""
    if isinstance(v, bool):
        return float(v)
    if isinstance(v, Number) and not isinstance(v, complex):
        return float(v)
    if isinstance(v, np.ndarray) and v.ndim == 0 and np.isrealobj(v):
        return float(v)
    try:  # pennylane.numpy tensors, autograd boxes
        arr = np.asarray(v)
        if arr.ndim == 0 and np.isrealobj(arr) and arr.dtype != object:
            return float(arr)
    except Exception:  # noqa: BLE001
        pass
    return None


def fmt_val(v) -> str:
    """Argument value as shown in a tab label: circuit(π/4)."""
    if isinstance(v, bool):
        return "True" if v else "False"
    if v is None:
        return "None"
    if isinstance(v, str):
        return f'"{v}"'
    s = as_scalar(v)
    if s is not None:
        return fmt_num(s)
    if isinstance(v, (list, tuple, np.ndarray)):
        items = list(np.asarray(v).ravel()) if isinstance(v, np.ndarray) else list(v)
        scalars = [as_scalar(x) for x in items]
        if len(items) <= 4 and all(x is not None for x in scalars):
            return "[" + ", ".join(fmt_num(x) for x in scalars) + "]"
        return "[…]"
    return "…"
