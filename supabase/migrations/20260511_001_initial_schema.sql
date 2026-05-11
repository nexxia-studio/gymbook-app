-- ============================================================================
-- GYMBOOK — SCHÉMA BASE DE DONNÉES COMPLET & DÉFINITIF
-- Plateforme SaaS multi-tenant de réservation pour salles de sport
-- Version : 3.0 — Schéma final intégrant TOUS les points discutés
--
-- Nouveautés v3 vs v2 :
-- ✅ Multi-sites par tenant (gym_sites)
-- ✅ Mollie Connect OAuth (gym_mollie_connections + oauth_states)
-- ✅ Formules configurables par gérant (billing_type sur gym_plans)
-- ✅ Multi-langue i18n (gym_translations + user language preference)
-- ✅ Self-service onboarding (onboarding_step, trial, plan_limits)
-- ✅ table nexxia_plan_limits (Free / Pro / Pro+)
-- ✅ Données médicales chiffrées (medical_notes via Vault)
-- ✅ Rate limiting + login attempts
-- ✅ RGPD complet (gdpr_requests, consent_history)
-- ✅ Notifications multi-devices (user_devices séparé)
-- ✅ Audit logs complets
-- ✅ i18next ready (champs language + translations)
--
-- Stack : Supabase (PostgreSQL 15+) + Auth + RLS + Vault + Edge Functions
-- Région : Frankfurt (EU — conformité RGPD)
-- Premier tenant : Move95 (Neupré, Belgique) — Nico
--
-- INSTRUCTIONS :
-- 1. Créer projet Supabase région Frankfurt
-- 2. Activer Supabase Vault
-- 3. Activer pg_cron (pour les jobs automatiques)
-- 4. Exécuter ce fichier dans SQL Editor → Run
-- ============================================================================

-- ============================================================================
-- EXTENSIONS
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "supabase_vault";
CREATE EXTENSION IF NOT EXISTS "pg_cron";

-- ============================================================================
-- COUCHE 1 — INFRASTRUCTURE NEXXIA (SUPER ADMIN)
-- ============================================================================

-- Tenants : salles clientes de Nexxia
CREATE TABLE nexxia_gyms (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    TEXT NOT NULL,
  slug                    TEXT UNIQUE NOT NULL,
  subdomain               TEXT UNIQUE,
  -- Coordonnées
  address                 TEXT,
  city                    TEXT,
  postal_code             TEXT,
  country                 TEXT DEFAULT 'BE',
  phone                   TEXT,
  email                   TEXT,
  vat_number              TEXT,
  company_name            TEXT,
  -- Branding
  logo_url                TEXT,
  primary_color           TEXT DEFAULT '#C8F000',
  secondary_color         TEXT DEFAULT '#111111',
  -- Mollie (référence Vault — jamais de clé en clair)
  mollie_vault_secret_id  UUID,
  mollie_profile_id       TEXT,
  -- Status & plan Nexxia
  status                  TEXT DEFAULT 'trialing'
                          CHECK (status IN ('active', 'trialing', 'suspended', 'cancelled')),
  plan                    TEXT DEFAULT 'free'
                          CHECK (plan IN ('free', 'starter', 'pro', 'pro_plus')),
  -- Trial / onboarding self-service
  trial_started_at        TIMESTAMPTZ DEFAULT now(),
  trial_ends_at           TIMESTAMPTZ DEFAULT (now() + INTERVAL '14 days'),
  onboarding_completed    BOOLEAN DEFAULT false,
  onboarding_step         INTEGER DEFAULT 1
                          CHECK (onboarding_step BETWEEN 1 AND 5),
  -- Configuration locale (multi-langue)
  timezone                TEXT DEFAULT 'Europe/Brussels',
  currency                TEXT DEFAULT 'EUR',
  default_language        TEXT DEFAULT 'fr'
                          CHECK (default_language IN ('fr', 'nl', 'en', 'de', 'lb')),
  supported_languages     TEXT[] DEFAULT ARRAY['fr'],
  -- RGPD
  dpo_name                TEXT,
  dpo_email               TEXT,
  -- Métadonnées
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now(),
  deleted_at              TIMESTAMPTZ
);

