# Hello Quantum — visualiseur de circuits PennyLane

## Le projet

Site web pour les workshops d'initiation au calcul quantique animés par Tao (EQCE). L'étudiant colle du code Python PennyLane dans une zone de saisie ; le site affiche le circuit quantique correspondant, mis à jour tout seul pendant la frappe, et l'histogramme des mesures en dessous.

- **Public** : étudiants débutants, en séance, chacun sur son PC via une URL. Rien à installer.
- **Échéance** : Workshop 1 « Hello Quantum » le **19 novembre 2026**. La première version doit être en ligne et testée avant.
- **Périmètre de la v1** : les circuits du Workshop 1 (1 à 3 qubits). Les modules suivants (Grover, circuits paramétrés, QAOA) viendront après : ne pas les bloquer par l'architecture, ne pas les optimiser maintenant.

Circuits que la v1 doit afficher parfaitement (ce sont les tests de recette) :

1. Un qubit, aucune porte, mesure → 100 % `|0⟩`
2. `PauliX` → 100 % `|1⟩`
3. `Hadamard` → 50/50
4. `RY(angle)` appelé avec 0, π/4, π/2, π (boucle sur une liste d'angles)
5. `H` puis `Z` puis `H` ; `H` puis `H`
6. Deux qubits, `H` sur le premier seulement
7. État de Bell : `H` + `CNOT` ; l'autre état de Bell avec un `X` en plus
8. Challenge : `RY(2*np.arccos(np.sqrt(0.25)))` → doit s'afficher `RY(2π/3)`
9. Teaser : Grover sur 3 qubits écrit avec des sous-fonctions `oracle()` / `diffusion()`

## Le prototype fait foi pour le design

`docs/prototype/hello-quantum.html` est un prototype en un seul fichier, validé par Tao (« tu as parfaitement compris ce que je voulais »). **Il définit l'identité visuelle et le comportement attendu. On le porte, on ne le redessine pas.**

À conserver à l'identique :

- Thème sombre spatial et sobre : ciel étoilé en canvas, panneaux en verre dépoli, palette et typographies du bloc `:root` (Space Grotesk + JetBrains Mono).
- Deux panneaux : éditeur à gauche, circuit à droite ; empilés sous 880 px.
- Rendu SVG du circuit : fils, portes colorées par famille, `|0⟩` au départ de chaque fil, fil classique doublé après une mesure, comète lumineuse sur les fils, apparition animée des seules portes nouvelles.
- Angles lisibles : multiples de π affichés en fraction (`π/4`, `2π/3`), sinon 3 décimales.
- Encadré nommé autour des portes produites par une sous-fonction (`oracle`, `diffusion`).
- Un onglet par appel du circuit quand le code l'appelle plusieurs fois.
- Lien code ↔ circuit : survoler une porte surligne sa ligne de code ; placer le curseur sur une ligne illumine ses portes.
- Infobulle par porte : nom, rôle en une phrase en français, matrice.
- Respect de `prefers-reduced-motion`.

À jeter : le mini-interpréteur Python en JavaScript du prototype (`QEngine`). Il imite Python et ne couvre qu'un sous-ensemble. Seules ses fonctions d'affichage (`fmtNum`, `pretty`) et tout le code de mise en page et de dessin (`layout`, `draw`, `drawItem`) sont à porter en TypeScript.

## Décisions prises avec Tao

| Sujet | Décision |
|---|---|
| Moteur | Vrai Python + vrai PennyLane côté serveur. Le circuit affiché est celui que PennyLane a réellement construit. |
| Usage | Site en ligne, une URL pour toute la classe. |
| Hébergement | Vercel. Le code des étudiants tourne dans Vercel Sandbox, jamais dans le processus de l'API. |
| Accès | Code de séance : il faut saisir un code donné en cours avant de pouvoir exécuter. Pas de comptes. |
| Frontend | Next.js (App Router) + TypeScript. |
| Déclenchement | Automatique après une pause de frappe, avec indicateur de chargement. Pas de bouton Exécuter. |
| Affichage | Le circuit, plus l'histogramme des mesures toujours visible sous le circuit. Rien d'autre (pas de sphère de Bloch, pas de pas à pas). |
| Erreur | Le dernier circuit valide reste affiché en grisé, le message d'erreur s'affiche par-dessus, dans le panneau du circuit. |
| Message d'erreur | Une phrase claire en français avec le numéro de ligne, et le message Python d'origine dépliable en dessous. |
| Templates | `GroverOperator`, `QFT`, etc. : une boîte nommée, qu'un clic déplie en portes élémentaires. |

## Architecture

```
Navigateur (Next.js)
  éditeur ──(pause de frappe)──> POST /api/run  { code }
                                    │  vérifie le code de séance + limite de débit
                                    ▼
                         Vercel Sandbox (microVM, réseau coupé)
                           python runner.py  ← exécute le code avec PennyLane
                                    │  JSON : circuits + résultats, ou erreur
                                    ▼
  panneau circuit + histogramme <── réponse JSON
```

- `app/` : interface Next.js. `app/api/run/route.ts` orchestre le bac à sable avec `@vercel/sandbox`. `app/api/session/route.ts` valide le code de séance.
- `runner/` : programme Python exécuté **dans** le bac à sable. Reçoit le code de l'étudiant, renvoie un JSON sur stdout. Testable seul, sans Vercel.
- `lib/circuit/` : types du contrat JSON, mise en page, formatage des angles. Fonctions pures, testées.
- `components/` : éditeur, scène du circuit (SVG), histogramme, bandeau d'erreur, ciel.

### Le runner Python

Rôle : exécuter le code, intercepter chaque appel de QNode, sérialiser ce que PennyLane a construit.

- Exécuter le code avec `compile(code, "<circuit>", "exec")` pour que les numéros de ligne des erreurs et des portes se rapportent au code de l'étudiant.
- Intercepter la création et l'appel des `qml.QNode` pour enregistrer chaque appel : nom, arguments, opérations, mesures, résultat renvoyé.
- Pour chaque opération : nom, libellé, paramètres, fils de contrôle et fils cibles, valeurs de contrôle, adjoint, ligne de code d'origine, sous-fonction d'origine, et sa décomposition quand elle en a une (pour la boîte dépliable).
- Sortie : **un seul objet JSON sur stdout**, toujours. Tout `print` de l'étudiant est capturé à part et ne doit jamais polluer ce JSON.
- Toute exception est attrapée et convertie en erreur structurée. Le runner ne se termine jamais sur une trace Python brute.

L'API interne de PennyLane pour obtenir la bande d'opérations change selon les versions. **Lire la documentation de la version installée avant d'écrire l'interception, ne pas coder de mémoire.** Épingler la version de PennyLane.

### Contrat JSON

Reprendre la forme du modèle de circuit du prototype pour porter le moteur de rendu sans le réécrire.

```ts
type RunResponse =
  | { ok: true; circuits: Circuit[]; stdout: string; durationMs: number }
  | { ok: false; error: RunError };

type Circuit = {
  name: string;            // "bell"
  label: string;           // "circuit(π/4)" : un onglet par appel distinct
  wires: { key: string; label: string }[];
  ops: Op[];
  meas: Op[];              // mesures finales
  shots: number | null;
  histogram: { state: string; value: number }[] | null;  // "00" → 0.498
  histogramKind: "counts" | "probs" | null;
};

type Op = {
  name: string;            // nom PennyLane : "RY", "CNOT"
  label: string;           // affiché dans la porte : "RY", "X", "S†"
  family: "h" | "pauli" | "rot" | "phase" | "neutral" | "meas";
  shape: "box" | "oplus" | "dot" | "swap" | "meter" | "state" | "barrier";
  params: string[];        // déjà formatés : ["π/4"]
  controls: string[]; controlValues: number[]; targets: string[];
  line: number;            // ligne dans le code de l'étudiant
  group: { id: number; name: string } | null;   // sous-fonction d'origine
  children: Op[] | null;   // décomposition, pour les boîtes dépliables
};

type RunError = {
  kind: "syntax" | "runtime" | "pennylane" | "timeout" | "limit" | "infra";
  message: string;         // phrase en français, pour un débutant
  line: number | null;
  python: string | null;   // message Python d'origine, dépliable
};
```

## Fail-safe : règle absolue

**Le panneau du circuit ne doit jamais rester vide, figé ou cassé.** Quoi qu'il arrive, il affiche soit un circuit à jour, soit le dernier circuit valide grisé avec un message d'erreur lisible par-dessus.

Tous les cas doivent aboutir à ce même affichage :

| Cas | Origine | Message attendu (exemple) |
|---|---|---|
| Code qui ne compile pas | runner, `kind: "syntax"` | « Ligne 7 · Parenthèse ouverte jamais refermée » |
| Erreur à l'exécution | runner, `runtime` | « Ligne 9 · `thet` n'est pas défini » |
| Erreur PennyLane | runner, `pennylane` | « Ligne 6 · Le qubit 2 n'existe pas : le device a 2 qubits (0, 1) » |
| Boucle infinie, code trop long | runner ou API, `timeout` | « Exécution interrompue après 5 s : boucle infinie ? » |
| Circuit ou sortie trop gros | runner, `limit` | « Circuit trop grand pour être affiché » |
| Bac à sable indisponible | API, `infra` | « Le serveur d'exécution ne répond pas. Nouvel essai… » |
| Réseau coupé, réponse illisible | navigateur | « Connexion perdue. Ton code est conservé. » |
| Bug du rendu | navigateur, `ErrorBoundary` autour de la scène | « Affichage impossible pour ce circuit » + détail dépliable |

Règles :

- Une erreur dans le code de l'étudiant est une réponse **normale** : HTTP 200 avec `ok: false`. Les codes 4xx/5xx sont réservés à l'accès refusé et aux pannes.
- Le message français vient d'une table de correspondance par type d'exception (`SyntaxError`, `IndentationError`, `NameError`, `TypeError`, `ZeroDivisionError`, erreurs de fils PennyLane…). Type inconnu : phrase générique + message Python dans le détail. Ne jamais afficher une trace Python complète en premier niveau.
- Le numéro de ligne est celui du code de l'étudiant, extrait du cadre `<circuit>` de la trace.
- Ne pas faire clignoter d'erreur pendant la frappe : l'erreur ne s'affiche qu'à la réponse de l'exécution déclenchée après la pause.
- Réponses dans le désordre : seule la réponse de la **dernière** requête est affichée. Annuler les requêtes précédentes (`AbortController`).
- Ligne fautive surlignée dans l'éditeur, comme dans le prototype.
- Le code saisi est sauvegardé dans le navigateur à chaque frappe : une panne ne fait jamais perdre le travail.

## Histogramme

- Toujours visible sous le circuit dès qu'il y a un résultat à montrer. Le circuit reste l'élément principal.
- Source : ce que le circuit renvoie. `qml.counts` / `qml.sample` → fréquences observées sur N shots. `qml.probs` → probabilités.
- Une barre par état de base, étiquetée en ket (`|00⟩`), y compris les états à 0 % : en séance, « jamais `|01⟩` ni `|10⟩` » doit se voir.
- Même palette et même sobriété que le circuit. Pourcentage lisible sur chaque barre.
- Suit l'onglet sélectionné quand le circuit est appelé plusieurs fois.

## Sécurité et limites

Le site exécute du code arbitraire venu d'internet. Non négociable :

- Le code de l'étudiant ne s'exécute **que** dans Vercel Sandbox. Jamais de `eval`, `exec`, `child_process` ou `subprocess` sur ce code dans le processus de l'API.
- Bac à sable : `networkPolicy: "deny-all"`, `vcpus: 1`, délai court, aucun secret ni variable d'environnement du projet à l'intérieur.
- Image avec PennyLane préinstallé (snapshot ou image personnalisée) : aucun `pip install` au moment de l'exécution.
- Limites par exécution : 5 s de calcul, taille du code, nombre de qubits, nombre d'opérations, taille de la sortie.
- `/api/run` refuse toute requête sans cookie de séance valide. Le code de séance vient d'une variable d'environnement, le cookie est signé et `httpOnly`. Limite de débit par session.

## Jalons

1. **Mesure de latence d'abord.** Avant toute interface : un script qui lance le runner dans Vercel Sandbox sur l'état de Bell et mesure le temps de bout en bout. Objectif : circuit affiché en moins de 1,5 s après la pause de frappe. Importer PennyLane dans un nouveau processus à chaque exécution risque d'être trop lent ; si c'est le cas, garder un processus préchauffé dans le bac à sable qui se duplique à chaque requête. Décider sur mesure, pas sur intuition.
2. Runner Python + tests sur les 9 circuits de recette, en local.
3. Portage du rendu du prototype en composants React, alimenté par des JSON de test.
4. API `/api/run` + bac à sable + code de séance.
5. Fail-safe complet : chaque ligne du tableau ci-dessus a un test.
6. Histogramme.
7. Boîtes dépliables pour les templates.
8. Répétition générale : 30 onglets ouverts en même temps pendant 10 minutes.

## Points à vérifier avant de s'engager

- **Version de Python** : l'image Sandbox par défaut fournit Python 3.14. Vérifier que la version de PennyLane choisie le prend en charge ; sinon installer un autre Python avec `uv` dans l'image.
- **Offre Vercel** : l'offre gratuite limite à 10 bacs à sable simultanés et 45 minutes par session. Une classe de 30 ne peut pas avoir un bac à sable par étudiant : prévoir un petit groupe de bacs à sable partagés, recréés automatiquement, où chaque exécution est un processus séparé. Demander à Tao quelle offre il utilise.
- **API Vercel Sandbox** : lire la documentation à jour (`@vercel/sandbox`) avant d'écrire l'orchestration.

## Hypothèses par défaut (non confirmées par Tao, à lui signaler si elles posent question)

- QNode défini mais jamais appelé : sans paramètre obligatoire, le runner l'appelle lui-même ; avec paramètres obligatoires, le panneau affiche une aide (« Appelle ton circuit, par exemple `circuit(np.pi/4)` »), pas une erreur.
- Circuit qui ne renvoie ni `counts`, ni `sample`, ni `probs` (par exemple `expval`) : l'histogramme montre les probabilités théoriques des états, avec une étiquette qui le précise.
- Pas de repli hors ligne sur l'interpréteur JavaScript du prototype.
- Interface en français. Code, noms et commits en anglais.
- Éditeur : CodeMirror 6 (coloration Python, indentation), stylé comme le prototype.
- Pas de base de données, pas de sauvegarde côté serveur du code des étudiants.

## Façon de travailler

- Tao est étudiant et anime ces workshops : expliquer les choix techniques en français, simplement.
- Commandes : `pnpm dev`, `pnpm test` (Vitest), `pnpm lint`, `uv run pytest` dans `runner/`. Mettre cette liste à jour dès que les scripts existent.
- Tout changement du runner ou de la mise en page s'accompagne d'un test. Les 9 circuits de recette sont des tests permanents.
- Vérifier le rendu dans un vrai navigateur avant de dire qu'un changement visuel est terminé, en comparant avec le prototype.
- Ne pas ajouter de fonctionnalité hors périmètre (sphère de Bloch, pas à pas, comptes, partage de liens) sans demander.