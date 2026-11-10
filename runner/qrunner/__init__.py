"""Hello Quantum runner: executes student PennyLane code and serializes the
circuits PennyLane actually built, as one JSON object (see contract.md)."""

from .execute import run_code

__all__ = ["run_code"]
