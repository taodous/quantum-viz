# Jalons 5 et 6 — Fail-safe complet et histogramme (12 novembre 2026)

## Jalon 5 : chaque ligne du tableau fail-safe a son test

Les tests « navigateur » sont dans `components/failsafe.test.tsx`. Chacun ouvre le vrai `Workbench` avec une réponse simulée de `/api/run` et vérifie la même chose : le dernier circuit valide est toujours dessiné, grisé (histogramme compris), et le message en français s'affiche par-dessus.

| Cas | Côté runner / API (message) | Côté navigateur (affichage) |
|---|---|---|
| Code qui ne compile pas | `test_errors.py::test_syntax_errors` | `syntax error (runner)` : vérifie aussi la ligne surlignée dans l'éditeur et le message Python replié |
| Erreur à l'exécution | `test_name_error_with_suggestion` | `runtime error (runner)` |
| Erreur PennyLane | `test_wire_outside_device_points_at_the_gate` | `PennyLane error (runner)` |
| Boucle infinie | `test_modes.py::test_server_times_out_infinite_loops` (Linux : `pnpm sandbox:test-runner`) | `infinite loop (runner timeout)` |
| Circuit ou sortie trop gros | `test_too_many_operations`, `test_output_too_big_becomes_a_limit_error` | `circuit too big (runner limit)` |
| Bac à sable indisponible | `lib/server/run.test.ts` (503, nouvel essai sur un autre bac à sable) | `sandbox unavailable (API 503)` : message, puis nouvel essai automatique réussi |
| Réseau coupé, réponse illisible | — | `connection lost / unreadable answer` : code conservé, page HTML 502 traitée comme une coupure, nouvel essai |
| Bug du rendu | — | `rendering bug (browser)`, et `SafeRender.test.tsx` (le circuit suivant se dessine de nouveau) |

### Ce qui a été ajouté

- **`components/SafeRender.tsx`** : le garde-fou (« error boundary ») autour du circuit et de l'histogramme. Si un circuit ne peut pas être dessiné, le circuit dessiné juste avant reste à l'écran, grisé, avec « Affichage impossible pour ce circuit » et le détail replié. Le circuit suivant est retenté normalement. Si même l'ancien dessin échoue, il reste au moins le message.
- Les chiffres sous le circuit (qubits, portes, profondeur) ne peuvent plus faire planter la page si le JSON est abîmé.
- **Le dernier circuit valide est sauvegardé dans le navigateur** (`hello-quantum:last-good`). Après un rechargement avec du code en erreur, c'est le circuit de l'étudiant qui apparaît en grisé, plus l'exemple de départ. Si le code n'a pas changé depuis, le circuit est réaffiché sans relancer d'exécution : 30 rechargements simultanés en séance ne sollicitent pas le serveur.
- Deux nouvelles fixtures d'erreur produites par le vrai runner : `e3_name`, `e4_limit` (`pnpm fixtures`).

## Jalon 6 : histogramme

- `components/Histogram.tsx`, sous le circuit, dans le même panneau. Fonctions pures dans `lib/circuit/histogram.ts`.
- Une barre par état de base, **y compris les états à 0 %** (barre vide, étiquette atténuée) : pour Bell, l'absence de `|01⟩` et de `|10⟩` se voit.
- Échelle absolue de 0 à 100 % : un 50/50 donne deux demi-barres, pas deux barres pleines.
- Pourcentage en français sur chaque barre (`49,3 %`). Une valeur minuscule mais non nulle s'écrit `< 0,1 %`, jamais `0 %`.
- Légende selon la source : « résultats sur 1000 mesures » (`counts`/`sample`), « probabilités » (`probs`), « probabilités théoriques » (ni l'un ni l'autre, par exemple `expval`). Le survol de la légende explique la différence.
- Couleur dorée des mesures (`--gold`), barres qui montent à l'apparition, désactivé avec `prefers-reduced-motion`.
- Suit l'onglet sélectionné. Grisé avec le circuit en cas d'erreur.
- Au-delà de 16 états (5 qubits et plus, hors Workshop 1) : affichage compact, le ket n'est plus que dans l'infobulle.
- Sous 880 px, le panneau du circuit passe à 600 px de haut (au lieu de 420 px) pour laisser la place à l'histogramme.

Vérifié dans Chrome (Bell, Grover, erreur de syntaxe tapée dans l'éditeur, exécutée pour de vrai dans Vercel Sandbox, puis corrigée ; largeur 390 px).
