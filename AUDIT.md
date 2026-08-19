# AUDIT FACTUEL — gymbook-app

> État des lieux en **lecture seule** du code réellement présent dans le repo, pour réconciliation avec Linear (GYM-) et la roadmap Notion.
> Date : 2026-06-16 · Branche : `develop` · Méthode : preuve par chemin de fichier (+ ligne). « NON TROUVÉ » = absence vérifiée, pas supposition.
> Périmètre : seul le **code versionné** est audité. Plusieurs objets DB tournent en prod sans être dans le repo (voir INCOHÉRENCES / gap GYM-59).

---

## ÉTAPE 1 — CARTOGRAPHIE

### Arborescence haut niveau
| Domaine | Emplacement |
|---|---|
| Mobile (React Native + Expo) | `apps/mobile/` (routes Expo Router dans `apps/mobile/app/`) |
| Dashboard gérant (React + Vite) | `apps/dashboard/` (src dans `apps/dashboard/src/`, React Router) |
| `apps/admin/` | **VIDE** (dossier présent, aucun fichier) |
| Edge Functions (Deno) | `supabase/functions/` (17 fonctions + `_shared/`) |
| Migrations | `supabase/migrations/` (6 fichiers) |
| Packages partagés | `packages/i18n`, `packages/types`, `packages/ui` |
| `supabase/config.toml` | **NON TROUVÉ** — non versionné (seuls `supabase/.temp/` existent) |

### Edge Functions présentes (17)
`cancel-booking`, `cancel-subscription`, `confirm-waitlist`, `create-booking`, `create-payment`, `create-subscription`, `generate-invoice`, `get-progression`, `mollie-connect-oauth`, `mollie-subscription-webhook`, `mollie-webhook`, `notify-waitlist`, `send-communication`, `send-noshow-notification`, `send-notification`, `send-reminders` · partagé : `_shared/mollie-token.ts`.

### Tables référencées dans les migrations (`CREATE TABLE`)
`activities`, `activity_translations`, `audit_logs`, `bookings`, `coach_sites`, `coaches`, `consent_history`, `favorites`, `gdpr_requests`, `gym_mollie_connections`, `gym_plan_translations`, `gym_plans`, `gym_sites`, `gym_transactions`, `login_attempts`, `medical_notes`, `member_subscriptions`, `nexxia_features`, `nexxia_gyms`, `nexxia_invoices`, `nexxia_plan_limits`, `nexxia_subscriptions`, `noshow_rules`, `notifications`, `oauth_states`, `penalties`, `profiles`, `rate_limits`, `time_slots`, `user_devices`.

⚠️ **Tables utilisées par le code mais ABSENTES des migrations** : `payments`, `member_credits`, `gym_communications` (voir INCOHÉRENCES).

---

## ÉTAPE 2 — AUDIT FEATURE PAR FEATURE

