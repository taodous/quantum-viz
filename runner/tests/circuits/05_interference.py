import pennylane as qml

dev = qml.device("default.qubit", wires=1)


@qml.qnode(dev)
def hzh():
    qml.Hadamard(wires=0)
    qml.PauliZ(wires=0)
    qml.Hadamard(wires=0)
    return qml.probs(wires=0)


@qml.qnode(dev)
def hh():
    qml.Hadamard(wires=0)
    qml.Hadamard(wires=0)
    return qml.probs(wires=0)


print("HZH :", hzh())
print("HH  :", hh())
