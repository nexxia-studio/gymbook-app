-- ╔═══════════════════════════════════════════════════════════════════════════════════════╗
-- ║  GYM-330 — RECUEILLIR LE CONSENTEMENT, ET LE DATER CÔTÉ SERVEUR                      ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════════╝
--
-- 🔴 CE FICHIER N'EST PAS APPLIQUÉ PAR CE LOT. Le cockpit l'exécute, staging puis prod.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- LE FAIT, RELEVÉ EN PROD LE 11/09 (SELECT, aucune écriture)
-- ─────────────────────────────────────────────────────────────────────────────────────
--   104 profils vivants · 54 avec consentement · 50 SANS AUCUN (ni terms_version, ni
--   privacy_policy_version) — dont 47 membres et 3 gym_admin.
--   Le cockpit en comptait 48 sur 97 le 10/09 : l'écart se creuse, chaque création par
--   `admin-create-member` ajoutant un compte sans consentement.
--
-- Ce n'est PAS un défaut de journalisation — GYM-199 l'a corrigé. C'est un défaut de
-- RECUEIL : ces personnes n'ont jamais rien accepté, et aucune migration ne peut fabriquer
-- une acceptation qui n'a pas eu lieu. D'où l'écran bloquant, et d'où cette fonction.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- POURQUOI UNE RPC ALORS QUE LE CLIENT POURRAIT ÉCRIRE DIRECTEMENT
-- ─────────────────────────────────────────────────────────────────────────────────────
-- `terms_version`, `terms_accepted_at`, `privacy_policy_version` et
-- `privacy_policy_accepted_at` SONT dans la liste blanche de colonnes de gym203 : un UPDATE
-- client passerait. Deux raisons de ne pas s'en contenter.
--
-- 1. 🔴 L'HORODATAGE. Un `accepted_at` écrit par le téléphone vaut l'horloge du téléphone,
--    qui se règle à la main. C'est la règle posée par GYM-336 pour la demande d'exécution
--    anticipée, et il n'y a aucune raison qu'elle vaille pour une case d'achat et pas pour
--    l'acceptation du contrat lui-même. `now()` ici, sur le serveur.
--    C'est aussi ce que font DÉJÀ les consentements existants : `handle_new_user` les pose
--    avec `now()`. Un consentement écrit par le client serait le seul du parc à ne pas
--    l'être.
--
-- 2. LES DEUX DOCUMENTS ENSEMBLE. L'écran fait accepter les CGV ET la politique de
--    confidentialité d'un même geste ; deux colonnes posées par deux instructions séparées
--    peuvent diverger si la seconde échoue. Ici c'est une transaction.
--
-- ⚠️ CE N'EST PAS UNE FONCTION PRIVILÉGIÉE. Elle n'écrit QUE sur `auth.uid()` — un membre
-- ne peut consentir que pour lui-même, jamais pour un autre. C'est la même garantie que la
-- RLS `id = auth.uid()` offrait déjà, mais elle ne dépend plus d'elle.

