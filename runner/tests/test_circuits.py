"""Behaviours beyond the acceptance circuits: calls, templates, measurements."""

import pytest

from conftest import hist, line_of

HEAD = 'import pennylane as qml\nfrom pennylane import numpy as np\ndev = qml.device("default.qubit", wires=3)\n'


def test_qnode_never_called_without_arguments_is_run(ok):
    out = ok(HEAD + "@qml.qnode(dev)\ndef c():\n    qml.Hadamard(wires=0)\n    return qml.probs(wires=0)\n")
    (c,) = out["circuits"]
    assert c["label"] == "c()"
    assert out["hint"] is None


def test_qnode_never_called_with_arguments_gives_a_hint(ok):
    out = ok(HEAD + "@qml.qnode(dev)\ndef c(theta):\n    qml.RY(theta, wires=0)\n    return qml.probs(wires=0)\n")
    assert out["circuits"] == []
    assert out["hint"] == "Appelle ton circuit, par exemple `c(np.pi/4)`"


def test_set_shots_copy_is_the_one_auto_called(ok):
    out = ok(HEAD + "@qml.set_shots(500)\n@qml.qnode(dev)\ndef c():\n    qml.Hadamard(wires=0)\n    return qml.counts(wires=0)\n")
    (c,) = out["circuits"]
    assert c["shots"] == 500


def test_no_circuit_at_all(ok):
    out = ok("x = 1\n")
    assert out["circuits"] == []
    assert out["hint"].startswith("Aucun circuit trouvé")


def test_identical_calls_make_one_tab(ok):
    code = HEAD + "@qml.qnode(dev)\ndef c(t):\n    qml.RY(t, wires=0)\n    return qml.probs(wires=0)\nc(0.5)\nc(0.5)\nc(1.0)\n"
    assert [c["label"] for c in ok(code)["circuits"]] == ["c(0.5)", "c(1)"]


def test_keyword_arguments_in_label(ok):
    code = HEAD + "@qml.qnode(dev)\ndef c(theta):\n    qml.RY(theta, wires=0)\n    return qml.probs(wires=0)\nc(theta=np.pi/2)\n"
    assert ok(code)["circuits"][0]["label"] == "c(θ=π/2)"


def test_prints_inside_the_circuit_appear_once(ok):
    code = HEAD + "@qml.qnode(dev)\ndef c():\n    print('dans le circuit')\n    qml.Hadamard(wires=0)\n    return qml.probs(wires=0)\nc()\n"
    assert ok(code)["stdout"].count("dans le circuit") == 1


def test_adjoint_and_controlled_gates(ok):
    code = HEAD + (
        "@qml.qnode(dev)\ndef c():\n"
        "    qml.adjoint(qml.S(wires=0))\n"
        "    qml.adjoint(qml.Hadamard(wires=0))\n"
        "    qml.ctrl(qml.Hadamard(wires=2), control=[0, 1], control_values=[1, 0])\n"
        "    qml.ctrl(qml.PauliX(wires=1), control=0)\n"
        "    qml.CRY(np.pi / 2, wires=[0, 1])\n"
        "    qml.SWAP(wires=[1, 2])\n"
        "    qml.Barrier()\n"
        "    return qml.probs()\nc()\n"
    )
    ops = ok(code)["circuits"][0]["ops"]
    s_dag, h, ch, cnot, cry, swap, barrier = ops
    assert (s_dag["name"], s_dag["label"]) == ("S", "S†")
    assert h["label"] == "H", "H is its own inverse: no dagger"
    assert (ch["label"], ch["controls"], ch["controlValues"], ch["targets"], ch["extra"]) == ("H", ["#0", "#1"], [1, 0], ["#2"], 2)
    assert (cnot["name"], cnot["shape"]) == ("CNOT", "oplus"), "PennyLane turns ctrl(X) into CNOT"
    assert (cry["label"], cry["params"], cry["controls"], cry["targets"]) == ("RY", ["π/2"], ["#0"], ["#1"])
    assert (swap["shape"], swap["targets"]) == ("swap", ["#1", "#2"])
    assert (barrier["shape"], barrier["targets"]) == ("barrier", ["#0", "#1", "#2"])