CREATE INDEX idx_gyms_slug ON nexxia_gyms(slug) WHERE deleted_at IS NULL;
CREATE INDEX idx_gyms_status ON nexxia_gyms(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_gyms_plan ON nexxia_gyms(plan) WHERE deleted_at IS NULL;

-- ─── Limites par plan (Free / Starter / Pro / Pro+) ──────────────────────
CREATE TABLE nexxia_plan_limits (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan                    TEXT NOT NULL UNIQUE
                          CHECK (plan IN ('free', 'starter', 'pro', 'pro_plus')),
  -- Limites membres et créneaux
  max_members             INTEGER,              -- NULL = illimité
  max_slots_per_month     INTEGER,              -- NULL = illimité
  max_admins              INTEGER DEFAULT 1,
  max_sites               INTEGER DEFAULT 1,    -- multi-sites
  -- Trial
  trial_days              INTEGER DEFAULT 14,
  -- Features incluses
  custom_domain           BOOLEAN DEFAULT false,
  payments_enabled        BOOLEAN DEFAULT false,
  notifications_enabled   BOOLEAN DEFAULT false,
  analytics_enabled       BOOLEAN DEFAULT false,
  multi_site_enabled      BOOLEAN DEFAULT false,
  ios_app_enabled         BOOLEAN DEFAULT false,
  android_app_enabled     BOOLEAN DEFAULT false,
  qr_checkin_enabled      BOOLEAN DEFAULT false,
  export_enabled          BOOLEAN DEFAULT false,
  api_access_enabled      BOOLEAN DEFAULT false,
  -- Prix Nexxia (centimes)
  price_cents             INTEGER DEFAULT 0,
  created_at              TIMESTAMPTZ DEFAULT now()
);

-- Données initiales des plans
INSERT INTO nexxia_plan_limits
  (plan, max_members, max_slots_per_month, max_admins, max_sites,
   trial_days, custom_domain, payments_enabled, notifications_enabled,
   analytics_enabled, multi_site_enabled, ios_app_enabled,
   android_app_enabled, qr_checkin_enabled, export_enabled,
   api_access_enabled, price_cents)
VALUES
  ('free',     30,   10,   1,  1, 14, false, false, false, false, false, false, false, false, false, false, 0),
  ('starter',  100,  50,   2,  1, 14, false, true,  true,  false, false, false, false, true,  false, false, 15000),
  ('pro',      NULL, NULL, 5,  3, 14, true,  true,  true,  true,  false, true,  false, true,  true,  false, 20000),
  ('pro_plus', NULL, NULL, 10, 10, 14, true, true,  true,  true,  true,  true,  true,  true,  true,  true,  25000);

-- Abonnements des gérants vers Nexxia (B2B)
CREATE TABLE nexxia_subscriptions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id                  UUID NOT NULL REFERENCES nexxia_gyms(id) ON DELETE CASCADE,
  plan                    TEXT NOT NULL
                          CHECK (plan IN ('free', 'starter', 'pro', 'pro_plus')),
  status                  TEXT DEFAULT 'active'
                          CHECK (status IN ('active', 'past_due', 'cancelled', 'trialing')),
  amount_cents            INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency                TEXT DEFAULT 'EUR',
  billing_cycle           TEXT DEFAULT 'monthly'
                          CHECK (billing_cycle IN ('monthly', 'yearly')),
  current_period_start    TIMESTAMPTZ,
  current_period_end      TIMESTAMPTZ,
  -- Engagement
  commitment_months       INTEGER DEFAULT 24,
  commitment_ends_at      TIMESTAMPTZ,
  -- Mollie B2B
  mollie_subscription_id  TEXT UNIQUE,
  mollie_customer_id      TEXT,
  -- Annulation
  cancelled_at            TIMESTAMPTZ,
  cancellation_reason     TEXT,
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_nexxia_subs_gym ON nexxia_subscriptions(gym_id);
CREATE INDEX idx_nexxia_subs_status ON nexxia_subscriptions(status);

-- Feature flags par tenant (override des limites plan)
CREATE TABLE nexxia_features (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id      UUID NOT NULL REFERENCES nexxia_gyms(id) ON DELETE CASCADE,
  feature     TEXT NOT NULL CHECK (feature IN (
                'ios_app', 'android_app', 'web_app',
                'analytics', 'multi_site', 'marketing_emails',
                'sms_notifications', 'custom_branding', 'api_access',
                'qr_code_checkin', 'waitlist_priority', 'gift_cards',
                'payments_enabled', 'export_enabled', 'medical_notes'
              )),
  enabled     BOOLEAN DEFAULT false,
  config      JSONB,
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(gym_id, feature)
);

CREATE INDEX idx_features_gym ON nexxia_features(gym_id);

-- Factures Nexxia → Gérants (B2B)
CREATE TABLE nexxia_invoices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id            UUID NOT NULL REFERENCES nexxia_gyms(id),
  subscription_id   UUID REFERENCES nexxia_subscriptions(id),
  invoice_number    TEXT UNIQUE NOT NULL,
  amount_cents      INTEGER NOT NULL,
  vat_cents         INTEGER DEFAULT 0,
  total_cents       INTEGER NOT NULL,
  currency          TEXT DEFAULT 'EUR',
  status            TEXT DEFAULT 'pending'
                    CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
  mollie_payment_id TEXT,
  pdf_url           TEXT,
  due_at            TIMESTAMPTZ,
  paid_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_invoices_gym ON nexxia_invoices(gym_id);
CREATE INDEX idx_invoices_status ON nexxia_invoices(status);

-- ============================================================================
-- COUCHE 2 — MOLLIE CONNECT OAUTH
-- ============================================================================

-- États OAuth temporaires (anti-CSRF)
CREATE TABLE oauth_states (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state       TEXT NOT NULL UNIQUE,
  gym_id      UUID NOT NULL REFERENCES nexxia_gyms(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_oauth_states_expires ON oauth_states(expires_at);

-- Connexions Mollie par tenant (OAuth tokens dans Vault)
CREATE TABLE gym_mollie_connections (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id                    UUID NOT NULL UNIQUE REFERENCES nexxia_gyms(id) ON DELETE CASCADE,
  -- Tokens stockés dans Supabase Vault (jamais en clair)
  access_token_vault_id     UUID,
  refresh_token_vault_id    UUID,
  -- Métadonnées non sensibles
  mollie_profile_id         TEXT,
  mollie_account_id         TEXT,
  mollie_account_name       TEXT,
  scope                     TEXT[],
  expires_at                TIMESTAMPTZ,
  connected_at              TIMESTAMPTZ DEFAULT now(),
  last_refreshed_at         TIMESTAMPTZ,
  status                    TEXT DEFAULT 'active'
                            CHECK (status IN ('active', 'expired', 'revoked'))
);

CREATE INDEX idx_mollie_connections_gym ON gym_mollie_connections(gym_id);
CREATE INDEX idx_mollie_connections_status ON gym_mollie_connections(status);

-- Nettoyage automatique des states OAuth expirés
CREATE OR REPLACE FUNCTION cleanup_oauth_states()
RETURNS void LANGUAGE SQL AS $$
  DELETE FROM oauth_states WHERE expires_at < now();
$$;

SELECT cron.schedule('cleanup-oauth-states', '0 * * * *', 'SELECT cleanup_oauth_states()');

-- ============================================================================
-- COUCHE 3 — UTILISATEURS & PROFILS
-- ============================================================================

-- Profils (extension de auth.users)
CREATE TABLE profiles (
  id                          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  gym_id                      UUID REFERENCES nexxia_gyms(id),
  role                        TEXT NOT NULL
                              CHECK (role IN ('super_admin', 'gym_admin', 'coach', 'member')),
  -- Identité
  first_name                  TEXT,
  last_name                   TEXT,
  email                       TEXT NOT NULL,
  phone                       TEXT,
  date_of_birth               DATE,
  gender                      TEXT CHECK (gender IN ('male', 'female', 'other', 'prefer_not_say')),
  avatar_url                  TEXT,
  -- Adresse
  address_line                TEXT,
  city                        TEXT,
  postal_code                 TEXT,
  country                     TEXT DEFAULT 'BE',
  -- Contact d'urgence
  emergency_contact_name      TEXT,
  emergency_contact_phone     TEXT,
  -- Préférences (multi-langue)
  preferred_language          TEXT DEFAULT 'fr'
                              CHECK (preferred_language IN ('fr', 'nl', 'en', 'de', 'lb')),
  -- Gamification profil
  profile_completion          INTEGER DEFAULT 0
                              CHECK (profile_completion BETWEEN 0 AND 100),
  reward_unlocked             BOOLEAN DEFAULT false,
  -- No-show & suspension
  noshow_count                INTEGER DEFAULT 0,
  suspended_until             TIMESTAMPTZ,
  -- 2FA
  two_factor_enabled          BOOLEAN DEFAULT false,
  two_factor_required         BOOLEAN DEFAULT false,
  -- RGPD — Consentements
  privacy_policy_accepted_at  TIMESTAMPTZ,
  privacy_policy_version      TEXT,
  terms_accepted_at           TIMESTAMPTZ,
  terms_version               TEXT,
  marketing_consent           BOOLEAN DEFAULT false,
  marketing_consent_at        TIMESTAMPTZ,
  data_processing_consent     BOOLEAN DEFAULT false,
  data_processing_consent_at  TIMESTAMPTZ,
  -- Métadonnées
  member_since                TIMESTAMPTZ DEFAULT now(),
  last_seen_at                TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ DEFAULT now(),
  updated_at                  TIMESTAMPTZ DEFAULT now(),
  -- Soft delete (droit à l'oubli)
  deleted_at                  TIMESTAMPTZ,
  deletion_requested_at       TIMESTAMPTZ
);

CREATE INDEX idx_profiles_gym_role ON profiles(gym_id, role) WHERE deleted_at IS NULL;
CREATE INDEX idx_profiles_email ON profiles(email) WHERE deleted_at IS NULL;

-- Coaches
CREATE TABLE coaches (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id      UUID NOT NULL REFERENCES nexxia_gyms(id) ON DELETE CASCADE,
  profile_id  UUID REFERENCES profiles(id),
  name        TEXT NOT NULL,
  bio         TEXT,
  photo_url   TEXT,
  specialties TEXT[],
  active      BOOLEAN DEFAULT true,
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_coaches_gym ON coaches(gym_id) WHERE active = true;

-- Devices (push notifications — séparé car un user peut avoir plusieurs devices)
CREATE TABLE user_devices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  device_type     TEXT CHECK (device_type IN ('ios', 'android', 'web')),
  device_name     TEXT,
  push_token      TEXT NOT NULL,
  push_provider   TEXT DEFAULT 'expo'
                  CHECK (push_provider IN ('expo', 'fcm', 'apns')),
  app_version     TEXT,
  os_version      TEXT,
  active          BOOLEAN DEFAULT true,
  last_used_at    TIMESTAMPTZ DEFAULT now(),
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, push_token)
);

CREATE INDEX idx_devices_user_active ON user_devices(user_id) WHERE active = true;

-- Notes médicales chiffrées (RGPD Art.9 — données de santé)
-- Utilisées pour EMS (contre-indications cardiaques) et cours prénataux
CREATE TABLE medical_notes (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id                    UUID NOT NULL REFERENCES nexxia_gyms(id) ON DELETE CASCADE,
  member_id                 UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  -- Données chiffrées AES-256 via pgcrypto + Supabase Vault
  notes_encrypted           BYTEA,
  conditions_encrypted      BYTEA,
  -- Certificat médical
  has_medical_certificate   BOOLEAN DEFAULT false,
  certificate_url           TEXT,
  certificate_expires_at    DATE,
  -- Restrictions (non chiffré — nécessaire pour filtrage)
  restricted_activities     TEXT[],
  -- Audit
  encrypted_at              TIMESTAMPTZ,
  encrypted_by              UUID REFERENCES profiles(id),
  reviewed_at               TIMESTAMPTZ,
  reviewed_by               UUID REFERENCES profiles(id),
  created_at                TIMESTAMPTZ DEFAULT now(),
  updated_at                TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_medical_member ON medical_notes(member_id);

-- ============================================================================
-- COUCHE 4 — SITES (MULTI-SITES PAR TENANT)
-- ============================================================================

-- Sites physiques d'un tenant (ex: Move95 Neupré + Move95 Huy)
CREATE TABLE gym_sites (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id        UUID NOT NULL REFERENCES nexxia_gyms(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,          -- "Move95 Neupré"
  slug          TEXT NOT NULL,          -- "neupre"
  address       TEXT NOT NULL,
  city          TEXT NOT NULL,
  postal_code   TEXT,
  country       TEXT DEFAULT 'BE',
  phone         TEXT,
  email         TEXT,
  -- Géolocalisation (pour tri par proximité dans l'app)
  latitude      DECIMAL(10, 8),
  longitude     DECIMAL(11, 8),
  -- Métadonnées
  is_main_site  BOOLEAN DEFAULT false,  -- site principal du tenant
  active        BOOLEAN DEFAULT true,
  sort_order    INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(gym_id, slug)
);

CREATE INDEX idx_sites_gym ON gym_sites(gym_id) WHERE active = true;

-- Coaches assignés à des sites spécifiques
CREATE TABLE coach_sites (
  coach_id    UUID NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  site_id     UUID NOT NULL REFERENCES gym_sites(id) ON DELETE CASCADE,
  PRIMARY KEY (coach_id, site_id)
);

-- ============================================================================
-- COUCHE 5 — ACTIVITÉS & PLANNING
-- ============================================================================

-- Activités proposées par la salle
CREATE TABLE activities (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id                  UUID NOT NULL REFERENCES nexxia_gyms(id) ON DELETE CASCADE,
  name                    TEXT NOT NULL,
  slug                    TEXT NOT NULL,
  description             TEXT,
  duration_min            INTEGER NOT NULL DEFAULT 60 CHECK (duration_min > 0),
  default_capacity        INTEGER NOT NULL DEFAULT 12 CHECK (default_capacity > 0),
  default_level           TEXT DEFAULT 'all'
                          CHECK (default_level IN ('all', 'beginner', 'intermediate', 'advanced')),
  -- Contraintes médicales (EMS = true, prénatal = true)
  requires_medical_check  BOOLEAN DEFAULT false,
  -- Visuel
  image_url               TEXT,
  color                   TEXT,
  icon                    TEXT,           -- nom icône Lucide React
  -- Métadonnées
  active                  BOOLEAN DEFAULT true,
  sort_order              INTEGER DEFAULT 0,
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now(),
  UNIQUE(gym_id, slug)
);

CREATE INDEX idx_activities_gym ON activities(gym_id) WHERE active = true;

-- Traductions des activités (i18n)
CREATE TABLE activity_translations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id   UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  language      TEXT NOT NULL
                CHECK (language IN ('fr', 'nl', 'en', 'de', 'lb')),
  name          TEXT NOT NULL,
  description   TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(activity_id, language)
);

CREATE INDEX idx_activity_translations ON activity_translations(activity_id, language);

-- Créneaux (occurrences planifiées)
CREATE TABLE time_slots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id          UUID NOT NULL REFERENCES nexxia_gyms(id) ON DELETE CASCADE,
  site_id         UUID REFERENCES gym_sites(id),         -- NULL = tous les sites
  activity_id     UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  coach_id        UUID REFERENCES coaches(id),
  -- Timing
  starts_at       TIMESTAMPTZ NOT NULL,
  ends_at         TIMESTAMPTZ NOT NULL,
  -- Capacité
  capacity        INTEGER NOT NULL CHECK (capacity > 0),
  level           TEXT DEFAULT 'all'
                  CHECK (level IN ('all', 'beginner', 'intermediate', 'advanced')),
  -- Compteurs dénormalisés (mis à jour par trigger)
  bookings_count  INTEGER DEFAULT 0,
  waitlist_count  INTEGER DEFAULT 0,
  -- Statut
  status          TEXT DEFAULT 'scheduled'
                  CHECK (status IN ('scheduled', 'cancelled', 'completed')),
  cancellation_reason TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX idx_slots_gym_starts ON time_slots(gym_id, starts_at) WHERE status = 'scheduled';
CREATE INDEX idx_slots_site ON time_slots(site_id);
CREATE INDEX idx_slots_activity ON time_slots(activity_id);
CREATE INDEX idx_slots_coach ON time_slots(coach_id);
CREATE INDEX idx_slots_upcoming ON time_slots(gym_id, starts_at)
  WHERE status = 'scheduled' AND starts_at > now();

-- ============================================================================
-- COUCHE 6 — FORMULES & ABONNEMENTS MEMBRES
-- ============================================================================

-- Formules configurables par chaque gérant (depuis son dashboard)
CREATE TABLE gym_plans (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id            UUID NOT NULL REFERENCES nexxia_gyms(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  -- Type d'accès
  type              TEXT NOT NULL CHECK (type IN ('unlimited', 'credits')),
  duration_months   INTEGER CHECK (duration_months IS NULL OR duration_months > 0),
  credit_count      INTEGER CHECK (credit_count IS NULL OR credit_count > 0),
  -- Tarification
  price_cents       INTEGER NOT NULL CHECK (price_cents >= 0),
  currency          TEXT DEFAULT 'EUR',
  -- Type de facturation Mollie
  billing_type      TEXT DEFAULT 'one_time'
                    CHECK (billing_type IN (
                      'one_time',             -- Carte 10 séances = paiement unique
                      'recurring_fixed',      -- Illimité 6 mois = 6 prélèvements puis stop
                      'recurring_infinite'    -- Mensuel sans fin = jusqu'à annulation
                    )),
  -- Sites accessibles avec cette formule
  site_access       TEXT DEFAULT 'single'
                    CHECK (site_access IN (
                      'single',   -- 1 site uniquement
                      'all'       -- tous les sites du réseau (multi-sites)
                    )),
  -- Présentation dans l'app
  description       TEXT,
  features          TEXT[],       -- avantages affichés aux membres
  is_popular        BOOLEAN DEFAULT false,
  active            BOOLEAN DEFAULT true,
  sort_order        INTEGER DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),
  CHECK (
    (type = 'unlimited' AND duration_months IS NOT NULL)
    OR (type = 'credits' AND credit_count IS NOT NULL)
  )
);

CREATE INDEX idx_plans_gym_active ON gym_plans(gym_id) WHERE active = true;

-- Traductions des formules (i18n)
CREATE TABLE gym_plan_translations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id     UUID NOT NULL REFERENCES gym_plans(id) ON DELETE CASCADE,
  language    TEXT NOT NULL
              CHECK (language IN ('fr', 'nl', 'en', 'de', 'lb')),
  name        TEXT NOT NULL,
  description TEXT,
  features    TEXT[],
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(plan_id, language)
);

-- Abonnements actifs des membres
CREATE TABLE member_subscriptions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id                  UUID NOT NULL REFERENCES nexxia_gyms(id) ON DELETE CASCADE,
  member_id               UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  plan_id                 UUID NOT NULL REFERENCES gym_plans(id),
  -- Accès multi-sites
  site_id                 UUID REFERENCES gym_sites(id), -- NULL = accès tous sites
  status                  TEXT DEFAULT 'active'
                          CHECK (status IN ('active', 'suspended', 'expired', 'cancelled', 'paused')),
  starts_at               TIMESTAMPTZ NOT NULL,
  ends_at                 TIMESTAMPTZ,
  -- Crédits (pour cartes séances)
  credits_remaining       INTEGER CHECK (credits_remaining IS NULL OR credits_remaining >= 0),
  credits_total           INTEGER,
  -- Freeze / pause
  paused_at               TIMESTAMPTZ,
  pause_resumes_at        TIMESTAMPTZ,
  -- Suspension no-show
  suspended_until         TIMESTAMPTZ,
  -- Mollie
  mollie_subscription_id  TEXT UNIQUE,
  mollie_customer_id      TEXT,
  auto_renew              BOOLEAN DEFAULT true,
  -- Annulation
  cancelled_at            TIMESTAMPTZ,
  cancellation_reason     TEXT,
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_member_subs_member ON member_subscriptions(member_id, status);
CREATE INDEX idx_member_subs_gym_status ON member_subscriptions(gym_id, status);
CREATE INDEX idx_member_subs_ends_at ON member_subscriptions(ends_at)
  WHERE status = 'active';

-- Transactions financières membres → salle
CREATE TABLE gym_transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id            UUID NOT NULL REFERENCES nexxia_gyms(id) ON DELETE CASCADE,
  member_id         UUID REFERENCES profiles(id),
  subscription_id   UUID REFERENCES member_subscriptions(id),
  amount_cents      INTEGER NOT NULL CHECK (amount_cents >= 0),
  vat_cents         INTEGER DEFAULT 0,
  total_cents       INTEGER NOT NULL,
  currency          TEXT DEFAULT 'EUR',
  status            TEXT DEFAULT 'pending'
                    CHECK (status IN ('pending', 'paid', 'failed', 'refunded', 'partially_refunded')),
  payment_method    TEXT
                    CHECK (payment_method IN ('card', 'bancontact', 'apple_pay', 'google_pay', 'sepa', 'cash')),
  -- Mollie
  mollie_payment_id TEXT UNIQUE,
  mollie_order_id   TEXT,
  idempotency_key   TEXT UNIQUE,
  -- Description
  description       TEXT,
  invoice_number    TEXT,
  -- Timestamps
  paid_at           TIMESTAMPTZ,
  refunded_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_transactions_gym_paid ON gym_transactions(gym_id, paid_at);
CREATE INDEX idx_transactions_member ON gym_transactions(member_id);
CREATE INDEX idx_transactions_status ON gym_transactions(status);
CREATE INDEX idx_transactions_idempotency ON gym_transactions(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ============================================================================
-- COUCHE 7 — RÉSERVATIONS
-- ============================================================================

CREATE TABLE bookings (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id                    UUID NOT NULL REFERENCES nexxia_gyms(id) ON DELETE CASCADE,
  slot_id                   UUID NOT NULL REFERENCES time_slots(id) ON DELETE CASCADE,
  member_id                 UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subscription_id           UUID REFERENCES member_subscriptions(id),
  -- Statut
  status                    TEXT DEFAULT 'confirmed'
                            CHECK (status IN ('confirmed', 'cancelled', 'no_show', 'attended', 'waitlisted')),
  -- Annulation
  cancelled_at              TIMESTAMPTZ,
  cancel_reason             TEXT,
  is_late_cancel            BOOLEAN DEFAULT false,
  -- Présence / Check-in
  checked_in_at             TIMESTAMPTZ,
  checked_in_method         TEXT
                            CHECK (checked_in_method IN ('qr_code', 'manual', 'auto')),
  -- Waitlist
  waitlist_position         INTEGER,
  promoted_from_waitlist_at TIMESTAMPTZ,
  -- Idempotency
  idempotency_key           TEXT UNIQUE,
  -- Timestamps
  booked_at                 TIMESTAMPTZ DEFAULT now(),
  updated_at                TIMESTAMPTZ DEFAULT now(),
  UNIQUE(slot_id, member_id)
);

CREATE INDEX idx_bookings_member_status ON bookings(member_id, status);
CREATE INDEX idx_bookings_slot_status ON bookings(slot_id, status);
CREATE INDEX idx_bookings_gym_booked ON bookings(gym_id, booked_at);
CREATE INDEX idx_bookings_active ON bookings(member_id)
  WHERE status = 'confirmed';

-- Favoris (par occurrence spécifique — pas par activité)
-- Un favori s'efface automatiquement quand la date du créneau est passée
CREATE TABLE favorites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id      UUID NOT NULL REFERENCES nexxia_gyms(id) ON DELETE CASCADE,
  member_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  slot_id     UUID NOT NULL REFERENCES time_slots(id) ON DELETE CASCADE,
  added_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(member_id, slot_id)
);

CREATE INDEX idx_favorites_member ON favorites(member_id);

-- Nettoyage automatique des favoris expirés (cron quotidien)
CREATE OR REPLACE FUNCTION cleanup_expired_favorites()
RETURNS void LANGUAGE SQL AS $$
  DELETE FROM favorites
  WHERE slot_id IN (
    SELECT id FROM time_slots WHERE starts_at < now()
  );
$$;

SELECT cron.schedule('cleanup-expired-favorites', '0 2 * * *',
  'SELECT cleanup_expired_favorites()');

-- ============================================================================
-- COUCHE 8 — NO-SHOW & PÉNALITÉS
-- ============================================================================

-- Règles configurables par salle
CREATE TABLE noshow_rules (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id              UUID NOT NULL UNIQUE REFERENCES nexxia_gyms(id) ON DELETE CASCADE,
  late_cancel_hours   INTEGER DEFAULT 2 CHECK (late_cancel_hours >= 0),
  warning_1_at        INTEGER DEFAULT 1 CHECK (warning_1_at > 0),
  warning_2_at        INTEGER DEFAULT 2 CHECK (warning_2_at > 0),
  suspension_at       INTEGER DEFAULT 3 CHECK (suspension_at > 0),
  suspension_hours    INTEGER DEFAULT 48 CHECK (suspension_hours > 0),
  reset_after_days    INTEGER DEFAULT 90 CHECK (reset_after_days > 0),
  max_active_bookings INTEGER DEFAULT 2 CHECK (max_active_bookings > 0),
  active              BOOLEAN DEFAULT true,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

-- Historique des pénalités
CREATE TABLE penalties (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id        UUID NOT NULL REFERENCES nexxia_gyms(id) ON DELETE CASCADE,
  member_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  booking_id    UUID REFERENCES bookings(id),
  type          TEXT NOT NULL
                CHECK (type IN ('warning_1', 'warning_2', 'suspension', 'reset')),
  applied_at    TIMESTAMPTZ DEFAULT now(),
  expires_at    TIMESTAMPTZ,
  notes         TEXT
);

CREATE INDEX idx_penalties_member ON penalties(member_id, applied_at);

-- ============================================================================
-- COUCHE 9 — NOTIFICATIONS
-- ============================================================================

CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id      UUID NOT NULL REFERENCES nexxia_gyms(id) ON DELETE CASCADE,
  member_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN (
                'booking_confirmed', 'booking_cancelled', 'booking_reminder',
                'waitlist_promoted', 'session_cancelled_by_gym',
                'no_show_warning_1', 'no_show_warning_2', 'no_show_suspension',
                'subscription_expiring', 'subscription_renewed',
                'subscription_payment_failed', 'subscription_activated',
                'profile_completion_reward', 'medical_certificate_expiring',
                'security_new_login', 'security_password_changed',
                'site_new_available', 'plan_upgraded', 'trial_ending'
              )),
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  data        JSONB,
  -- Statut
  read        BOOLEAN DEFAULT false,
  sent_at     TIMESTAMPTZ,
  read_at     TIMESTAMPTZ,
  push_sent   BOOLEAN DEFAULT false,
  email_sent  BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_notifs_member_unread ON notifications(member_id, read, created_at DESC);

-- ============================================================================
-- COUCHE 10 — SÉCURITÉ : RATE LIMITING & AUDIT
-- ============================================================================

-- Rate limiting (protection anti-abus)
CREATE TABLE rate_limits (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier    TEXT NOT NULL,
  action        TEXT NOT NULL,
  attempts      INTEGER DEFAULT 1,
  window_start  TIMESTAMPTZ DEFAULT now(),
  blocked_until TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(identifier, action, window_start)
);

CREATE INDEX idx_rate_limits_lookup ON rate_limits(identifier, action, window_start);

-- Tentatives de connexion
CREATE TABLE login_attempts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT,
  user_id         UUID REFERENCES profiles(id),
  ip_address      INET,
  user_agent      TEXT,
  success         BOOLEAN DEFAULT false,
  failure_reason  TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_login_attempts_email ON login_attempts(email, created_at DESC);
CREATE INDEX idx_login_attempts_ip ON login_attempts(ip_address, created_at DESC);

-- Audit log (RGPD — traçabilité)
CREATE TABLE audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id        UUID REFERENCES nexxia_gyms(id),
  actor_id      UUID REFERENCES profiles(id),
  action        TEXT NOT NULL,
  resource      TEXT NOT NULL,
  resource_id   UUID,
  old_data      JSONB,
  new_data      JSONB,
  ip_address    INET,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_audit_gym_action ON audit_logs(gym_id, action, created_at DESC);
CREATE INDEX idx_audit_actor ON audit_logs(actor_id, created_at DESC);

-- ============================================================================
-- COUCHE 11 — RGPD : DROITS DES UTILISATEURS
-- ============================================================================

-- Demandes RGPD (délai légal 30 jours)
CREATE TABLE gdpr_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  gym_id            UUID REFERENCES nexxia_gyms(id),
  request_type      TEXT NOT NULL
                    CHECK (request_type IN (
                      'export', 'deletion', 'rectification',
                      'restriction', 'portability'
                    )),
  status            TEXT DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'completed', 'rejected')),
  reason            TEXT,
  rejection_reason  TEXT,
  must_complete_by  TIMESTAMPTZ DEFAULT (now() + INTERVAL '30 days'),
  completed_at      TIMESTAMPTZ,
  export_url        TEXT,
  export_expires_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_gdpr_status ON gdpr_requests(status, must_complete_by);

-- Historique des consentements (preuve légale)
CREATE TABLE consent_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  consent_type    TEXT NOT NULL
                  CHECK (consent_type IN (
                    'privacy_policy', 'terms', 'marketing',
                    'data_processing', 'cookies', 'medical_data'
                  )),
  version         TEXT NOT NULL,
  granted         BOOLEAN NOT NULL,
  ip_address      INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_consent_user ON consent_history(user_id, consent_type, created_at DESC);

-- ============================================================================
-- HELPERS — FONCTIONS UTILITAIRES
-- ============================================================================

-- Récupère le gym_id de l'utilisateur connecté
CREATE OR REPLACE FUNCTION get_my_gym_id()
RETURNS UUID LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT gym_id FROM profiles
  WHERE id = auth.uid() AND deleted_at IS NULL;
$$;

-- Récupère le rôle de l'utilisateur connecté
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS TEXT LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT role FROM profiles
  WHERE id = auth.uid() AND deleted_at IS NULL;
$$;

-- Vérifie si l'utilisateur est admin
CREATE OR REPLACE FUNCTION is_gym_admin()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT role IN ('gym_admin', 'super_admin') FROM profiles
  WHERE id = auth.uid() AND deleted_at IS NULL;
$$;

-- Vérifie si super admin Nexxia
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT role = 'super_admin' FROM profiles
  WHERE id = auth.uid() AND deleted_at IS NULL;
$$;

-- Vérifie si un tenant a accès à une feature
CREATE OR REPLACE FUNCTION gym_has_feature(p_gym_id UUID, p_feature TEXT)
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT COALESCE(
    (SELECT enabled FROM nexxia_features
     WHERE gym_id = p_gym_id AND feature = p_feature),
    false
  );
$$;

-- Chiffrement données médicales (AES-256 via Vault)
CREATE OR REPLACE FUNCTION encrypt_medical(plaintext TEXT, secret_id UUID)
RETURNS BYTEA LANGUAGE PLPGSQL SECURITY DEFINER AS $$
DECLARE
  encryption_key TEXT;
BEGIN
  IF plaintext IS NULL THEN RETURN NULL; END IF;
  SELECT decrypted_secret INTO encryption_key
  FROM vault.decrypted_secrets WHERE id = secret_id;
  IF encryption_key IS NULL THEN
    RAISE EXCEPTION 'Encryption key not found in Vault';
  END IF;
  RETURN encrypt(plaintext::BYTEA, encryption_key::BYTEA, 'aes-cbc/pad:pkcs');
END;
$$;

CREATE OR REPLACE FUNCTION decrypt_medical(ciphertext BYTEA, secret_id UUID)
RETURNS TEXT LANGUAGE PLPGSQL SECURITY DEFINER AS $$
DECLARE
  encryption_key TEXT;
BEGIN
  IF ciphertext IS NULL THEN RETURN NULL; END IF;
  SELECT decrypted_secret INTO encryption_key
  FROM vault.decrypted_secrets WHERE id = secret_id;
  IF encryption_key IS NULL THEN
    RAISE EXCEPTION 'Encryption key not found in Vault';
  END IF;
  RETURN convert_from(
    decrypt(ciphertext, encryption_key::BYTEA, 'aes-cbc/pad:pkcs'),
    'UTF8'
  );
END;
$$;

-- Rate limiting (appelé depuis Edge Functions)
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_identifier TEXT,
  p_action TEXT,
  p_max_attempts INTEGER DEFAULT 5,
  p_window_minutes INTEGER DEFAULT 15
)
RETURNS BOOLEAN LANGUAGE PLPGSQL SECURITY DEFINER AS $$
DECLARE
  current_attempts INTEGER;
  current_window TIMESTAMPTZ;
BEGIN
  current_window := now() - (p_window_minutes || ' minutes')::INTERVAL;
  SELECT COALESCE(SUM(attempts), 0) INTO current_attempts
  FROM rate_limits
  WHERE identifier = p_identifier
    AND action = p_action
    AND window_start > current_window;
  IF current_attempts >= p_max_attempts THEN RETURN false; END IF;
  INSERT INTO rate_limits (identifier, action, attempts)
  VALUES (p_identifier, p_action, 1)
  ON CONFLICT (identifier, action, window_start)
  DO UPDATE SET attempts = rate_limits.attempts + 1;
  RETURN true;
END;
$$;

-- Demande de suppression RGPD
CREATE OR REPLACE FUNCTION request_account_deletion(p_user_id UUID)
RETURNS UUID LANGUAGE PLPGSQL SECURITY DEFINER AS $$
DECLARE request_id UUID;
BEGIN
  INSERT INTO gdpr_requests (user_id, request_type, status)
  VALUES (p_user_id, 'deletion', 'pending')
  RETURNING id INTO request_id;
  UPDATE profiles SET deletion_requested_at = now() WHERE id = p_user_id;
  INSERT INTO audit_logs (actor_id, action, resource, resource_id)
  VALUES (p_user_id, 'gdpr.deletion_requested', 'profile', p_user_id);
  RETURN request_id;
END;
$$;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_gyms_updated BEFORE UPDATE ON nexxia_gyms FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_coaches_updated BEFORE UPDATE ON coaches FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_sites_updated BEFORE UPDATE ON gym_sites FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_activities_updated BEFORE UPDATE ON activities FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_slots_updated BEFORE UPDATE ON time_slots FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_plans_updated BEFORE UPDATE ON gym_plans FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_subs_updated BEFORE UPDATE ON member_subscriptions FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_bookings_updated BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_noshow_updated BEFORE UPDATE ON noshow_rules FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_medical_updated BEFORE UPDATE ON medical_notes FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_nexxia_subs_updated BEFORE UPDATE ON nexxia_subscriptions FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- Compteurs bookings_count et waitlist_count sur time_slots
CREATE OR REPLACE FUNCTION update_slot_bookings_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE time_slots SET
      bookings_count = (SELECT COUNT(*) FROM bookings WHERE slot_id = NEW.slot_id AND status = 'confirmed'),
      waitlist_count = (SELECT COUNT(*) FROM bookings WHERE slot_id = NEW.slot_id AND status = 'waitlisted')
    WHERE id = NEW.slot_id;
  ELSIF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    UPDATE time_slots SET
      bookings_count = (SELECT COUNT(*) FROM bookings WHERE slot_id = COALESCE(NEW.slot_id, OLD.slot_id) AND status = 'confirmed'),
      waitlist_count = (SELECT COUNT(*) FROM bookings WHERE slot_id = COALESCE(NEW.slot_id, OLD.slot_id) AND status = 'waitlisted')
    WHERE id = COALESCE(NEW.slot_id, OLD.slot_id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_update_bookings_count
AFTER INSERT OR UPDATE OR DELETE ON bookings
FOR EACH ROW EXECUTE FUNCTION update_slot_bookings_count();

-- Historique automatique des consentements
CREATE OR REPLACE FUNCTION track_consent_changes()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP = 'UPDATE' AND OLD.privacy_policy_version IS DISTINCT FROM NEW.privacy_policy_version) THEN
    INSERT INTO consent_history (user_id, consent_type, version, granted)
    VALUES (NEW.id, 'privacy_policy', NEW.privacy_policy_version, true);
  END IF;
  IF (TG_OP = 'UPDATE' AND OLD.marketing_consent IS DISTINCT FROM NEW.marketing_consent) THEN
    INSERT INTO consent_history (user_id, consent_type, version, granted)
    VALUES (NEW.id, 'marketing', '1.0', NEW.marketing_consent);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_track_consent
AFTER UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION track_consent_changes();

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

ALTER TABLE nexxia_gyms ENABLE ROW LEVEL SECURITY;
ALTER TABLE nexxia_plan_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE nexxia_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE nexxia_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE nexxia_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE gym_mollie_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE coaches ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE medical_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE gym_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE coach_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_translations ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE gym_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE gym_plan_translations ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE gym_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE noshow_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE penalties ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE gdpr_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_history ENABLE ROW LEVEL SECURITY;

-- ─── nexxia_gyms ──────────────────────────────────────────────────────────
CREATE POLICY "Super admins voient tout" ON nexxia_gyms FOR ALL USING (is_super_admin());
CREATE POLICY "Gym admins voient leur salle" ON nexxia_gyms FOR SELECT USING (id = get_my_gym_id());
CREATE POLICY "Members voient leur salle" ON nexxia_gyms FOR SELECT USING (id = get_my_gym_id());

-- ─── nexxia_plan_limits ───────────────────────────────────────────────────
CREATE POLICY "Plan limits visibles par tous" ON nexxia_plan_limits FOR SELECT USING (true);
CREATE POLICY "Super admins gèrent les plans" ON nexxia_plan_limits FOR ALL USING (is_super_admin());

-- ─── profiles ─────────────────────────────────────────────────────────────
CREATE POLICY "Voir son propre profil" ON profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY "Modifier son propre profil" ON profiles FOR UPDATE USING (id = auth.uid());
CREATE POLICY "Gym admins voient les profils du gym" ON profiles FOR SELECT USING (gym_id = get_my_gym_id() AND is_gym_admin());
CREATE POLICY "Super admins voient tout" ON profiles FOR ALL USING (is_super_admin());

-- ─── user_devices ─────────────────────────────────────────────────────────
CREATE POLICY "Gérer ses propres devices" ON user_devices FOR ALL USING (user_id = auth.uid());

-- ─── medical_notes — DONNÉES SENSIBLES (RGPD Art.9) ─────────────────────
-- Les gym_admins NE PEUVENT PAS voir les notes médicales par défaut
-- Accès coach uniquement avec consentement explicite (feature dédiée)
CREATE POLICY "Voir ses propres notes médicales" ON medical_notes FOR SELECT USING (member_id = auth.uid());
CREATE POLICY "Créer ses propres notes médicales" ON medical_notes FOR INSERT WITH CHECK (member_id = auth.uid());
CREATE POLICY "Modifier ses propres notes médicales" ON medical_notes FOR UPDATE USING (member_id = auth.uid());
CREATE POLICY "Super admins voient les notes médicales" ON medical_notes FOR ALL USING (is_super_admin());

-- ─── gym_sites ────────────────────────────────────────────────────────────
CREATE POLICY "Sites visibles par les membres du gym" ON gym_sites FOR SELECT USING (gym_id = get_my_gym_id());
CREATE POLICY "Gym admins gèrent leurs sites" ON gym_sites FOR ALL USING (gym_id = get_my_gym_id() AND is_gym_admin());

-- ─── coach_sites ──────────────────────────────────────────────────────────
CREATE POLICY "Coach sites visibles par les membres" ON coach_sites FOR SELECT USING (
  site_id IN (SELECT id FROM gym_sites WHERE gym_id = get_my_gym_id())
);
CREATE POLICY "Gym admins gèrent les assignations coaches/sites" ON coach_sites FOR ALL USING (is_gym_admin());

-- ─── activities ───────────────────────────────────────────────────────────
CREATE POLICY "Activités visibles par les membres du gym" ON activities FOR SELECT USING (gym_id = get_my_gym_id());
CREATE POLICY "Gym admins gèrent les activités" ON activities FOR ALL USING (gym_id = get_my_gym_id() AND is_gym_admin());

-- ─── activity_translations ────────────────────────────────────────────────
CREATE POLICY "Traductions activités visibles par les membres" ON activity_translations FOR SELECT USING (
  activity_id IN (SELECT id FROM activities WHERE gym_id = get_my_gym_id())
);
CREATE POLICY "Gym admins gèrent les traductions" ON activity_translations FOR ALL USING (is_gym_admin());

-- ─── time_slots ───────────────────────────────────────────────────────────
CREATE POLICY "Slots visibles par les membres du gym" ON time_slots FOR SELECT USING (gym_id = get_my_gym_id());
CREATE POLICY "Gym admins gèrent les slots" ON time_slots FOR ALL USING (gym_id = get_my_gym_id() AND is_gym_admin());

-- ─── gym_plans ────────────────────────────────────────────────────────────
CREATE POLICY "Plans visibles par les membres (actifs)" ON gym_plans FOR SELECT USING (gym_id = get_my_gym_id() AND active = true);
CREATE POLICY "Gym admins gèrent leurs formules" ON gym_plans FOR ALL USING (gym_id = get_my_gym_id() AND is_gym_admin());

-- ─── gym_plan_translations ────────────────────────────────────────────────
CREATE POLICY "Traductions plans visibles par les membres" ON gym_plan_translations FOR SELECT USING (
  plan_id IN (SELECT id FROM gym_plans WHERE gym_id = get_my_gym_id())
);
CREATE POLICY "Gym admins gèrent les traductions plans" ON gym_plan_translations FOR ALL USING (is_gym_admin());

-- ─── coaches ──────────────────────────────────────────────────────────────
CREATE POLICY "Coaches visibles par les membres du gym" ON coaches FOR SELECT USING (gym_id = get_my_gym_id());
CREATE POLICY "Gym admins gèrent les coaches" ON coaches FOR ALL USING (gym_id = get_my_gym_id() AND is_gym_admin());

-- ─── member_subscriptions ────────────────────────────────────────────────
CREATE POLICY "Voir son propre abonnement" ON member_subscriptions FOR SELECT USING (member_id = auth.uid());
CREATE POLICY "Gym admins gèrent les abonnements du gym" ON member_subscriptions FOR ALL USING (gym_id = get_my_gym_id() AND is_gym_admin());

-- ─── bookings ────────────────────────────────────────────────────────────
CREATE POLICY "Voir ses propres réservations" ON bookings FOR SELECT USING (member_id = auth.uid());
CREATE POLICY "Créer ses propres réservations" ON bookings FOR INSERT WITH CHECK (member_id = auth.uid() AND gym_id = get_my_gym_id());
CREATE POLICY "Annuler ses propres réservations" ON bookings FOR UPDATE USING (member_id = auth.uid());
CREATE POLICY "Gym admins voient toutes les réservations" ON bookings FOR ALL USING (gym_id = get_my_gym_id() AND is_gym_admin());

-- ─── favorites ────────────────────────────────────────────────────────────
CREATE POLICY "Gérer ses propres favoris" ON favorites FOR ALL USING (member_id = auth.uid());

-- ─── gym_transactions ─────────────────────────────────────────────────────
CREATE POLICY "Voir ses propres transactions" ON gym_transactions FOR SELECT USING (member_id = auth.uid());
CREATE POLICY "Gym admins voient les transactions du gym" ON gym_transactions FOR SELECT USING (gym_id = get_my_gym_id() AND is_gym_admin());

-- ─── notifications ────────────────────────────────────────────────────────
CREATE POLICY "Voir ses propres notifications" ON notifications FOR SELECT USING (member_id = auth.uid());
CREATE POLICY "Marquer ses notifications comme lues" ON notifications FOR UPDATE USING (member_id = auth.uid());

-- ─── penalties ────────────────────────────────────────────────────────────
CREATE POLICY "Voir ses propres pénalités" ON penalties FOR SELECT USING (member_id = auth.uid());
CREATE POLICY "Gym admins gèrent les pénalités du gym" ON penalties FOR ALL USING (gym_id = get_my_gym_id() AND is_gym_admin());

-- ─── noshow_rules ─────────────────────────────────────────────────────────
CREATE POLICY "Règles no-show visibles par les membres" ON noshow_rules FOR SELECT USING (gym_id = get_my_gym_id());
CREATE POLICY "Gym admins gèrent les règles no-show" ON noshow_rules FOR ALL USING (gym_id = get_my_gym_id() AND is_gym_admin());

-- ─── gdpr_requests ────────────────────────────────────────────────────────
CREATE POLICY "Voir ses propres demandes RGPD" ON gdpr_requests FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Créer une demande RGPD pour soi-même" ON gdpr_requests FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Super admins gèrent les demandes RGPD" ON gdpr_requests FOR ALL USING (is_super_admin());

-- ─── consent_history ──────────────────────────────────────────────────────
CREATE POLICY "Voir son historique de consentements" ON consent_history FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Super admins voient tout" ON consent_history FOR ALL USING (is_super_admin());

-- ─── audit_logs ───────────────────────────────────────────────────────────
CREATE POLICY "Gym admins voient les logs de leur gym" ON audit_logs FOR SELECT USING (gym_id = get_my_gym_id() AND is_gym_admin());
CREATE POLICY "Super admins voient tous les logs" ON audit_logs FOR ALL USING (is_super_admin());

-- ─── Mollie Connect OAuth ─────────────────────────────────────────────────
CREATE POLICY "Gym admins voient leur connexion Mollie" ON gym_mollie_connections FOR SELECT USING (gym_id = get_my_gym_id() AND is_gym_admin());
CREATE POLICY "Super admins gèrent toutes les connexions Mollie" ON gym_mollie_connections FOR ALL USING (is_super_admin());
-- oauth_states : géré uniquement par Edge Functions (service_role)

-- ─── nexxia_subscriptions, features, invoices ─────────────────────────────
CREATE POLICY "Super admins gèrent les abonnements Nexxia" ON nexxia_subscriptions FOR ALL USING (is_super_admin());
CREATE POLICY "Gym admins voient leur abonnement Nexxia" ON nexxia_subscriptions FOR SELECT USING (gym_id = get_my_gym_id() AND is_gym_admin());
CREATE POLICY "Features visibles par les membres du gym" ON nexxia_features FOR SELECT USING (gym_id = get_my_gym_id());
CREATE POLICY "Super admins gèrent les features" ON nexxia_features FOR ALL USING (is_super_admin());
CREATE POLICY "Super admins gèrent les factures Nexxia" ON nexxia_invoices FOR ALL USING (is_super_admin());
CREATE POLICY "Gym admins voient leurs factures Nexxia" ON nexxia_invoices FOR SELECT USING (gym_id = get_my_gym_id() AND is_gym_admin());

-- ─── login_attempts, rate_limits ──────────────────────────────────────────
CREATE POLICY "Super admins voient les tentatives de connexion" ON login_attempts FOR ALL USING (is_super_admin());
-- rate_limits : pas de policy, géré uniquement par Edge Functions (service_role)

-- ============================================================================
-- DONNÉES INITIALES — Move95 (Premier tenant)
-- ============================================================================

-- Tenant Move95
INSERT INTO nexxia_gyms (
  id, name, slug, address, city, postal_code, country,
  phone, primary_color, secondary_color,
  plan, status, onboarding_completed,
  timezone, currency, default_language, supported_languages,
  trial_ends_at
) VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'Move95', 'move95', 'Route du Condroz', 'Neupré', '4120', 'BE',
  '+32 XXX XXX XXX', '#C8F000', '#111111',
  'pro', 'active', true,
  'Europe/Brussels', 'EUR', 'fr', ARRAY['fr'],
  null
);

