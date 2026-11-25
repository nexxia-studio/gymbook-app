## QA — GYM-315 recharge après déploiement — 2026-11-25

Branche `nexxiastudio/gym-315-recharge-apres-deploiement` (commit `3294719`). Dashboard construit avec `npm run build` (vert), variables Supabase du profil staging passées par l'environnement du processus, sans `VITE_SENTRY_DSN`. Le build a été copié hors du dépôt et servi par un serveur statique local qui imite Vercel (tout chemin sans fichier renvoie `index.html` en 200 `text/html`, `Cache-Control: public, max-age=0, must-revalidate`). Navigateur : Google Chrome sans tête piloté par le protocole DevTools, clics souris réels sur le menu. Compte : gérant de test du staging, uniquement. Aucune donnée créée, modifiée ou supprimée.

Contrôle préalable : avant la saisie des identifiants, une garde réseau n'autorisait que le serveur local et l'hôte Supabase du staging ; seuls ces deux hôtes ont été appelés pendant toute la recette. Le build ne contient aucun autre hôte Supabase.

Comment sont comptées les recharges : (a) requêtes de document reçues par le serveur depuis le clic, (b) nombre de documents distincts vus dans l'onglet (`performance.timeOrigin`), (c) événements de navigation DevTools. Les trois concordent sur chaque ligne.

« Déploiement simulé » = le fichier JS de la page est renommé dans le dossier servi et sa référence corrigée dans le fichier d'entrée, comme un nouveau build ; l'onglet ouvert garde l'ancien nom.

