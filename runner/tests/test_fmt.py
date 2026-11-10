import math

import numpy as np
import pytest

from qrunner.fmt import fmt_num, fmt_val, pretty


@pytest.mark.parametrize(
    "value, expected",
    [
        (0, "0"),
        (3.0, "3"),
        (-2, "−2"),
        (math.pi, "π"),
        (-math.pi, "−π"),
        (math.pi / 4, "π/4"),
        (2 * math.pi / 3, "2π/3"),
        (2 * np.arccos(np.sqrt(0.25)), "2π/3"),
        (3 * math.pi / 2, "3π/2"),
        (math.pi / 32, "π/32"),
        (0.5, "0.5"),
        (0.123456, "0.123"),
        (-0.25, "−0.25"),
        (123.456, "123.5"),
        (float("inf"), "∞"),
        (float("-inf"), "−∞"),
        (float("nan"), "?"),
    ],
)
def test_fmt_num(value, expected):
    assert fmt_num(value) == expected


def test_fmt_val():
    from pennylane import numpy as pnp

    assert fmt_val(np.pi / 2) == "π/2"
    assert fmt_val(pnp.array(np.pi, requires_grad=True)) == "π"
    assert fmt_val(True) == "True"
    assert fmt_val("a") == '"a"'
    assert fmt_val([0, np.pi]) == "[0, π]"
    assert fmt_val(np.zeros(10)) == "[…]"
    assert fmt_val(None) == "None"


def test_pretty():
    assert pretty("theta") == "θ"
    assert pretty("phi_1") == "φ₁"
    assert pretty("angle") == "angle"
