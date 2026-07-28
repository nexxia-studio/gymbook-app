-- GYM-197 : journaliser l'acceptation des CGU dans consent_history.
--
-- TROU CONSTATÉ : le trigger track_consent_changes journalise 'privacy_policy' et
-- 'marketing', mais PAS 'terms' — alors que profiles.terms_version et terms_accepted_at
-- existent, et que consent_history_consent_type_check autorise déjà 'terms'.
-- Conséquence : l'acceptation des CGU n'était tracée nulle part de façon horodatée et
-- versionnée. C'est précisément la preuve qu'on doit pouvoir produire en cas de litige.
--
-- ─── Constats base live (Règle Zéro) ────────────────────────────────────────
--   - Définition LIVE du trigger relue : deux branches (privacy_policy, marketing).
--     La branche ajoutée est calquée À L'IDENTIQUE sur celle de privacy_policy —
--     même déclencheur (IS DISTINCT FROM sur la colonne de version), même colonnes
--     insérées, même granted = true.
--   - consent_history_consent_type_check autorise déjà : privacy_policy | terms |
--     marketing | data_processing | cookies | medical_data → aucune modification du
--     CHECK n'est nécessaire.
--   - profiles.terms_version (text) et profiles.terms_accepted_at (timestamptz) existent.
--
-- ⚠️ ANTI-DRIFT : les deux branches existantes sont reprises telles quelles ; SEULE la
-- branche 'terms' est ajoutée. Le trigger lui-même (nom, table, timing) n'est pas touché,
-- CREATE OR REPLACE FUNCTION suffit — le trigger continue de pointer sur cette fonction.

CREATE OR REPLACE FUNCTION public.track_consent_changes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF (TG_OP = 'UPDATE' AND OLD.privacy_policy_version IS DISTINCT FROM NEW.privacy_policy_version) THEN
    INSERT INTO consent_history (user_id, consent_type, version, granted)
    VALUES (NEW.id, 'privacy_policy', NEW.privacy_policy_version, true);
  END IF;

  -- GYM-197 — SEUL AJOUT : l'acceptation des CGU, sur le même modèle que privacy_policy.
  -- Un changement de terms_version vaut acceptation de cette version (granted = true) :
  -- c'est l'app qui ne pose la colonne qu'après action explicite du membre.
  IF (TG_OP = 'UPDATE' AND OLD.terms_version IS DISTINCT FROM NEW.terms_version) THEN
    INSERT INTO consent_history (user_id, consent_type, version, granted)
    VALUES (NEW.id, 'terms', NEW.terms_version, true);
  END IF;

  IF (TG_OP = 'UPDATE' AND OLD.marketing_consent IS DISTINCT FROM NEW.marketing_consent) THEN
    INSERT INTO consent_history (user_id, consent_type, version, granted)
    VALUES (NEW.id, 'marketing', '1.0', NEW.marketing_consent);
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.track_consent_changes() IS
  'Journalise dans consent_history tout changement de consentement porté par profiles : '
  'privacy_policy_version, terms_version (GYM-197) et marketing_consent. Chaque ligne est '
  'horodatée et versionnée — c''est la preuve d''acceptation opposable en cas de litige.';