| # | Feature | Statut | Fichiers preuve | Note |
|---|---|---|---|---|
| 1 | Auth membre + Google + Apple + biométrie | **FAIT** | `apps/mobile/stores/useAuthStore.ts:61-102`, `lib/oauth.ts:36-103`, `components/auth/OAuthButtons.tsx:13-80`, `app/auth/callback.tsx`, `hooks/useBiometrics.ts`, `app/(auth)/login.tsx:28-66` | Bio réellement câblée au login (auto-prompt + activation post-login). Apple iOS-only. |
| 2 | Home J/J+1/J+2, Schedule filtrable, favoris | **PARTIEL** | `app/(tabs)/index.tsx`, `hooks/useHomeSchedule.ts:34-42`, `hooks/useSchedule.ts` (filtres activité/semaine/coach), `stores/useBookingStore.ts:45,255-261` | Home + Schedule OK. **Favoris en RAM Zustand non persistés** (pas d'AsyncStorage ni table `favorites` câblée) → perdus au redémarrage. Filtres activité hardcodés (`FilterPills.tsx:54-62`). |
| 3 | Flow réservation + garde paiement (abo OU crédit) | **FAIT** | `supabase/functions/create-booking/index.ts:158-197` (guard GYM-63), `app/session/[id].tsx:215-250`, `stores/useBookingStore.ts:53` | Guard abo/crédit présent côté backend + UI (`PaymentRequiredSheet`). Voir RISQUES (crédit débité avant check capacité). |
| 4 | Annulation + waitlist | **FAIT** | `cancel-booking/index.ts`, `notify-waitlist/index.ts`, `confirm-waitlist/index.ts`, `app/session/[id].tsx:252-290`, `components/shared/WaitlistCountdown.tsx` | RPC `promote_next_in_waitlist` / `reorder_waitlist` (non versionnés). |
| 5 | No-show auto + pénalités/suspensions + cron | **PARTIEL** | `send-noshow-notification/index.ts` (RPC `process_no_shows`), `migrations/20260521_004_gym32_33_cron_jobs.sql:25-37`, garde suspension `create-booking/index.ts:96-107` | Cron `process-no-shows` toutes les 30 min OK. Paliers warning/48h/2sem. **La logique de détection+pénalité (`process_no_shows`) n'est PAS dans le repo** — RPC prod uniquement. |
| 6 | Rappels 24h/2h + cron | **PARTIEL** | `send-reminders/index.ts` (RPC `get_pending_reminders` / `mark_reminder_sent`), `migrations/...004:11-23` | Cron `send-booking-reminders` toutes les 15 min OK. RPC sous-jacents **non versionnés**. |
| 7 | Paiements one-time Mollie | **FAIT** | `create-payment/index.ts`, `mollie-webhook/index.ts` | Webhook protégé par `?secret=`, rate-limit, validation format ID. Voir RISQUES (montant client-supplied). |
| 8 | Abonnements SEPA | **PARTIEL** | `create-subscription/index.ts:101-176`, `mollie-subscription-webhook/index.ts:8-11`, `cancel-subscription/index.ts` | Création lit `gym_plans` (DB). **Mais le webhook récurrent utilise une map prix HARDCODÉE** (double source de vérité — voir 3b / RISQUES). |
| 9 | Factures | **FAIT** | `generate-invoice/index.ts` (RPC `allocate_invoice_number`, non versionné), `app/profile/payments.tsx:74-95` | Génère HTML + envoi email Resend. |
| 10 | Communications gérant→membres | **FAIT** | `apps/dashboard/src/pages/Communications.tsx:127` → `invoke('send-communication')`, `send-communication/index.ts` | Drafts dans `gym_communications` (table non versionnée), RPC `get_communication_recipients` (non versionné). SMS/WhatsApp = TODO. |
| 11 | /studio « Ma Progression » | **FAIT** | `app/(tabs)/studio.tsx`, `hooks/useProgression.ts`, `get-progression/index.ts`, `utils/gamification.ts` | Histogramme 30j + streak + heatmap 6 mois + niveaux. **Écran entièrement en français hardcodé** (viole règle i18n — voir RISQUES). |
| 12 | Sous-pages profil | **FAIT** | `app/profile/security.tsx`, `preferences.tsx:85-101`, `subscription.tsx`, `payments.tsx` | Sécurité (mdp+bio), prefs notif (8 toggles), sélecteur langue FR/EN→`preferred_language`+i18n, abo+crédits. |
| 13 | Dashboard : CRUD créneaux/activités/coaches, planning, paiements | **PARTIEL** | `hooks/usePlanning.ts:306-362`, `hooks/useActivities.ts:60-134`, `hooks/useCoaches.ts:48-94`, `pages/Planning.tsx` (FullCalendar), `pages/Payments.tsx` | CRUD time_slots/activities/coaches OK, planning calendrier OK, page paiements OK. **Manque : CRUD plans/formules** (route `/plans` = placeholder). |
| 14 | Multilingue DB | **PARTIEL** | migrations : `activity_translations`, `gym_plan_translations`, `profiles.preferred_language`, `nexxia_gyms` (default/supported_languages) | Schéma DB i18n présent. **Locales front réelles = FR/EN seulement** ; `nl.json`/`de.json` = `{}` vides ; `packages/i18n/*.json` = 0 octet. |

---

## ÉTAPE 3 — VÉRIFICATIONS CIBLÉES

**a. `verify_jwt` des webhooks Mollie** → **NON TROUVÉ dans le repo.** `supabase/config.toml` n'est pas versionné (`git ls-files` : aucun résultat). Le réglage effectif ne peut donc pas être confirmé depuis le code. **Au niveau code**, `mollie-webhook/index.ts:11-18` et `mollie-subscription-webhook/index.ts:17-` s'auto-protègent par un guard `?secret=` (et renvoient 200 sur rejet pour éviter les retries) — design cohérent avec un déploiement en `verify_jwt = false` (endpoint public appelé par Mollie). À vérifier manuellement côté prod.

**b. Prix des plans (120/110/95€)** :
- **SEPA (création)** : lus depuis la table `gym_plans` → `create-subscription/index.ts:101-102` (`price_cents`), `:168`.
- **SEPA (webhook récurrent)** : **HARDCODÉS** dans `mollie-subscription-webhook/index.ts:8-11` (`monthly_3: 120.00`, `monthly_6: 110.00`, `monthly_12: 95.00`) — c'est cette valeur qui sert à créer l'abonnement Mollie (`:130 amount: plan.amount`). **Double source de vérité.**
- **One-time** : montant **fourni par le client** (`create-payment/index.ts:80`), aucune table consultée pour le prix.
- **CRUD dashboard** : **NON TROUVÉ.** Route `/plans` = `PlaceholderPage` (`apps/dashboard/src/App.tsx:74-81`), onglet Settings `plans` vide. Table `gym_plans` orpheline côté front (jamais lue/écrite hors test RLS). **Les prix ne sont éditables nulle part dans le dashboard.**

**c. Table `coaches`** → colonne **`name` UNIQUE** (pas first/last). Preuve : insert `name: \`${firstName} ${lastName}\`.trim()` (`apps/dashboard/src/hooks/useCoaches.ts:52`), lecture + `split(' ')` (`:7-11`), confirmé `usePlanning.ts:57` (`coaches(id, name, active)`) et `create-booking/index.ts:112` (`coaches(name)`). Le formulaire expose 2 champs first/last (`CoachModal.tsx:144-163`) → reconstruction fragile.

**d. Animations count-up `studio.tsx`** → **MIXTE** :
- Compteurs numériques `AnimatedNumber` (streak/mois/total) : `useEffect(..., [value])` → `studio.tsx:35` ✅ (re-déclenche sur arrivée des données).
- Jauges `LevelCard` `[progress]` (`:50`), `AttendanceCard` `[rate]` (`:134`) ✅.
- `HistoBar` : `useEffect(..., [])` → `studio.tsx:238` (au montage).
- `HeatmapCell` : `useEffect(..., [])` → `studio.tsx:332` (au montage).
- Nuance : les cartes ne montent qu'après le loader (`:401-414`), donc en pratique l'animation `[]` joue avec les vraies données ; mais histogramme/heatmap **ne se ré-animent pas** sur refetch, contrairement aux compteurs.

**e. Secrets en dur** → **Aucun secret de production hardcodé** dans le code des Edge Functions ni des apps : tout passe par `Deno.env.get(...)` (Mollie, Resend, Supabase service key). Exceptions / nuances :
- URL projet Supabase en dur `https://fcjupgvmjkqztxtwymdb.supabase.co` (`create-payment:133`, `create-subscription:173`, migration cron) — non secret mais couplage en dur.
- **Anon key JWT committée** dans `apps/dashboard/src/tests/rls-isolation.test.ts:7` (projet `buovgpokubrkejunmauq`, ≠ prod) — clé anon (semi-publique) mais à ne pas committer.
- `.env`, `.env.local`, `.env.staging` présents sur disque mais **non versionnés** (seul `.env.example` est tracké) ✅.

---

## INCOHÉRENCES

1. **Gap de gouvernance DB (GYM-59) — critique.** Objets utilisés par le code mais **absents des migrations** :
   - Tables : `payments`, `member_credits`, `gym_communications`.
   - RPC : `process_no_shows`, `get_communication_recipients`, `allocate_invoice_number`, `get_gym_mollie_tokens`, `get_pending_reminders`, `mark_reminder_sent`, `promote_next_in_waitlist`, `reorder_waitlist`.
   → Le schéma prod n'est pas reproductible depuis le repo. Un environnement neuf monté depuis `supabase/migrations/` serait **cassé** (réservation, no-show, rappels, factures, communications).
2. **Double source de vérité sur les prix SEPA** : `gym_plans` (création) vs map hardcodée (webhook récurrent). Un changement de prix en DB ne se répercutera pas sur les renouvellements.
3. **Table `gym_plans` orpheline côté produit** : existe en DB + a des traductions (`gym_plan_translations`), mais aucun CRUD dashboard et seule la création d'abo la lit. Les prix one-time ne la consultent pas du tout.
4. **Table `favorites` orpheline** : créée en migration + cleanup cron (`cleanup_expired_favorites`), mais l'app mobile gère les favoris en mémoire et ne lit/écrit jamais cette table.
5. **Modèle coaches incohérent** : DB `name` unique vs UI first/last → `split(' ')` casse sur noms/prénoms composés. `sites` hardcodé `['Neupré']` (`useCoaches.ts:16`), non persisté alors qu'une table `coach_sites` existe.
6. **`apps/admin/` vide** : dossier prévu, aucun code.
7. **i18n partiel malgré la règle « no hardcoded strings »** : `studio.tsx` entièrement FR en dur ; pages Mollie dashboard (`MollieCallback`/`PaymentSuccess`/`PaymentCancel`) sans `useTranslation` ; labels de statuts paiements en dur ; locales NL/DE et `packages/i18n` vides.

## RISQUES TECHNIQUES

- **🔴 Montant de paiement contrôlé par le client** (`create-payment/index.ts:80,83`) : `amount` vient du body, validé seulement `> 0`. Les crédits sont attribués selon `payment_type` (`:180-182`, drop_in=1 / card_10=10) **sans recouper le montant**. Un client peut payer 0,01 € pour 10 crédits. **Argent réel exposé — à corriger en priorité** (prix serveur autoritatif par `payment_type`).
- **🔴 Prix de renouvellement SEPA hardcodés** (`mollie-subscription-webhook:8-11`) : tout changement tarifaire en base est silencieusement ignoré sur les prélèvements récurrents.
- **🟠 Crédit débité avant le check de capacité** (`create-booking/index.ts:189-197` exécuté avant `:201`) : un membre payant qui tombe sur un cours plein passe en liste d'attente **mais perd un crédit**. Pas de remboursement visible si la waitlist n'aboutit pas.
- **🟠 Course/over-booking possible** : capacité vérifiée puis insert **sans transaction ni verrou** (`create-booking:201-267`). L'idempotency key empêche les doublons d'un même membre, pas deux membres simultanés sur la dernière place.
- **🟠 Schéma non reproductible** (gap GYM-59) : impossible de recréer staging/prod depuis les migrations ; tout rollback/DR repose sur l'état live non versionné.
- **🟠 Favoris volatiles** : perte silencieuse à chaque redémarrage de l'app (dette UX).
- **🟡 CORS `Access-Control-Allow-Origin: '*'`** sur les fonctions authentifiées (`create-booking`, `create-payment`, …) — acceptable avec JWT mais large.
- **🟡 Webhooks « toujours 200 »** : masque les vraies erreurs de traitement (un paiement non réconcilié renvoie quand même 200) → pas de retry Mollie, détection silencieuse difficile sans monitoring.
- **🟡 Anon key committée** dans un fichier de test (`rls-isolation.test.ts:7`).

---

## RÉSUMÉ (5 lignes)

1. Le produit est **largement implémenté** : auth complète (Google/Apple/bio), réservation+waitlist+garde paiement, no-show/rappels par cron, Mollie one-time + SEPA, factures, progression studio, dashboard CRUD créneaux/activités/coaches.
2. **Trou fonctionnel principal** : aucun CRUD des plans/formules dans le dashboard (route placeholder) — les prix 120/110/95 € ne sont éditables nulle part.
3. **Risque argent #1** : `create-payment` fait confiance au montant envoyé par le client et accorde les crédits sur le seul `payment_type` → à sécuriser d'urgence ; prix SEPA récurrents hardcodés en doublon de `gym_plans`.
4. **Risque structurel** : gap de gouvernance DB (GYM-59) — tables `payments`/`member_credits`/`gym_communications` et ~8 RPC critiques tournent en prod **sans migration versionnée** ; schéma non reproductible.
5. **Dette** : favoris non persistés, modèle coaches `name`/split fragile, i18n incomplet (studio FR en dur, NL/DE vides), `config.toml` non versionné (réglage `verify_jwt` des webhooks invérifiable depuis le repo).
