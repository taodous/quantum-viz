# Jalon 8 — Répétition générale (script prêt le 12 novembre 2026)

## But

Vérifier, avant le 19 novembre, que le site déployé tient une classe entière : 30 étudiants qui tapent du code en même temps pendant 10 minutes.

## Le script

```
HQ_SESSION_CODE=<code de séance> pnpm rehearsal
```

Ce que fait chaque étudiant simulé, comme dans le navigateur :

1. Il arrive pendant la première minute, comme une classe qui ouvre la page, et saisit le code de séance.
2. Il choisit un des 9 circuits de recette et l'écrit petit à petit. À chaque pause de frappe (entre 2 et 9 s), le code tel qu'il est à ce moment part vers `/api/run` : souvent incomplet, donc souvent en erreur de syntaxe, comme en vrai.
3. Une fois le circuit complet, il fait quelques retouches (une faute de frappe puis sa correction, une modification sans effet), puis lit le résultat et passe au circuit suivant.

Tous les étudiants simulés partent de la même adresse IP, comme une classe derrière le réseau de l'école.

Toutes les 30 s, le script affiche le nombre d'exécutions, les temps de réponse (médiane, 95 %, maximum) et le type des réponses. À la fin, il donne quatre verdicts :

| Vérification | Pourquoi |
|---|---|
| Tous les étudiants sont entrés | Le code de séance ne doit bloquer personne |
| 95 % des circuits en moins de 1,5 s, hors premier circuit | Objectif du jalon 1 |
| Aucune requête perdue (réseau, 5xx, 429) | Le fail-safe saurait l'afficher, mais il ne doit pas servir en séance normale |
| Chaque circuit de recette complet répond `ok` | Le bon circuit, pas seulement une réponse rapide |

Le premier circuit de chaque étudiant est compté à part, parce qu'il peut attendre la création des bacs à sable (environ 4 à 5 s, une seule fois par séance).

Options :

- `--students 1 --minutes 1` : mesure de la latence en production (le point restant du jalon 4) ;
- `--url http://localhost:3000 --code quantum` : essai en local ;
- `--rampup <s>` : durée d'arrivée des étudiants.

## Problème trouvé en écrivant le script, corrigé

Le code de séance était limité à 8 essais par adresse IP, **essais réussis compris**, puis 1 toutes les 10 s. Une classe derrière une seule IP aurait attendu : le 30e étudiant serait entré au bout de 3 min 40 s environ. Désormais, seuls les **mauvais** codes comptent (`app/api/session/route.ts`, test `route.test.ts` : 40 connexions depuis la même IP passent toutes).

**Cette correction n'est pas encore en production : redéployer avant la répétition.**

## Essai en local (12/11, 3 étudiants, 1 min, vrai Vercel Sandbox)

| Mesure | Valeur |
|---|---:|
| Circuits après le premier : médiane / 95 % / max | 75 ms / 110 ms / 139 ms |
| Requêtes perdues | 0 |
| Circuits de recette complets en erreur | 0 |

## Résultats en production

À remplir après `HQ_SESSION_CODE=… pnpm rehearsal`.

Ce qu'il faudra regarder :

- Les 95 % dépassent 1,5 s → passer `SANDBOX_POOL_SIZE` à 3 ou 4 dans Vercel. L'offre Hobby autorise 10 bacs à sable : avec 4, on en a au plus 8 pendant les relèves de tranche.
- Des réponses 429 → la limite de 20 exécutions d'affilée puis 1 par seconde est trop stricte.
- Ensuite, `pnpm sandbox:stop` pour arrêter les bacs à sable de la répétition.
