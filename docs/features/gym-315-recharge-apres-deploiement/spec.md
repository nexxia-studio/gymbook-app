# GYM-315 : le dashboard se recharge seul quand un fichier de page a disparu après un déploiement

Tickets : GYM-315, GYM-392 (doublon, constat Sentry du 23/11).

## Constat

Chaque page du dashboard est chargée par `lazy()` (`apps/dashboard/src/App.tsx`), dans un fichier dont le nom change à chaque build. Un onglet ouvert avant un déploiement demande l'ancien fichier, qui n'existe plus : Vercel renvoie `index.html`, le navigateur refuse de l'exécuter, et `Sentry.ErrorBoundary` (`src/main.tsx`) affiche l'écran d'erreur. Un rechargement suffit à tout réparer.

Erreurs vues : `Failed to fetch dynamically imported module` (Chrome), `'text/html' is not a valid JavaScript MIME type` (Safari), `Importing a module script failed` (Safari), et l'événement `vite:preloadError`.

## Critères d'acceptation

1. Quand le chargement d'une page échoue pour cette raison (événement `vite:preloadError` ou rejet d'un `lazy()`, dont le message est l'un de ceux ci-dessus, `error loading dynamically imported module` de Firefox ou `Unable to preload CSS for` de Vite), la page est rechargée UNE fois, à la même URL (chemin, paramètres et ancre conservés). L'événement `vite:preloadError` part aussi quand un module de page lève à son évaluation : seul le message décide, jamais l'événement à lui seul.
2. Anti-boucle dans `sessionStorage` : une seule recharge par fenêtre de 30 secondes. Si l'erreur revient dans cette fenêtre, on ne recharge pas et l'ErrorBoundary actuel s'affiche, inchangé. Si `sessionStorage` est indisponible (lecture ou écriture qui lève), on ne recharge pas : mieux vaut l'écran d'erreur qu'une boucle. Hors ligne (`navigator.onLine === false`), on ne recharge pas non plus et le marqueur n'est pas écrit : recharger enverrait sur la page hors-ligne du navigateur.
3. Une erreur qui n'est pas un échec de chargement de fichier n'est jamais avalée ni rechargée : elle suit le chemin actuel.
4. Sentry : le cas rechargé ne remonte plus comme une erreur. Il laisse un breadcrumb, posé au démarrage qui suit la recharge (un breadcrumb posé avant `reload()` serait perdu avec la page). Le second échec, celui qui affiche l'ErrorBoundary, remonte toujours comme une erreur.
5. `Sentry.setUser({ id })` dès qu'une session est connue (connexion, session restaurée au démarrage), avec l'id seulement. `Sentry.setUser(null)` à la déconnexion, y compris la sortie sur session morte.
6. `npm run build` (`tsc -b && vite build`) vert. `npm run lint` sans nouvelle erreur par rapport à `develop`.
7. Tests de la logique pure (reconnaissance de l'erreur, décision de recharge selon l'horodatage), en script `npx tsx`, comme `src/tests/logo-colors.test.ts`.

## Hors périmètre

- `apps/links` (statique, aucun import dynamique).
- Les règles de réécriture Vercel, l'en-tête de cache d'`index.html`.
- `environment` et `release` de Sentry.

## Scénarios

1. Construire, servir, ouvrir une page. Reconstruire avec un fichier de page renommé (ou supprimer le fichier de page du build servi), puis changer de page dans l'onglet resté ouvert : la page se recharge et s'affiche, sans écran d'erreur.
2. Fichier réellement absent (toujours manquant après la recharge) : une seule recharge, puis l'écran d'erreur actuel. Pas de boucle.
3. Après 30 secondes, un nouvel échec recharge de nouveau.
4. La recharge conserve l'URL (chemin et paramètres).