-- Site principal Move95 (Neupré)
INSERT INTO gym_sites (
  id, gym_id, name, slug, address, city, postal_code,
  country, is_main_site, active
) VALUES (
  'b0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'Move95 Neupré', 'neupre', 'Route du Condroz', 'Neupré', '4120',
  'BE', true, true
);

-- Activités Move95
INSERT INTO activities (gym_id, name, slug, description, duration_min, default_capacity, default_level, icon, requires_medical_check) VALUES
('a0000000-0000-0000-0000-000000000001', 'EMS', 'ems',
 'Électrostimulation musculaire — 20 minutes équivalent à 2h de musculation classique. Séances encadrées par nos coaches certifiés.',
 20, 4, 'all', 'Zap', true),
('a0000000-0000-0000-0000-000000000001', 'HIIT Circuit', 'hiit',
 'High Intensity Interval Training — alterne effort intense et récupération pour maximiser la dépense calorique.',
 60, 15, 'all', 'Flame', false),
('a0000000-0000-0000-0000-000000000001', 'CrossFit', 'crossfit',
 'Force athlétique, haltérophilie, gymnastique et sports d''endurance combinés. Mouvements adaptés à chaque niveau.',
 60, 16, 'all', 'Dumbbell', false),
('a0000000-0000-0000-0000-000000000001', 'Open Gym', 'open-gym',
 'Accès libre à l''ensemble des équipements avec nos coaches présents pour te conseiller.',
 60, 8, 'all', 'Activity', false),
