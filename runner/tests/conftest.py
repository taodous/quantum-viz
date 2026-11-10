from pathlib import Path

import pytest

from qrunner import run_code

CIRCUITS = Path(__file__).parent / "circuits"


def load(name: str) -> str:
    return (CIRCUITS / name).read_text(encoding="utf-8")


def line_of(code: str, needle: str) -> int:
    """1-based line number of the first line containing `needle`."""
    for i, text in enumerate(code.splitlines(), start=1):
        if needle in text:
            return i
    raise AssertionError(f"{needle!r} not in code")


def hist(circuit: dict) -> dict[str, float]:
    return {b["state"]: b["value"] for b in circuit["histogram"]}


@pytest.fixture
def run():
    def _run(code: str) -> dict:
        out = run_code(code)
        assert "durationMs" in out
        return out

    return _run


@pytest.fixture
def ok(run):
    def _ok(code: str) -> dict:
        out = run(code)
        assert out["ok"], out.get("error")
        return out

    return _ok


@pytest.fixture
def err(run):
    def _err(code: str) -> dict:
        out = run(code)
        assert not out["ok"], "expected an error"
        e = out["error"]
        assert set(e) == {"kind", "message", "line", "python"}
        assert "Traceback" not in e["message"]
        return e

    return _err
