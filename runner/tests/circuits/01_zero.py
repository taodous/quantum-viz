import pennylane as qml

dev = qml.device("default.qubit", wires=1)


@qml.set_shots(1000)
@qml.qnode(dev)
def circuit():
    return qml.counts()


print(circuit())