('a0000000-0000-0000-0000-000000000001', 'Pilates', 'pilates',
 'Méthode douce axée sur le gainage profond, la posture et la mobilité. Recommandé pour la prévention des douleurs dorsales.',
 60, 12, 'all', 'PersonStanding', false),
('a0000000-0000-0000-0000-000000000001', 'Yoga', 'yoga',
 'Pratique unissant corps, souffle et esprit. Améliore la flexibilité, réduit le stress et restaure l''équilibre.',
 60, 14, 'all', 'Leaf', false),
('a0000000-0000-0000-0000-000000000001', 'Cours prénatal/postnatal', 'prenatal',
 'Cours doux adaptés aux femmes enceintes et jeunes mamans. Maintien de l''activité physique en toute sécurité.',
 60, 8, 'all', 'Baby', true),
('a0000000-0000-0000-0000-000000000001', 'Drainage Renata França', 'drainage',
 'Massage corps profond technique Renata França. Réduction des œdèmes, élimination des toxines, effet lissant.',
 60, 6, 'all', 'Waves', false);

-- Coaches Move95
INSERT INTO coaches (gym_id, name, specialties, sort_order) VALUES
('a0000000-0000-0000-0000-000000000001', 'Nicolas',  ARRAY['EMS', 'CrossFit', 'HIIT', 'Open Gym'], 1),
('a0000000-0000-0000-0000-000000000001', 'François', ARRAY['EMS', 'CrossFit', 'HIIT', 'Open Gym'], 2),
('a0000000-0000-0000-0000-000000000001', 'Léna',     ARRAY['Pilates', 'Drainage Renata França'], 3),
('a0000000-0000-0000-0000-000000000001', 'Manon',    ARRAY['Pilates', 'Cours prénatal/postnatal'], 4),
('a0000000-0000-0000-0000-000000000001', 'Victoria', ARRAY['Yoga'], 5);

