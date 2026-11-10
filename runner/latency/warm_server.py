"""Pre-warmed fork server for milestone 1.

The parent imports PennyLane once and runs a warm-up circuit, then serves
HTTP. Each request is handled in a forked child (ForkingMixIn), which forks
again into a worker that runs the student code, so the supervisor can enforce
a wall-clock timeout and always answer with JSON.
"""

from __future__ import annotations

import os

# Must be set before numpy loads: forking with live BLAS threads is unsafe.
for var in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(var, "1")

import json
import resource
import select
import signal
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ForkingMixIn

T_START = time.perf_counter()
import pennylane as qml  # noqa: E402,F401

from probe import run_code  # noqa: E402

T_IMPORTED = time.perf_counter()

WARMUP = """
import pennylane as qml
dev = qml.device("default.qubit", wires=2)
@qml.qnode(dev)
def warm(theta):
    qml.Hadamard(wires=0)
    qml.RY(theta, wires=1)
    qml.CNOT(wires=[0, 1])
    return qml.probs(wires=[0, 1])
warm(0.3)
"""
run_code(WARMUP)
T_READY = time.perf_counter()

TIMEOUT_S = 5.0
PORT = int(os.environ.get("PORT", "7000"))


def run_isolated(code: str) -> dict:
    r, w = os.pipe()
    pid = os.fork()
    if pid == 0:  # worker
        os.close(r)
        try:
            resource.setrlimit(resource.RLIMIT_CPU, (int(TIMEOUT_S), int(TIMEOUT_S) + 1))
            data = json.dumps(run_code(code)).encode()
        except BaseException as exc:  # noqa: BLE001
            data = json.dumps({"ok": False, "error": {"kind": "infra", "python": repr(exc)}}).encode()
        view = memoryview(data)
        while view:
            view = view[os.write(w, view):]
        os._exit(0)

    os.close(w)
    chunks: list[bytes] = []
    deadline = time.monotonic() + TIMEOUT_S
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            os.kill(pid, signal.SIGKILL)
            os.waitpid(pid, 0)
            os.close(r)
            return {"ok": False, "error": {"kind": "timeout", "python": None}}
        ready, _, _ = select.select([r], [], [], remaining)
        if ready:
            chunk = os.read(r, 65536)
            if not chunk:
                break
            chunks.append(chunk)
    os.close(r)
    os.waitpid(pid, 0)
    return json.loads(b"".join(chunks) or b'{"ok": false, "error": {"kind": "infra", "python": "worker died"}}')


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):  # readiness probe
        self._send(200, {"ready": True, "importMs": round((T_IMPORTED - T_START) * 1000), "warmupMs": round((T_READY - T_IMPORTED) * 1000)})

    def do_POST(self):
        t0 = time.perf_counter()
        length = int(self.headers.get("Content-Length", "0"))
        code = self.rfile.read(length).decode("utf-8")
        out = run_isolated(code)
        out["serverMs"] = round((time.perf_counter() - t0) * 1000, 1)
        self._send(200, out)

    def _send(self, status: int, payload: dict):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class ForkingHTTPServer(ForkingMixIn, HTTPServer):
    allow_reuse_address = True


if __name__ == "__main__":
    sys.stderr.write(f"ready import={T_IMPORTED - T_START:.2f}s warmup={T_READY - T_IMPORTED:.2f}s\n")
    ForkingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
