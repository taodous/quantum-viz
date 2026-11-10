import pennylane as qml

dev = qml.device("default.qubit", wires=1, shots=1000)


@qml.qnode(dev)
def circuit():
    qml.Hadamard(wires=0)
    return qml.counts()


print(circuit())