CREATE OR REPLACE FUNCTION public.accept_legal_terms(p_version text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'accept_legal_terms: appel non authentifié'
      USING ERRCODE = 'PT401', HINT = 'LEGAL_UNAUTHENTICATED';
  END IF;

  -- Forme volontairement étroite : la valeur vient du client et finit dans une colonne à
  -- valeur probante, puis dans consent_history. '2.0', '2.1', '10.0' passent ; rien d'autre.
  IF p_version IS NULL OR p_version !~ '^[0-9]{1,3}\.[0-9]{1,3}$' THEN
    RAISE EXCEPTION 'accept_legal_terms: version invalide (%)', p_version
      USING ERRCODE = 'PT422', HINT = 'LEGAL_INVALID_VERSION';
  END IF;

  -- ⚠️ LES DEUX DOCUMENTS, ET LES QUATRE COLONNES, EN UNE INSTRUCTION. Le trigger
  -- `trg_track_consent` (GYM-199) journalise alors DEUX lignes dans consent_history —
  -- 'terms' et 'privacy_policy' — parce que les deux versions changent. C'est lui le
  -- journal ; cette fonction ne fait que poser l'état.
  UPDATE public.profiles
     SET terms_version              = p_version,
         terms_accepted_at          = v_now,
         privacy_policy_version     = p_version,
         privacy_policy_accepted_at = v_now,
         updated_at                 = v_now
   WHERE id = v_uid
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    -- Profil absent ou supprimé : on ne crée rien. Un compte supprimé n'accepte plus rien,
    -- et inventer une ligne de profil ici masquerait un tout autre problème.
    RAISE EXCEPTION 'accept_legal_terms: profil introuvable ou supprimé'
      USING ERRCODE = 'PT404', HINT = 'LEGAL_NO_PROFILE';
  END IF;

  RETURN jsonb_build_object('status', 'accepted', 'version', p_version, 'at', v_now);
END;
$function$;

COMMENT ON FUNCTION public.accept_legal_terms(text) IS
  'GYM-330 — Enregistre l''acceptation des CGV ET de la politique de confidentialité pour '
  'l''appelant, horodatée par le SERVEUR. L''identité vient toujours de auth.uid() : un '
  'membre ne consent que pour lui-même. Le journal consent_history est alimenté par le '
  'trigger trg_track_consent (GYM-199), pas par cette fonction.';

REVOKE ALL ON FUNCTION public.accept_legal_terms(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_legal_terms(text) TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 🔴 REMISE À ZÉRO DES COMPTEURS DE NO-SHOW — VOLONTAIREMENT COMMENTÉE
-- ═════════════════════════════════════════════════════════════════════════════════════
-- À EXÉCUTER AU DÉPLOIEMENT, PAS AVANT, ET UNE SEULE FOIS.
--
-- POURQUOI. Le barème d'absences (art. B8 des CGV) est une règle CONTRACTUELLE. Une
-- sanction fondée sur un contrat que la personne n'a jamais accepté ne lui est pas
-- opposable. Les compteurs des profils sans aucun consentement doivent donc repartir de
-- zéro — et les suspensions en cours être levées, sans quoi la remise à zéro serait
-- cosmétique : le compteur tomberait à 0 pendant que l'interdiction de réserver courrait.
--
-- 🔴 POURQUOI AU DÉPLOIEMENT ET PAS ICI. Le prédicat porte sur « aucun consentement ». Dès
-- que l'écran est en production, des membres acceptent — et sortent du périmètre. Jouer la
-- requête AVANT que l'écran existe remettrait à zéro des compteurs qui se seraient
-- re-remplis entre-temps ; la jouer APRÈS ne toucherait plus qu'un sous-ensemble qui
-- rétrécit d'heure en heure. Elle doit partir dans la MÊME fenêtre que le déploiement.
--
-- ⚠️ LES LIGNES `bookings.status = 'no_show'` NE SONT PAS TOUCHÉES, et c'est délibéré :
-- elles constatent un FAIT (la personne ne s'est pas présentée). C'est la SANCTION qui
-- n'est pas opposable, pas l'absence. Les effacer réécrirait l'historique de la salle.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- PÉRIMÈTRE RÉEL, MESURÉ EN PROD LE 11/09 (SELECT seul)
-- ─────────────────────────────────────────────────────────────────────────────────────
--   47 membres sans consentement · 1 SEUL avec un compteur (noshow_count = 1)
--   0 suspension posée · 0 suspension EN COURS · aucune date de fin
--
-- La remise à zéro touchera donc UNE ligne, et aucune suspension n'est à lever. Le geste
-- reste juste — il est simplement minuscule aujourd'hui, et ne le sera plus si le
-- déploiement tarde. C'est un argument pour déployer, pas pour renoncer à la requête.
--
--   BEGIN;
--
--   -- 1. Contrôle AVANT : à relire, et à archiver dans le ticket.
--   SELECT id, role, noshow_count, suspended_until
--     FROM public.profiles
--    WHERE deleted_at IS NULL
--      AND terms_version IS NULL
--      AND privacy_policy_version IS NULL
--      AND (noshow_count > 0 OR suspended_until IS NOT NULL);
--
--   -- 2. La remise à zéro. Le prédicat exige les DEUX colonnes nulles : un membre qui
--   --    aurait accepté l'un des deux documents a bien été mis en face du texte.
--   UPDATE public.profiles
--      SET noshow_count    = 0,
--          suspended_until = NULL,
--          updated_at      = now()
--    WHERE deleted_at IS NULL
--      AND terms_version IS NULL
--      AND privacy_policy_version IS NULL
--      AND (noshow_count > 0 OR suspended_until IS NOT NULL);
--
--   -- 3. Contrôle APRÈS : doit rendre 0 ligne.
--   SELECT count(*) FROM public.profiles
--    WHERE deleted_at IS NULL
--      AND terms_version IS NULL AND privacy_policy_version IS NULL
--      AND (noshow_count > 0 OR suspended_until IS NOT NULL);
--
--   COMMIT;