| # | Scénario | Résultat | Preuve |
|---|---|---|---|
| 1 | Navigation interne après déploiement (Tableau de bord ouvert, fichier de Membres renommé, clic « Membres ») | PASS | 1 recharge exactement (1 requête de document sur `/members`, type de navigation `reload`). URL avant `/dashboard`, après `/members`. Page Membres affichée (13 membres), pas d'écran d'erreur. `viniz.chunkReload` présent : `{at, path:"/members", reason:"preload"}`. Capture : liste des membres, menu « Membres » actif. |
| 2 | Fichier réellement absent (Planning supprimé, références inchangées, clic « Planning ») | PASS | 1 recharge exactement (1 requête de document sur `/planning`), puis écran « Une erreur est survenue. » avec bouton « Recharger ». 11 s d'observation : aucun autre chargement. Capture : écran d'erreur Viniz seul. |
| 2b | Clic sur « Recharger » de l'écran d'erreur, fichier toujours absent | PASS | 1 chargement (celui du clic), écran d'erreur de nouveau, aucune recharge automatique derrière (6 s), marqueur inchangé. |
| 3 | Nouvel échec après plus de 30 s (57 s après le marqueur précédent, fichier de Revenus renommé, clic « Revenus ») | PASS | 1 recharge, `/dashboard` vers `/revenue`, page Revenus affichée, marqueur réécrit avec le nouvel horodatage et `path:"/revenue"`. |
| 3b | Nouvel échec DANS la fenêtre de 30 s (juste après la recharge du scénario 4, fichier de Formules renommé, clic « Formules ») | PASS | 0 recharge, 0 requête de document, écran d'erreur actuel affiché, marqueur inchangé. |
| 4 | L'URL est conservée avec paramètres et ancre (fichier de Communications renommé, navigation interne vers `/communications?q=1&onglet=test#ancre`) | PASS | 1 recharge ; URL après recharge strictement identique : `/communications?q=1&onglet=test#ancre` ; le serveur a reçu `/communications?q=1&onglet=test`. Page Communications affichée. Le marqueur ne garde que le chemin (`/communications`), sans paramètres. |
| 5 | Non-régression : navigation normale Planning, Membres, Formules, Revenus, Communications, Paramètres, Tableau de bord | PASS | 7 clics, 0 requête de document, même document du début à la fin, 0 erreur ou avertissement console, 0 requête en échec, 0 réponse 4xx/5xx. |
| 6 | Connexion puis déconnexion | PASS | Connexion : arrivée sur `/dashboard` (« Bonjour, Admin »). Déconnexion : retour sur `/login`, jeton de session retiré du stockage local, page protégée `/members` renvoie sur `/login`. Joué deux fois. Console vide. |
| 7 | Console sans DSN Sentry | PASS | Aucune erreur ni avertissement lié à Sentry sur l'ensemble de la recette (démarrage, connexion, recharge, déconnexion). |
| 8 | Hors ligne (DevTools `Network.emulateNetworkConditions offline`, marqueur vieux de 48 s donc hors fenêtre, clic « Paramètres ») | PASS | `navigator.onLine` à `false`, 0 recharge, 0 requête de document, écran d'erreur actuel, marqueur NON réécrit (valeur identique avant et après). Capture : écran d'erreur Viniz. |
| 9 | Double clic sur le menu pendant l'échec (fichier de Paramètres renommé) | PASS | 1 seule recharge, page Paramètres affichée. |
| 10 | Retour arrière après une recharge automatique (depuis `/members` rechargé) | PASS | Retour sur `/dashboard`, 0 recharge, console vide. |
| 11 | Pages publiques, déconnecté (`/login` ouvert, fichier de « Mot de passe oublié » renommé, clic sur le lien) | PASS | 1 recharge, `/login` vers `/forgot-password`, page affichée, pas d'écran d'erreur. |
| 12 | Scénario 1 en fenêtre mobile 390 x 844 (fichier de Membres renommé, clic « Membres » dans le menu) | PASS | 1 recharge, `/members` affiché. Voir la réserve de largeur dans « Hors spec ». |
| 13 | Pas d'éclair d'écran d'erreur avant la recharge | PASS | Un observateur du DOM posé avant le clic n'a jamais vu le texte « Une erreur est survenue » avant la recharge (scénarios 3, 4, 11, 12). |
| 13b | Module de page qui lève à son évaluation (contenu du fichier de Membres remplacé par `throw new Error('boom')`, aucun marqueur en place, clic « Membres ») | PASS | 0 recharge, 0 requête de document, même document pendant 10 s, écran « Une erreur est survenue. » avec « Recharger », `viniz.chunkReload` toujours absent. Console : `Error: boom` ; l'erreur n'est ni avalée ni rechargée (critères 1 et 3). Capture : écran d'erreur Viniz seul. |
| 14 | Session expirée au moment de la recharge | NON JOUÉ | Voir Recette manuelle. |
| 15 | `sessionStorage` indisponible (critère 2) | NON JOUÉ | Non simulable proprement dans cette recette ; couvert par les tests unitaires de la logique, à confirmer à la main (navigation privée Safari ancienne, stockage bloqué). |
| 16 | Safari (dont iPhone), Firefox | NON JOUÉ | Chrome seul disponible. Voir Recette manuelle. |
| 17 | Sentry réel (breadcrumb, filtrage, utilisateur) | NON JOUÉ | Recette faite sans DSN, par consigne. Voir Recette manuelle. |
| 18 | Vraie recette après deux déploiements Vercel successifs sur le staging | NON JOUÉ | Aucun déploiement autorisé. Voir Recette manuelle. |

### Échecs détaillés

Aucun scénario joué n'est en échec.

### Hors spec mais observé

- Console pendant un cas rechargé : Chrome écrit toujours sa propre ligne « Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html" ». C'est un message du navigateur, pas de l'application, et il n'y a aucune exception non rattrapée. Dans le cas du second échec (scénarios 2, 3b, 8), `TypeError: Failed to fetch dynamically imported module` apparaît en plus dans la console : attendu, c'est l'erreur qui va à l'écran d'erreur.
- Toutes les recharges observées portent `reason:"preload"` : dans Chrome, c'est l'événement `vite:preloadError` qui déclenche, jamais le rejet du `lazy()`. Le chemin `lazy` n'a donc pas été exercé dans le navigateur (seulement par les tests unitaires).
- Limite de la simulation : le fichier d'entrée `index-*.js` a été modifié sur place sans changer de nom (un vrai build le renomme aussi). Sans effet sur ce qui est testé, mais la recette après deux vrais déploiements reste nécessaire.
- Scénario 4 : le paramètre a été amené par `history.pushState` suivi d'un `popstate` (navigation interne du routeur), pas par un clic, aucun lien du menu ne portant de paramètre.
- Mobile 390 px, page Membres : la largeur de mise en page mesurée était de 617 px (débordement horizontal), alors que le Tableau de bord tient en 390 px. Mesuré sur un onglet chargé en bureau puis redimensionné, tiroir de menu ouvert : à confirmer sur un vrai téléphone. Sans rapport avec GYM-315.
- Sur l'écran d'erreur atteint sans recharge (hors ligne, module qui lève), le texte de la page contient un « 0 » isolé après « Recharger », invisible sur la capture. Sans conséquence visible.
- `apps/dashboard/dist` (ignoré par git) a été régénéré par le build, avec les valeurs du staging.

