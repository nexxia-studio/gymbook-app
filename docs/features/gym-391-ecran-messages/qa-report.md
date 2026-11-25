## QA — GYM-391, écran Messages (app membre) — 2026-11-25

Branche `nexxiastudio/gym-391-ecran-messages`, commit `ab6be10`.

**Aucun scénario n'a été joué dans l'interface.** Ce rapport ne contient donc que la recette manuelle, plus quelques constats faits sans lancer l'app (tests de logique, relecture du code), présentés à part et qui ne valent pas recette.

### Pourquoi rien n'a été joué

1. **Mot de passe du compte membre de test introuvable.** La variable `MOT_DE_PASSE_STAGING` n'est pas définie dans l'environnement. `apps/mobile/.env.test` n'existe pas (seul `.env.test.example` est présent). `apps/dashboard/.env.test` existe mais ne contient que des comptes gérant et admin (`STAGING_MOVE95_*`, `STAGING_STUDIO_*`, `STAGING_ADMIN_CLONE_*`, `STAGING_ADMIN_YOGA_*`) ; aucune de ces adresses n'est celle du compte membre de test. Ces comptes n'ont pas été utilisés, conformément à la consigne.
2. **Playwright CLI absent.** `playwright-cli` n'est pas installé, et `npx playwright` n'est pas disponible sans téléchargement du paquet (aucun `playwright` dans les `node_modules` du dépôt ; seuls des navigateurs sont en cache sur la machine).

La cause 1 suffit à elle seule : sans connexion, aucun des scénarios n'est observable. Expo web n'a donc pas été lancé.

### Ce qui a été établi sur l'environnement

- `apps/mobile/.env.local` pointe vers le même projet Supabase que le profil `preview-staging` de `eas.json` (références de projet identiques). C'est bien le staging. Les profils `production` de `eas.json` ne portent pas d'URL en clair, la comparaison avec la prod n'a donc pu se faire que par cette égalité avec le staging.
- Attention : `.env.local` ne définit ni `EXPO_PUBLIC_GYM_SLUG` ni `EXPO_PUBLIC_GYM_ID`, que le profil `preview-staging` définit. Pour une recette web en mode single, il faudra les passer par l'environnement du processus.

### Tableau des scénarios

| # | Scénario | Résultat | Preuve |
|---|---|---|---|
| 1 | Cloche : pastille avec le bon nombre, aucune à 0, « 9+ » au-delà de 9 | NON JOUÉ | pas de connexion possible |
| 2 | Liste : ordre, icônes, dates relatives, non lus en évidence | NON JOUÉ | idem |
| 3 | Toucher un message de cours à venir : lu, fiche du cours | NON JOUÉ | idem |
| 4 | Toucher un message de cours passé : lu, Mes réservations | NON JOUÉ | idem |
| 5 | Toucher une communication : lu, message en entier | NON JOUÉ | idem |
| 6 | Tout marquer comme lu : plus aucun non lu, pastille disparue | NON JOUÉ | idem |
| 7 | État vide | NON JOUÉ | idem |
| 8 | Tirer pour rafraîchir, pagination au-delà de 30 | NON JOUÉ | idem |
| 9 | Ouverture directe de `/messages/<id bidon>` : état introuvable | NON JOUÉ | idem |
| 10 | Console et réseau : erreurs, 4xx/5xx, forme des requêtes `notifications` | NON JOUÉ | idem |
| 11 | Textes : aucun tiret long, français correct, tutoiement | NON JOUÉ à l'écran | voir constats hors interface |
| 12 | Variante mobile 390 x 844 | NON JOUÉ | idem |
| 13 | Double toucher, retour arrière, session expirée | NON JOUÉ | idem |

### Échecs détaillés

Aucun échec constaté, faute d'exécution. Ce n'est pas un résultat favorable : rien n'a été observé.

### Constats hors interface (ne valent pas recette)

Faits sans lancer l'app, sans rien écrire en base ni dans les sources.

- Tests de logique pure : `npx tsx tests/messages.test.ts`, `tests/messagesData.test.ts`, `tests/messagesList.test.ts` passent tous les trois (lancés depuis `apps/mobile`). `npx tsc --noEmit` n'a pas été lancé.
- Relecture de `apps/mobile/lib/messages/api.ts` : les cinq requêtes sur `notifications` (page, message seul, compteur, marquer un, tout marquer) portent les deux filtres `member_id` et `gym_id`. Les deux UPDATE passent par `readPayload`, qui ne rend que `{ read: true, read_at: <date ISO> }`, et ajoutent le filtre « `read` n'est pas true ». Forme attendue sur le réseau, à confirmer en recette :
  - lecture : `GET /rest/v1/notifications?select=id,type,title,body,data,read,read_at,created_at&member_id=eq.<membre>&gym_id=eq.<salle>&order=created_at.desc.nullslast,id.desc` avec une plage de 30 lignes ;
  - compteur : `HEAD /rest/v1/notifications?select=id&member_id=eq.<membre>&gym_id=eq.<salle>&read=not.is.true` ;
  - marquage : `PATCH /rest/v1/notifications?id=eq.<message>&member_id=eq.<membre>&gym_id=eq.<salle>&read=not.is.true`, corps `{"read":true,"read_at":"…"}`.
