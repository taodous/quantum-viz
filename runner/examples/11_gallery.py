import pennylane as qml
from pennylane import numpy as np

dev = qml.device("default.qubit", wires=["a", "b", "c"])


@qml.qnode(dev)
def gallery(theta):
    qml.Hadamard(wires="a")
    qml.S(wires="b")
    qml.adjoint(qml.T(wires="c"))
    qml.RX(theta, wires="a")
    qml.CRY(np.pi / 2, wires=["a", "b"])
    qml.ctrl(qml.Hadamard(wires="c"), control=["a", "b"], control_values=[1, 0])
    qml.Barrier()
    qml.SWAP(wires=["b", "c"])
    qml.CZ(wires=["a", "c"])
    qml.Toffoli(wires=["a", "b", "c"])
    return qml.expval(qml.PauliZ("a") @ qml.PauliZ("b")), qml.probs(wires=["c"])


print(gallery(0.3))