### Recette manuelle

**A. Safari (macOS et iPhone) et Firefox** — sur l'URL du dashboard de staging, après la manipulation D, ou en local avec le build servi comme ci-dessus.
1. Ouvrir le Tableau de bord, connecté. Laisser l'onglet ouvert.
2. Faire disparaître le fichier d'une page non visitée (nouveau déploiement).
3. Cliquer sur cette page dans le menu. Attendu : une recharge, même URL, page affichée, pas d'écran d'erreur. Dans l'inspecteur, `sessionStorage` contient `viniz.chunkReload`.
4. Messages à vérifier dans la console : Safari, `'text/html' is not a valid JavaScript MIME type` ou `Importing a module script failed` ; Firefox, `error loading dynamically imported module`. Chacun doit déclencher la recharge.
5. iPhone : même chose dans Safari, onglet laissé en arrière-plan pendant le déploiement puis rouvert (Safari peut recharger seul l'onglet : noter si c'est le cas). Vérifier aussi la navigation privée.
6. Rejouer le cas « toujours manquant » : une recharge puis l'écran d'erreur, pas de boucle pendant 10 s.

**B. Sentry réel** — build de staging avec `VITE_SENTRY_DSN`.
1. Cas rechargé (scénario 1) : aucun événement d'erreur dans Sentry pour ce chargement.
2. Provoquer ensuite une erreur quelconque dans les 30 s (ou le second échec) et ouvrir l'événement : il porte le breadcrumb `chunk-reload`, « Page rechargée : fichier de page introuvable après un déploiement », avec `path` (chemin seul, sans paramètres) et `reason`.
3. Second échec (scénario 2) : un événement d'erreur remonte bien (`Failed to fetch dynamically imported module` ou équivalent).
4. Après connexion : l'événement porte l'utilisateur par son id uniquement (ni email, ni nom). Idem après un rechargement de page avec session restaurée.
5. Après déconnexion, et après une sortie sur session morte : un événement provoqué sur `/login` ne porte plus d'utilisateur.
6. Hors ligne : l'erreur de chargement remonte (elle n'est pas filtrée, aucune recharge n'ayant eu lieu).

**C. Session expirée** — connecté, laisser expirer ou révoquer la session du compte de test, faire disparaître le fichier d'une page, cliquer. Attendu : une recharge, puis `/login` (pas d'écran d'erreur, pas de boucle), `Sentry.setUser(null)`.

**D. Vraie recette après deux déploiements Vercel sur le staging**
1. Déploiement 1 de la branche sur le staging. Ouvrir le dashboard, se connecter, rester sur le Tableau de bord sans visiter les autres pages.
2. Déploiement 2 avec une modification réelle d'une page (pour que son fichier change de nom). Attendre qu'il soit en ligne.
3. Dans l'onglet resté ouvert, cliquer sur la page modifiée. Attendu : une recharge, page affichée. Dans l'onglet Réseau : l'ancien fichier renvoie du `text/html` en 200, puis un seul rechargement du document.
4. Vérifier que `index.html` n'est pas servi depuis un cache périmé après la recharge (sinon la recharge retombe sur l'ancien build et l'écran d'erreur s'affiche : c'est hors périmètre de la spec, mais c'est ce qui ferait échouer la recette).
5. Attendre plus de 30 s, refaire un déploiement, cliquer sur une autre page : nouvelle recharge.
