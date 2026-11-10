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


# --- Milestone 4: the exposed port is public -------------------------------------

root_only = pytest.mark.skipif(not hasattr(os, "geteuid") or os.geteuid() != 0, reason="needs root (sandbox test runner uses sudo)")


@fork_only
def test_server_auth_checks_the_token_hash():
    import hashlib

    from qrunner.server import Config, authorized

    saved = Config.token_sha256
    try:
        Config.token_sha256 = hashlib.sha256(b"s3cret").digest()
        assert authorized("Bearer s3cret")
        assert not authorized("Bearer s3cret2")
        assert not authorized("s3cret")
        assert not authorized(None)
    finally:
        Config.token_sha256 = saved


@fork_only
@root_only
def test_worker_drops_to_an_unprivileged_user():
    import pwd

    from qrunner.server import Config, run_isolated

    saved = Config.worker_user
    Config.worker_user = pwd.getpwnam("nobody")
    try:
        code = (
            "import os, signal\n"
            "print('uid', os.getuid(), os.geteuid())\n"
            "try:\n"
            "    os.kill(os.getppid(), 0)\n"
            "    print('can signal parent')\n"
            "except PermissionError:\n"
            "    print('cannot signal parent')\n"
            "try:\n"
            "    open('/proc/%d/environ' % os.getppid()).read()\n"
            "    print('can read parent env')\n"
            "except PermissionError:\n"
            "    print('cannot read parent env')\n"
        )
        out = json.loads(run_isolated(code))
        assert out["ok"], out
        nobody = pwd.getpwnam("nobody").pw_uid
        assert f"uid {nobody} {nobody}" in out["stdout"]
        assert "cannot signal parent" in out["stdout"]
        assert "cannot read parent env" in out["stdout"]
        # PennyLane still works under the unprivileged user, lazy imports included.
        grover = json.loads(run_isolated(load("09_grover.py")))
        assert grover["ok"], grover
    finally:
        Config.worker_user = saved


@fork_only
def test_worker_memory_is_limited():
    from qrunner.server import run_isolated

    out = json.loads(run_isolated("import numpy\nx = numpy.ones(400_000_000)\n"))
    assert out["ok"] is False and out["error"]["kind"] == "limit"  # MemoryError
    assert json.loads(run_isolated(load("03_hadamard.py")))["ok"]


@fork_only
def test_http_server_requires_the_token():
    import hashlib
    import socket
    import tempfile
    import time
    import urllib.error
    import urllib.request

    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    token = "tok-" + os.urandom(8).hex()
    log = tempfile.TemporaryFile()
    proc = subprocess.Popen(
        [sys.executable, "-m", "qrunner.server", "--port", str(port), "--token-sha256", hashlib.sha256(token.encode()).hexdigest()],
        cwd=RUNNER_DIR,
        stdout=log,
        stderr=log,
    )
    url = f"http://127.0.0.1:{port}/"
    try:
        for _ in range(300):
            try:
                assert json.loads(urllib.request.urlopen(url, timeout=1).read())["ready"]
                break
            except (OSError, urllib.error.URLError):
                time.sleep(0.1)
        else:
            log.seek(0)
            raise AssertionError(f"server never became ready: {log.read().decode(errors='replace')[-2000:]}")

        def post(headers):
            req = urllib.request.Request(url, data=load("07_bell.py").encode(), headers=headers, method="POST")
            try:
                with urllib.request.urlopen(req, timeout=20) as r:
                    return r.status, json.loads(r.read())
            except urllib.error.HTTPError as e:
                return e.code, json.loads(e.read())

        status, body = post({})
        assert status == 401 and body["ok"] is False
        status, body = post({"Authorization": "Bearer wrong"})
        assert status == 401
        status, body = post({"Authorization": f"Bearer {token}"})
        assert status == 200 and body["ok"] and len(body["circuits"]) == 2
    finally:
        proc.kill()
        proc.wait()
