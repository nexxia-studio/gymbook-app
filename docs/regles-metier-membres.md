# Règles métier « membres » réellement codées — pour CGV (GYM-109)

> **Source** : fonctions Edge **déployées sur STAGING** (`buovgpokubrkejunmauq`) + définitions **live** en base (pg_get_functiondef). Audit lecture seule, aucune modification. Chaque règle cite `fichier:ligne` (repo, miroir du déployé) ou la fonction SQL live.
> **⚠️ Valeurs = celles du CODE, pas de la théorie.** Les écarts UI↔code et règles non câblées sont signalés en fin de document (§8).

---

## 1. Réservation d'un cours

Fonction : `supabase/functions/create-booking/index.ts` (déployé v14) + RPC `create_booking_atomic` (live).

| Règle | Valeur exacte codée | Réf |
|---|---|---|
| Compte suspendu (no-show) → réservation refusée | `suspended_until > now()` → HTTP 403 `SUSPENDED` | create-booking:96-107 |
| Créneau annulé / déjà passé / autre club | refus 400/403 | create-booking:117-119 |
| Déjà inscrit / déjà en liste d'attente | 400 `ALREADY_BOOKED` / `ALREADY_WAITLISTED` | create-booking:137-142 |
| **Max réservations simultanées** | **2 réservations confirmées futures** (`>= 2` → 400 `MAX_BOOKINGS_REACHED`) | create-booking:145-155 |
| **Paiement requis** | **abonnement actif OU ≥ 1 crédit disponible**, sinon 402 `PAYMENT_REQUIRED` | create-booking:157-187 |
| Crédit « disponible » = | au moins une ligne `member_credits` avec `credits_remaining > 0` (colonne générée = `credits_total - credits_used`) | create-booking:172-179 |
| Place dans le cours | capacité vérifiée **sous verrou** `time_slots FOR UPDATE`, recomptage des `confirmed`. Si `confirmed >= capacity` → `full` → liste d'attente | `create_booking_atomic` (live) |
| Débit du crédit | **1 crédit débité uniquement si PAS d'abonnement** (`IF NOT p_has_subscription`), atomiquement avec la confirmation du siège | `create_booking_atomic` (live) ; create-booking:189-190 |

**Liste d'attente — entrée** : le guard paiement (create-booking:181) s'exécute **avant** le calcul plein/attente → **il faut déjà posséder un abonnement ou ≥ 1 crédit pour être mis en liste d'attente**, mais **aucun crédit n'est débité** à ce stade (position = `nb_waitlisted + 1`, create-booking:222-253).

---

## 2. Annulation

Fonction : `supabase/functions/cancel-booking/index.ts` (déployé v15).

