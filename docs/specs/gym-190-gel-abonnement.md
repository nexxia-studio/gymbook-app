# GYM-190 : gel d'abonnement, étude avant code

- **Ticket** : GYM-190, volet 1 (gel). Le volet 2 (remboursement exceptionnel) n'est pas traité ici.
- **Date** : 25/11/2026. **Base de code** : `develop`, tête `374dc8f`.
- **Nature** : étude sans code. Rien n'est implémenté, rien n'a été testé chez Mollie.

## En bref

- **Mollie ne propose aucune pause.** L'API ne connaît que deux leviers documentés : modifier l'abonnement (dont `startDate`) ou l'annuler puis en créer un autre sur le même mandat.
- **La piste du ticket (repousser `startDate`) n'est pas documentée** pour un abonnement déjà prélevé. Mollie donne le format du champ, rien sur son effet. C'est une hypothèse à tester en mode test, pas un fait.
- **Recommandation : option B**, annuler l'abonnement Mollie au gel et en recréer un à la reprise, sur le mandat existant. Elle ne repose que sur des comportements documentés. L'option A (décaler `startDate`) est plus légère et reste une simplification possible si un test en mode test la valide.
- **Le statut `paused` existe en base mais n'est traité nulle part.** Le poser sans rien d'autre casserait six endroits, listés au chapitre 2, dont deux touchent à l'argent.
- **Taille** : environ 7 à 9 jours pour B, 5 à 7 pour A, 2 à 3 pour C (arrêt par le gérant, sans gel). Ces chiffres sont des ordres de grandeur.

## 1. Ce que l'API Mollie permet réellement

Toutes les pages ont été lues le 25/11/2026. Les citations sont textuelles. « Non documenté » veut dire absent des pages citées, pas de tout le site de Mollie.

### 1.1 Aucune pause native

- L'API des abonnements liste sept opérations : créer, lister par client, lire, modifier, annuler, lister tout, lister les paiements. Aucune ne suspend ni ne reprend. Source : https://docs.mollie.com/reference/subscriptions-api
- Statuts possibles : `pending`, `active`, `canceled`, `suspended`, `completed`. Source : https://docs.mollie.com/reference/get-subscription
- `suspended` n'est pas une pause à la main du marchand : « Suspended : The subscription mandate is invalid and the subscription is suspended. » Source : https://help.mollie.com/hc/en-us/articles/115004489945-What-do-the-statuses-from-the-Subscriptions-API-mean
- Le champ `status` est en lecture seule dans le schéma de l'API. Provoquer ou lever `suspended` par API : **non documenté**. Source : https://docs.mollie.com/reference/create-subscription

### 1.2 Modifier un abonnement (PATCH)

Source pour tout ce paragraphe : https://docs.mollie.com/reference/update-subscription

- Champs acceptés : `amount`, `description`, `interval`, `startDate`, `times`, `metadata`, `webhookUrl`, `mandateId`, `testmode`. Aucun n'est obligatoire.
- `applicationFee`, `method` et `profileId` ne figurent pas dans le corps du PATCH (constat sur le schéma, pas de phrase explicite).
- « Canceled subscriptions cannot be updated. »
- `startDate` : la page dit seulement « The start date of the subscription in `YYYY-MM-DD` format. »
  - Modifiable sur un abonnement `active` déjà prélevé : **non documenté**.
  - Effet sur `nextPaymentDate` et sur `timesRemaining` : **non documenté**.
  - Obligation d'une date future : **non documentée**.
- `interval` est modifiable (« The maximum interval is one year »). Effet sur la prochaine échéance : **non documenté**.
- `times` : « Total number of payments for the subscription. Once this number of payments is reached, the subscription is considered completed. »
- Réponses décrites : 200, 404, 429. Aucune erreur de validation (422) n'est décrite, donc aucune règle de refus n'est publiée.

