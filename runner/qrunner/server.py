"""Pre-warmed fork server (Linux only), chosen in milestone 1.

    python -m qrunner.server            # listens on 0.0.0.0:$PORT (7000)

The parent imports PennyLane and runs a warm-up circuit once. Each HTTP
request is handled in a forked child (ForkingMixIn), which forks again into a
worker that runs the student code. The child supervises the worker: a
wall-clock timeout plus RLIMIT_CPU, and it always answers with JSON.

GET /  → readiness probe. POST / (body = code, UTF-8) → RunResponse JSON.
"""

from __future__ import annotations

import os

# Before numpy loads: forking with live BLAS threads is unsafe.
for _var in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_var, "1")

import json  # noqa: E402
import resource  # noqa: E402
import select  # noqa: E402
import signal  # noqa: E402
import sys  # noqa: E402
import time  # noqa: E402
import warnings  # noqa: E402
from http.server import BaseHTTPRequestHandler, HTTPServer  # noqa: E402
from socketserver import ForkingMixIn  # noqa: E402

T_START = time.perf_counter()
with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    from .execute import run_code, to_json  # noqa: E402
    from .limits import MAX_CODE_CHARS, TIMEOUT_S  # noqa: E402
T_IMPORTED = time.perf_counter()

WARMUP = """
import pennylane as qml
from pennylane import numpy as np
dev = qml.device("default.qubit", wires=2)

@qml.set_shots(100)
@qml.qnode(dev)
def warm(theta):
    qml.Hadamard(wires=0)
    qml.RY(theta, wires=1)
    qml.CNOT(wires=[0, 1])
    return qml.counts()

@qml.qnode(dev)
def warm_probs():
    qml.Hadamard(wires=0)
    return qml.probs()

warm(np.pi / 4)
warm_probs()
"""
run_code(WARMUP)
T_READY = time.perf_counter()


def _error(kind: str, message: str, python: str | None = None) -> bytes:
    return json.dumps({"ok": False, "error": {"kind": kind, "message": message, "line": None, "python": python}}, ensure_ascii=False).encode()


def run_isolated(code: str, timeout: float = TIMEOUT_S) -> bytes:
    """Run `code` in a forked worker; return the RunResponse as JSON bytes."""
    r, w = os.pipe()
    pid = os.fork()
    if pid == 0:  # worker
        os.close(r)
        try:
            limit = int(timeout) + 1
            resource.setrlimit(resource.RLIMIT_CPU, (limit, limit + 1))
            data = to_json(run_code(code))
        except BaseException as exc:  # noqa: BLE001
            data = _error("infra", "Erreur interne du serveur d'exécution", repr(exc))
        view = memoryview(data)
        while view:
            view = view[os.write(w, view):]
        os._exit(0)

    os.close(w)
    timed_out = _error("timeout", f"Exécution interrompue après {timeout:g} s : boucle infinie ?")
    chunks: list[bytes] = []
    deadline = time.monotonic() + timeout
    status = 0
    try:
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                os.kill(pid, signal.SIGKILL)
                return timed_out
            ready, _, _ = select.select([r], [], [], remaining)
            if ready:
                chunk = os.read(r, 65536)
                if not chunk:
                    break
                chunks.append(chunk)
    finally:
        os.close(r)
        _, status = os.waitpid(pid, 0)
    if chunks and os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0:
        return b"".join(chunks)
    if os.WIFSIGNALED(status) and os.WTERMSIG(status) in (signal.SIGXCPU, signal.SIGKILL):
        return timed_out  # RLIMIT_CPU
    return _error("runtime", "Le programme s'est arrêté brutalement sans résultat (os._exit ?)")


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps({"ready": True, "importMs": round((T_IMPORTED - T_START) * 1000), "warmupMs": round((T_READY - T_IMPORTED) * 1000)}).encode()
        self._send(body)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length > MAX_CODE_CHARS * 4:
            self.rfile.read(length)
            self._send(_error("limit", f"Code trop long ({MAX_CODE_CHARS} caractères au maximum)"))
            return
        code = self.rfile.read(length).decode("utf-8", errors="replace")
        self._send(run_isolated(code))

    def _send(self, body: bytes):
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class ForkingHTTPServer(ForkingMixIn, HTTPServer):
    allow_reuse_address = True


def main() -> None:
    port = int(os.environ.get("PORT", "7000"))
    sys.stderr.write(f"qrunner ready on :{port} import={T_IMPORTED - T_START:.2f}s warmup={T_READY - T_IMPORTED:.2f}s\n")
    ForkingHTTPServer(("0.0.0.0", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
