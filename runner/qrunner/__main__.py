"""Cold mode: `python -m qrunner < code.py` prints exactly one JSON object.

The real stdout file descriptor is set aside before anything runs, and fds
1 and 2 point to /dev/null: even `os.write(1, ...)` from student code cannot
corrupt the JSON.
"""

import os
import sys


def main() -> None:
    code = sys.stdin.buffer.read().decode("utf-8", errors="replace")
    json_out = os.fdopen(os.dup(1), "wb")
    devnull = os.open(os.devnull, os.O_WRONLY)
    os.dup2(devnull, 1)
    os.dup2(devnull, 2)

    from .execute import run_code, to_json  # imported after the redirect: import warnings go nowhere

    json_out.write(to_json(run_code(code)))
    json_out.flush()


if __name__ == "__main__":
    main()