**Conséquence.** La piste du commentaire du 17/11 sur le ticket (« l'API permet de modifier la `startDate` d'un abonnement existant ») est exacte sur l'existence du champ, mais Mollie n'écrit nulle part que cela repousse le prochain prélèvement d'un abonnement en cours.

### 1.3 Annuler, puis recréer

- Annuler ne touche pas au mandat : « Canceling a subscription has no effect on the mandates of the customer. » Source : https://docs.mollie.com/reference/cancel-subscription
- Un abonnement annulé ne se réactive pas : aucune opération ne le permet, et il n'est plus modifiable (1.2). L'irréversibilité n'est pas écrite en toutes lettres.
- Recréer un abonnement demande un mandat `pending` ou `valid` : « Continue if there's a mandate with its `status` being either `pending` or `valid`, otherwise set up a *first* payment for the customer first. » Source : https://docs.mollie.com/docs/recurring-payments
- Sans `mandateId`, « any of the customer's valid mandates may be used ». Source : https://docs.mollie.com/reference/create-subscription
- Un abonnement peut être créé avec une date de départ future. Il est alors `pending` : « Subscription created but not active yet because start date is in the future. » Source : https://help.mollie.com/hc/en-us/articles/115004489945-What-do-the-statuses-from-the-Subscriptions-API-mean
- `startDate` fixe le jour de prélèvement des échéances suivantes (exemple de la page : `interval="1 month"`, `startDate="2018-04-30"`, prélèvement le dernier jour de chaque mois). Source : https://docs.mollie.com/reference/create-subscription
- Description : « the description needs to be unique for the Customer in case it has multiple active subscriptions. » Le cas d'un abonnement annulé qui porte la même description : **non documenté**. Source : https://docs.mollie.com/reference/create-subscription
- Avec un jeton OAuth, `profileId` est obligatoire à la création. Les frais de plateforme se fixent à la création : « Setting an application fee on the subscription will ensure this fee is charged on each individual payment. » Source : https://docs.mollie.com/reference/create-subscription

### 1.4 Le mandat SEPA dans le temps

- Statuts d'un mandat : `valid`, `pending`, `invalid`. Source : https://docs.mollie.com/reference/get-mandate
- Durée de validité : **deux articles officiels se contredisent**.
  - « SEPA Direct Debit mandates never expire. » Source : https://help.mollie.com/hc/en-us/articles/115004339309-What-happens-to-a-subscription-mandate-after-a-reversal
  - Sous le code de rejet MD01 : « The mandate expired after 36 months. » Source : https://help.mollie.com/hc/en-us/articles/115000309865-Why-did-my-SEPA-direct-debit-payment-fail
- Révoquer un mandat annule les abonnements qui en dépendent : « all connected subscriptions will be canceled. » Source : https://docs.mollie.com/reference/revoke-mandate
- Piège : quand Mollie annule lui-même un abonnement après des échecs, il révoque aussi le mandat si l'abonnement a un `mandateId` fixe. Source : https://docs.mollie.com/docs/recurring-payments

### 1.5 Un prélèvement déjà parti

- Annuler un paiement dépend de `isCancelable` : « The `isCancelable` property on the Payment object will indicate if the payment can be canceled. » Source : https://docs.mollie.com/reference/cancel-payment
- Pour le SEPA : « It's only possible to cancel a SEPA Direct Debit payment if it has not been sent to the bank yet. » Source : https://help.mollie.com/hc/en-us/articles/115001007289-How-can-I-cancel-a-SEPA-Direct-Debit-payment
- Délai entre la date d'échéance, la création du paiement et l'envoi à la banque : **non documenté**.
- Un prélèvement peut être rejeté jusqu'à 5 jours ouvrés après le débit, et contesté par le client pendant 8 semaines. Sources : https://help.mollie.com/hc/en-us/articles/115000309865-Why-did-my-SEPA-direct-debit-payment-fail et https://docs.mollie.com/docs/sepa-direct-debit

### 1.6 Webhooks, pré-notification, droits