-- Formules Move95 (configurées par Nico depuis son dashboard)
INSERT INTO gym_plans (
  gym_id, name, type, duration_months, credit_count,
  price_cents, billing_type, site_access,
  features, is_popular, sort_order
) VALUES
(
  'a0000000-0000-0000-0000-000000000001',
  'Carte 10 séances', 'credits', NULL, 10,
  11900, 'one_time', 'single',
  ARRAY['10 séances au choix', 'Open Gym ou Cours collectifs', 'Valable 6 mois après achat', 'Sans engagement'],
  false, 1
),
(
  'a0000000-0000-0000-0000-000000000001',
  'Illimité 3 mois', 'unlimited', 3, NULL,
  8900, 'recurring_fixed', 'single',
  ARRAY['Open Gym illimité', 'Cours collectifs illimités', 'Réservation 7j à l''avance', 'Annulation jusqu''à 2h avant'],
  false, 2
),
(
  'a0000000-0000-0000-0000-000000000001',
  'Illimité 6 mois', 'unlimited', 6, NULL,
  7400, 'recurring_fixed', 'single',
  ARRAY['Open Gym illimité', 'Cours collectifs illimités', 'Réservation 7j à l''avance', 'Annulation jusqu''à 2h avant', 'Freeze 1 mois/an inclus'],
  true, 3
),
(
  'a0000000-0000-0000-0000-000000000001',
  'Illimité 12 mois', 'unlimited', 12, NULL,
  6400, 'recurring_fixed', 'single',
  ARRAY['Open Gym illimité', 'Cours collectifs illimités', 'Réservation 7j à l''avance', 'Annulation jusqu''à 2h avant', 'Freeze 2 mois/an inclus', 'Priorité liste d''attente'],
  false, 4
);

