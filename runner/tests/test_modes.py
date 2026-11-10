"""The two ways the runner is started: cold CLI and pre-warmed fork server."""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from conftest import load

RUNNER_DIR = Path(__file__).resolve().parents[1]


def run_cli(code: str) -> dict:
    proc = subprocess.run(
        [sys.executable, "-m", "qrunner"], input=code.encode("utf-8"), capture_output=True, cwd=RUNNER_DIR, timeout=120
    )
    assert proc.returncode == 0, proc.stderr.decode(errors="replace")
    return json.loads(proc.stdout.decode("utf-8"))  # exactly one JSON object, nothing else


def test_cli_outputs_one_json_object():
    out = run_cli(load("07_bell.py"))
    assert out["ok"] and len(out["circuits"]) == 2


def test_cli_student_cannot_pollute_the_json():
    code = (
        "import os, sys\n"
        "print('hello')\n"
        "sys.stdout.write('direct\\n')\n"
        "os.write(1, b'raw fd write\\n')\n"
        "sys.__stdout__.write('dunder\\n')\n"
        "sys.stderr.write('err\\n')\n"
    )
    out = run_cli(code)
    assert out["ok"]
    assert "hello" in out["stdout"] and "direct" in out["stdout"]


def test_cli_error_is_json_too():
    out = run_cli("x = (\n")
    assert out["ok"] is False and out["error"]["kind"] == "syntax"


fork_only = pytest.mark.skipif(not hasattr(os, "fork"), reason="fork server is Linux only (runs in the sandbox)")


@fork_only
def test_server_runs_code_in_a_worker():
    from qrunner.server import run_isolated

    out = json.loads(run_isolated(load("07_bell.py")))
    assert out["ok"] and [c["name"] for c in out["circuits"]] == ["bell", "bell_other"]


@fork_only
def test_server_times_out_infinite_loops():
    from qrunner.server import run_isolated

    out = json.loads(run_isolated("while True:\n    pass\n", timeout=1))
    assert out == {"ok": False, "error": {"kind": "timeout", "message": "Exécution interrompue après 1 s : boucle infinie ?", "line": None, "python": None}}


@fork_only
def test_server_survives_a_hard_exit():
    from qrunner.server import run_isolated

    out = json.loads(run_isolated("import os\nos._exit(3)\n"))
    assert out["ok"] is False and out["error"]["kind"] == "runtime"
    assert json.loads(run_isolated(load("02_pauli_x.py")))["ok"], "the next run still works"


@fork_only
def test_server_worker_state_does_not_leak():
    from qrunner.server import run_isolated

    run_isolated("import pennylane as qml\nqml.Hadamard = None\n")
    assert json.loads(run_isolated(load("03_hadamard.py")))["ok"]