- Aucun webhook sur l'abonnement lui-même : « We do not provide webhooks specifically for status changes of a Subscription itself. » Source : https://docs.mollie.com/docs/recurring-payments
- Le `webhookUrl` de l'abonnement reçoit les événements de chaque paiement qu'il génère, échecs compris. Source : https://docs.mollie.com/reference/create-subscription
- Pré-notification SEPA : Mollie ne documente aucune obligation, aucun délai, aucun responsable. Il recommande seulement : « We suggest notifying the customer a couple of days in advance of the next payment ». Source : https://docs.mollie.com/docs/recurring-payments. La fenêtre de 14 à 16 jours appliquée par l'app est une règle du projet (GYM-334), pas une exigence lue chez Mollie.
- Droits OAuth : créer, modifier et annuler un abonnement demandent `subscriptions.write` ; lire un mandat, `mandates.read`. Sources : https://docs.mollie.com/reference/update-subscription et https://docs.mollie.com/reference/get-mandate. La connexion Mollie des salles demande déjà ces deux portées (`supabase/functions/mollie-connect-oauth/index.ts`) : aucune reconnexion du gérant n'est nécessaire.
- Mode test : « Test mode subscriptions will get canceled automatically after 10 payments. » Source : https://docs.mollie.com/reference/create-subscription

### 1.7 À tester en mode test avant de coder

1. PATCH `startDate` sur un abonnement `active` déjà prélevé : accepté ou refusé, effet sur `nextPaymentDate`, sur `timesRemaining`, sur le statut.
2. PATCH `startDate` alors que le paiement du cycle est déjà créé : ce paiement part-il quand même ?
3. Créer un abonnement juste après en avoir annulé un autre, avec la même description et le même mandat.
4. Créer un abonnement avec une `startDate` à trois mois : statut, `nextPaymentDate`, puis PATCH de cette `startDate` tant qu'il est `pending`.
5. Combien de jours avant l'échéance Mollie crée le paiement SEPA, et jusqu'à quand `isCancelable` reste vrai.
6. L'état du mandat après plusieurs mois sans prélèvement (non testable rapidement : à surveiller à la première reprise réelle).

