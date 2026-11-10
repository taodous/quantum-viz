"""Per-run limits. The wall-clock timeout itself is enforced by the
supervisor (server.py), not here."""

MAX_CODE_CHARS = 20_000
MAX_WIRES = 16
MAX_OPS_PER_CIRCUIT = 2_500
MAX_CHILDREN = 500
MAX_CIRCUITS = 40
MAX_STDOUT_CHARS = 10_000
MAX_HISTOGRAM_QUBITS = 8
MAX_OUTPUT_BYTES = 2_000_000
TIMEOUT_S = 5.0


class LimitError(Exception):
    """Raised when student code exceeds a limit. Message is already in French."""
