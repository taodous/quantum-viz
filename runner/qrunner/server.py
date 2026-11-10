"""Pre-warmed fork server (Linux only), chosen in milestone 1.

    sudo python -m qrunner.server --token-sha256 <hex> [--user nobody] [--port 7000]
    python -m qrunner.server --no-auth            # local manual testing only

The parent imports PennyLane and runs a warm-up circuit once. Each HTTP
request is handled in a forked child (ForkingMixIn), which forks again into a
worker that runs the student code. The child supervises the worker: a
wall-clock timeout plus RLIMIT_CPU, and it always answers with JSON.

GET /  → readiness probe (no auth, reveals nothing).
POST / (body = code, UTF-8, header `Authorization: Bearer <token>`) → RunResponse JSON.

Security (milestone 4). The exposed port is a public URL, so:
- The server only knows SHA-256(token), passed on the command line. The raw
  token exists in the sandbox only inside the request being handled.
- Started as root, the server drops the worker to an unprivileged user
  (`nobody`) before running student code: it cannot read the server's memory,
  signal it, or touch root-owned files. Per-worker limits on processes, memory
  and file size come on top of the CPU limit.
"""

from __future__ import annotations

import os

# Before numpy loads: forking with live BLAS threads is unsafe.
for _var in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_var, "1")

import argparse  # noqa: E402
import hashlib  # noqa: E402
import hmac  # noqa: E402
import json  # noqa: E402
import pwd  # noqa: E402
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


# Worker limits, on top of RLIMIT_CPU.
WORKER_NPROC = 64  # processes of the worker user, all workers together
WORKER_EXTRA_MEMORY = 600 * 2**20  # address space the worker may add to what the server already maps
WORKER_FSIZE = 8 * 2**20  # largest file the worker may write


class Config:
    """Set by main(); tests may set it directly."""

    token_sha256: bytes | None = None  # None: no auth (tests, --no-auth)
    worker_user: pwd.struct_passwd | None = None  # None: keep the current user


def authorized(header: str | None) -> bool:
    if Config.token_sha256 is None:
        return True
    if not header or not header.startswith("Bearer "):
        return False
    return hmac.compare_digest(hashlib.sha256(header[7:].strip().encode()).digest(), Config.token_sha256)


def _mapped_bytes() -> int:
    with open("/proc/self/statm") as f:
        return int(f.read().split()[0]) * os.sysconf("SC_PAGE_SIZE")


def _confine_worker(timeout: float) -> None:
    """Called in the worker, before student code runs. Order matters: limits
    that need privileges first, then the user switch, which cannot be undone."""
    limit = int(timeout) + 1
    resource.setrlimit(resource.RLIMIT_CPU, (limit, limit + 1))
    resource.setrlimit(resource.RLIMIT_FSIZE, (WORKER_FSIZE, WORKER_FSIZE))
    try:
        mem = _mapped_bytes() + WORKER_EXTRA_MEMORY
        resource.setrlimit(resource.RLIMIT_AS, (mem, mem))
    except OSError:
        pass
    user = Config.worker_user
    if user is not None and os.geteuid() == 0:
        resource.setrlimit(resource.RLIMIT_NPROC, (WORKER_NPROC, WORKER_NPROC))
        os.setgroups([])
        os.setgid(user.pw_gid)
        os.setuid(user.pw_uid)
        os.environ["HOME"] = "/tmp"
        os.chdir("/tmp")
    Config.token_sha256 = None


def run_isolated(code: str, timeout: float = TIMEOUT_S) -> bytes:
    """Run `code` in a forked worker; return the RunResponse as JSON bytes."""
    r, w = os.pipe()
    pid = os.fork()
    if pid == 0:  # worker
        os.close(r)
        try:
            _confine_worker(timeout)
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
        if not authorized(self.headers.get("Authorization")):
            self._send(_error("infra", "Accès refusé au serveur d'exécution"), status=401)
            return
        del self.headers["Authorization"]  # the worker is forked from this process
        length = int(self.headers.get("Content-Length", "0"))
        if length > MAX_CODE_CHARS * 4:
            self.rfile.read(length)
            self._send(_error("limit", f"Code trop long ({MAX_CODE_CHARS} caractères au maximum)"))
            return
        code = self.rfile.read(length).decode("utf-8", errors="replace")
        self._send(run_isolated(code))

    def _send(self, body: bytes, status: int = 200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class ForkingHTTPServer(ForkingMixIn, HTTPServer):
    allow_reuse_address = True


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="python -m qrunner.server")
    p.add_argument("--port", type=int, default=int(os.environ.get("PORT", "7000")))
    auth = p.add_mutually_exclusive_group(required=True)
    auth.add_argument("--token-sha256", help="hex SHA-256 of the bearer token callers must send")
    auth.add_argument("--no-auth", action="store_true", help="accept any caller (local testing only)")
    p.add_argument("--user", default="nobody", help="user that runs student code when started as root")
    args = p.parse_args(argv)

    Config.token_sha256 = None if args.no_auth else bytes.fromhex(args.token_sha256)
    if os.geteuid() == 0:
        Config.worker_user = pwd.getpwnam(args.user)
    else:
        sys.stderr.write("qrunner: not root, student code runs as the server's own user\n")
    server = ForkingHTTPServer(("0.0.0.0", args.port), Handler)
    sys.stderr.write(f"qrunner ready on :{args.port} import={T_IMPORTED - T_START:.2f}s warmup={T_READY - T_IMPORTED:.2f}s\n")
    server.serve_forever()


if __name__ == "__main__":
    main()