-- Règles no-show Move95 (Option A validée avec Nico)
INSERT INTO noshow_rules (
  gym_id, late_cancel_hours,
  warning_1_at, warning_2_at, suspension_at, suspension_hours,
  max_active_bookings, reset_after_days
) VALUES (
  'a0000000-0000-0000-0000-000000000001',
  2, 1, 2, 3, 48, 2, 90
);

-- Features activées pour Move95
INSERT INTO nexxia_features (gym_id, feature, enabled) VALUES
('a0000000-0000-0000-0000-000000000001', 'web_app', true),
('a0000000-0000-0000-0000-000000000001', 'ios_app', true),
('a0000000-0000-0000-0000-000000000001', 'payments_enabled', true),
('a0000000-0000-0000-0000-000000000001', 'analytics', true),
('a0000000-0000-0000-0000-000000000001', 'marketing_emails', true),
('a0000000-0000-0000-0000-000000000001', 'qr_code_checkin', true),
('a0000000-0000-0000-0000-000000000001', 'waitlist_priority', true),
('a0000000-0000-0000-0000-000000000001', 'export_enabled', true),
('a0000000-0000-0000-0000-000000000001', 'custom_branding', true),
('a0000000-0000-0000-0000-000000000001', 'medical_notes', true),
('a0000000-0000-0000-0000-000000000001', 'android_app', false),
('a0000000-0000-0000-0000-000000000001', 'multi_site', false),
('a0000000-0000-0000-0000-000000000001', 'sms_notifications', false),
('a0000000-0000-0000-0000-000000000001', 'gift_cards', false),
('a0000000-0000-0000-0000-000000000001', 'api_access', false);

