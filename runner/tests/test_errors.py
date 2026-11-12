"""Student mistakes → structured French errors (fail-safe table, runner side)."""

import pytest

from conftest import line_of

HEAD = """import pennylane as qml
from pennylane import numpy as np

dev = qml.device("default.qubit", wires=2)

@qml.qnode(dev)
def circuit(theta):
"""


def body(*lines: str, call: str = "circuit(0.5)") -> str:
    return HEAD + "".join(f"    {line}\n" for line in lines) + call + "\n"


# --- syntax ---------------------------------------------------------------


@pytest.mark.parametrize(
    "code, line, message",
    [
        ("import pennylane as qml\nqml.RY(0.5, wires=0\n", 2, "Parenthèse `(` ouverte jamais refermée"),
        ("def f()\n    pass\n", 1, "Il manque `:` à la fin de la ligne"),
        ("def f():\nreturn 1\n", 2, "Il faut indenter (décaler vers la droite) les lignes qui suivent `:`"),
        ("x = 1\n  y = 2\n", 2, "Indentation inattendue : cette ligne est décalée sans raison"),
        ("s = 'abc\n", 1, "Texte entre guillemets jamais refermé"),
        ("print(“bonjour”)\n", 1, "Guillemets typographiques : remplace-les par des guillemets droits \" ou '"),
        ("print(a b)\n", 1, "Syntaxe invalide : il manque peut-être une virgule"),
        ("x = (1, 2]\n", 1, "`]` ne correspond pas au `(` ouvert avant"),
        ("x === 2\n", 1, "Erreur de syntaxe : Python ne comprend pas cette ligne"),
    ],
)
def test_syntax_errors(err, code, line, message):
    e = err(code)
    assert e["kind"] == "syntax"
    assert e["line"] == line
    assert e["message"] == message
    assert e["python"].startswith('File "<circuit>"')  # original message, folded in the UI


# --- runtime --------------------------------------------------------------


def test_name_error_with_suggestion(err):
    code = body("qml.RY(thet, wires=0)", "return qml.probs()")
    e = err(code)
    assert e["kind"] == "runtime"
    assert e["line"] == line_of(code, "thet,")
    assert e["message"] == "`thet` n'est pas défini (tu voulais dire `theta` ?)"
    assert "NameError" in e["python"]


def test_missing_import(err):
    e = err("dev = qml.device('default.qubit', wires=1)\n")
    assert e["message"] == "`qml` n'est pas défini : ajoute `import pennylane as qml` en haut du code"
    assert e["line"] == 1


def test_unknown_gate_suggests_the_right_name(err):
    code = body("qml.Hadamar(wires=0)", "return qml.probs()")
    e = err(code)
    assert e["kind"] == "runtime"
    assert e["message"] == "`qml.Hadamar` n'existe pas dans PennyLane (tu voulais dire `qml.Hadamard` ?)"
    assert e["line"] == line_of(code, "Hadamar(")


def test_zero_division(err):
    e = err("x = 1 / 0\n")
    assert (e["kind"], e["message"], e["line"]) == ("runtime", "Division par zéro", 1)


def test_circuit_called_without_its_argument(err):
    code = body("qml.RY(theta, wires=0)", "return qml.probs()", call="circuit()")
    e = err(code)
    assert e["message"] == "`circuit()` : il manque l'argument `theta`"
    assert e["line"] == line_of(code, "circuit()")


# --- PennyLane --------------------------------------------------------------


def test_wire_outside_device_points_at_the_gate(err):
    code = body("qml.Hadamard(wires=0)", "qml.CNOT(wires=[0, 2])", "return qml.probs()")
    e = err(code)
    assert e["kind"] == "pennylane"
    assert e["message"] == "Le qubit 2 n'existe pas : le device a 2 qubits (0, 1)"
    assert e["line"] == line_of(code, "qml.CNOT"), "the gate's line, not the call's"
    assert "WireError" in e["python"]


def test_missing_return(err):
    code = body("qml.Hadamard(wires=0)")
    e = err(code)
    assert e["kind"] == "pennylane"
    assert e["message"] == "Le circuit doit finir par `return` suivi d'une mesure, par exemple `return qml.probs()`"


