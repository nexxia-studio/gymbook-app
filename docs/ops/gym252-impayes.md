# GYM-252 — Échéances en échec : exploitation, écrans, recette

## 1. La machine à états

```
active ──échec J0──▶ past_due ──J+3 impayé──▶ suspended ──terme──▶ expired
   ▲                     │                        │
   └──────── paiement reçu (webhook `paid`) ──────┘
```

| Statut | Accès abonnement | Qui l'écrit |
|---|---|---|
| `active` | ouvert | webhook `paid` |
| `past_due` | **ouvert** (grâce de 3 j) | webhook, branche `failed/expired/canceled` |
| `suspended` | **coupé** | `suspend_overdue_subscriptions()`, balayage quotidien |
| `expired` | coupé | `expire_subscriptions()`, cron horaire |

**La coupure n'est pas un drapeau.** `suspended` ne figure dans aucun prédicat « ouvre des droits » : le membre est traité comme un non-abonné, par le même chemin que l'expiration. Il n'y a rien à « penser à lire » ailleurs.

### Ce qui n'est PAS touché par la suspension

- **Les réservations déjà faites** : rien dans ce lot ne lit `bookings`. Elles sont honorées.
- **Les crédits prépayés** : un membre suspendu retombe sur `debit_credit_fifo`, comme n'importe quel non-abonné. Abonnement et carnet de séances sont deux produits ; un impayé sur l'un ne confisque pas l'autre.

## 2. Ce que fait Mollie de son côté

> « Mollie will retry the failed payment up to 5 times. »
> « If your subscription payment does not succeed, Mollie may attempt it again up to 5 times (once a day), depending on the failure reason. »
> « Mollie will generally not cancel your subscription when a payment fails. »
> « After all retries have been exhausted, the subscription will be cancelled. »
> « Like regular payments your webhook is called for retrieving status updates. »
> — docs.mollie.com/docs/recurring-payments, consultée le 24/08/2026

Trois conséquences :

1. **Aucun lien de rattrapage n'est envoyé au membre.** Payer à la main pendant que Mollie représente le prélèvement produirait un double débit.
2. **Le webhook est rappelé jusqu'à 5 fois pour le même impayé.** `last_failed_payment_id` sert de clé d'idempotence, et le 1er courrier est adossé à la transition `payment_failed_at` NULL → now(). Le membre reçoit **un** email, pas cinq.
3. **La grâce (3 j) tombe dans la fenêtre de retry de Mollie (jusqu'à 5 j).** Assumé : on suspend au 3e jour même si Mollie peut encore réussir au 4e. La réactivation étant automatique, le coût d'une suspension prématurée est faible ; celui d'un mois d'accès gratuit ne l'est pas.

## 3. Les paramètres

Une seule valeur, citée à trois endroits qui se renvoient l'un à l'autre :

| Où | Quoi |
|---|---|
| `mollie-subscription-webhook/index.ts` | `const GRACE_DAYS = 3` — sert à **annoncer la date de coupure** dans le 1er email |
| `process-failed-renewals/index.ts` | `const GRACE_DAYS = 3` — argument passé au RPC |
| migration, `suspend_overdue_subscriptions(p_grace_days integer DEFAULT 3)` | défaut SQL |

⚠️ En changer une seule ferait annoncer au membre une date que le balayage ne respecterait pas.

## 4. Les courriers

| Quand | À qui | Gabarit |
|---|---|---|
| J0, premier échec du cycle | membre | `buildMemberFailureEmail` — « ton accès reste ouvert, Mollie représentera, coupure le \<date\> » |
| J0, premier échec du cycle | gérant (`nexxia_gyms.email`) | `buildOwnerAlertEmail(stage: 'failed')` |
| J+3, à la suspension | membre | `buildMemberSuspensionEmail` — dit aussi **ce qui marche encore** (réservations, crédits) |
| J+3, à la suspension | gérant | `buildOwnerAlertEmail(stage: 'suspended')` |

Tous passent par `_shared/gym-branding.ts` : couleurs, logo, pied de page et expéditeur de **la salle**.

⚠️ **`nexxia_gyms.email` est NULL en production** tant que la salle ne l'a pas renseignée (GYM-265 l'expose dans /settings). Sans destinataire, l'alerte gérant n'est pas envoyée — un `console.warn` le dit, et le statut reste visible au dashboard.

## 5. Ce que l'app mobile affiche AUJOURD'HUI — sans aucune modification

Le mobile est **hors périmètre de ce lot**. Voici son comportement par défaut, tracé de bout en bout.

