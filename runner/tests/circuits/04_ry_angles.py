import pennylane as qml
from pennylane import numpy as np

dev = qml.device("default.qubit", wires=1)


@qml.qnode(dev)
def circuit(angle):
    qml.RY(angle, wires=0)
    return qml.probs(wires=0)


for angle in [0, np.pi / 4, np.pi / 2, np.pi]:
    print(angle, circuit(angle))
