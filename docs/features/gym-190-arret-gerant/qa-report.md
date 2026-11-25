## QA — GYM-190 arrêt d'un abonnement par le gérant — 2026-11-25

Branche `nexxiastudio/gym-190-arret-gerant` (commit `751bddc`). Dashboard construit hors du dépôt (`tsc -b` vert, `vite build --outDir` vers le dossier de travail), variables Supabase du staging passées par l'environnement du processus, sans `VITE_SENTRY_DSN`. Servi par un serveur statique local. Navigateur : Google Chrome 158 sans tête, piloté par le protocole DevTools, clics souris réels. Compte : gérant de test du staging, salle « Dopamine (Staging Clone) », uniquement. Aucune donnée créée, modifiée ou supprimée. Aucun déploiement, aucune migration, aucun appel à l'API Mollie.

**Contexte.** La fonction `admin-stop-subscription` et la migration ne sont pas déployées sur le staging. Vérifié : l'appel répond 404 dès le préflight. L'arrêt réel n'a donc pas été joué. Les scénarios 2 à 7 de la spec sont NON JOUÉS de bout en bout (voir « Non joué » et « Recette manuelle »).

**Garde réseau.** Posée avant la saisie des identifiants et gardée jusqu'à la fin. Elle ne laisse passer que le serveur local et l'hôte Supabase du staging. Sur le staging : lectures, connexion et déconnexion, et l'appel d'aperçu (`dry_run: true`) seulement. Toute autre écriture aurait été bloquée et journalisée : la garde n'a rien eu à bloquer. Le build ne contient qu'un seul hôte Supabase, celui du staging.

**Deux niveaux de preuve, à ne pas confondre.**
- **Réel** : le dashboard de la branche contre les vraies données du staging, en lecture.
- **Simulé** : la réponse de `admin-stop-subscription` est fabriquée dans le navigateur (la requête ne quitte pas la machine), et la lecture de l'abonnement est parfois réécrite à l'arrivée pour montrer un statut `canceling`. Cela prouve le comportement du dashboard face à une réponse conforme à la spec. Cela ne prouve rien sur la fonction.

Pour le scénario 2, les abonnements de la salle ont été lus en une requête de lecture avec la session du gérant (mêmes droits que le dashboard), puis chaque fiche a été ouverte à l'écran.

Les membres sont désignés par leurs initiales. AM = compte de test `+r1`. MD = compte de test « member.dopamine ».

### Scénarios joués en réel

