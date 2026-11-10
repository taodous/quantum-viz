"""Exceptions → structured RunError with a French sentence for beginners.

The message never contains the line number (the UI prefixes "Ligne N ·").
The original Python message goes to `python`, shown folded under it.
"""

from __future__ import annotations

import builtins
import difflib
import os
import re
import traceback

import pennylane as qml

from .gates import SPECS
from .limits import LimitError

FILENAME = "<circuit>"
_PL_DIR = os.path.dirname(qml.__file__)
_QML_CALL = re.compile(r"\bqml\.(\w+)\s*\(")

_OPENERS = {"(": "Parenthèse `(` ouverte", "[": "Crochet `[` ouvert", "{": "Accolade `{` ouverte"}

SYNTAX_RULES: list[tuple[re.Pattern, object]] = [
    (re.compile(r"'([(\[{])' was never closed"), lambda m: f"{_OPENERS[m[1]]} jamais refermé{'e' if m[1] != '[' else ''}"),
    (re.compile(r"unmatched '(.)'"), lambda m: f"`{m[1]}` fermant en trop : rien ne l'ouvre avant"),
    (re.compile(r"closing parenthesis '(.)' does not match opening parenthesis '(.)'"), lambda m: f"`{m[1]}` ne correspond pas au `{m[2]}` ouvert avant"),
    (re.compile(r"expected ':'"), "Il manque `:` à la fin de la ligne"),
    (re.compile(r"expected an indented block"), "Il faut indenter (décaler vers la droite) les lignes qui suivent `:`"),
    (re.compile(r"unexpected indent"), "Indentation inattendue : cette ligne est décalée sans raison"),
    (re.compile(r"unindent does not match"), "Indentation incohérente : aligne cette ligne sur un bloc au-dessus"),
    (re.compile(r"inconsistent use of tabs and spaces"), "Mélange de tabulations et d'espaces dans l'indentation"),
    (re.compile(r"unterminated (triple-quoted )?string literal"), "Texte entre guillemets jamais refermé"),
    (re.compile(r"invalid character '([“”‘’])'"), "Guillemets typographiques : remplace-les par des guillemets droits \" ou '"),
    (re.compile(r"invalid non-printable character"), "Caractère invisible (espace insécable ?) : retape les espaces de cette ligne"),
    (re.compile(r"invalid character '(.)'"), lambda m: f"Caractère `{m[1]}` invalide en Python"),
    (re.compile(r"Perhaps you forgot a comma"), "Syntaxe invalide : il manque peut-être une virgule"),
    (re.compile(r"'return' outside function"), "`return` doit être à l'intérieur d'une fonction (sous `def`)"),
    (re.compile(r"invalid decimal literal"), "Nombre mal écrit"),
    (re.compile(r"cannot assign to"), "Impossible d'affecter une valeur à cet élément"),
    (re.compile(r"Maybe you meant '==' or ':=' instead of '='"), "Pour comparer, écris `==` (un seul `=` sert à affecter)"),
]


def _first_qml_call(line_text: str | None) -> str | None:
    if not line_text:
        return None
    m = _QML_CALL.search(line_text)
    return m.group(1) if m else None


def _args_list(raw: str) -> str:
    names = re.findall(r"'(\w+)'", raw)
    return " et ".join(f"`{n}`" for n in names) if names else raw


def _suggest(name: str, candidates, prefix: str = "") -> str:
    match = difflib.get_close_matches(name, [c for c in candidates if not c.startswith("_")], n=1, cutoff=0.75)
    return f" (tu voulais dire `{prefix}{match[0]}` ?)" if match else ""


class ErrorContext:
    """What the translator may know beyond the exception itself."""

    def __init__(self, source_lines: list[str], device_wires: list | None = None, wire_line: int | None = None):
        self.source_lines = source_lines
        self.device_wires = device_wires
        self.wire_line = wire_line

    def line_text(self, line: int | None) -> str | None:
        if line and 0 < line <= len(self.source_lines):
            return self.source_lines[line - 1]
        return None


def _student_frames(exc):
    return [f for f in traceback.extract_tb(exc.__traceback__) if f.filename == FILENAME]


def _innermost_tb(exc):
    tb = exc.__traceback__
    while tb is not None and tb.tb_next is not None:
        tb = tb.tb_next
    return tb


def _raised_in_pennylane(exc) -> bool:
    tb = _innermost_tb(exc)
    return tb is not None and tb.tb_frame.f_code.co_filename.startswith(_PL_DIR)


def _student_scope(exc) -> set[str]:
    """Names visible in the innermost student frame, for suggestions."""
    names = set(dir(builtins))
    tb = exc.__traceback__
    while tb is not None:
        if tb.tb_frame.f_code.co_filename == FILENAME:
            names = set(dir(builtins)) | set(tb.tb_frame.f_globals) | set(tb.tb_frame.f_locals)
        tb = tb.tb_next
    return names