def test_templates_unfold_into_children(ok):
    code = HEAD + "@qml.qnode(dev)\ndef c():\n    qml.GroverOperator(wires=[0, 1, 2])\n    qml.QFT(wires=[0, 1])\n    return qml.probs()\nc()\n"
    grover, qft = ok(code)["circuits"][0]["ops"]
    assert (grover["label"], grover["targets"]) == ("Grover", ["#0", "#1", "#2"])
    assert grover["children"], "a click unfolds the box"
    assert "GlobalPhase" not in [ch["name"] for ch in grover["children"]]
    assert all(ch["line"] == line_of(code, "GroverOperator") for ch in grover["children"])
    assert any(ch["name"] == "MultiControlledX" for ch in grover["children"])
    assert [ch["name"] for ch in qft["children"]] == ["Hadamard", "ControlledPhaseShift", "Hadamard", "SWAP"]
    assert qft["children"][1]["params"] == ["π/2"]


def test_flipsign_oracle_template(ok):
    code = HEAD + "@qml.qnode(dev)\ndef c():\n    qml.FlipSign([1, 0, 1], wires=[0, 1, 2])\n    return qml.probs()\nc()\n"
    (op,) = ok(code)["circuits"][0]["ops"]
    assert (op["label"], op["params"]) == ("FlipSign", [])
    assert op["children"][0]["controlValues"] == [1, 0]


def test_expval_shows_theoretical_probabilities(ok):
    code = HEAD + "@qml.qnode(dev)\ndef c():\n    qml.Hadamard(wires=0)\n    return qml.expval(qml.PauliZ(0) @ qml.PauliZ(1))\nc()\n"
    (c,) = ok(code)["circuits"]
    (m,) = c["meas"]
    assert (m["name"], m["obs"], m["joint"], m["caps"]) == ("expval", "Z⊗Z", True, {"#0": "⟨Z⟩", "#1": "⟨Z⟩"})
    assert c["histogramKind"] == "theory"
    assert hist(c)["000"] == pytest.approx(0.5) and hist(c)["100"] == pytest.approx(0.5)


def test_sample_gives_counts_histogram(ok):
    code = HEAD + "@qml.set_shots(200)\n@qml.qnode(dev)\ndef c():\n    qml.PauliX(wires=1)\n    return qml.sample(wires=[0, 1])\nc()\n"
    (c,) = ok(code)["circuits"]
    assert c["histogramKind"] == "counts"
    assert hist(c) == {"00": 0.0, "01": 1.0, "10": 0.0, "11": 0.0}


def test_several_measurements_prefer_counts(ok):
    code = HEAD + "@qml.set_shots(100)\n@qml.qnode(dev)\ndef c():\n    qml.PauliX(wires=0)\n    return qml.expval(qml.PauliZ(0)), qml.counts(wires=[0])\nc()\n"
    (c,) = ok(code)["circuits"]
    assert [m["name"] for m in c["meas"]] == ["expval", "counts"]
    assert c["histogramKind"] == "counts" and hist(c) == {"0": 0.0, "1": 1.0}


def test_string_wire_labels(ok):
    code = "import pennylane as qml\ndev = qml.device('default.qubit', wires=['a', 'b'])\n@qml.qnode(dev)\ndef c():\n    qml.CNOT(wires=['a', 'b'])\n    return qml.probs()\nc()\n"
    (c,) = ok(code)["circuits"]
    assert c["wires"] == [{"key": "$a", "label": "a"}, {"key": "$b", "label": "b"}]
    assert c["ops"][0]["controls"] == ["$a"]


def test_output_is_json_serializable(ok):
    from qrunner.execute import to_json

    import json

    out = ok(HEAD + "@qml.qnode(dev)\ndef c(x):\n    qml.RX(x, wires=0)\n    return qml.state()\nc(np.array(0.3, requires_grad=True))\n")
    assert json.loads(to_json(out))["circuits"][0]["meas"][0]["shape"] == "state"
