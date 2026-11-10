/** What the gate tooltip says (ported from the prototype's INFO table). */

import type { AnyOp } from "./layout";
import { isMeas } from "./layout";

type Info = { t: string; d: string; pre?: string; m?: string[][] };

const rot = (ax: string): Info => ({
  t: `Rotation ${ax}`,
  d: `Tourne le qubit d'un angle θ autour de l'axe ${ax} de la sphère de Bloch. L'angle dose le mélange entre |0⟩ et |1⟩.`,
});

export const INFO: Record<string, Info> = {
  Hadamard: { t: "Hadamard", d: "Crée une superposition égale de |0⟩ et |1⟩ : 50 % / 50 % à la mesure.", pre: "1/√2", m: [["1", "1"], ["1", "−1"]] },
  PauliX: { t: "Pauli-X", d: "Le NOT quantique : échange |0⟩ et |1⟩.", m: [["0", "1"], ["1", "0"]] },
  PauliY: { t: "Pauli-Y", d: "Échange |0⟩ et |1⟩ en ajoutant une phase ±i.", m: [["0", "−i"], ["i", "0"]] },
  PauliZ: { t: "Pauli-Z", d: "Inverse le signe de |1⟩ et laisse |0⟩ intact.", m: [["1", "0"], ["0", "−1"]] },
  Identity: { t: "Identité", d: "Ne fait rien : le qubit reste tel quel.", m: [["1", "0"], ["0", "1"]] },
  S: { t: "Porte S", d: "Ajoute une phase i à |1⟩ (un quart de tour autour de Z).", m: [["1", "0"], ["0", "i"]] },
  T: { t: "Porte T", d: "Ajoute une phase e^(iπ/4) à |1⟩ (un huitième de tour autour de Z).", m: [["1", "0"], ["0", "e^(iπ/4)"]] },
  SX: { t: "Racine de X", d: "Appliquée deux fois, elle donne une porte X." },
  RX: { ...rot("X"), m: [["cos θ/2", "−i·sin θ/2"], ["−i·sin θ/2", "cos θ/2"]] },
  RY: { ...rot("Y"), m: [["cos θ/2", "−sin θ/2"], ["sin θ/2", "cos θ/2"]] },
  RZ: { ...rot("Z"), m: [["e^(−iθ/2)", "0"], ["0", "e^(iθ/2)"]] },
  PhaseShift: { t: "Décalage de phase", d: "Ajoute une phase e^(iφ) à |1⟩.", m: [["1", "0"], ["0", "e^(iφ)"]] },
  Rot: { t: "Rotation générale", d: "Trois rotations enchaînées RZ·RY·RZ : n'importe quelle porte à un qubit." },
  CNOT: {
    t: "CNOT",
    d: "Inverse la cible ⊕ seulement si le contrôle ● vaut |1⟩. Après un H, elle intrique les deux qubits.",
    m: [["1", "0", "0", "0"], ["0", "1", "0", "0"], ["0", "0", "0", "1"], ["0", "0", "1", "0"]],
  },
  CZ: {
    t: "Z contrôlée",
    d: "Inverse le signe de |11⟩. Symétrique : les deux qubits jouent le même rôle.",
    m: [["1", "0", "0", "0"], ["0", "1", "0", "0"], ["0", "0", "1", "0"], ["0", "0", "0", "−1"]],
  },
  CY: { t: "Y contrôlée", d: "Applique Y sur la cible si le contrôle vaut |1⟩." },
  CH: { t: "Hadamard contrôlée", d: "Applique H sur la cible si le contrôle vaut |1⟩." },
  SWAP: { t: "SWAP", d: "Échange l'état des deux qubits.", m: [["1", "0", "0", "0"], ["0", "0", "1", "0"], ["0", "1", "0", "0"], ["0", "0", "0", "1"]] },
  CSWAP: { t: "SWAP contrôlée (Fredkin)", d: "Échange les deux cibles si le contrôle vaut |1⟩." },
  CRX: { t: "RX contrôlée", d: "Applique RX(θ) sur la cible si le contrôle vaut |1⟩." },
  CRY: { t: "RY contrôlée", d: "Applique RY(θ) sur la cible si le contrôle vaut |1⟩." },
  CRZ: { t: "RZ contrôlée", d: "Applique RZ(θ) sur la cible si le contrôle vaut |1⟩." },
  ControlledPhaseShift: { t: "Phase contrôlée", d: "Ajoute une phase e^(iφ) à |11⟩." },
  Toffoli: { t: "Toffoli", d: "Inverse la cible seulement si les deux contrôles valent |1⟩." },
  CCZ: { t: "Z doublement contrôlée", d: "Inverse le signe de |111⟩." },
  MultiControlledX: { t: "X multi-contrôlée", d: "Inverse la cible si tous les contrôles sont satisfaits (● = |1⟩, ○ = |0⟩)." },
  GroverOperator: { t: "Diffuseur de Grover", d: "Amplifie l'amplitude de l'état marqué par l'oracle (inversion autour de la moyenne)." },
  FlipSign: { t: "Oracle FlipSign", d: "Inverse le signe de l'état recherché : c'est l'oracle de Grover." },
  QFT: { t: "Transformée de Fourier quantique", d: "Passe les qubits dans la base de Fourier : l'ingrédient de nombreux algorithmes." },
  Barrier: { t: "Barrière", d: "Séparation visuelle, sans effet sur les qubits." },
  measure: { t: "Mesure en cours de circuit", d: "Mesure ce qubit au milieu du circuit. Le résultat peut conditionner la suite." },
  probs: { t: "Probabilités", d: "Renvoie la probabilité de chaque résultat possible." },
  counts: { t: "Comptage", d: "Exécute le circuit N fois (shots) et compte combien de fois chaque résultat sort." },
  sample: { t: "Échantillons", d: "Renvoie le résultat brut de chaque exécution (shot)." },
  expval: { t: "Valeur moyenne", d: "Moyenne de l'observable mesuré : +1 pour |0⟩, −1 pour |1⟩ dans le cas de Z." },
  var: { t: "Variance", d: "Dispersion des résultats de l'observable mesuré." },
  state: { t: "Vecteur d'état", d: "Renvoie le vecteur d'état complet. Possible uniquement sur simulateur." },
  density_matrix: { t: "Matrice densité", d: "Renvoie la matrice densité des qubits choisis." },
};

export type TipContent = { title: string; signature: string; description: string; pre?: string; matrix?: string[][] };

const wireText = (key: string) => (key.startsWith("$") ? `"${key.slice(1)}"` : key.slice(1));

export function tipFor(op: AnyOp): TipContent {
  const meas = isMeas(op);
  const info: Info = INFO[op.name] ?? { t: op.name, d: meas ? "" : "Opération PennyLane affichée telle quelle." };
  const wires = [...op.controls, ...op.targets].map(wireText);
  const ws = meas && op.all ? "" : wires.length === 1 ? `wires=${wires[0]}` : `wires=[${wires.join(", ")}]`;
  const signature = meas
    ? `qml.${op.name}(${op.obs ? "qml." + op.obs.replace(/⊗/g, " @ ") : ws})`
    : `qml.${op.name}(${[...op.params, ws].filter(Boolean).join(", ")})`;
  const adjoint = op.label.endsWith("†");
  let title = info.t;
  if (op.extra) title += " · contrôlée";
  if (adjoint) title += " · adjointe";
  if (op.cond) title += " · conditionnelle";
  const plain = !op.extra && !adjoint;
  return { title, signature, description: info.d, pre: plain ? info.pre : undefined, matrix: plain ? info.m : undefined };
}