def python_message(exc) -> str:
    return "".join(traceback.format_exception_only(exc)).strip()


def translate(exc: BaseException, ctx: ErrorContext) -> dict:
    if isinstance(exc, SyntaxError):
        line = exc.lineno if exc.filename == FILENAME else None
        return {"kind": "syntax", "message": _syntax_message(exc), "line": line, "python": python_message(exc)}

    frames = _student_frames(exc)
    line = frames[-1].lineno if frames else None
    if isinstance(exc, LimitError):
        return {"kind": "limit", "message": str(exc), "line": line, "python": None}
    if isinstance(exc, MemoryError):
        return {"kind": "limit", "message": "Mémoire insuffisante : le calcul est trop gros", "line": line, "python": python_message(exc)}

    is_pl_exception = type(exc).__module__.startswith("pennylane")
    # qml.RY(wires=0) fails in the call itself, before entering PennyLane code.
    ctor = re.match(r"(\w+)\.__init__\(\)", str(exc)) if isinstance(exc, TypeError) else None
    is_pl_ctor = bool(ctor and hasattr(qml, ctor[1]))
    if _is_student_mistake(exc):
        return {"kind": "runtime", "message": _runtime_message(exc), "line": line, "python": python_message(exc)}
    if is_pl_exception or is_pl_ctor or _raised_in_pennylane(exc):
        if isinstance(exc, qml.exceptions.WireError) and ctx.wire_line:
            line = ctx.wire_line
        message = _pennylane_message(exc, ctx, line)
        return {"kind": "pennylane", "message": message, "line": line, "python": python_message(exc)}
    return {"kind": "runtime", "message": _runtime_message(exc), "line": line, "python": python_message(exc)}


def _is_student_mistake(exc: BaseException) -> bool:
    """Errors raised from inside PennyLane that are really about the student's code:
    a typo in `qml.Hadamar`, or calling their own circuit with wrong arguments."""
    if isinstance(exc, AttributeError) and type(getattr(exc, "obj", None)).__name__ == "module":
        return True
    if isinstance(exc, TypeError):
        # "circuit() missing 1 required positional argument" (no dot: not a gate constructor)
        return bool(re.match(r"\w+\(\) (missing|takes|got an unexpected keyword)", str(exc)))
    return False


def _syntax_message(exc: SyntaxError) -> str:
    msg = exc.msg or ""
    for pattern, out in SYNTAX_RULES:
        m = pattern.search(msg)
        if m:
            return out(m) if callable(out) else out
    return "Erreur de syntaxe : Python ne comprend pas cette ligne"


def _runtime_message(exc: BaseException) -> str:
    msg = str(exc)
    if isinstance(exc, UnboundLocalError):
        return f"`{exc.name}` est utilisée avant d'avoir reçu une valeur" if getattr(exc, "name", None) else "Variable utilisée avant d'avoir reçu une valeur"
    if isinstance(exc, NameError):
        name = getattr(exc, "name", None) or (re.findall(r"'(\w+)'", msg) or ["?"])[0]
        if name == "qml":
            return "`qml` n'est pas défini : ajoute `import pennylane as qml` en haut du code"
        if name == "np":
            return "`np` n'est pas défini : ajoute `from pennylane import numpy as np` en haut du code"
        return f"`{name}` n'est pas défini{_suggest(name, _student_scope(exc))}"
    if isinstance(exc, AttributeError):
        name, obj = getattr(exc, "name", None), getattr(exc, "obj", None)
        if obj is qml:
            return f"`qml.{name}` n'existe pas dans PennyLane{_suggest(name, dir(qml), 'qml.')}"
        if type(obj).__name__ == "module":
            return f"`{obj.__name__}.{name}` n'existe pas{_suggest(name, dir(obj), obj.__name__ + '.')}"
        if name:
            return f"Une valeur de type `{type(obj).__name__}` n'a pas d'attribut `{name}`"
        return "Attribut inexistant"
    if isinstance(exc, TypeError):
        if m := re.search(r"(\w+)\(\) missing \d+ required (?:positional |keyword-only )?arguments?: (.+)", msg):
            return f"`{m[1]}()` : il manque l'argument {_args_list(m[2])}"
        if m := re.search(r"(\w+)\(\) takes (\d+) positional arguments? but (\d+) (?:were|was) given", msg):
            return f"`{m[1]}()` accepte {m[2]} argument(s) mais en reçoit {m[3]}"
        if m := re.search(r"(\w+)\(\) got an unexpected keyword argument '(\w+)'", msg):
            return f"`{m[1]}()` n'a pas d'argument `{m[2]}`"
        if m := re.search(r"'(\w+)' object is not callable", msg):
            return f"Une valeur de type `{m[1]}` n'est pas une fonction : impossible de l'appeler avec `( )`"
        if m := re.search(r"unsupported operand type\(s\) for (\S+): '(\w+)' and '(\w+)'", msg):
            return f"Opération `{m[1]}` impossible entre `{m[2]}` et `{m[3]}`"
        if m := re.search(r"can only concatenate (\w+)", msg):
            return f"Impossible d'ajouter une autre valeur à un `{m[1]}` avec `+`"
        return "Erreur de type : une valeur n'a pas le type attendu"
    if isinstance(exc, ZeroDivisionError):
        return "Division par zéro"
    if isinstance(exc, IndexError):
        return "Indice hors limites : la liste est plus courte que ça"
    if isinstance(exc, KeyError):
        return f"Clé {exc.args[0]!r} introuvable dans le dictionnaire" if exc.args else "Clé introuvable"
    if isinstance(exc, ModuleNotFoundError):
        return f"Le module `{exc.name}` n'est pas installé sur le serveur"
    if isinstance(exc, ImportError):
        return "Import impossible : ce nom n'existe pas dans le module"
    if isinstance(exc, RecursionError):
        return "Récursion trop profonde : une fonction s'appelle elle-même sans fin ?"
    if isinstance(exc, OverflowError):
        return "Nombre trop grand"
    if isinstance(exc, AssertionError):
        return "Un `assert` a échoué"
    if isinstance(exc, ValueError):
        return "Valeur invalide"
    return f"Erreur pendant l'exécution du code ({type(exc).__name__})"