**Membre `past_due` (J0 → J+3)** — l'accès est ouvert : rien ne change à l'écran. Il réserve normalement. *(Voir le point 2 du reste-à-faire : `lib/subscription.ts` côté mobile n'a pas été mis à jour, ce qui a une conséquence.)*

**Membre `suspended`, avec des crédits** — il réserve, et **un crédit est débité**. Aucun message ne lui dit pourquoi : de son point de vue, son abonnement a cessé de couvrir ses réservations du jour au lendemain.

**Membre `suspended`, sans crédit** — `create-booking` renvoie `402 PAYMENT_REQUIRED`, et `app/session/[id].tsx` ouvre la modale existante :

> **Réservation impossible**
> Vous n'avez pas d'abonnement actif ni de crédit disponible.
> · Souscrire un abonnement · Acheter un carnet 10 séances · Payer cette séance

🔴 **C'est le point le plus important de ce document.** Le message est techniquement exact mais **trompeur**, et surtout : il propose de **souscrire un nouvel abonnement** à un membre dont Mollie représente encore l'ancien. S'il accepte, il paie deux fois — exactement le double débit que ce lot évite par ailleurs en n'envoyant aucun lien de rattrapage.

## 6. Reste-à-faire UI (chantier mobile, non couvert ici)

Par ordre de gravité.

1. 🔴 **Cas `suspended` distinct dans la modale de réservation.** `create-booking` doit renvoyer un code dédié (p. ex. `SUBSCRIPTION_PAST_DUE`) plutôt que `PAYMENT_REQUIRED`, et l'app afficher « ton abonnement est suspendu, un prélèvement a échoué » **sans** proposer de souscrire à nouveau. Tant que ce n'est pas fait, un membre suspendu peut acheter un second abonnement.
2. 🟠 **`apps/mobile/lib/subscription.ts` ne connaît pas `past_due`.** Il porte la copie mobile du prédicat « ouvre des droits ». Pendant les 3 jours de grâce, l'app affichera donc « pas d'abonnement » à un membre que le serveur laisse réserver. Écart d'affichage, pas de perte d'accès — mais c'est exactement la divergence que GYM-195 a dû rattraper pour `canceling`.
3. 🟠 **Bandeau d'état sur l'écran d'accueil / profil** : « paiement en échec, accès jusqu'au \<date\> » puis « abonnement suspendu ». Aujourd'hui le membre n'a que l'email.
4. 🟡 **Page `/<slug>/subscription` dans `apps/links`.** Les emails pointent sur `bookings` faute de mieux : `apps/links/public/<slug>/` ne sert que `bookings` et `confirm-waitlist`, et `vercel.json` ne réécrit rien. Un `ctaPath: 'subscription'` produirait un 404 (le défaut de GYM-238).
5. 🟡 **Dashboard — vue « impayés ».** Le gérant voit le badge « Paiement en échec » dans la fiche membre, et reçoit les emails. Une liste dédiée (`/members?filter=past_due`) rendrait la relance actionnable.

## 7. Choix assumés, à rouvrir si besoin

**Aucune ligne `payments` n'est créée pour une échéance échouée.** `/revenus` lit `payments` sans filtrer le statut : y injecter des tentatives refusées changerait la lecture du chiffre d'affaires de toutes les salles. La trace vit sur `member_subscriptions` (`last_failed_payment_id`, `payment_failed_count`), qui n'est lue par aucun calcul d'argent. À rouvrir le jour où `/revenus` gagne un onglet « impayés ».

**Un refus bancaire ordinaire ne part PAS dans #viniz-bugs.** `recordWebhookFailure` alimente une file de triage de **défauts** ; une carte expirée n'en est pas un, et noyer le canal ferait manquer les vrais. Y partent en revanche les anomalies : échéance échouée **sans ligne d'abonnement correspondante**, ou échec d'écriture. L'information métier va au gérant, par email.

**Un `canceling` ne devient pas `past_due`.** Ce statut porte « résiliation demandée, accès dû jusqu'au terme » (GYM-113/195), qu'aucune autre colonne ne réplique. Les colonnes de suivi sont renseignées, le statut est préservé.

## 8. Recette staging — scénario complet

⚠️ **Rien n'est déployé.** Déployer d'abord la migration, `mollie-subscription-webhook` et `process-failed-renewals` sur staging.

Remplacer `<SUB_ID>`, `<MEMBER_ID>`, `<GYM_ID>`, `<SLOT_ID>` par des valeurs réelles.

### 8.0 — Point de départ

```sql
select id, member_id, status, plan_name, amount, ends_at,
       payment_failed_at, payment_failed_count, payment_suspended_at, last_failed_payment_id
from member_subscriptions where id = '<SUB_ID>';
-- attendu : status='active', les quatre colonnes de suivi à NULL/0
```

### 8.1 — J0 : simuler l'échec

Deux façons. **(a) Bout en bout** — depuis le dashboard Mollie test, forcer un paiement d'échéance en `failed` ; Mollie appelle le webhook. **(b) Appel direct du webhook signé** :

```bash
curl -i -X POST \
  "https://buovgpokubrkejunmauq.supabase.co/functions/v1/mollie-subscription-webhook?secret=<MOLLIE_WEBHOOK_SECRET>&gym_id=<GYM_ID>" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data 'id=tr_<ID_PAIEMENT_ECHOUE_CHEZ_MOLLIE>'
```

⚠️ Le paiement doit **exister chez Mollie** en statut `failed` avec `sequenceType=recurring` et la metadata `member_id`/`gym_id` : la fonction relit le paiement chez Mollie et refuse (403) toute divergence de `gym_id`. Un id inventé ne teste rien.

**Attendu**

```sql
select status, payment_failed_at, payment_failed_count, last_failed_payment_id
from member_subscriptions where id = '<SUB_ID>';
-- status='past_due', payment_failed_at ≈ now(), count=1, last_failed_payment_id=tr_…
```

- Email membre « Ton paiement n'est pas passé », annonçant la coupure à **J+3**.
- Email gérant « Renouvellement échoué — \<nom\> » (si `nexxia_gyms.email` est renseigné).
- Dashboard → fiche membre → badge ambre **« Paiement en échec »**.

### 8.2 — L'accès reste ouvert pendant la grâce

Réserver un créneau depuis l'app avec ce membre : **la réservation passe, aucun crédit n'est débité.**

```sql
select id, status, credit_id from bookings
where member_id='<MEMBER_ID>' and slot_id='<SLOT_ID>';
-- status='confirmed', credit_id IS NULL  ← le crédit n'a PAS été touché
```

### 8.3 — Rejeu Mollie : pas de spam

Rejouer **exactement** le même appel qu'en 8.1.

**Attendu** : `200`, log `renewal failure already processed — idempotent skip`, `payment_failed_count` **toujours à 1**, **aucun email**.

### 8.4 — J+3 : la suspension

Antidater la grâce, puis lancer le balayage :

```sql
update member_subscriptions
set payment_failed_at = now() - interval '4 days'
where id = '<SUB_ID>';
```

```bash
curl -i -X POST \
  "https://buovgpokubrkejunmauq.supabase.co/functions/v1/process-failed-renewals" \
  -H 'Content-Type: application/json' \
  -H "X-Internal-Secret: <INTERNAL_FUNCTIONS_SECRET>"
```

**Attendu** : `{"suspended":1,"member_emails":1,"owner_emails":1}`

```sql
select status, payment_suspended_at from member_subscriptions where id = '<SUB_ID>';
-- status='suspended', payment_suspended_at ≈ now()
```

- Email membre « Ton abonnement est suspendu », **listant ce qui fonctionne encore**.
- Email gérant « Accès suspendu pour impayé ».

**Rejouer le balayage immédiatement** → `{"suspended":0,…}` et aucun email : l'idempotence est dans le `RETURNING` du RPC.

### 8.5 — Les droits sont réellement coupés

**(a) Symétrie — les réservations déjà faites tiennent.** La réservation de 8.2 est toujours `confirmed`.

**(b) Sans crédit → refus.** Vider les crédits du membre, puis réserver depuis l'app :

```sql
select credits_remaining from member_credits where member_id='<MEMBER_ID>';
```

→ `402 PAYMENT_REQUIRED`, modale « Réservation impossible » (cf. §5 — texte trompeur, point 1 du reste-à-faire).

**(c) Symétrie — les crédits restent consommables.** Créditer une séance (`adjust-credits`), réserver :

```sql
select status, credit_id from bookings where member_id='<MEMBER_ID>' order by booked_at desc limit 1;
-- status='confirmed', credit_id NOT NULL  ← un crédit a été débité, comme pour tout non-abonné
```

### 8.6 — Régularisation : réactivation automatique

Rejouer le webhook avec un paiement d'échéance **réussi** (`status=paid`, `sequenceType=recurring`) :

```sql
select status, payments_count, payment_failed_at, payment_failed_count,
       payment_suspended_at, last_failed_payment_id
from member_subscriptions where id = '<SUB_ID>';
-- status='active', payments_count +1, et LES QUATRE COLONNES DE SUIVI REMISES À ZÉRO
```

⚠️ **La remise à zéro est le point à vérifier le plus attentivement.** Sans elle, le prochain impayé repartirait avec `payment_failed_at` déjà renseigné et **n'enverrait aucun courrier** — un impayé silencieux au deuxième cycle, le plus difficile à diagnostiquer.

Réserver à nouveau → passe **sans débit de crédit**.

### 8.7 — Le terme ferme la boucle

```sql
update member_subscriptions set ends_at = now() - interval '1 hour' where id = '<SUB_ID>';
select * from expire_subscriptions();
select status from member_subscriptions where id = '<SUB_ID>';  -- 'expired'
```

À vérifier aussi depuis un état `suspended` **pour impayé** (`payment_suspended_at` non nul) : il doit s'expirer. Une suspension **manuelle** (`payment_suspended_at` NULL), elle, ne doit **pas** être touchée — c'est l'invariant de GYM-195, préservé.

### 8.8 — Le cron

```sql
select jobname, schedule, active from cron.job where jobname = 'process-failed-renewals';
-- '10 7 * * *', active
select status, return_message from cron.job_run_details
where jobid = (select jobid from cron.job where jobname='process-failed-renewals')
order by start_time desc limit 3;
```
