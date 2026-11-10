"""Latency probe: run student code with PennyLane and record every QNode call.

Throwaway code for milestone 1 (latency measurement). It does roughly the
same amount of work as the real runner will (exec + tape construction +
execution + JSON), without the full serialization contract.
"""

from __future__ import annotations

import io
import json
import sys
import time
import traceback
from contextlib import redirect_stdout

import pennylane as qml


def run_code(code: str) -> dict:
    t0 = time.perf_counter()
    records: list[dict] = []
    original_call = qml.QNode.__call__

    def recording_call(self, *args, **kwargs):
        tape = qml.workflow.construct_tape(self)(*args, **kwargs)
        result = original_call(self, *args, **kwargs)
        records.append(
            {
                "name": getattr(self.func, "__name__", "circuit"),
                "ops": [
                    {
                        "name": op.name,
                        "wires": [str(w) for w in op.wires],
                        "params": [float(p) for p in op.parameters],
                    }
                    for op in tape.operations
                ],
                "meas": [repr(m) for m in tape.measurements],
                "result": repr(result),
            }
        )
        return result

    qml.QNode.__call__ = recording_call
    stdout = io.StringIO()
    try:
        with redirect_stdout(stdout):
            exec(compile(code, "<circuit>", "exec"), {"__name__": "__main__"})
        out = {"ok": True, "circuits": records, "stdout": stdout.getvalue()}
    except BaseException as exc:  # noqa: BLE001 - every failure must become JSON
        out = {
            "ok": False,
            "error": {"kind": type(exc).__name__, "python": "".join(traceback.format_exception_only(exc)).strip()},
        }
    finally:
        qml.QNode.__call__ = original_call
    out["execMs"] = round((time.perf_counter() - t0) * 1000, 1)
    return out


if __name__ == "__main__":
    # Cold mode: `python probe.py file.py` — one fresh process per run.
    with open(sys.argv[1], encoding="utf-8") as f:
        source = f.read()
    sys.stdout.write(json.dumps(run_code(source)))
