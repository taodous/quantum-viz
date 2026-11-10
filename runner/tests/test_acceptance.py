"""The 9 Workshop 1 acceptance circuits (CLAUDE.md). Permanent tests."""

import pytest

from conftest import hist, line_of, load

pytestmark = pytest.mark.acceptance


def ops_summary(circuit):
    return [(o["label"], o["params"], o["controls"], o["targets"]) for o in circuit["ops"]]


def test_01_no_gate_measures_zero(ok):
    out = ok(load("01_zero.py"))
    (c,) = out["circuits"]
    assert c["label"] == "circuit()"
    assert c["wires"] == [{"key": "#0", "label": "0"}]
    assert c["ops"] == []
    assert [m["name"] for m in c["meas"]] == ["counts"]
    assert c["shots"] == 1000
    assert c["histogramKind"] == "counts"
    assert hist(c) == {"0": 1.0, "1": 0.0}


def test_02_pauli_x_flips_to_one(ok):
    code = load("02_pauli_x.py")
    (c,) = ok(code)["circuits"]
    assert ops_summary(c) == [("X", [], [], ["#0"])]
    assert c["ops"][0]["name"] == "PauliX"
    assert c["ops"][0]["family"] == "pauli"
    assert c["ops"][0]["line"] == line_of(code, "qml.PauliX")
    assert c["shots"] is None
    assert c["histogramKind"] == "probs"
    assert hist(c) == {"0": 0.0, "1": 1.0}


def test_03_hadamard_is_fifty_fifty(ok):
    """Device-level shots (deprecated in PennyLane 0.45 but still what students write)."""
    out = ok(load("03_hadamard.py"))
    (c,) = out["circuits"]
    assert ops_summary(c) == [("H", [], [], ["#0"])]
    assert c["ops"][0]["family"] == "h"
    assert c["shots"] == 1000
    h = hist(c)
    assert set(h) == {"0", "1"}
    assert h["0"] == pytest.approx(0.5, abs=0.1)
    assert h["0"] + h["1"] == pytest.approx(1.0)
    assert "np.str_('0')" in out["stdout"], "the student's print is captured"


def test_04_ry_called_with_four_angles_gives_four_tabs(ok):
    code = load("04_ry_angles.py")
    circuits = ok(code)["circuits"]
    assert [c["label"] for c in circuits] == ["circuit(0)", "circuit(π/4)", "circuit(π/2)", "circuit(π)"]
    assert [c["ops"][0]["params"] for c in circuits] == [["0"], ["π/4"], ["π/2"], ["π"]]
    assert all(c["ops"][0]["family"] == "rot" for c in circuits)
    assert all(c["ops"][0]["line"] == line_of(code, "qml.RY") for c in circuits)
    p1 = [hist(c)["1"] for c in circuits]
    assert p1 == pytest.approx([0.0, 0.1464, 0.5, 1.0], abs=1e-4)


def test_05_interference_hzh_and_hh(ok):
    hzh, hh = ok(load("05_interference.py"))["circuits"]
    assert hzh["label"] == "hzh()"
    assert [o["label"] for o in hzh["ops"]] == ["H", "Z", "H"]
    assert hist(hzh) == pytest.approx({"0": 0.0, "1": 1.0}, abs=1e-9)
    assert hh["label"] == "hh()"
    assert [o["label"] for o in hh["ops"]] == ["H", "H"]
    assert hist(hh) == pytest.approx({"0": 1.0, "1": 0.0}, abs=1e-9)


def test_06_two_qubits_h_on_first_only(ok):
    (c,) = ok(load("06_two_qubits.py"))["circuits"]
    assert [w["key"] for w in c["wires"]] == ["#0", "#1"]
    assert ops_summary(c) == [("H", [], [], ["#0"])]
    h = hist(c)
    assert list(h) == ["00", "01", "10", "11"], "every basis state, including 0 %"
    assert h["01"] == 0.0 and h["11"] == 0.0
    assert h["00"] == pytest.approx(0.5, abs=0.1)


def test_07_bell_states(ok):
    code = load("07_bell.py")
    bell, other = ok(code)["circuits"]
    assert ops_summary(bell) == [("H", [], [], ["#0"]), ("X", [], ["#0"], ["#1"])]
    cnot = bell["ops"][1]
    assert (cnot["name"], cnot["shape"], cnot["controlValues"]) == ("CNOT", "oplus", [1])
    assert cnot["line"] == line_of(code, "qml.CNOT")
    h = hist(bell)
    assert h["01"] == 0.0 and h["10"] == 0.0, "never |01⟩ nor |10⟩"
    assert h["00"] == pytest.approx(0.5, abs=0.1)

    assert other["label"] == "bell_other()"
    h = hist(other)
    assert h["00"] == 0.0 and h["11"] == 0.0
    assert h["01"] == pytest.approx(0.5, abs=0.1)


def test_08_challenge_angle_shown_as_two_pi_over_three(ok):
    (c,) = ok(load("08_challenge.py"))["circuits"]
    assert c["ops"][0]["label"] == "RY"
    assert c["ops"][0]["params"] == ["2π/3"]
    assert hist(c) == pytest.approx({"0": 0.25, "1": 0.75}, abs=1e-4)


def test_09_grover_groups_subfunctions(ok):
    code = load("09_grover.py")
    (c,) = ok(code)["circuits"]
    assert c["label"] == "grover()"
    assert len(c["wires"]) == 3

    groups = []
    for o in c["ops"]:
        g = o["group"] and (o["group"]["id"], o["group"]["name"])
        if g and (not groups or groups[-1] != g):
            groups.append(g)
    assert [name for _, name in groups] == ["oracle", "diffusion", "oracle", "diffusion"]
    assert len({gid for gid, _ in groups}) == 4, "one box per call"

    first_h = c["ops"][:3]
    assert all(o["group"] is None and o["label"] == "H" for o in first_h)

    ccz = [o for o in c["ops"] if o["group"] and o["group"]["name"] == "oracle" and o["controls"]]
    assert ccz, "the oracle has a doubly-controlled Z"
    assert ccz[0]["controls"] == ["#0", "#1"] and ccz[0]["targets"] == ["#2"]
    assert ccz[0]["label"] == "Z" and ccz[0]["shape"] == "dot"
    assert ccz[0]["line"] == line_of(code, "qml.ctrl(qml.PauliZ(wires=2), control=[0, 1])")

    h = hist(c)
    assert len(h) == 8
    assert max(h, key=h.get) == "101"
    assert h["101"] > 0.85
