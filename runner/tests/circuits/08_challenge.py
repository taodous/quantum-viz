import pennylane as qml
from pennylane import numpy as np

dev = qml.device("default.qubit", wires=1)


@qml.qnode(dev)
def circuit():
    # On veut 25 % de |0⟩ et 75 % de |1⟩
    qml.RY(2 * np.arccos(np.sqrt(0.25)), wires=0)
    return qml.probs(wires=0)


print(circuit())
