# Jalon 1 — Mesure de latence (10 novembre 2026)

**Question** : combien de temps entre l'envoi du code et le retour du circuit, si le code tourne dans Vercel Sandbox avec un vrai PennyLane ? Objectif : moins de 1,5 s après la pause de frappe.

**Réponse** : environ **80 ms** avec un processus Python préchauffé, joint par un port exposé. Le démarrage d'un nouveau processus Python à chaque exécution coûte environ **2 s** : il est écarté.

## Conditions

- Bac à sable : image `vercel/sandbox/python:3.14` + PennyLane 0.45.1 (Python 3.14.4), préinstallé dans un snapshot.
- Région `cdg1` (Paris), 1 vCPU, `networkPolicy: "deny-all"`, non persistant.
- Circuit : état de Bell (`H` + `CNOT`, `qml.probs`), légèrement modifié à chaque envoi pour imiter la frappe.
- Mesuré depuis un PC à Paris, en wifi domestique. Les temps incluent donc l'aller-retour internet.
- Reproduire : `pnpm sandbox:snapshot` (une fois) puis `pnpm sandbox:latency`.

## Résultats (ms)

| Mesure | médiane | p90 | max |
|---|---:|---:|---:|
| Aller-retour API Sandbox seul (`runCommand true`) | 461 | 686 | 686 |
| **Froid** : nouveau processus Python par exécution | 1 975 | 2 404 | 2 404 |
| dont `import pennylane` seul | 1 200 à 1 500 | | |
| dont exécution du circuit dans Python | 4 | 7 | 7 |
| **Chaud** via `runCommand` + petit client | 501 | 658 | 658 |
| **Chaud via port exposé** | **77** | 401 | 401 |
| dont duplication du processus + exécution dans le serveur | 16 | 17 | 17 |
| Rafale de 10 requêtes simultanées, 1 vCPU | 271 | 1 204 | 1 204 |
| Création d'un bac à sable depuis le snapshot | 758 | | 876 |
| Bac à sable neuf jusqu'au serveur prêt | 3 913 | | 3 913 |

Le p90 à 401 ms du port exposé correspond à la première requête, qui ouvre la connexion TLS. Les suivantes réutilisent la connexion.

## Ce qu'on en tire

1. **L'import de PennyLane coûte 1,2 à 1,5 s ; le circuit lui-même, 4 ms.** Un processus neuf par exécution dépasse l'objectif à lui seul. Il faut donc un processus préchauffé.
2. **Chaque appel à l'API Sandbox coûte environ 450 ms.** Passer par `runCommand` pour chaque exécution mange un tiers du budget. Le port exposé l'évite complètement : la fonction Vercel parle directement au serveur du bac à sable.
3. **Le port exposé fonctionne avec `deny-all`.** `deny-all` bloque les connexions sortantes du bac à sable, pas les requêtes entrantes sur le port exposé.
4. **Un bac à sable de 1 vCPU sert facilement plusieurs étudiants** : 16 ms de calcul par exécution. La rafale de 10 requêtes simultanées monte à 1,2 s au pire, ce qui reste dans l'objectif. La taille du pool sera fixée au jalon 8 (30 onglets).
5. **Remplacer un bac à sable prend environ 4 s.** Sur l'offre Hobby, une session dure au plus 45 min : le pool doit en démarrer un neuf avant que l'ancien n'expire, pour qu'aucune requête ne tombe dans le trou.

## Décision

**Serveur Python préchauffé dans chaque bac à sable, joint par un port exposé.**

- Au démarrage, le serveur importe PennyLane et exécute un circuit d'échauffement.
- À chaque requête, il se duplique (`fork`), et le processus dupliqué lance un processus de travail qui exécute le code de l'étudiant. Il le tue au bout de 5 s s'il ne répond pas (`RLIMIT_CPU` en plus). Il renvoie toujours du JSON.
- `/api/run` (fonction Vercel en `cdg1`) envoie le code en HTTP au serveur d'un bac à sable du pool. L'API Sandbox ne sert qu'à créer, surveiller et remplacer les bacs à sable.

Le prototype de ce serveur est dans `runner/latency/warm_server.py`. Il sera réécrit proprement dans le runner au jalon 2.

## À traiter au jalon 4 (sécurité du port exposé)

L'URL du port exposé est publique : sans protection, quelqu'un qui la connaît peut exécuter du code dans le bac à sable sans passer par le code de séance ni par la limite de débit. Mesures prévues :

- Un jeton aléatoire par bac à sable, vérifié par le serveur sur chaque requête. Le jeton est effacé de la mémoire du processus de travail avant d'exécuter le code de l'étudiant.
- Le code de l'étudiant tourne sous un utilisateur Linux sans droits, séparé du serveur. Il ne peut donc pas lire la mémoire du serveur.
- Remplacement régulier des bacs à sable (de toute façon imposé par la limite de 45 min).

Le bac à sable n'a ni secret ni accès réseau sortant : même en cas de fuite du jeton, le risque se limite à consommer du temps de calcul dans ce bac à sable.

## Points restants

- La mesure part d'un PC. En production, le trajet sera navigateur → fonction Vercel (`cdg1`) → bac à sable (`cdg1`). Le second tronçon reste dans la même région, donc on attend un ordre de grandeur similaire. À confirmer au jalon 4.
- Avertissement à l'import sous Python 3.14 : `SyntaxWarning` dans `autograd`. Il ne gêne rien, mais il faudra le filtrer pour qu'il n'apparaisse pas dans la sortie de l'étudiant.
- Consommation de l'offre Hobby (heures de calcul Sandbox) : à surveiller dans le tableau de bord Vercel, onglet Usage, après la répétition générale.