| # | Scénario | Résultat | Preuve |
|---|---|---|---|
| 1 | Connexion gérant, liste des membres, ouverture d'une fiche | PASS | Arrivée sur `/dashboard`, liste de 13 membres, 6 fiches ouvertes une à une. Section « Abonnement » présente sur chacune. Console vide, 0 requête en échec, 0 réponse 4xx/5xx. Captures `01-apres-connexion`, `02-membres`, `10-fiche-ligne-*`. |
| 2 | Un abonnement récurrent actif existe ; le bouton est visible sur sa fiche | PASS | Il en existe deux, avec identifiant d'abonnement et de client Mollie : AM (« Illimité 6 mois », prochaine échéance le 22/12/2026) et MD (« Illimité 3 mois », prochaine échéance le 09/12/2026). Bouton rouge « Arrêter l'abonnement » sous la carte, sur les deux fiches. Capture `11-fiche-ligne-0-abonnement`. |
| 3 | Bouton absent sans abonnement et pour un abonnement payé en une fois | PASS | Absent sur 2 fiches sans abonnement (« Aucun abonnement ») et sur 2 fiches « Illimité 12 mois » payé en une fois (statut « Actif »). |
| 4 | Bouton absent sur un abonnement `canceling` | NON JOUÉ | Aucun abonnement `canceling` sur le staging (6 lignes : 2 actifs récurrents, 2 actifs payés en une fois, 2 expirés). Couvert en simulé : S7. |
| 5 | Badge « Se termine le {date} » sur un abonnement `canceling` réel | NON JOUÉ | Même raison. Couvert en simulé : S6, S7. |
| 6 | Hook de la fiche : jamais la carte d'abonnement d'un autre membre | PASS | 9 séquences, chaque changement du DOM enregistré. Souris (ouvrir, fermer, ouvrir, 40 à 80 ms entre les gestes) : A,B,A ; A,C,D ; D,A,B,A,D. Bascule directe sans fermer, réponses de A retenues 1,5 à 2 s pour qu'elles arrivent après celles de B : A,B ; A,D (deux récurrents) ; A,B,A. Fiche fermée pendant son chargement. Résultat : sous le nom de X, la carte montre « Chargement... » puis l'abonnement de X, jamais autre chose. Le bouton d'arrêt n'apparaît jamais sur une fiche qui n'y a pas droit. Captures `20-R1-juste-apres-B`, `21-R4-B-avant-reponse-tardive-de-A`, `21-R4-B-apres-reponse-tardive-de-A`. |
| 7 | Hook de la fiche : crédits et nom jamais ceux du membre précédent | FAIL | Le solde de crédits du membre précédent reste affiché sous le nom du nouveau jusqu'à la fin du chargement. Le nom du précédent apparaît une image (9 ms mesurés). Antérieur à la branche. Voir Échecs détaillés. |
| 8 | Hook de la fiche : état final, fermer puis rouvrir | PASS | Sur les 9 séquences, l'état final (nom, abonnement, crédits, bouton) est celui du membre ouvert, y compris quand la réponse retardée de A arrive après celle de B. Fermer puis rouvrir la même fiche : « Chargement... » puis les bonnes données. |
| 9 | « Vendre une formule » et « Ajuster les crédits » s'ouvrent toujours | PASS | Les deux modales s'ouvrent (« Encaisser » et « Valider » désactivés tant que rien n'est choisi), se ferment par « Annuler », la fiche reste ouverte et inchangée. Rien validé. Captures `30-modale-vendre`, `30-modale-ajuster`. |
| 10 | Clic sur « Arrêter l'abonnement », fonction absente : message clair | PASS | Bandeau rouge sous les dates de la carte : « L'action n'a pas abouti. Réessaie ; si le problème persiste, contacte le support. » Pas de modale, pas d'écran blanc, aucun texte technique à l'écran, la fiche reste ouverte, le bouton reste. Le message disparaît en changeant de fiche et ne suit pas sur une autre. Joué sur AM et MD. Capture `40-fr-arret-ligne-1-clic-simple`. |
| 11 | Requête partie au clic | PASS | `POST {staging}/functions/v1/admin-stop-subscription`, corps `{ subscription_id, member_id, dry_run: true }`, rien d'autre. `subscription_id` = l'abonnement actif du membre affiché, `member_id` = le membre affiché (vérifié sur les deux fiches). Statut : le préflight `OPTIONS` répond 404, le navigateur n'envoie donc pas le `POST` (`net::ERR_FAILED`, refus CORS). Voir « Hors spec ». |
| 12 | Un seul appel par clic | PASS | Clic simple : 1. Double clic : 1. Quatre clics en rafale : 1. Sur les deux fiches. |
| 13 | Anglais : libellé du bouton | PASS | « Stop subscription ». Message d'échec : « The action did not go through. Try again; if it keeps failing, contact support. » Le badge en anglais n'a été vu qu'en simulé (S9). |
| 14 | Aucun « — » ni « – » dans les nouveaux textes | PASS | 28 textes nouveaux par langue (bouton, badge, modale, toasts, 10 refus) : aucun tiret long ni demi-cadratin, en `fr` et en `en`. Idem sur tous les textes vus à l'écran pendant la recette. Le test `test:stop-subscription` passe (« jamais de tiret long »). |
| 15 | Non-régression des textes d'erreur existants | FAIL | La clé `edge_errors.PAYMENT_NOT_RECORDED` existe maintenant deux fois dans `fr.json` et `en.json`. Le texte de la vente au comptoir est écrasé. Voir Échecs détaillés. |
| 16 | Console et réseau sur l'ensemble du parcours réel | PASS | Aucune exception, aucun avertissement. Seules erreurs : le 404 du préflight et l'échec du `POST` de la fonction absente, attendus. Seuls hôtes appelés : serveur local et staging. |

### Scénarios joués en simulé (réponse de la fonction fabriquée dans le navigateur)

| # | Scénario | Résultat | Preuve |
|---|---|---|---|
| S1 | Aperçu accepté : la modale s'ouvre | PASS | Titre « Arrêter l'abonnement ? », sous-titre « {nom} · Illimité 3 mois », « Date de fin 9 décembre 2026 » (pour `2026-12-08T23:00Z`, soit minuit à Bruxelles), avertissement « Les prélèvements s'arrêtent. Pour revenir, le membre devra souscrire une nouvelle formule. ». Réservations : « Aucune réservation ne sera annulée. », « 1 réservation sera annulée. », « 3 réservations seront annulées. ». Capture `50-fr-modale-apercu`. |
| S2 | Motif obligatoire | PASS | Confirmation désactivée sans motif et avec des espaces seuls ; active dès un caractère ; champ coupé à 500 caractères, compteur à jour. Échap et « Ne pas arrêter » ferment la modale sans fermer la fiche et sans rien envoyer. À la réouverture, le motif est vide. |
| S3 | Refus rendus par l'aperçu, affichés en clair, sans modale | PASS | 13 cas, 1 appel chacun, bandeau sur la carte : `PAYMENT_IN_FLIGHT`, `PAYMENT_NOT_RECORDED`, `NOT_STOPPABLE`, `NOT_RECURRING`, `END_DATE_UNKNOWN`, `MOLLIE_READ_FAILED`, `MOLLIE_NOT_CONNECTED`, `NOT_FOUND`, `FORBIDDEN`, `SERVER_ERROR` ont chacun leur phrase ; un code inconnu et deux réponses 200 hors contrat (date illisible, réponse d'arrêt reçue à la place d'un aperçu) donnent le message générique. Capture `51-fr-refus-prelevement-en-cours`. |
| S4 | Aperçu « déjà arrêté » (`already: true`) | PASS | Pas de modale. Toast « Cet abonnement est déjà arrêté. La fiche a été mise à jour. », fiche rechargée. Capture `52-fr-deja-arrete`. |
| S5 | Échec à la confirmation (`MOLLIE_STOP_FAILED`, 502) | PASS | Pendant l'envoi : bouton « Arrêt en cours… » désactivé, champ motif désactivé, Échap sans effet. Après : erreur dans la modale (« Mollie n'a pas confirmé l'arrêt des prélèvements : rien n'a été modifié. Réessaie dans quelques instants. »), motif conservé, confirmation de nouveau possible. Corps envoyé : `{ subscription_id, member_id, reason }`, motif rogné, sans `dry_run`. Capture `53-fr-echec-dans-la-modale`. |
| S6 | Succès, double clic sur la confirmation (réponse retenue 1,2 s) | PASS | Double clic puis deux clics de plus : 1 seul appel d'arrêt. Toast « Abonnement arrêté. Il se termine le 9 décembre 2026. », modale fermée, fiche rechargée. Avec la relecture réécrite en `canceling` : badge « Se termine le 9 décembre 2026 », ligne des dates « 09 nov. 2026 → 09 déc. 2026 », bouton disparu. Une réservation en échec dans la réponse : avis ambre persistant « 1 réservation n'a pas pu être annulée, à annuler à la main. », qui ne suit pas sur une autre fiche. Capture `54-fr-apres-arret-badge`. |
| S7 | Badge `canceling` : cohérence des dates et fuseau | PASS | Lecture réécrite en `canceling`, date de fin de la base : « Se termine le 9 février 2027 » face à « → 09 févr. 2027 » (MD), « Se termine le 22 mai 2027 » face à « → 22 mai 2027 » (AM). Bouton absent. Navigateur réglé sur Los Angeles, fin à `2026-12-14T23:00Z` : « 15 décembre 2026 » des deux côtés. Navigateur réglé sur Tokyo, fin à `2027-06-30T22:00Z` (heure d'été) : « 1 juillet 2027 » et « 01 juil. 2027 ». Sans date de fin : libellé « Résiliation en cours », « → ∞ ». Captures `55-fr-badge-se-termine-le`, `55-fr-badge-fuseau-navigateur-different`. |
| S8 | Aperçu tardif après changement de fiche | PASS | Aperçu de MD retenu 2,5 s ; pendant ce temps, fermeture puis ouverture de AM : la modale ne s'ouvre jamais sur AM, aucun bandeau. Le bouton de AM répond tout de suite et son appel porte l'abonnement et le `member_id` de AM. Aller-retour AM (aperçu lancé), autre fiche, retour AM : la modale ne s'ouvre pas sans nouveau clic. |
| S9 | Anglais : modale, toast, badge | PASS | « Stop this subscription? », « End date 9 December 2026 », « 3 bookings will be cancelled. », « Reason (required) », « Keep subscription » / « Stop subscription », « Stopping… », toast « Subscription stopped. It ends on 9 December 2026. », badge « Ends on 9 February 2027 ». |
| S10 | Fenêtre mobile 390 x 844 : fiche et modale | PASS | Fiche en pleine largeur, pas de débordement horizontal dans la fiche, bouton d'arrêt entier (286 px). Modale entière à l'écran, champ motif et bouton de confirmation visibles. Captures `70-mobile-fiche-abonnement`, `71-mobile-modale`. Voir la réserve de largeur de la page Membres dans « Hors spec ». |
| S11 | Session expirée au clic (401 simulé, deux fois) | PASS | Un rejeu exactement (2 appels), puis session fermée et retour sur `/login`. Pas d'écran blanc, pas d'exception. Capture `60-session-expiree`. |

Décompte : **23 PASS** (12 en réel, 11 en simulé), **2 FAIL**, **11 NON JOUÉS** (lignes 4 et 5 ci-dessus, et les 9 points de « Non joué »).

### Échecs détaillés

> **Après la QA** (corrections faites par l'orchestrateur, non rejouées par le qa-tester) :
> - Échec 1 corrigé : le refus de l'arrêt s'appelle désormais `RENEWAL_NOT_RECORDED` (fonction, dashboard, spec). La clé `PAYMENT_NOT_RECORDED` de la vente au comptoir n'existe de nouveau qu'une fois et a retrouvé son texte. Vérifié par lecture du JSON et par un contrôle de clés en double sur `fr.json` et `en.json`.
> - Échec 2 traité : au changement de membre, le hook vide aussi les crédits, les ajustements, les paiements et les réservations. Vérifié par le build seulement, pas à l'écran.
> - Dans ce rapport, lire `RENEWAL_NOT_RECORDED` là où il est écrit `PAYMENT_NOT_RECORDED` pour l'arrêt d'abonnement.

**Scénario 15 : le texte d'erreur de la vente au comptoir est écrasé (régression de la branche).**
- Constat : `apps/dashboard/src/locales/fr.json` et `en.json` portent deux fois la clé `PAYMENT_NOT_RECORDED` dans `edge_errors` (lignes 1411 et 1426). La seconde gagne à la lecture du JSON. Sur `develop`, la clé n'existe qu'une fois.
- Le code est partagé par deux fonctions, avec deux sens : `admin-sell-plan` (500, l'encaissement au comptoir n'a pas pu être enregistré) et `admin-stop-subscription` (409, un prélèvement Mollie vient d'être encaissé).
- Attendu, quand une vente au comptoir échoue avec ce code : « L'encaissement n'a pas pu être enregistré. Rien n'a été débité ni crédité : réessaie. »
- Obtenu (valeur retenue dans le build) : « Un prélèvement vient d'être encaissé et n'est pas encore enregistré. Réessaie dans quelques minutes. » Le gérant qui vient d'encaisser en espèces lit qu'un prélèvement a été encaissé, et attend au lieu de réessayer.
- Reproduire : `node -e 'console.log(JSON.parse(require("fs").readFileSync("apps/dashboard/src/locales/fr.json","utf8")).edge_errors.PAYMENT_NOT_RECORDED)'`. Même résultat en anglais. Non joué à l'écran : il faudrait faire échouer une vente, donc écrire.
- `KNOWN_EDGE_ERROR_CODES` liste aussi le code deux fois, sans effet.

**Scénario 7 : solde de crédits et nom du membre précédent affichés un court instant (antérieur à la branche).**
- Reproduire : ouvrir la fiche d'un membre à 10 crédits, attendre le chargement, fermer, ouvrir la fiche d'un membre à 0 crédit.
- Attendu : jamais une donnée du précédent sous le nom du nouveau.
- Obtenu : « Solde restant 10 » sous le nom du second membre pendant le chargement (85 ms mesurés sans retard ; toute la durée du chargement quand le réseau est lent, 2 s avec des réponses retenues 2 s). Pendant ce temps la carte d'abonnement affiche bien « Chargement... », pas la section Crédits. Capture `22-credits-du-precedent-pendant-chargement` : fiche du membre à 10 crédits, « Solde restant 0 » (celui du précédent).
- Le nom et l'email du membre précédent apparaissent aussi une image (9 ms) à l'ouverture d'une autre fiche, avant d'être remplacés.
- Cause lue dans le code : la branche remet à zéro l'abonnement au changement de membre (pendant le rendu), pas les crédits, les lignes de crédits ni l'historique des ajustements ; l'identité est recopiée dans un effet. `develop` se comporte de la même façon : ce n'est pas une régression.
- Conséquence : « Vendre une formule » et « Ajuster » sont cliquables pendant cette fenêtre et reçoivent le solde périmé comme « Solde actuel » (lu dans le code, pas joué). L'état final est toujours correct, et le serveur recalcule.

### Hors spec mais observé

- **Fonction absente : pourquoi le message générique.** Le staging répond 404 au préflight `OPTIONS`. Le navigateur refuse alors d'envoyer le `POST` : le dashboard ne reçoit aucun code et affiche le message générique. C'est le bon comportement. Une fois la fonction déployée, ce cas disparaît.
- **Session expirée (S11)** : le gérant arrive sur `/login` sans phrase qui explique pourquoi. Comportement commun à toutes les fonctions (GYM-227), pas propre à GYM-190.
- **Langue** : le dashboard n'a pas de sélecteur une fois connecté. Le seul est sur l'écran de connexion, et le choix n'est pas gardé après un rechargement de page (rien dans `localStorage`).
- **Anglais** : la ligne des dates de la carte reste en français (« 09 nov. 2026 → 09 févr. 2027 ») à côté du badge « Ends on 9 February 2027 ». `fmtDate` est figé sur `fr-BE`. Antérieur à la branche.
- **Premier du mois** : « Se termine le 1 juillet 2027 », pas « 1er juillet ». C'est le format de `Intl` en `fr-BE`.
- **Tirets longs hors périmètre** : la formule de test « Illimité 12 mois — paiement unique » porte un tiret long dans son nom (donnée de la salle, visible sur la fiche). Le webhook d'abonnement en écrit aussi dans des textes vus par le membre, antérieurs à la branche : libellé Mollie « {formule} — Dopamine Performance Club », « Mandat SEPA — {formule} », objet de l'email « Abonnement activé — {formule} ».
- **Libellé Mollie codé en dur** : « Dopamine Performance Club » est écrit dans le code du webhook, quelle que soit la salle. Antérieur à la branche.
- **Textes des refus** : le dashboard affiche ses propres phrases, au tutoiement (« Attends son résultat avant de l'arrêter. »), pas le message de la fonction cité dans la spec (« Réessayez quand il sera encaissé ou rejeté. »). Sens identique.
- **Mobile 390 px** : la page Membres déborde (largeur de mise en page 617 px), déjà signalé dans le rapport GYM-315. La fiche et la modale, elles, tiennent en 390 px.
- **Après un refus**, le bouton d'arrêt reste et la fiche se recharge en silence. Attendu.

### Non joué, et pourquoi

Tout ce qui suit demande la fonction et la migration sur le staging. Aucun déploiement n'était autorisé. Rien n'a été contourné.

| # | Scénario | Renvoi |
|---|---|---|
| N1 | Spec 2 : la modale montre la vraie date de fin et le vrai nombre de réservations | Recette B, étape 2 |
| N2 | Spec 3 : confirmation, succès, badge, bouton disparu, sur de vraies données | Recette B, étapes 4 et 5 |
| N3 | Spec 4 : réservations d'après la date de fin annulées, celles d'avant conservées, liste d'attente promue | Recette B, étape 6 |
| N4 | Spec 5 : double clic sur la confirmation, un seul arrêt et une seule notification côté serveur | Recette B, étape 7 |
| N5 | Spec 6 : abonnement déjà annulé dans Mollie | Recette B, étape 9 |
| N6 | Spec 7 : notification dans l'app et email | Recette B, étape 8 |
| N7 | Prélèvement en cours (`PAYMENT_IN_FLIGHT`) et paiement encaissé pas encore enregistré (`PAYMENT_NOT_RECORDED`) | Recette B, étape 10 |
| N8 | Second appel après l'arrêt (aperçu, puis reprise) | Recette B, étape 11 |
| N9 | Paiement test qui arrive après l'arrêt (alerte, statut inchangé) | Recette B, étape 12 |

Non joué aussi : Safari et Firefox (Chrome seul disponible), vrai téléphone.

### A. Créer un abonnement récurrent Mollie de test sur le staging

Décrit en lisant le code (`supabase/functions/create-subscription`, `mollie-subscription-webhook`, `apps/mobile/lib/payments.ts`). **Je ne l'ai pas fait.** Le staging en porte déjà deux (AM et MD) : le parcours y a donc déjà fonctionné, mais je n'ai pas vérifié leur état dans le tableau de bord Mollie de test.

Prérequis, à vérifier avant de commencer :
- Secrets des fonctions du staging : `MOLLIE_TEST_MODE=true` et `MOLLIE_TEST_API_KEY` (clé `test_…`). Sans la clé, `create-subscription` répond 500 `CONFIG_ERROR`. Incertain : je n'ai pas lu les secrets. `MOLLIE_WEBHOOK_SECRET` doit aussi être posé, sinon le webhook rejette l'appel.
- En mode test, c'est la clé de test qui sert, pas la connexion Mollie de la salle. Les abonnements créés se voient dans le tableau de bord Mollie du compte auquel appartient cette clé, en mode test.
- La salle a une formule récurrente active (« Mensuel récurrent » dans Formules). Sur la salle de test : « Illimité 3 mois » et « Illimité 6 mois » ont servi aux deux abonnements existants. Incertain : je n'ai pas vérifié qu'elles sont encore en vente.
- Les informations légales de facturation de la salle sont complètes, et son plan Viniz autorise les paiements en ligne (sinon 409 `GYM_LEGAL_IDENTITY_INCOMPLETE` ou 403 `PLAN_PAYMENTS_DISABLED`).
- Un compte membre de test de cette salle, sans abonnement `active`, `canceling`, `past_due` ou `paused` (sinon 409). AM et MD en ont déjà un : prendre un autre compte, ou en créer un.
- Le parcours se joue depuis l'app membre (build `preview-staging`). Le dashboard ne vend au comptoir que des formules à paiement unique.

Parcours :
1. App membre, connecté avec le compte de test : Formules, choisir la formule récurrente, souscrire. L'app appelle `create-subscription` avec `gym_id`, `member_id`, `plan_id`, `redirect_url`.
2. La fonction crée le client Mollie s'il n'existe pas, puis un premier paiement `sequenceType: 'first'` (moyens : prélèvement, Bancontact, carte), et enregistre une ligne `payments` en `pending`. Elle renvoie l'URL de paiement.
3. Sur l'écran de test Mollie, choisir un moyen puis le statut **« Paid »**.
4. Mollie appelle `mollie-subscription-webhook`. Sur ce premier paiement payé, le webhook : enregistre le mandat, crée l'abonnement Mollie (`interval: '1 month'`, `times` = durée moins 1, `startDate` = prochaine échéance), insère la ligne `member_subscriptions` (`status: 'active'`, `mollie_subscription_id`, `mollie_customer_id`, `payments_count: 1`, `max_payments` = durée, `next_payment_at`, `ends_at` = début plus la durée), passe le paiement en payé, envoie la notification « abonnement activé », l'email et la facture.
5. Vérifier depuis le dashboard : Membres, fiche du membre. Section Paiements : la ligne du jour, avec son moyen de paiement et son numéro de facture. Section Abonnement : la formule, « Actif », les dates, et le bouton « Arrêter l'abonnement » (il n'apparaît que si `mollie_subscription_id` est renseigné). Dans la liste : « Abonnement · jusqu'au … ».
6. Vérifier dans le tableau de bord Mollie de test : client, mandat valide, abonnement actif avec sa prochaine date.

Pour la recette B, préparer aussi : deux réservations sous abonnement pour ce membre, l'une avant la prochaine échéance, l'autre après ; une réservation payée par un crédit après l'échéance si le membre a aussi des crédits ; et, sur le créneau d'après l'échéance, un autre membre en liste d'attente (créneau complet).

### B. Recette manuelle, une fois la fonction et la migration déployées sur le staging

Avant de commencer : migration `20261125100000` appliquée, fonctions `admin-stop-subscription` et `mollie-subscription-webhook` déployées, dashboard de la branche en ligne sur le staging. Noter l'abonnement utilisé, sa prochaine échéance et les réservations préparées.

| # | Geste | Résultat attendu |
|---|---|---|
| 1 | Dashboard, Membres, ouvrir la fiche du membre abonné. | Carte « Actif », bouton « Arrêter l'abonnement ». Pas de bouton sur une fiche sans abonnement ou payée en une fois. |
| 2 | Cliquer sur « Arrêter l'abonnement ». | Le bouton tourne, puis la modale s'ouvre. « Date de fin » = la prochaine échéance (dernier jour payé), lue dans le fuseau de la salle. Nombre de réservations = celles sous abonnement dont le créneau commence à cette date ou après. Réseau : un `POST` avec `dry_run: true`, réponse 200. Rien n'a changé en base ni chez Mollie. |
| 3 | Sans motif, puis avec des espaces. | « Arrêter l'abonnement » reste désactivé. « Ne pas arrêter » ferme sans rien envoyer. |
| 4 | Saisir un motif, confirmer. | « Arrêt en cours… », puis toast « Abonnement arrêté. Il se termine le {date}. ». Réponse 200 avec `mollie: 'cancelled'`, `cancelled_bookings`, `failed_bookings` vide. |
| 5 | Regarder la fiche sans recharger la page, puis après rechargement. | Badge « Se termine le {date} », même jour que la fin de la ligne des dates. Bouton disparu. Dans la liste, le membre reste « Abonnement · jusqu'au {date} » et garde son accès jusqu'à cette date. Le clic sur « Vendre une formule » prévient toujours qu'un abonnement est en cours. |
| 6 | Planning : ouvrir les créneaux préparés. | Réservation d'après la date de fin : annulée. Réservation d'avant : conservée. Réservation payée par un crédit, même après la date : conservée. Sur le créneau libéré, le premier de la liste d'attente est prévenu ou promu, comme après une annulation par le membre. Dernières réservations de la fiche : « Annulée » sur la bonne ligne seulement. |
| 7 | Sur un second abonnement de test : confirmer par un double clic rapide. | Un seul `POST` d'arrêt dans l'onglet Réseau. Une seule ligne `gym_admin_actions` (`subscription_cancel`), une seule notification et un seul email pour le membre. |
| 8 | Côté membre : ouvrir l'app, puis la boîte mail du compte de test. | Notification « Abonnement arrêté » : « Ton abonnement {formule} s'arrête le {date}. Aucun autre prélèvement ne sera effectué. », rangée avec les messages d'abonnement, ouvre « Ma formule » (visible avec le build qui contient le type). Email dans la coquille de la salle, même information, plus le nombre de réservations annulées s'il y en a. Aucun tiret long. |
| 9 | Abonnement déjà annulé chez Mollie : sur un troisième abonnement de test, l'annuler d'abord dans le tableau de bord Mollie de test, puis l'arrêter depuis la fiche. | L'aperçu s'ouvre, l'arrêt aboutit, réponse avec `mollie: 'already_gone'`. Même résultat à l'écran qu'à l'étape 5. |
| 10 | Prélèvement en cours : choisir un abonnement dont un paiement de test est `open` ou `pending` chez Mollie (échéance du jour laissée sans statut), cliquer sur « Arrêter l'abonnement ». | Pas de modale. Bandeau « Un prélèvement est en cours pour cet abonnement. Attends son résultat avant de l'arrêter. » (409 `PAYMENT_IN_FLIGHT`). Rien n'a changé. Variante : paiement passé à « Paid » chez Mollie mais webhook pas encore traité : « Un prélèvement vient d'être encaissé et n'est pas encore enregistré. Réessaie dans quelques minutes. » (409 `PAYMENT_NOT_RECORDED`). |
| 11 | Second appel après l'arrêt : garder un second onglet ouvert sur la fiche avant l'arrêt (bouton encore visible), arrêter dans le premier, puis cliquer dans le second. | Toast « Cet abonnement est déjà arrêté. La fiche a été mise à jour. », pas de modale, la fiche passe au badge. Aucun nouvel appel Mollie, aucune seconde notification, aucun second email. Un appel réel rejoué moins de deux minutes après l'arrêt ne reprend rien ; après deux minutes, il ne fait qu'annuler les réservations qui resteraient. |
| 12 | Paiement qui arrive après l'arrêt : faire parvenir au webhook un paiement récurrent payé pour l'abonnement arrêté (paiement de test Mollie passé à « Paid », ou rejeu par `admin-replay-mollie-webhook`). | Le webhook répond 200. Le paiement est enregistré et apparaît dans les Paiements de la fiche. L'abonnement reste « Se termine le {date} » : statut, date de fin et prochaine échéance inchangés. Une alerte part (`payment_after_stop`, email et Slack des alertes de paiement), sans donnée personnelle. |
| 13 | Refus de statut : sur un abonnement `past_due` ou `suspended`, s'il en existe. | Pas de bouton (statut non `active`). Si la fiche était périmée et le bouton encore là : bandeau « Cet abonnement ne peut pas être arrêté dans son état actuel… », puis le bouton disparaît au rechargement. |
| 14 | Rejouer les étapes 2 à 5 en anglais (choisir EN sur l'écran de connexion) et sur un téléphone. | Textes anglais, date longue en anglais, modale entière à l'écran. |
| 15 | Après correction du scénario 15 : faire échouer une vente au comptoir avec `PAYMENT_NOT_RECORDED`, si un moyen de test existe. | « L'encaissement n'a pas pu être enregistré. Rien n'a été débité ni crédité : réessaie. », et non le texte du prélèvement. |

Captures et scripts de cette recette : `/private/tmp/claude-502/-Users-Nexxia--gymbook-app/13a11c10-51b4-4190-81c4-701994fc39ff/scratchpad/qa-190/` (hors dépôt, dossier temporaire ; les captures montrent les adresses des comptes de test). Serveur local et Chrome éteints, aucun processus restant, session du compte de test fermée.