| Règle | Valeur exacte codée | Réf |
|---|---|---|
| Annulable | statut `confirmed` ou `waitlisted` uniquement | cancel-booking:90-92 |
| **Seuil annulation tardive** | **`heures_avant_début < 2` ET `> 0`** (et réservation confirmée, pas en attente) | cancel-booking:107-110 |
| **Remboursement du crédit** | oui **seulement si** : confirmée **ET** pas tardive (<2h) **ET** créneau non passé **ET** pas d'abonnement actif | cancel-booking:128-130 |
| Ciblage du remboursement | crédit **exactement re-crédité** sur `debited_credit_id` tracé à la réservation (`credits_used − 1`), puis `debited_credit_id → NULL` (anti double-remboursement) | cancel-booking:131-146 |
| Réservation sous abonnement | **aucun** remboursement crédit (rien n'avait été débité) | cancel-booking:167-170 |
| Annulation d'une place en **liste d'attente** | pas de pénalité, pas de remboursement, ré-ordonnancement (`reorder_waitlist`) | cancel-booking:178-197 |
| **Conséquence annulation tardive (<2h)** = pénalité identique au no-show | 1ʳᵉ = avertissement · 2ᵉ = **suspension 48h** · 3ᵉ+ = **suspension 2 semaines (336h)** | cancel-booking:226-294 |
| Promotion après annulation d'une place confirmée | 1ᵉʳ de la liste notifié, délai de confirmation = `waitlist_confirmation_minutes` du club (**défaut 30 min**) ; **notification seule, pas de confirmation auto** | cancel-booking:297-338 |

---

## 3. No-show (absence sans annulation) — GYM-33

Fonction SQL **live** : `public.process_no_shows()` (créée par migrations `_history/20260521154520_gym33_process_no_shows.sql` + fix `_history/20260521170530…`, présente au baseline `00000000000000_baseline_prod.sql`).

- **Détection** : `bookings.status = 'confirmed'` **ET** `checked_in_at IS NULL` **ET** `slot.ends_at < now() − 30 min` **ET** `slot.ends_at > now() − 24h` (fenêtre de traitement : entre 30 min et 24h après la fin du cours).
- **Barème (sur `noshow_count` cumulé)** — valeurs exactes :
  - **1ᵉʳ** : `warning` — **pas de suspension**.
  - **2ᵉ** : `suspended_until = now() + 48h` (`suspension_48h`).
  - **3ᵉ et +** : `suspended_until = now() + 336h` = **2 semaines** (`suspension_2w`).
- Chaque pénalité est journalisée dans `penalties` (type, applied_at, expires_at, notes).

> ⚠️ **Voir §8** : `process_no_shows()` **n'est rattachée à aucun job pg_cron sur staging** → les vrais no-shows ne sont, en l'état, **pas pénalisés automatiquement**. Seules les **annulations tardives (<2h)** déclenchent le barème, en temps réel via cancel-booking (§2).

---

## 4. Liste d'attente

| Règle | Valeur exacte codée | Réf |
|---|---|---|
| Entrée | créneau plein → statut `waitlisted`, position = `nb_waitlisted + 1` (abonnement ou crédit requis, non débité) | create-booking:222-253 |
| Notification d'une place libérée | membre en tête notifié, `waitlist_confirmation_deadline = now + délai_club` (défaut **30 min**) | cancel-booking:307-338 |
| **Confirmation par le membre** | `confirm-waitlist` (déployé v15) : promotion **atomique** (recapacité sous verrou + débit crédit FIFO si pas d'abonnement + confirmation). `NO_CREDIT`→402, `FULL`→409, hors délai→410 | confirm-waitlist:53-110 |
| **Expiration du délai** | job pg_cron `expire-waitlist-confirmations` **toutes les minutes** : place non confirmée à échéance → `cancelled` (`cancel_reason='waitlist_expired'`), puis promotion du suivant (ordre `waitlist_position`, `booked_at`) + notification | `expire_waitlist_confirmations()` (live), cron jobid 3 |
| Non-avance auto | si le membre notifié ne confirme pas via l'app, **aucune avance automatique** hors du job d'expiration (confirm-waitlist ne fait pas avancer les autres) | confirm-waitlist:93-110 |

---

## 5. Crédits (cartes de séances / paiement à l'unité)

| Règle | Valeur exacte codée | Réf |
|---|---|---|
| Solde | `credits_remaining` = **colonne générée** `credits_total − credits_used` (jamais écrite à la main) | schéma live `member_credits` |
| **Expiration / validité** | colonne `expires_at` existe mais **n'est JAMAIS renseignée par le code** (l'octroi de crédits — `mollie-webhook:131 insert member_credits` — ne pose pas `expires_at`) → **les crédits n'expirent jamais** en l'état | mollie-webhook:115-141 ; schéma live |
| **Ordre de consommation (FIFO)** | `ORDER BY expires_at ASC NULLS LAST, created_at ASC` puis `LIMIT 1 FOR UPDATE` → « le plus proche d'expirer, sinon le plus ancien créé ». `expires_at` étant toujours NULL → **de facto : le plus ancien créé d'abord** | `debit_credit_fifo()` (live) |
| Débit | +1 sur `credits_used` de la ligne choisie ; trace `bookings.debited_credit_id`. Aucun crédit → exception `NO_CREDIT` | `debit_credit_fifo()` (live) |
| Cumul | l'achat de crédits reste **libre** tant qu'il n'y a pas d'abonnement actif (cumul multi-cartes autorisé) | create-payment (guard) |

---

## 6. Abonnements (SEPA récurrent Mollie)

Fonctions : `create-subscription` (v13), `mollie-subscription-webhook` (v14), `cancel-subscription` (v1).

| Règle | Valeur exacte codée | Réf |
|---|---|---|
| Premier paiement | paiement Mollie `sequenceType: 'first'` (mandat SEPA), méthodes `directdebit/bancontact/creditcard` | create-subscription/index.ts |
| **Un seul abonnement actif** | `create-subscription` refuse 409 `SUBSCRIPTION_ALREADY_ACTIVE` si un abonnement `status='active'` existe | create-subscription/index.ts |
| Achat crédits bloqué si abonné | `create-payment` refuse 409 `SUBSCRIPTION_ACTIVE` (accès illimité → crédits inutiles) | create-payment/index.ts |
| Activation (webhook 1ᵉʳ paiement payé) | crée l'abonnement récurrent Mollie : `interval '1 month'`, `times = max(duration_months − 1, 1)` ; insère `member_subscriptions` (`status='active'`, `max_payments = duration_months`, `payments_count = 1`) | mollie-subscription-webhook:107-171 |
| Renouvellement (paiement récurrent) | `payments_count += 1` ; `status='completed'` quand `payments_count >= max_payments`, sinon `active` ; 1 ligne `payments` (`credits_granted=0`) | mollie-subscription-webhook:204-233 |
| **Gel des crédits pendant l'abonnement** | une réservation sous abonnement **ne débite aucun crédit** (`create_booking_atomic` : débit `IF NOT p_has_subscription`) → les crédits existants sont préservés | `create_booking_atomic` (live) |
| **Résiliation** | `cancel-subscription` : `DELETE` de l'abonnement chez Mollie + `member_subscriptions.status='canceling'`, `cancelled_at=now`. **Reste actif jusqu'à `ends_at`** (message : « Il reste actif jusqu'au … ») | cancel-subscription:61-109 |

---

## 7. Rappels & notifications

| Événement | Contenu / timing exact | Réf |
|---|---|---|
| **Rappels avant cours** (GYM-32) | **24h avant : email + push** · **2h avant : push seul**. Intervalles **codés en dur** (TODO GYM-61 = les rendre configurables) | send-reminders:1-5, 99-104 |
| Confirmation de réservation | email transactionnel (Resend) | create-booking:263-309 |
| Annulation | email de confirmation + email d'avertissement séparé si tardive | cancel-booking:340-349 |
| Place en liste d'attente libérée | email + push (`notify-waitlist`) | cancel-booking:324-337 |
| Place confirmée (waitlist) | email « Place confirmée » | confirm-waitlist:128-143 |
| Abonnement activé / résilié, paiement confirmé | emails transactionnels | mollie-subscription-webhook, cancel-subscription, mollie-webhook |
| Suspension no-show / annulation tardive | email « Compte suspendu 48h / 2 semaines » | cancel-booking:266-293 |

---

## 8. ⚠️ Écarts UI ↔ code & règles promises mais NON câblées

1. **No-show automatique non déclenché (staging)** — `process_no_shows()` (§3) existe mais **aucun job `cron.job` ne l'appelle** sur `buovgpokubrkejunmauq` (seuls 2 jobs actifs : `cleanup-oauth-states` horaire, `expire-waitlist-confirmations` chaque minute). ⇒ En l'état, un membre **absent sans annuler n'est pas pénalisé** ; seules les **annulations tardives <2h** appliquent le barème (temps réel). *À confirmer : déclenchement éventuel par un ordonnanceur externe non visible en base.*

2. **Rappels avant cours non planifiés (staging)** — `send-reminders` déclare en en-tête « Appelée par pg_cron toutes les 15 min », mais **aucun cron correspondant** n'existe sur staging. ⇒ Les rappels 24h/2h **ne partent pas automatiquement** en l'état (même réserve : ordonnanceur externe éventuel).

3. **Validité des crédits promise côté UI mais inexistante côté back** — l'app affiche « **Valable jusqu'au {{date}}** » (`locales/fr.json:444`, `app/profile/subscription.tsx:301-305`) **uniquement si `expires_at` est renseigné**. Or `expires_at` **n'est jamais posé** (§5) → l'affichage ne se déclenche jamais et **les crédits sont, de fait, sans date d'expiration**. → Décision CGV nécessaire : durée de validité réelle à définir puis à coder.

4. **Seuil <2h : UI = code (cohérent)** — `app/session/[id].tsx:146-153` calcule `slotStart − now < 2h` et affiche « Annulation tardive — sera comptée comme no-show » (`locales/fr.json:238`). Conforme au back (cancel-booking:110). ✅

5. **`expire_waitlist_confirmations()` poste vers une URL de PROD codée en dur** (`https://fcjupgvmjkqztxtwymdb.supabase.co/functions/v1/notify-waitlist`) — sur staging, la promotion after-expiration notifie l'environnement de prod. Caveat technique (pas une règle membre), à corriger avant bascule multi-env.

6. **Barème no-show / annulation tardive figé dans le code** (48h, 336h, seuils 1/2/3) — non paramétrable par club aujourd'hui. À figer explicitement dans les CGV puisque non configurable.

---
_Document généré en lecture seule pour l'avocat (CGV / GYM-109). Non commité._