-- ============================================================================
-- ÉTAPES POST-EXÉCUTION OBLIGATOIRES
-- ============================================================================
-- 1. SUPABASE VAULT
--    → Créer secret "medical_encryption_key" (clé AES-256 aléatoire)
--    → Créer secret "mollie_client_secret" (après approbation Mollie Connect)
--    → Récupérer leurs UUIDs pour les Edge Functions
--
-- 2. SUPABASE AUTH
--    → Activer email confirmation
--    → Politique mot de passe : 12 chars min, 1 maj, 1 chiffre, 1 spécial
--    → Activer 2FA (requis pour gym_admin et super_admin)
--    → Session timeout : 30 jours
--    → Rate limiting : 5 tentatives / 15 min
--
-- 3. MOLLIE CONNECT (faire ce weekend !)
--    → Créer compte partenaire sur mollie.com/partners
--    → Créer app "GymBook" avec redirect URI :
--      https://dashboard.nexxia.dev/mollie/callback
--    → Scope : payments.read/write, orders.read/write,
--              subscriptions.read/write, profiles.read, onboarding.read
--    → Stocker MOLLIE_CLIENT_ID + MOLLIE_CLIENT_SECRET dans Vault
--
-- 4. EDGE FUNCTIONS À CRÉER (par ordre de priorité)
--    → mollie-oauth-callback   : gère le retour OAuth Mollie
--    → mollie-refresh-tokens   : cron toutes les 6h
--    → create-payment          : crée un paiement avec token du gérant
--    → process-mollie-webhook  : confirme paiements (signature HMAC)
--    → create-booking          : réservation avec toutes les validations
--    → cancel-booking          : annulation + late cancel detection
--    → check-noshow            : cron post-séance
--    → send-reminders          : cron J-1 et H-2
--    → promote-waitlist        : trigger sur annulation
--    → clean-expired-data      : cron quotidien
--    → process-gdpr-export     : export données RGPD
--    → process-gdpr-deletion   : suppression compte RGPD
--
-- 5. I18NEXT (dès le premier composant lundi)
--    → npm install i18next react-i18next
--    → Créer /locales/fr.json, nl.json, en.json, de.json
--    → JAMAIS de texte en dur dans les composants
--
-- 6. COMPTE SUPER ADMIN NEXXIA (toi)
--    → S'inscrire via Supabase Auth
--    → UPDATE profiles SET role = 'super_admin', gym_id = NULL WHERE id = '...'
--
-- 7. BACKUPS
--    → Activer backup quotidien automatique (Supabase Pro plan)
--    → Configurer backup région secondaire
--    → Planifier test de restauration mensuel
-- ============================================================================