def _pennylane_message(exc: BaseException, ctx: ErrorContext, line: int | None) -> str:
    msg = str(exc)
    gate = _first_qml_call(ctx.line_text(line))
    q = f"`qml.{gate}`" if gate else "Cette opération"

    if "wires not found on the device" in msg:
        missing = re.search(r"\{(.*)\}", msg)
        w = missing.group(1) if missing else "?"
        if ctx.device_wires is not None:
            dw = ctx.device_wires
            listed = ", ".join(str(x) for x in dw[:6]) + (", …" if len(dw) > 6 else "")
            return f"Le qubit {w} n'existe pas : le device a {len(dw)} qubit{'s' if len(dw) > 1 else ''} ({listed})"
        return f"Le qubit {w} n'existe pas sur ce device"
    if "Wires must be unique" in msg or "control wires must be different" in msg:
        return f"{q} : le même qubit apparaît deux fois dans `wires`"
    if "wrong number of wires" in msg:
        spec = SPECS.get(_canonical(gate))
        if spec and spec.wires:
            return f"{q} agit sur {spec.wires} qubit{'s' if spec.wires > 1 else ''} : vérifie `wires=…`"
        return f"{q} : mauvais nombre de qubits dans `wires`"
    if "must return either a single measurement" in msg:
        return "Le circuit doit finir par `return` suivi d'une mesure, par exemple `return qml.probs()`"
    if m := re.search(r"Measurement (\w+)MP.* not accepted for analytic simulation", msg):
        kind = {"Counts": "qml.counts()", "Sample": "qml.sample()"}.get(m[1], "Cette mesure")
        return f"`{kind}` a besoin de shots : ajoute `@qml.set_shots(1000)` au-dessus de `@qml.qnode(dev)`" if kind != "Cette mesure" else "Cette mesure a besoin de shots : ajoute `@qml.set_shots(1000)`"
    if m := re.search(r"Device (\S+) does not exist", msg):
        return f"Le device `{m[1]}` n'existe pas : utilise `\"default.qubit\"`"
    if m := re.search(r"(\w+)\.__init__\(\) missing \d+ required positional arguments?: (.+)", msg):
        missing = re.findall(r"'(\w+)'", m[2])
        name = f"`qml.{gate or m[1]}`"
        if "wires" in missing and len(missing) == 1:
            return f"{name} : indique le qubit avec `wires=…`"
        return f"{name} attend un angle puis le qubit, par exemple {name[:-1]}(np.pi/2, wires=0)`"
    if isinstance(exc, qml.exceptions.WireError):
        return f"{q} : qubits invalides dans `wires`"
    return f"{q} : arguments invalides" if gate else "Erreur PennyLane"


def _canonical(gate: str | None) -> str | None:
    aliases = {"H": "Hadamard", "X": "PauliX", "Y": "PauliY", "Z": "PauliZ", "CX": "CNOT", "CCX": "Toffoli"}
    return aliases.get(gate, gate) if gate else None