Le support de Mollie décrit des limites du mode test pour le SEPA récurrent (https://help.mollie.com/hc/en-us/articles/214072489-How-do-I-use-Mollie-Recurring) : à lire avant de bâtir le plan de test.

## 2. L'existant dans le code

### 2.1 La ligne d'abonnement

- Table `member_subscriptions` (`supabase/migrations/00000000000000_baseline_prod.sql:1461`).
- Statuts autorisés : `active`, `suspended`, `expired`, `cancelled`, `paused`, `completed`, `canceling`, `past_due` (dernier CHECK : `20260824160000_gym252_failed_renewals.sql:85`).
- **`paused`, `paused_at` et `pause_resumes_at` existent, sans aucun code qui les écrive ni les lise.**
- Pas de colonne « engagement » : il se déduit de `ends_at`.
- Colonnes de prélèvement : `mollie_subscription_id` (unique), `mollie_customer_id`, `next_payment_at`, `payments_count`, `max_payments`, `prenotification_sent_at`, et les quatre colonnes d'impayé de GYM-252.
- Écritures : toutes par `service_role`. Le membre ne peut que lire sa ligne.

### 2.2 La vie d'un abonnement récurrent

- **Création** (`mollie-subscription-webhook/index.ts:555-730`). Au premier paiement encaissé, l'app crée l'abonnement Mollie avec `interval: '1 month'`, `times` = durée moins 1, `startDate` = un mois après le paiement (GYM-319), les frais de plateforme et un `webhookUrl` qui porte l'identité de la salle (GYM-244). La ligne est insérée `active`, `ends_at` = aujourd'hui plus la durée, `payments_count` = 1, `max_payments` = durée.
- **Renouvellement** (même fichier, `:945-1065`). À chaque prélèvement payé : `payments_count` + 1, `next_payment_at` avance d'un mois à partir de la date de paiement, `prenotification_sent_at` repasse à null, les colonnes d'impayé sont remises à zéro, et **`status` est réécrit à `active`** (ou `completed` si c'était la dernière échéance et que le terme est échu).
- **Échec** : `past_due`, puis `suspended` après 3 jours de grâce (`process-failed-renewals`, cron quotidien, fonction `suspend_overdue_subscriptions`).
- **Pré-notification SEPA** (`get_pending_sepa_prenotifications`, `20260909200000_gym334_prenotification_sepa.sql:119`) : abonnements `active` dont `next_payment_at` tombe dans 1 à 16 jours et dont la pré-notification n'est pas partie. Cron horaire.
- **Alertes** (`renewal_alerts_pending`, `20260928120000_alerte_renouvellements_sepa.sql`) : entre autres le motif `no_debit`, un abonnement `active` dont l'échéance est dépassée de plus de 120 heures.
- **Expiration** (`expire_subscriptions`, cron horaire) : passe à `expired` les lignes `active`, `canceling`, `past_due` (et `suspended` pour impayé) dont `ends_at` est dépassé.
- **Résiliation par le membre** (`cancel-subscription`) : refusée tant que l'abonnement est engagé (`isEngaged`, `_shared/subscription-engagement.ts` : `active` ou `canceling`, terme futur). Sinon Mollie d'abord, base ensuite.
- **Abonnement payé en une fois** (GYM-189) : pas d'abonnement Mollie, seulement une ligne avec `source_payment_id`.

### 2.3 Les droits de réservation

- La règle est dans `_shared/active-subscription.ts`.
  - `ACCESS_SUBSCRIPTION_STATUSES` = `active`, `canceling`, `past_due` : ces statuts ouvrent l'accès, si le terme n'est pas dépassé.
  - `PURCHASE_BLOCKING_STATUSES` = les mêmes plus `suspended` : ces statuts interdisent d'acheter un second abonnement.
- Elle est recopiée, et les copies se citent : `promote_waitlist_atomic` (SQL), `get_communication_recipients` (SQL), `apps/dashboard/src/lib/subscription.ts`, `apps/mobile/lib/subscription.ts`.
- `create-booking` vérifie l'accès, puis `create_booking_atomic` débite un crédit seulement si le membre n'a pas d'abonnement ouvrant.
- Un abonnement illimité n'alloue aucun crédit. Les crédits des packs n'expirent pas.
- Aucun code n'annule les réservations futures quand un abonnement cesse d'ouvrir des droits.

### 2.4 Ce qu'un gel doit toucher

| Endroit | Pourquoi |
|---|---|
| Une Edge Function réservée au gérant, sur le modèle de `admin-lift-suspension` (rôle, salle de l'appelant, motif obligatoire, journal `gym_admin_actions`) | Geler, reprendre, annuler un gel |
| `member_subscriptions` | `status`, `paused_at`, `pause_resumes_at`, `ends_at`, `next_payment_at` |
| Une table d'historique des gels | Dates, auteur, motif, valeurs d'avant le gel |
| L'abonnement Mollie | Empêcher le prélèvement pendant le gel, le reprendre ensuite |
| Les réservations à venir sur la période | À annuler, avec un message au membre |
| Dashboard, fiche membre (`MemberDrawer.tsx`) | Boutons « Geler » et « Reprendre », état affiché |
| App membre, « Ma formule » (`profile/subscription.tsx`) | Afficher le gel et sa date de fin. Demande un build mobile. |

### 2.5 Ce qui casserait si l'on posait `paused` sans rien d'autre

1. **Un prélèvement qui arrive lèverait le gel sans bruit.** Le traitement d'un renouvellement réécrit `status: 'active'` sans regarder le statut courant. Si Mollie prélève pendant un gel (décalage raté, paiement déjà créé), la membre est débitée et son abonnement redevient actif, sans alerte.
2. **Un second abonnement deviendrait achetable.** `paused` n'est pas dans `PURCHASE_BLOCKING_STATUSES` : la membre gelée pourrait souscrire de nouveau, puis être prélevée deux fois à la reprise.
3. **L'engagement sauterait.** `isEngaged` ne connaît que `active` et `canceling`. Un abonnement gelé ne serait plus « engagé » pour `cancel-subscription` ni pour `delete-account`. Le filet SEPA de `delete-account` (`:125`) ne filtre aussi que `active` et `canceling` : un compte supprimé pendant un gel laisserait l'abonnement Mollie vivant.
4. **La reprise serait prélevée sans pré-notification.** `get_pending_sepa_prenotifications` ne lit que les lignes `active`. Si l'abonnement repasse `active` le jour de la reprise, la fenêtre de 14 jours est déjà fermée.
5. **Un gel plus long que le terme resterait gelé à vie.** `expire_subscriptions` ignore `paused`. À l'inverse, si `ends_at` n'est pas repoussé, une reprise après le terme rendrait un abonnement `active` aussitôt expiré.
6. **Les prédicats recopiés divergeraient.** Dashboard, mobile et SQL ont chacun leur liste. L'app membre actuelle afficherait « aucune formule » pendant un gel.

À surveiller aussi :
- `cancel-booking` (`:143-149`) teste `status = 'active'` seul pour décider d'une restitution de crédit.
- `renewal_alerts_pending` : le motif `no_debit` ne se déclenche pas pour `paused`, mais il se déclencherait le jour de la reprise si `next_payment_at` n'était pas repoussé.
- Les rejets tardifs : un prélèvement payé juste avant le gel peut être rejeté jusqu'à 5 jours ouvrés après, donc pendant le gel. Le chemin d'échec passerait la ligne `paused` en `past_due`.

### 2.6 À vérifier en base avant de coder

Ces points viennent de la lecture du dépôt et n'ont pas été vérifiés sur le staging ni la prod.

- La migration GYM-252 est-elle appliquée partout ? Son en-tête dit « NON DÉPLOYÉE », `docs/ops/gym252-impayes.md` aussi, alors que le webhook écrit ses colonnes.
- `mollie_customers` porte-t-elle un mandat pour chaque abonnée ? Aucun `INSERT` dans le dépôt, et `mollie_mandate_id` n'est jamais relu.
- Existe-t-il des formules récurrentes d'un mois ? Avec `times` = 1, le gel n'a pas le même sens.

## 3. Options de conception

### Socle commun aux trois options

- **Modèle de données.** Une table `subscription_freezes` : `id`, `gym_id`, `subscription_id`, `member_id`, `starts_on`, `planned_end_on`, `ended_at`, `end_kind` (`planned`, `early`, `cancelled`), `reason_category`, `reason_note`, `created_by`, `ended_by`, et les valeurs d'avant le gel (`previous_ends_at`, `previous_next_payment_at`, `previous_mollie_subscription_id`). RLS : le gérant lit les gels de sa salle, le membre lit les siens, toutes les écritures par `service_role`. Sur `member_subscriptions` : `status = 'paused'`, `paused_at`, `pause_resumes_at`, déjà présents.
- **Donnée de santé.** Le motif du cas réel est médical. Stocker un diagnostic ou un certificat ferait entrer l'app dans le régime des données de santé (RGPD, article 9). Proposition : une catégorie fermée (« santé », « déplacement », « autre »), une note libre facultative avec un avertissement, et aucun dépôt de document. À valider avec le volet juridique.
- **Règle de calendrier.** Un gel de D jours décale tout de D jours : `ends_at` et la prochaine échéance. Le nombre total de prélèvements ne change pas : l'engagement reste dû en entier, il est seulement étalé.
- **Accès.** `paused` n'entre pas dans `ACCESS_SUBSCRIPTION_STATUSES` : la coupure est la sortie de la liste, comme pour `suspended`. Il entre dans `PURCHASE_BLOCKING_STATUSES` et dans `isEngaged`.
- **Conditions d'entrée.** Seul un abonnement `active` se gèle. `past_due`, `suspended` et `canceling` sont refusés avec un message clair. Un seul gel ouvert par abonnement.
- **Abonnement payé en une fois.** Pas de Mollie : `paused`, puis `ends_at` repoussé à la reprise. Identique dans les trois options.

### Option A : décaler la date du prochain prélèvement (PATCH `startDate`)

L'abonnement Mollie est conservé. Au gel, on envoie `startDate` = date de reprise.

- **Modèle de données** : le socle. `mollie_subscription_id` ne change pas.
- **Fin d'engagement** : `ends_at` repoussé de la durée du gel. `times` inchangé.
- **Réservations de la période** : annulées au gel, message au membre.
- **Crédits** : sans objet pour un illimité. Une réservation payée par un crédit est restituée.
- **Pré-notification SEPA** : `next_payment_at` est repoussé à la date de reprise. La fonction de pré-notification doit lire aussi les lignes `paused` dont l'échéance approche, pour annoncer le prélèvement de reprise 14 jours avant.
- **Gel puis reprise** : rien à faire chez Mollie le jour de la reprise. Un cron repasse la ligne à `active`.
- **Reprise anticipée** : un second PATCH `startDate`.
- **Annulation pendant un gel** : DELETE Mollie, comme aujourd'hui.
- **Pour** : le plus petit chantier avec gel. Un seul identifiant Mollie, des frais de plateforme inchangés, aucun risque sur le mandat.
- **Contre** : repose entièrement sur un comportement non documenté (1.2). Si Mollie ignore ou réinterprète `startDate`, une membre en arrêt médical est prélevée. Et rien ne garantit que ce comportement reste stable.

### Option B : annuler l'abonnement Mollie, le recréer pour la reprise (recommandée)

Au gel, l'app annule l'abonnement Mollie. Elle en crée un nouveau sur le mandat existant, avec `startDate` = date de reprise et `times` = échéances restantes (`max_payments` moins `payments_count`).

- **Deux variantes pour la création.**
  - **B1, date de reprise connue** : le nouvel abonnement est créé dans la même action que le gel. Il attend en `pending` chez Mollie et démarre seul. Aucune action le jour de la reprise.
  - **B2, date inconnue** : seul le DELETE part au gel. Le nouvel abonnement est créé quand le gérant clique « Reprendre ».
- **Modèle de données** : le socle. La même ligne `member_subscriptions` est conservée et son `mollie_subscription_id` remplacé. L'ancien identifiant est gardé dans `subscription_freezes`, et le webhook doit savoir le retrouver : un rejet tardif du dernier prélèvement porte l'ancien identifiant.
- **Fin d'engagement** : `ends_at` repoussé de la durée du gel. Les échéances restantes sont reportées dans `times` du nouvel abonnement.
- **Réservations de la période** : annulées au gel, message au membre.
- **Crédits** : comme A.
- **Pré-notification SEPA** : comme A. En B2, la reprise ne peut pas être prélevée avant 14 jours, sauf à accepter une pré-notification de rattrapage.
- **Gel puis reprise** : B1, automatique. B2, une action du gérant, avec un rappel s'il oublie.
- **Reprise anticipée** : B1, PATCH `startDate` du nouvel abonnement tant qu'il est `pending` (à tester, point 4 de 1.7), sinon DELETE et nouvelle création. B2, création immédiate.
- **Annulation pendant un gel** : B1, DELETE du nouvel abonnement. B2, rien chez Mollie.
- **Pour** : chaque étape est documentée par Mollie (1.3). Entre l'annulation et la reprise, aucun abonnement actif n'existe chez Mollie : un prélèvement pendant le gel est impossible par construction, sauf paiement déjà créé avant le gel.
- **Contre** :
  - Les frais de plateforme et le `webhookUrl` sont à reposer à l'identique à la recréation. Le taux à appliquer (celui d'origine ou le taux en vigueur) est une décision.
  - Si la création échoue (mandat devenu invalide, connexion Mollie perdue), la membre garde son accès sans être prélevée. Il faut un état d'échec visible et une alerte au gérant.
  - La fenêtre entre le DELETE et la création : si le second appel échoue, la base doit dire « gelé, reprise à recréer », jamais « actif ».
  - L'unicité de la description face à un abonnement annulé n'est pas documentée : prévoir un suffixe.

### Option C : pas de gel, un arrêt par le gérant

On outille ce qui a été fait à la main le 17/11. Une Edge Function réservée au gérant annule l'abonnement Mollie et passe la ligne en `canceling`, avec `ends_at` ramené au terme de la dernière période payée. Au retour, le gérant vend une nouvelle formule.

- **Modèle de données** : aucune table. Une ligne dans `gym_admin_actions`. `paused` reste inutilisé.
- **Fin d'engagement** : l'engagement restant est abandonné. C'est une décision commerciale à chaque fois.
- **Réservations** : celles d'après le nouveau terme sont à annuler. Le manque existe déjà aujourd'hui.
- **Crédits** : inchangés.
- **Pré-notification SEPA** : plus d'échéance, plus de notification (`next_payment_at` à null).
- **Symétrie** : pas de reprise. Le retour est une vente neuve, avec un nouveau premier paiement.
- **Pour** : petit, sans risque Mollie, utile de toute façon. Aujourd'hui le gérant n'a aucun moyen d'arrêter un abonnement engagé.
- **Contre** : ce n'est pas un gel. La membre perd son tarif et son ancienneté d'engagement, le gérant perd les mois restants.

### Comparaison

| | A, décaler | B, annuler et recréer | C, arrêt |
|---|---|---|---|
| Repose sur du documenté | Non | Oui | Oui |
| Prélèvement possible pendant le gel | Oui si Mollie ignore le décalage | Non, hors paiement déjà créé | Non |
| Engagement conservé | Oui | Oui | Non |
| Action le jour de la reprise | Aucune | Aucune (B1) ou un clic (B2) | Nouvelle vente |
| Identifiant Mollie | Inchangé | Remplacé | Supprimé |
| Frais de plateforme | Inchangés | À reposer | Sans objet |
| Taille | 5 à 7 j | 7 à 9 j | 2 à 3 j |

### Recommandation

**Option B, variante B1 par défaut** (date de reprise obligatoire, modifiable ensuite), pour trois raisons :

1. **Elle ne parie pas.** Le gel sert d'abord à ne pas prélever quelqu'un qui est en arrêt. A fait reposer cette garantie sur un champ dont Mollie ne décrit pas l'effet.
2. **Sa panne est du bon côté.** Si B échoue, la membre n'est pas prélevée et le gérant est alerté. Si A échoue, la membre est prélevée à tort, et un prélèvement SEPA se conteste pendant 8 semaines, aux frais de la salle.
3. **Elle contient C.** L'annulation Mollie par le gérant est la première moitié de B. La livrer d'abord règle déjà le cas « arrêter un abonnement engagé ».

**Avant de coder**, jouer les tests 1 à 5 du paragraphe 1.7. Si le test 1 montre que PATCH `startDate` décale proprement l'échéance d'un abonnement actif, A devient défendable : il faudra alors décider si l'économie de deux jours vaut la dépendance à un comportement non écrit. Mon avis resterait B.

Dans tous les cas, le lot commence par les garde-fous du paragraphe 2.5, qui valent pour toutes les options : le renouvellement ne doit plus réécrire `active` sur une ligne `paused`, et `paused` doit entrer dans les listes d'engagement et de blocage d'achat.

## 4. Questions à poser au gérant

**Règles du gel**
1. Durée minimale d'un gel ? En jours, ou par mois entiers ? Par mois entiers, le jour de prélèvement ne bouge pas.
2. Durée maximale par gel, et par année d'abonnement ?
3. Combien de gels par abonnement ?
4. La date de reprise est-elle obligatoire dès le départ ? Sinon, au bout de combien de temps relancer le gérant ?
5. Peut-on geler rétroactivement (la membre prévient après coup) ? Cela suppose de rembourser un prélèvement déjà passé.

**Justificatif et motif**
6. Un justificatif est-il exigé, ou la parole du gérant suffit ? S'il est exigé, il reste à la salle et n'est jamais envoyé dans l'app.
7. Quels motifs sont admis : santé seulement, ou aussi déplacement long, grossesse, raison personnelle ?

**Argent et engagement**
8. L'engagement est-il prolongé d'autant (12 prélèvements dus, étalés), ou le gel raccourcit-il l'engagement ?
9. Le gel est-il gratuit, ou la salle veut-elle un petit montant mensuel pendant le gel ?
10. Si un prélèvement est déjà parti pour la période où le gel commence : on le laisse et le gel démarre à la période suivante, ou on le rembourse ?
11. Pour un abonnement payé en une fois, même règle (terme repoussé) ?

**Accès pendant le gel**
12. La membre gelée peut-elle venir quand même avec des crédits achetés à part ?
13. Ses réservations déjà prises sur la période sont-elles annulées d'office, avec un message ?
14. Sa place en liste d'attente est-elle perdue ?

**Reprise et sortie**
15. Reprise anticipée : la membre peut-elle la demander, et le premier prélèvement part-il aussitôt ou après les 14 jours de pré-notification ?
16. Si elle ne revient pas : au terme du gel, résiliation ou reprise des prélèvements ?
17. Peut-elle résilier pendant un gel, et que devient l'engagement restant ?

**Qui et où**
18. Le gérant seul décide, ou la membre peut-elle faire la demande depuis l'app, avec validation ?
19. La membre voit-elle « Abonnement en pause jusqu'au… » dans l'app ? Reçoit-elle un email de confirmation, puis un rappel avant la reprise ?
20. Les membres gelés reçoivent-ils les communications de la salle ?

## 5. Taille du chantier

Ordres de grandeur en jours de travail, recette staging comprise, hors attente des réponses du gérant. Ils supposent les règles tranchées.

| Lot | A | B | C |
|---|---|---|---|
| Tests Mollie en mode test (1.7) | 0,5 | 0,5 | 0 |
| Garde-fous communs (2.5) : renouvellement, engagement, blocage d'achat, expiration, prédicats SQL, dashboard, mobile | 1,5 | 1,5 | 0,5 |
| Migration : table des gels, RLS, cron de reprise | 0,5 | 0,5 | 0 |
| Edge Functions gérant (geler, reprendre, annuler le gel) | 1 | 2 | 0,5 |
| Webhook : ancien identifiant Mollie, rejets tardifs pendant un gel | 0,5 | 1 | 0 |
| Pré-notification de reprise, email de confirmation | 0,5 | 0,5 | 0 |
| Annulation des réservations de la période, message au membre | 0,5 | 0,5 | 0,5 |
| Dashboard : boutons, modale, état sur la fiche membre | 0,5 | 0,5 | 0,5 |
| App membre : affichage du gel dans « Ma formule » (build à prévoir) | 0,5 | 0,5 | 0 |
| Recette staging, cas d'échec Mollie | 0,5 | 1 | 0,5 |
| **Total** | **5 à 7 j** | **7 à 9 j** | **2 à 3 j** |

Ce qui peut faire grossir le chantier :
- un gel rétroactif avec remboursement (question 5), qui rejoint le volet 2 du ticket ;
- une demande de gel depuis l'app (question 18) : environ 2 jours de plus, et un build mobile ;
- un montant mensuel pendant le gel (question 9) : avec B, un second abonnement Mollie temporaire.

Découpage conseillé : garde-fous communs et arrêt par le gérant (option C) d'abord, puis le gel par-dessus.