- Relecture des textes ajoutés à `locales/fr.json` (bloc `messages`) : aucun « — » ni « – », tutoiement tenu (« Tu n'as aucun message pour le moment. », « Impossible de charger tes messages. », « Réessaie. »). Les titres et corps des messages viennent du serveur et n'ont pas été vus.
- `app/messages/index.tsx` branche bien un `RefreshControl` et un `onEndReached`. Sur web, le geste de tirer pour rafraîchir n'existe en général pas : à tester sur appareil.

### Recette manuelle sur appareil

Prérequis : build du profil `preview-staging` (app Dopamine sur le staging), compte membre de test, et un compte gérant de staging pour émettre des messages depuis le dashboard. Jamais la production. Idéalement, la boîte du compte contient plus de 30 messages, dont au moins 10 non lus et un de chaque type.

Jouer dans cet ordre, car l'étape 7 consomme tous les non lus.

1. **Cloche.** Ouvrir l'accueil. Attendu : pastille sur la cloche avec le nombre de non lus ; « 9+ » s'il y en a plus de 9. Noter le nombre. VoiceOver/TalkBack lit « Messages, N non lus » (« non lu » au singulier pour 1).
2. **Liste.** Toucher la cloche. Attendu : écran « Messages », du plus récent au plus ancien ; par ligne une icône selon le type, le titre, le corps, la date relative ; non lus visiblement distincts des lus. Vérifier les dates : « à l'instant », « il y a N min », « il y a N h », « hier », « il y a N j » jusqu'à 7 jours, puis jour et mois (année si différente).
3. **Cours à venir** (`booking_confirmed`, `waitlist_promoted`, `session_cancelled_by_gym`, `session_updated_by_gym`). Toucher un message non lu. Attendu : la fiche du cours s'ouvre. Retour à la liste : le message est passé en lu.
4. **Cours passé ou introuvable.** Toucher un message de cours déjà passé (ou d'un cours supprimé). Attendu : Mes réservations. Retour : message lu.
5. **Autres types.** Abonnement activé, paiement échoué, achat de crédits : Ma formule. Suspension pour no-show : Profil. Communication : le message en entier, avec titre, corps complet et date. Type inconnu : message en entier, icône générique. Chaque fois, le message passe en lu.
6. **Pastille qui diminue.** Revenir à l'accueil après chaque lecture. Attendu : le nombre a baissé d'autant ; à 9 ou moins, « 9+ » devient un chiffre.
7. **Tirer pour rafraîchir et pagination.** Tirer la liste vers le bas : indicateur, puis liste à jour (faire émettre un message par le gérant juste avant pour le voir apparaître). Faire défiler jusqu'en bas avec plus de 30 messages : la page suivante se charge, sans doublon ni trou. Couper le réseau puis faire défiler : pas d'indicateur qui clignote en boucle, message d'erreur lisible.
8. **Tout marquer comme lu** (en dernier). Toucher le bouton. Attendu : plus aucun non lu, le bouton disparaît, la pastille a disparu à l'accueil. En mode avion : « Impossible de tout marquer comme lu. Réessaie. » et rien ne change.
9. **État vide.** Avec un compte membre sans aucun message (compte neuf, ne rien supprimer en base). Attendu : « Tu n'as aucun message pour le moment. », pas de bouton « Tout marquer comme lu », pas de pastille.
10. **Message introuvable.** Ouvrir un lien profond vers `/messages/<identifiant inexistant>`. Attendu : « Ce message est introuvable. » et « Retour aux messages », sans écran blanc ni plantage. Essayer aussi avec l'identifiant d'un message d'une autre salle.
11. **Push en premier plan.** App ouverte sur l'accueil, faire émettre un message. Attendu : la pastille augmente sans action de l'utilisateur.
12. **Retour au premier plan.** Mettre l'app en arrière-plan, faire émettre un message, revenir. Attendu : pastille à jour.
13. **Tap à froid sur une notification.** App tuée, toucher la notification système. Attendu : même destination qu'avant cette branche pour le même type (la table du push est figée par un test) ; la pastille est juste une fois l'app ouverte.
14. **Bouton retour Android.** Depuis la liste : retour à l'accueil. Depuis un message en entier : retour à la liste. Depuis un écran ouvert par un message (fiche du cours, Ma formule) : retour cohérent, pas de sortie de l'app.
15. **Double toucher.** Toucher deux fois très vite un message : un seul écran s'ouvre, pas d'empilement.
16. **Session expirée et déconnexion.** Se déconnecter : la pastille disparaît. Se reconnecter avec un autre compte : aucun message ni compteur du compte précédent.
17. **Variante Viniz** (build `preview-viniz`, mode multi). Rendu de la cloche, de la pastille, de la liste et du message en entier aux couleurs Viniz, contrastes lisibles. Changer de salle : le compteur repart de zéro puis affiche celui de la nouvelle salle, la liste ne montre que les messages de cette salle.
18. **Accessibilité.** VoiceOver et TalkBack : la cloche, chaque ligne (état « Non lu » ou « Lu » annoncé), le bouton « Tout marquer comme lu », le retour. Zones tactiles confortables (44 pt).
19. **Textes.** Sur tous les écrans, en français puis en anglais : aucun « — » ni « – », tutoiement, pas de clé i18n brute affichée.
20. **Réseau** (si un proxy de débogage est branché). Aucune requête 4xx/5xx ; les requêtes vers `notifications` portent `member_id` et `gym_id` ; les PATCH n'envoient que `read` et `read_at`.

Types de messages non testés faute d'exécution : tous.

### Pour rejouer cette QA en automatique

- Fournir le mot de passe du compte membre de test par la variable d'environnement `MOT_DE_PASSE_STAGING` (ou dans `apps/mobile/.env.test`, ignoré par git).
- Installer Playwright CLI sur la machine.
