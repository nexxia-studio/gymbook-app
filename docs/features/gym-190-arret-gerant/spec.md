# GYM-190, étape C : le gérant arrête un abonnement

Branche `nexxiastudio/gym-190-arret-gerant`, PR vers `develop`. Référence : `docs/specs/gym-190-gel-abonnement.md` (2.5 et option C).

## Règles de la session (valables pour chaque agent)

- Aucun déploiement, aucun merge, aucune action sur la prod, aucun SQL direct (staging compris). Mollie en mode test uniquement.
- `.claude/agents/` reste hors commit. Le mot de passe des comptes de test n'est jamais écrit dans un fichier, un commit ou un rapport.
- Aucun « — » ni « – » dans un texte visible par un membre ou un gérant (notification, email, dashboard, app). i18n fr et en côté dashboard et mobile.
- Commits terminés par `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- Une décision non tranchée prend l'option la plus prudente et se note dans le rapport.

## Constats de l'exploration

- Table `member_subscriptions`. Colonnes utiles : `status`, `auto_renew`, `cancelled_at`, `cancellation_reason`, `ends_at`, `next_payment_at`, `mollie_subscription_id`, `mollie_customer_id`, `payments_count`, `max_payments`, `source_payment_id` (abonnement payé en une fois).
- `mollie-subscription-webhook/index.ts` (vers `:948-1065`) : le renouvellement payé relit la ligne par `mollie_subscription_id` sans regarder son statut et écrit `status: 'active'` (ou `completed`).
- Alertes : `_shared/webhook-failures.ts` (`recordWebhookFailure` : table `webhook_failures`, email, Slack), relue par `send-payment-alerts`.
- `cancel-subscription` : Mollie d'abord, 404 accepté, sinon 502 sans écriture. `admin-lift-suspension` : auth `getUser`, rôle et salle lus sur le profil de l'appelant, journal `gym_admin_actions` (le CHECK contient déjà `subscription_cancel`).
- **Il n'existe aucun chemin d'annulation d'UNE réservation côté salle.** `cancel-booking` exige le JWT du membre ; `cancel-slot` annule tout un créneau. Ce que fait `cancel-booking` pour une réservation confirmée : UPDATE `status = 'cancelled'` (le trigger tient les compteurs du créneau), puis RPC `notify_waitlist_for_free_seats(p_slot_id)` ; pour une réservation en liste d'attente : UPDATE puis RPC `reorder_waitlist(p_slot_id)`.
- `bookings.debited_credit_id` : non nul quand la réservation a été payée par un crédit ; nul quand elle a été prise sous abonnement.
- Tests : `deno test` pour `supabase/functions` (Deno 2.9 installé), scripts `npx tsx` pour mobile et dashboard.

## Critères d'acceptation

### 1. Garde-fous communs

1a. **Webhook.** Sur un renouvellement payé, si la ligne est `canceling`, `paused`, `cancelled` ou `expired` : le paiement est enregistré comme aujourd'hui, `payments_count` est incrémenté, et RIEN d'autre n'est écrit sur la ligne (ni `status`, ni `next_payment_at`, ni `ends_at`, ni les colonnes d'impayé, ni `prenotification_sent_at`). Une alerte part par `recordWebhookFailure` (stage `payment_after_stop`, avec l'id d'abonnement, le statut, l'id Mollie du paiement, sans donnée personnelle). Le webhook répond 200. `active`, `past_due` et tout autre statut gardent le comportement actuel. La décision est une fonction pure, testée.

1b. `'paused'` entre dans `PURCHASE_BLOCKING_STATUSES` et dans `isEngaged` (`_shared`), et dans chacune de leurs copies (SQL, dashboard, mobile). `paused` n'entre PAS dans `ACCESS_SUBSCRIPTION_STATUSES`. Le rapport liste chaque copie trouvée, modifiée ou non, avec la raison. Une copie SQL se corrige par une migration qui reprend la dernière définition à l'identique.

1c. `delete-account` : le filet SEPA couvre `active`, `canceling`, `past_due` et `paused`. La liste est une constante exportée, testée.

1d. `apps/mobile/lib/subscription.ts` : `past_due` ajouté (un membre en délai de grâce voit aujourd'hui « aucune formule »). Test.

### 2. Edge Function `admin-stop-subscription` (`verify_jwt = true`)

Entrée : `{ subscription_id, reason, dry_run? }`.

- **Appelant** : `profiles.role = 'gym_admin'` avec une salle sur son profil. La salle vient du profil, jamais du corps. Sinon 401, 403. Un abonnement d'une autre salle répond 404 `NOT_FOUND`, exactement comme un abonnement inexistant (la réponse ne révèle pas son existence), et rien n'est lu chez Mollie.
- **Motif** : obligatoire, rogné, 500 caractères au plus. Non exigé en `dry_run`.
- **Éligible** : `status = 'active'` avec `mollie_subscription_id` et `mollie_customer_id`.
- **Refus (409), code et message clair en français** : abonnement non récurrent (`NOT_RECURRING`) : « Abonnement payé en une fois : remboursement à traiter à part » seulement si `source_payment_id` est renseigné, sinon le message neutre « Cet abonnement n'est pas prélevé par Mollie : il ne peut pas être arrêté ici. » ; `past_due`, `suspended`, `paused`, et `canceling` non arrêté par la salle (`NOT_STOPPABLE`, avec le statut) ; tout autre statut.
- **Déjà arrêté par la salle** (`canceling` avec `cancellation_reason = 'stopped_by_gym'`) : 200 `{ ok: true, already: true, ends_at }`, rien n'est refait. Valable aussi en `dry_run`.
- **Date de fin** = fin de la dernière période payée :
  1. `next_payment_at` s'il est renseigné ;
  2. sinon, si toutes les échéances sont payées (`payments_count >= max_payments`) : `ends_at` inchangé ;
  3. sinon : 409 `END_DATE_UNKNOWN`, rien n'est modifié (option prudente : on ne devine pas une date qui coupe un accès payé).
  Bornes : jamais après `ends_at` actuel ; si la date est passée, elle vaut l'instant de l'arrêt. Fonction pure, testée.
- **Réservations concernées** : celles du membre dans cette salle, `confirmed` ou `waitlisted`, dont le créneau commence à la date de fin ou après, et dont `debited_credit_id` est nul. Une réservation payée par un crédit ne dépend pas de l'abonnement : elle est conservée.
- **Prélèvement en cours** : avant tout DELETE, les paiements de l'abonnement sont lus chez Mollie (`GET /v2/customers/{customerId}/subscriptions/{subscriptionId}/payments`, `_embedded.payments[].status`). Un paiement `open` ou `pending` : 409 `PAYMENT_IN_FLIGHT`, « Un prélèvement est en cours pour cet abonnement. Réessayez quand il sera encaissé ou rejeté. », rien n'est modifié. 404 sur cette lecture = abonnement introuvable chez Mollie, on continue. Pas de jeton (`MOLLIE_NOT_CONNECTED`), toute autre réponse, corps illisible, erreur réseau ou délai (`MOLLIE_READ_FAILED`) : 502, rien n'est modifié (fermé par défaut). La classification est une fonction pure, testée.
- **`dry_run: true`** : ne modifie rien, ne fait que lire chez Mollie (les paiements, pour afficher le refus `PAYMENT_IN_FLIGHT` avant la saisie du motif ; pas le statut de l'abonnement). Renvoie `{ ok, dry_run: true, ends_at, plan_name, bookings: [{ id, slot_id, starts_at, activity_name, status }] }`.
- **Ordre réel** :
  1. Mollie (jeton OAuth de la salle, ou clé de test si `MOLLIE_TEST_MODE`, même règle que `cancel-subscription`), après la lecture des paiements ci-dessus :
     - statut de l'abonnement (`GET /v2/customers/{c}/subscriptions/{s}`) : `canceled` ou `completed`, ou réponse 404 ou 410 = déjà parti (`already_gone`), le DELETE est sauté ; `active`, `pending`, `suspended` = DELETE. Toute autre réponse, statut inconnu, erreur réseau ou délai : 502 `MOLLIE_READ_FAILED`, rien ne change en base ;
     - DELETE : succès, 404 ou 410 acceptés. Toute autre réponse (422 compris, quel que soit son texte), erreur réseau ou délai : 502 `MOLLIE_STOP_FAILED`, rien ne change en base.
     Les trois classifications sont des fonctions pures, testées.
  2. UPDATE conditionnel (`.eq('status', 'active')`, lignes relues) : `status 'canceling'`, `auto_renew false`, `cancelled_at now()`, `cancellation_reason 'stopped_by_gym'`, `ends_at` = date de fin, `next_payment_at null`, `prenotification_sent_at null`. Zéro ligne touchée et ligne relue `canceling` avec `stopped_by_gym` = un appel concurrent a gagné : 200 `already`, sans rien refaire. Erreur d'écriture, ou zéro ligne touchée avec un autre statut, après l'arrêt chez Mollie : 500 `STOP_NOT_PERSISTED`, journalisée, et alerte `recordWebhookFailure` (stage `stop_not_persisted`, sans donnée personnelle, jamais bloquante).
  3. Journal `gym_admin_actions` : `action_type 'subscription_cancel'`, `reason`, `metadata` (id d'abonnement, ancien et nouveau `ends_at`, ancien `next_payment_at`, issue Mollie, réservations annulées et en échec).
  4. Réservations : annulées une à une par un helper partagé (`_shared`) qui rejoue la séquence de `cancel-booking` sans sanction ni email par réservation : UPDATE `cancelled` avec `cancel_reason = 'subscription_stopped_by_gym'`, puis `notify_waitlist_for_free_seats` (confirmée) ou `reorder_waitlist` (liste d'attente). La sélection est bornée en SQL (jointure interne sur le créneau, `starts_at >= date de fin`, `debited_credit_id` nul) puis repassée par le filtre pur ; l'UPDATE de chaque réservation est verrouillé sur `gym_id`, `member_id` et le statut lu. Un échec n'arrête pas les autres ; il est renvoyé dans la réponse et dans le journal, et une alerte `recordWebhookFailure` part (stage `bookings_not_cancelled`, sans donnée personnelle, jamais bloquante).
  5. Membre prévenu (sous-tâche T3).
- Réponse : `{ ok: true, ends_at, mollie: 'cancelled' | 'already_gone', cancelled_bookings, failed_bookings }`.
- Le cœur de la fonction est une fonction à dépendances injectées (`handler.ts`), testée avec des doublures ; `index.ts` ne garde que le câblage.
- **Mise en service** : la connexion Mollie de la salle doit porter `subscriptions.read` et `payments.read` (demandés par `mollie-connect-oauth`), en plus de `subscriptions.write`.

### 3. Notification et email

- Type `subscription_stopped_by_gym` : migration qui reprend à l'identique la liste du dernier CHECK de `notifications.type` (`20261123140000`) plus ce type ; type TS et texte dans `_shared/notify.ts`. Texte : « Ton abonnement {formule} s'arrête le {date}. Aucun autre prélèvement ne sera effectué. »
- Email de confirmation par Resend, dans la coquille `emailShell` de `_shared/gym-branding.ts` : même information, plus le nombre de réservations annulées s'il y en a. Fonction de composition pure, testée (dont l'absence de tiret long).
- Les deux sont envoyés après l'écriture en base, sans jamais faire échouer l'arrêt.
- App membre : `apps/mobile/lib/messages` traite ce type comme les autres messages d'abonnement (Ma formule), avec une icône. Part avec le prochain build.

### 4. Dashboard, fiche membre

- Bouton « Arrêter l'abonnement », visible seulement pour un abonnement `active` récurrent (avec `mollie_subscription_id`).
- Au clic : appel `dry_run`, puis `ConfirmModal` avec la date de fin, le nombre de réservations annulées, un champ motif obligatoire et l'avertissement « Les prélèvements s'arrêtent. Pour revenir, le membre devra souscrire une nouvelle formule. ». Bouton de confirmation désactivé sans motif et pendant l'envoi. Les refus de la fonction s'affichent en clair.
- Après l'arrêt : la fiche se recharge et affiche le badge « Se termine le {date} » pour tout abonnement `canceling`.
- Textes en `fr` et `en`, sans tiret long.

## Découpage

- **T1** : garde-fous 1a à 1d, un test par point.
- **T2** : `admin-stop-subscription` (logique pure, fonction, helper d'annulation de réservation, `config.toml`), sans notification ni email.
- **T3** : migration du type, `notify.ts`, email, branchement dans la fonction, type côté mobile.
- **T4** : dashboard.

## Scénarios de QA (staging, compte gérant de test)

1. Fiche d'un membre avec abonnement récurrent actif : le bouton est visible ; absent pour un abonnement payé en une fois, `canceling` ou sans abonnement.
2. Clic : la modale montre la date de fin et le nombre de réservations ; confirmation impossible sans motif.
3. Confirmation : succès, badge « Se termine le {date} », bouton disparu.
4. Les réservations futures après la date de fin sont annulées ; celles d'avant sont conservées.
5. Double clic sur la confirmation : un seul arrêt, une seule notification.
6. Abonnement déjà annulé dans Mollie : l'arrêt aboutit quand même.
7. Le membre voit le message dans l'app et reçoit l'email.
