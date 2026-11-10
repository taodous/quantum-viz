import pennylane as qml

dev = qml.device("default.qubit", wires=2)


@qml.set_shots(1000)
@qml.qnode(dev)
def bell():
    qml.Hadamard(wires=0)
    qml.CNOT(wires=[0, 1])
    return qml.counts()


@qml.set_shots(1000)
@qml.qnode(dev)
def bell_other():
    qml.Hadamard(wires=0)
    qml.PauliX(wires=1)
    qml.CNOT(wires=[0, 1])
    return qml.counts()


print(bell())
print(bell_other())
