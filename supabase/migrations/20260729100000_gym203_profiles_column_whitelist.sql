-- GYM-203 — ÉLÉVATION DE PRIVILÈGE SUR public.profiles (confirmée en prod le 29/07).
--
-- ── La faille ────────────────────────────────────────────────────────────────
-- Trois éléments se combinaient :
--   1. policy « Modifier son propre profil » : FOR UPDATE USING (id = auth.uid()),
--      SANS WITH CHECK (repli implicite sur USING) ;
--   2. GRANT UPDATE au NIVEAU TABLE pour `authenticated` (et `anon`) → les 41 colonnes ;
--   3. aucun trigger de garde.
--
-- Une policy RLS ne filtre PAS par colonne : la seule contrainte était « tu ne modifies
-- que TA ligne », jamais « tu ne modifies que TES champs ». Avec le seul jeton d'un membre :
--
--     PATCH /rest/v1/profiles?id=eq.<son_id>   { "role": "gym_admin" }
--
-- → il devenait gérant : tous les membres, tous les paiements, tout le CA. Étaient aussi
-- écrivables : gym_id (rattachement à une AUTRE salle = brèche multi-tenant),
-- suspended_until et noshow_count (annulation de ses propres sanctions), email, deleted_at.
--
-- ── Le correctif ─────────────────────────────────────────────────────────────
-- Modèle GYM-180 sur nexxia_gyms : la policy dit QUELLE LIGNE, le GRANT dit QUELLES
-- COLONNES. Les deux sont nécessaires — l'un ne remplace pas l'autre.
--
-- ⚠️ PostgREST rejette la requête ENTIÈRE si elle mentionne une colonne hors liste blanche,
-- MÊME à valeur inchangée. Les 9 écritures client sur profiles (mobile + dashboard) ont été
-- inventoriées : toutes envoient un objet PARTIEL, aucune ne fait de `.update({ ...profile })`.
-- Aucune réduction de payload n'a donc été nécessaire.
--
-- ⚠️ Les Edge Functions (admin-create-member, admin-update-member, delete-account, …)
-- passent par SUPABASE_SERVICE_ROLE_KEY → rôle `service_role`, dont les GRANTs ne sont pas
-- touchés ici. Elles ne sont PAS affectées.
--
-- ⚠️ handle_new_user() est SECURITY DEFINER et fait un INSERT : hors de portée de ce REVOKE.
--
-- À appliquer sur STAGING puis PROD.

-- ─────────────────────────────────────────────────────────────────────────────
-- a) WITH CHECK EXPLICITE
--
-- Sans WITH CHECK, Postgres retombe implicitement sur USING pour l'UPDATE. Le résultat est
-- correct mais tacite : on l'écrit noir sur blanc pour que la ligne d'arrivée soit contrôlée
-- au même titre que la ligne de départ (interdit de réécrire `id` vers un autre utilisateur).
-- Le reste de la policy est recopié à l'identique (FOR UPDATE, TO public).
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Modifier son propre profil" ON public.profiles;
CREATE POLICY "Modifier son propre profil" ON public.profiles
  FOR UPDATE
  USING      (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- b) LISTE BLANCHE DE COLONNES
--
-- `anon` n'a jamais rien à écrire ici (la policy ne matche aucune ligne pour lui, mais le
-- GRANT n'avait aucune raison d'exister) ; `authenticated` est ramené à la liste blanche.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE UPDATE ON public.profiles FROM anon;
REVOKE UPDATE ON public.profiles FROM authenticated;

GRANT UPDATE (
  -- Identité — apps/mobile/app/profile/edit.tsx, dashboard AccountActivation (GYM-202),
  -- healProfile (GYM-154) et healAppleProfileName (GYM-150).
  first_name, last_name, phone, date_of_birth, avatar_url,

  -- Adresse — écrite en bloc par l'écran d'édition du profil mobile. address_line est la
  -- forme composée des quatre autres, recalculée côté client à chaque enregistrement.
  street_name, street_number, postal_code, city, address_line,

  -- Contact d'urgence.
  emergency_contact_name, emergency_contact_phone,

  -- Préférences — apps/mobile/app/profile/preferences.tsx.
  preferred_language, notification_preferences,

  -- Notifications push — apps/mobile/hooks/usePushNotifications.ts.
  push_token,

  -- Consentements. Aucun client ne les écrit ENCORE (ils sont posés à l'inscription via les
  -- metadata auth, donc par handle_new_user en SECURITY DEFINER), mais la ré-acceptation
  -- in-app de GYM-197 passera par ici. Les colonnes `*_at` accompagnent leur drapeau : un
  -- horodatage sans consentement n'a pas de sens, et track_consent_changes() ne les pose pas.
  terms_version, terms_accepted_at,
  privacy_policy_version, privacy_policy_accepted_at,
  marketing_consent, marketing_consent_at,
  data_processing_consent, data_processing_consent_at,

  -- gym_id — SENSIBLE, mais INDISPENSABLE : le heal GYM-154
  -- (apps/mobile/lib/ensureProfile.ts) pose gym_id quand il est NULL, ce qui est LE correctif
  -- de l'inscription OAuth Apple/Google. Sans lui, l'app est entièrement vide pour tout
  -- inscrit par ce chemin. NE PAS RETIRER de cette liste : l'immuabilité une fois posé est
  -- assurée par le trigger trg_gym_id_immutable (migration suivante), pas par le GRANT.
  gym_id
) ON public.profiles TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- COLONNES VOLONTAIREMENT EXCLUES (17 sur 41) — un utilisateur ne doit jamais les écrire
-- lui-même. Toute réintroduction doit être justifiée ticket en main.
--
--   id                     clé primaire ; réécriture = usurpation
--   role                   ⚠️ LA faille — élévation en gym_admin / super_admin
--   email                  identifiant de connexion ; passe par auth.updateUser
--   suspended_until        sanction no-show : la victime ne lève pas sa propre suspension
--   noshow_count           idem — compteur de sanction
--   deleted_at             suppression logique ; réservée à delete-account (service_role)
--   deletion_requested_at  demande RGPD ; même chemin
--   created_at             horodatage système
--   member_since           ancienneté ; sert de base à des droits commerciaux
--   updated_at             posé par le trigger trg_profiles_updated
--   last_seen_at           télémétrie serveur ; aucune écriture client
--   profile_completion     métrique dérivée, pas une donnée saisie
--   reward_unlocked        gamification : s'auto-attribuer une récompense
--   two_factor_enabled     posture de sécurité — mérite un parcours dédié, pas un PATCH
--   two_factor_required    imposé par le gérant, pas par l'utilisateur
--   gender                 aucune écriture client aujourd'hui ; donnée sensible → exclue
--                          par défaut, à rouvrir si un écran la saisit un jour
--   country                aucune écriture client ; défaut 'BE' à l'insertion
-- ─────────────────────────────────────────────────────────────────────────────

COMMENT ON POLICY "Modifier son propre profil" ON public.profiles IS
  'GYM-203 — restreint la LIGNE (la sienne). Les COLONNES autorisées sont fixées par le '
  'GRANT UPDATE (…) TO authenticated de la même migration : une policy RLS ne filtre pas '
  'par colonne.';