def test_counts_without_shots(err):
    e = err(body("qml.Hadamard(wires=0)", "return qml.counts()"))
    assert e["kind"] == "pennylane"
    assert e["message"] == "`qml.counts()` a besoin de shots : ajoute `@qml.set_shots(1000)` au-dessus de `@qml.qnode(dev)`"


@pytest.mark.parametrize(
    "line, message",
    [
        ("qml.RY(wires=0)", "`qml.RY` attend un angle puis le qubit, par exemple `qml.RY(np.pi/2, wires=0)`"),
        ("qml.RY(0.5)", "`qml.RY` : indique le qubit avec `wires=…`"),
        ("qml.CNOT(wires=[0, 0])", "`qml.CNOT` : le même qubit apparaît deux fois dans `wires`"),
        ("qml.Hadamard(wires=[0, 1])", "`qml.Hadamard` agit sur 1 qubit : vérifie `wires=…`"),
        ("qml.CNOT(wires=[0, 1, 2])", "`qml.CNOT` agit sur 2 qubits : vérifie `wires=…`"),
        ("qml.CNOT(wires=0)", "`qml.CNOT` : arguments invalides"),
    ],
)
def test_gate_argument_errors(err, line, message):
    code = body(line, "return qml.probs()")
    e = err(code)
    assert e["kind"] == "pennylane"
    assert e["message"] == message
    assert e["line"] == line_of(code, line)


def test_unknown_device(err):
    e = err("import pennylane as qml\ndev = qml.device('default.qubitt', wires=1)\n")
    assert e["message"] == "Le device `default.qubitt` n'existe pas : utilise `\"default.qubit\"`"
    assert e["line"] == 2


# --- limits -----------------------------------------------------------------


def test_too_many_qubits_on_device(err):
    e = err("import pennylane as qml\ndev = qml.device('default.qubit', wires=40)\n")
    assert e["kind"] == "limit"
    assert e["message"] == "Trop de qubits : 16 au maximum (le device en demande 40)"
    assert e["line"] == 2


def test_too_many_qubits_dynamic_device(err):
    code = (
        "import pennylane as qml\ndev = qml.device('default.qubit')\n@qml.qnode(dev)\ndef c():\n"
        "    for w in range(30):\n        qml.Hadamard(wires=w)\n    return qml.probs()\nc()\n"
    )
    e = err(code)
    assert e["kind"] == "limit"
    assert "16 au maximum" in e["message"]


def test_too_many_operations(err):
    code = body("for _ in range(5000):", "    qml.PauliX(wires=0)", "return qml.probs()")
    e = err(code)
    assert e["kind"] == "limit"
    assert e["message"] == "Circuit trop grand pour être affiché (plus de 2500 portes)"


def test_code_too_long(err):
    e = err("x = 1\n" * 5000)
    assert e["kind"] == "limit"


def test_huge_print_output_is_truncated(ok):
    out = ok("for i in range(100000):\n    print('bonjour', i)\n")
    assert len(out["stdout"]) < 10_100
    assert out["stdout"].endswith("… (sortie tronquée)")


# --- never a raw crash ------------------------------------------------------


def test_sys_exit_is_not_an_error(ok):
    out = ok(body("qml.Hadamard(wires=0)", "return qml.probs()", call="circuit(0.1)\nimport sys\nsys.exit()\nprint('jamais')"))
    assert len(out["circuits"]) == 1


def test_user_raised_exception(err):
    e = err("raise ValueError('oups')\n")
    assert e["kind"] == "runtime"
    assert e["message"] == "Valeur invalide"
    assert "oups" in e["python"]


def test_runner_state_is_reset_between_runs(ok, err):
    err("x = (\n")
    out = ok(body("qml.Hadamard(wires=0)", "return qml.probs()"))
    assert len(out["circuits"]) == 1
    out = ok("x = 1\n")
    assert out["circuits"] == []


def test_output_too_big_becomes_a_limit_error():
    import json

    from qrunner.execute import to_json
    from qrunner.limits import MAX_OUTPUT_BYTES

    huge = {"ok": True, "circuits": [], "stdout": "x" * (MAX_OUTPUT_BYTES + 1), "hint": None, "durationMs": 3}
    out = json.loads(to_json(huge))
    assert out == {"ok": False, "error": {"kind": "limit", "message": "Résultat trop gros pour être affiché", "line": None, "python": None}, "durationMs": 3}
