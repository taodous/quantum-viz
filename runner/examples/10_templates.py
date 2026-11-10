import pennylane as qml

dev = qml.device("default.qubit", wires=3)


@qml.set_shots(1000)
@qml.qnode(dev)
def grover_template():
    for w in range(3):
        qml.Hadamard(wires=w)
    qml.FlipSign([1, 0, 1], wires=[0, 1, 2])
    qml.GroverOperator(wires=[0, 1, 2])
    qml.QFT(wires=[0, 1])
    return qml.counts()


print(grover_template())
