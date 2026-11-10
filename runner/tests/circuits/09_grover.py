import pennylane as qml
from pennylane import numpy as np

n = 3
dev = qml.device("default.qubit", wires=n)


def oracle():
    # Marque l'état |101⟩ en inversant son signe
    qml.PauliX(wires=1)
    qml.ctrl(qml.PauliZ(wires=2), control=[0, 1])
    qml.PauliX(wires=1)


def diffusion():
    for w in range(n):
        qml.Hadamard(wires=w)
        qml.PauliX(wires=w)
    qml.ctrl(qml.PauliZ(wires=2), control=[0, 1])
    for w in range(n):
        qml.PauliX(wires=w)
        qml.Hadamard(wires=w)


@qml.set_shots(1000)
@qml.qnode(dev)
def grover():
    for w in range(n):
        qml.Hadamard(wires=w)
    for _ in range(2):
        oracle()
        diffusion()
    return qml.counts()


print(grover())
