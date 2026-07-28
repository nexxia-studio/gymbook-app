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
--
-- ─── ON NE JOURNALISE QUE CE QUI EST RÉELLEMENT POSÉ ────────────────────────
-- DÉFAUT CORRIGÉ (QA staging) : remettre une version de consentement à NULL faisait
-- ÉCHOUER tout l'UPDATE du profil —
--     ERROR 23502: null value in column "version" of relation "consent_history"
--                  violates not-null constraint
-- IS DISTINCT FROM se déclenche aussi sur « valeur → NULL » : le trigger tentait alors
-- d'insérer version = NULL dans une colonne NOT NULL, et faisait tomber la transaction.
-- Préexistant sur privacy_policy ; ce lot l'aurait étendu à terms. Une correction admin,
-- un flux RGPD ou une purge auraient bloqué la mise à jour du profil sur une erreur
-- incompréhensible.
--
-- D'où la condition IS NOT NULL sur les deux branches VERSIONNÉES. La sémantique est le
-- vrai motif, pas seulement la contrainte : on journalise une ACCEPTATION, pas un
-- effacement. Poser une version = accepter (granted = true) ; la RETIRER n'est pas un
-- consentement et n'a rien à faire dans ce journal.
-- ⚠️ NE PAS « COMPLÉTER » en journalisant les retraits avec granted = false : l'historique
-- des acceptations antérieures reste intact, et c'est précisément ce qu'on doit pouvoir
-- produire en cas de litige. Un retrait se constate par l'état courant du profil.
--
-- La branche 'marketing' n'est PAS concernée : elle journalise un booléen avec une version
-- constante '1.0', jamais NULL — sa valeur granted porte déjà le sens « accordé/retiré ».

CREATE OR REPLACE FUNCTION public.track_consent_changes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF (TG_OP = 'UPDATE'
      AND OLD.privacy_policy_version IS DISTINCT FROM NEW.privacy_policy_version
      AND NEW.privacy_policy_version IS NOT NULL) THEN
    INSERT INTO consent_history (user_id, consent_type, version, granted)
    VALUES (NEW.id, 'privacy_policy', NEW.privacy_policy_version, true);
  END IF;

  -- GYM-197 — l'acceptation des CGU, sur le même modèle que privacy_policy.
  -- Un changement de terms_version vaut acceptation de cette version (granted = true) :
  -- c'est l'app qui ne pose la colonne qu'après action explicite du membre.
  IF (TG_OP = 'UPDATE'
      AND OLD.terms_version IS DISTINCT FROM NEW.terms_version
      AND NEW.terms_version IS NOT NULL) THEN
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
  'Journalise dans consent_history les consentements portés par profiles : '
  'privacy_policy_version, terms_version (GYM-197) et marketing_consent. Chaque ligne est '
  'horodatée et versionnée — c''est la preuve d''acceptation opposable en cas de litige. '
  'Les deux branches VERSIONNÉES n''écrivent que si la nouvelle version est NON NULLE : on '
  'journalise une ACCEPTATION, pas un effacement ; remettre une version à NULL ne crée donc '
  'aucune ligne et ne fait plus échouer l''UPDATE du profil (contrainte NOT NULL sur '
  'consent_history.version). La branche marketing, elle, porte le sens accordé/retiré dans '
  'sa colonne granted.';
