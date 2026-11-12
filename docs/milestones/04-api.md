# Jalon 4 — API, bacs à sable et code de séance (10 novembre 2026)

**Résultat** : le site exécute pour de vrai le code des étudiants. Après le code de séance, chaque pause de frappe envoie le code à `/api/run`, qui le fait tourner dans un bac à sable Vercel et renvoie le circuit. Testé en local contre le vrai Vercel Sandbox ; **pas encore déployé** (voir « Mise en ligne »).

## Ce qui se passe à chaque exécution

```
navigateur ── pause de 450 ms ──> POST /api/run { code }
   │  (requête précédente annulée)        │ cookie de séance valide ? limite de débit ?
   │                                       ▼
   │                         pool : choisit un bac à sable prêt
   │                                       │ POST + jeton propre à ce bac à sable
   │                                       ▼
   │                         serveur Python préchauffé (root)
   │                           └─ processus de travail sous `nobody` : code de l'étudiant
   ▼                                       │
circuit, ou dernier circuit valide grisé + message  <── JSON
```

## Le pool de bacs à sable, sans base de données

Problème : Vercel peut lancer plusieurs copies de la fonction `/api/run` en même temps, et elles ne partagent pas leur mémoire. Il faut pourtant qu'elles utilisent les mêmes bacs à sable (offre Hobby : 10 au maximum en même temps).

Solution : **des noms fixes, calculés à partir de l'heure.** Le temps est découpé en tranches de 30 min. Les bacs à sable de la tranche n°E s'appellent `qv-<version>-<clé>-<E>-<n>`. Toutes les copies de la fonction calculent les mêmes noms : la première qui en a besoin crée le bac à sable, les autres le retrouvent par son nom (un nom n'existe qu'une fois ; Vercel refuse le doublon avec une erreur 400).

- Un bac à sable vit 45 min (maximum Hobby). Ceux de la tranche suivante sont créés pendant les 3 dernières minutes de la tranche en cours, s'il y a de l'activité. Tant qu'ils ne répondent pas, l'ancienne tranche continue de servir. 3 min après le début de la nouvelle tranche, les anciens sont arrêtés.
- Au plus 2 × la taille du pool existent en même temps : 4 avec la taille par défaut (2).
- `<version>` change avec le code du runner et le snapshot : un déploiement qui modifie le runner part sur des bacs à sable neufs.
- Saisir le code de séance démarre le pool en arrière-plan : le premier circuit de la séance n'attend pas la création.
- Si un bac à sable ne répond plus, la fonction réessaie une fois sur un autre, puis le navigateur réessaie seul (« Le serveur d'exécution ne répond pas. Nouvel essai… »).

## Sécurité du port exposé (prévue au jalon 1, faite)

L'adresse du serveur dans le bac à sable est publique. Mesures, toutes vérifiées dans un vrai bac à sable par `pnpm sandbox:pool-check` :

| Mesure | Vérifié |
|---|---|
| Jeton par bac à sable, `HMAC(SESSION_SECRET, nom)`. Le bac à sable ne reçoit que son empreinte SHA-256 | requête sans jeton ou avec un faux jeton → 401 |
| Le serveur tourne en root, le code de l'étudiant sous `nobody` (uid 65534) | ne peut ni lire l'environnement du serveur, ni le tuer, ni lire `/root` |
| Limites par exécution : 5 s de CPU, ~600 Mo de mémoire en plus, 64 processus, fichiers de 8 Mo | boucle infinie → coupée à 5,1 s ; `numpy.ones(4e8)` → « Mémoire insuffisante » |
| `networkPolicy: "deny-all"`, aucune variable d'environnement dans le bac à sable | pas de connexion sortante |

Risque restant, accepté : un étudiant très avancé pourrait fouiller la mémoire de son propre processus et y retrouver le jeton de la requête en cours. Ce jeton ne permet que d'exécuter du code dans ce bac à sable, pendant au plus 45 min, ce qu'il peut déjà faire avec le code de séance.

## Code de séance

- `POST /api/session` compare le code (majuscules et espaces ignorés : il est dicté en cours) et pose un cookie `hq_session` signé, `httpOnly`, valable 12 h. Changer `SESSION_CODE` invalide tous les cookies.
- 8 essais par adresse IP, puis 1 toutes les 10 s.
- `/api/run` : 401 sans cookie valide. Limite : 20 exécutions d'affilée, puis 1 par seconde et par session. Ces compteurs sont en mémoire dans chaque copie de la fonction : ils arrêtent un script qui s'emballe, pas un attaquant déterminé.

## Mesures (depuis un PC à Paris, serveur Next.js local)

| Mesure | Temps |
|---|---:|
| Premier appel, pool froid (création + démarrage du serveur) | 4,2 à 4,6 s |
| Exécution de Bell via le pool, médiane (10 essais) | 95 ms |
| `/api/run` de bout en bout, pool chaud | 150 à 220 ms |
| Deux copies de la fonction créent le pool en même temps | 1 seul bac à sable créé |

## Mise en ligne (à faire par Tao)

1. Dans le projet Vercel, Settings → Environment Variables (Production et Preview) :
   - `SESSION_CODE` : le code à donner en cours.
   - `SESSION_SECRET` : une longue chaîne aléatoire (au moins 32 caractères), par exemple le résultat de `openssl rand -hex 32`.
   - `SANDBOX_SNAPSHOT_ID` : la valeur `snapshotId` de `.sandbox/snapshot.json`.
2. Déployer. La fonction tourne à Paris (`cdg1`, dans `vercel.json`), comme les bacs à sable.
3. Après une séance, `pnpm sandbox:stop` arrête les bacs à sable restants (sinon ils s'arrêtent seuls au bout de 45 min).

En local, `pnpm dev` fonctionne sans rien configurer : code de séance `quantum`, snapshot lu dans `.sandbox/snapshot.json`, pool d'un seul bac à sable.

## Points restants

- Latence en production (fonction `cdg1` → bac à sable `cdg1`) : à mesurer après le premier déploiement. Attendu : un peu mieux qu'en local.
- ~~Tests du tableau fail-safe ; dernier circuit valide perdu au rechargement~~ : faits au jalon 5 (`05-06-failsafe-histogram.md`).
