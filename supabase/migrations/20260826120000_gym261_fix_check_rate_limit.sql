-- GYM-261 : réparation de check_rate_limit, fonction morte depuis son écriture.
--
-- ⚠️ NON DÉPLOYÉE. Idempotente et rejouable (CREATE OR REPLACE + REVOKE/GRANT).
--
-- ═════════════════════════════════════════════════════════════════════════════
-- DEUX FONCTIONS DE RATE LIMIT COEXISTENT — LIRE AVANT D'EN AJOUTER UNE TROISIÈME
-- ═════════════════════════════════════════════════════════════════════════════
--
--   check_webhook_rate_limit(p_identifier, p_action, p_max_calls, p_window_seconds)
--     Sert les WEBHOOKS Mollie (mollie-webhook, mollie-subscription-webhook).
--     Identifiant = l'id de paiement Mollie. Fenêtre en SECONDES.
--     ✅ CORRECTE ET EN PRODUCTION — ce fichier n'y touche pas.
--
--   check_rate_limit(p_identifier, p_action, p_max_attempts, p_window_minutes)
--     Fonction GÉNÉRIQUE, fenêtre en MINUTES, destinée aux CHEMINS PUBLICS :
--     inscription self-serve, réinitialisation de mot de passe, invitations.
--     C'est celle que ce fichier répare.
--
-- Les deux partagent la table `rate_limits`, et se distinguent par l'unité de
-- fenêtre et par l'usage. ⚠️ TOUTE NOUVELLE PROTECTION PASSE PAR L'UNE DES DEUX —
-- jamais par une troisième logique écrite en ligne dans une fonction métier.
--
-- ⚠️ DETTE ASSUMÉE, À FAIRE CONVERGER : le RPC `create_gym_self_serve` (GYM-248)
-- porte encore SA PROPRE logique de fenêtre glissante, écrite en ligne. Elle est
-- correcte et validée 8/8 en staging, et elle est EN PRODUCTION — la remplacer
-- exige une recette complète du funnel d'inscription, ce qui n'est pas le
-- périmètre de ce lot. Le jour où on la fera, c'est vers `check_rate_limit`
-- qu'elle doit converger, pas l'inverse.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- 🔴 LE DÉFAUT : LA FONCTION N'A JAMAIS PROTÉGÉ PERSONNE
-- ═════════════════════════════════════════════════════════════════════════════
-- Corps déployé (relu sur staging avant écriture, pas supposé) :
--
--     INSERT INTO rate_limits (identifier, action, attempts)
--     VALUES (p_identifier, p_action, 1)
--     ON CONFLICT (identifier, action, window_start)   -- ← TROIS colonnes
--     DO UPDATE SET attempts = rate_limits.attempts + 1;
--
-- Or les contraintes RÉELLES de la table sont :
--     rate_limits_pkey                   PRIMARY KEY (id)
--     rate_limits_identifier_action_key  UNIQUE (identifier, action)   -- ← DEUX colonnes
--     idx_rate_limits_lookup             INDEX (identifier, action, window_start)  -- NON unique
--
-- `ON CONFLICT` exige un index UNIQUE correspondant. L'index à trois colonnes
-- existe bien mais n'est pas unique : Postgres lève
--     42P10 — there is no unique or exclusion constraint matching the ON CONFLICT specification
-- au PREMIER conflit, c'est-à-dire au deuxième appel pour un même couple
-- (identifier, action).
--
-- ⚠️ CE DÉFAUT EST RESTÉ INVISIBLE PARCE QUE LA FONCTION N'A AUCUN APPELANT.
-- Recensement fait au cockpit : sa définition (baseline), les migrations de
-- durcissement d'ACL, les types générés, et un commentaire de GYM-248. Rien
-- d'autre. Le premier chemin public qu'on aurait voulu protéger aurait donc
-- échoué en 500 au deuxième essai d'un même utilisateur — c'est-à-dire au moment
-- exact où la protection devait servir.
--
-- Second défaut, plus discret : le corps déployé n'a AUCUNE remise à zéro. Le
-- `SELECT SUM(...)` filtre bien sur la fraîcheur, mais la ligne, elle, n'est
-- jamais réinitialisée : `attempts` grossirait indéfiniment et `window_start`
-- garderait sa valeur d'origine. La fenêtre glissante n'aurait jamais glissé.

-- ═════════════════════════════════════════════════════════════════════════════
-- LA RÉPARATION
-- ═════════════════════════════════════════════════════════════════════════════
--
-- ⚠️ SIGNATURE INCHANGÉE, y compris les valeurs par défaut (5 tentatives,
-- 15 minutes) : la fonction est déjà dans les types générés, et une signature qui
-- bouge casserait un appelant futur pour rien.
--
-- ── SÉMANTIQUE DU COMPTEUR : LE TEST PORTE SUR LA VALEUR D'AVANT ─────────────
-- On lit `attempts` AVANT l'écriture et on compare cette valeur à la limite.
-- Conséquence, à connaître : la fonction autorise EXACTEMENT `p_max_attempts`
-- appels, et refuse le suivant.
--
--     appel 1 : lu = 0 (aucune ligne fraîche) → 0 < 5 → true,  ligne à attempts=1
--     appel 2 : lu = 1                        → 1 < 5 → true,  attempts=2
--     …
--     appel 5 : lu = 4                        → 4 < 5 → true,  attempts=5
--     appel 6 : lu = 5                        → 5 < 5 → FALSE, attempts=6
--
-- 🔴 C'EST LA CONVENTION DE check_webhook_rate_limit, REPRISE TELLE QUELLE, ET
-- C'EST LE POINT : deux fonctions de rate limit qui compteraient différemment
-- (l'une « avant », l'autre « après ») donneraient à `p_max_attempts = 5` deux
-- sens selon la fonction appelée. Personne ne s'en apercevrait avant de comparer
-- deux incidents.
--
-- ── FENÊTRE GLISSANTE, avec remise à zéro ───────────────────────────────────
-- L'upsert décide, ligne par ligne : si `window_start` est encore DANS la
-- fenêtre, on incrémente et on garde la borne d'origine (la fenêtre ne se
-- prolonge pas à chaque appel — sans quoi un attaquant régulier la repousserait
-- indéfiniment). Sinon on repart à 1 avec `window_start = now()`.
--
-- ── blocked_until : DÉLIBÉRÉMENT INUTILISÉE, ET C'EST ÉCRIT ─────────────────
-- La colonne existe depuis la baseline et n'est lue par personne — ni ici, ni
-- dans check_webhook_rate_limit, ni dans aucun appelant.
--
-- Elle n'est PAS exploitée ici, et ce n'est pas un oubli : elle introduirait une
-- SECONDE sémantique de refus — un verrouillage qui SURVIT à la fenêtre — que
-- personne n'a demandée, qu'aucun appelant ne saurait lever, et qui ferait
-- diverger les deux fonctions que ce fichier vient précisément d'aligner.
--
-- 👉 SI un verrouillage devient nécessaire un jour, tout tient en trois gestes,
--    et ils vont ensemble :
--      1. dans le SELECT ci-dessous, refuser d'emblée si
--         `blocked_until IS NOT NULL AND blocked_until > now()` ;
--      2. dans le DO UPDATE, poser `blocked_until = now() + <durée>` quand
--         `attempts + 1` dépasse la limite ;
--      3. remettre `blocked_until = NULL` sur la branche de remise à zéro,
--         sans quoi un verrou posé une fois ne se lèverait jamais.
--    Les trois, ou aucun : n'en écrire que deux crée un blocage définitif.
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_identifier     text,
  p_action         text,
  p_max_attempts   integer DEFAULT 5,
  p_window_minutes integer DEFAULT 15
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  -- Nombre de tentatives DÉJÀ enregistrées dans la fenêtre courante, lu AVANT
  -- l'écriture. NULL si aucune ligne, ou si la ligne existante est périmée.
  v_attempts_before integer;
  -- Borne basse de la fenêtre : une ligne n'est « fraîche » que si son
  -- window_start lui est postérieur.
  v_window_floor    timestamptz;
BEGIN
  -- `make_interval` plutôt que la concaténation `(p_window_minutes || ' minutes')::interval`
  -- employée par check_webhook_rate_limit : même résultat, mais typé, et sans
  -- construction d'intervalle par assemblage de texte.
  v_window_floor := now() - make_interval(mins => p_window_minutes);

  SELECT attempts
    INTO v_attempts_before
  FROM rate_limits
  WHERE identifier   = p_identifier
    AND action       = p_action
    AND window_start > v_window_floor
  LIMIT 1;

  -- ⚠️ ON CONFLICT SUR (identifier, action) — LES DEUX COLONNES DE LA CONTRAINTE
  -- RÉELLE `rate_limits_identifier_action_key`. C'est LA correction : la version
  -- déployée en nommait trois, dont aucune combinaison unique n'existe.
  INSERT INTO rate_limits (identifier, action, attempts, window_start)
  VALUES (p_identifier, p_action, 1, now())
  ON CONFLICT (identifier, action) DO UPDATE SET
    attempts = CASE
      WHEN rate_limits.window_start > v_window_floor THEN rate_limits.attempts + 1
      ELSE 1                        -- fenêtre expirée → on repart de zéro
    END,
    window_start = CASE
      -- La borne d'origine est CONSERVÉE tant que la fenêtre est valide : la
      -- repousser à chaque appel ferait glisser la fenêtre avec l'attaquant, et
      -- elle n'expirerait jamais.
      WHEN rate_limits.window_start > v_window_floor THEN rate_limits.window_start
      ELSE now()
    END;

  -- ⚠️ Deux appels CONCURRENTS peuvent lire la même valeur d'avant et être
  -- autorisés tous les deux. C'est admis : un limiteur de débit borne un ordre de
  -- grandeur, il ne tient pas une comptabilité. Le rendre exact demanderait un
  -- verrou par identifiant, dont le coût dépasserait le service rendu sur des
  -- chemins publics. Même compromis que check_webhook_rate_limit.
  RETURN COALESCE(v_attempts_before, 0) < p_max_attempts;
END;
$function$;

COMMENT ON FUNCTION public.check_rate_limit(text, text, integer, integer) IS
  'GYM-261 — Limiteur de débit GÉNÉRIQUE (fenêtre en MINUTES), pour les chemins publics : '
  'inscription self-serve, réinitialisation de mot de passe, invitations. Autorise '
  'EXACTEMENT p_max_attempts appels par fenêtre glissante (le test porte sur la valeur '
  'd''avant, comme check_webhook_rate_limit). Réparé : l''ON CONFLICT nommait trois '
  'colonnes alors que la contrainte unique en porte deux (42P10 au premier conflit), et '
  'aucune remise à zéro de fenêtre n''existait. Ne pas confondre avec '
  'check_webhook_rate_limit (fenêtre en SECONDES, webhooks Mollie). rate_limits.blocked_until '
  'reste volontairement inutilisée — voir l''en-tête de la migration.';

-- ═════════════════════════════════════════════════════════════════════════════
-- ACL — réaffirmées, à l'identique de la migration de durcissement 20260720161810
-- ═════════════════════════════════════════════════════════════════════════════
-- `CREATE OR REPLACE` conserve les droits existants : ces deux lignes sont donc
-- redondantes aujourd'hui (état live vérifié : {postgres=X, service_role=X}).
-- Elles sont écrites quand même, parce qu'une fonction SECURITY DEFINER dans le
-- schéma `public` reçoit EXECUTE pour PUBLIC par défaut à la moindre recréation :
-- si quelqu'un la DROP puis la recrée sans relire ce fichier, elle redeviendrait
-- appelable par `anon`. Le coût est nul, l'oubli serait une brèche.
REVOKE ALL     ON FUNCTION public.check_rate_limit(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.check_rate_limit(text, text, integer, integer) TO service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- SCÉNARIO DE TEST — à exécuter par le cockpit après application
-- ═════════════════════════════════════════════════════════════════════════════
-- À jouer d'un bloc, en service_role (ou en tant que propriétaire). Chaque étape
-- annonce le résultat attendu ; toute divergence est un échec.
--
-- -- 0) Terrain propre
-- DELETE FROM rate_limits WHERE identifier LIKE 'gym261-test-%';
--
-- -- 1) N appels sous la limite (max 3) → true à chaque fois
-- SELECT check_rate_limit('gym261-test-a', 'signup', 3, 15);   -- attendu: true
-- SELECT check_rate_limit('gym261-test-a', 'signup', 3, 15);   -- attendu: true
-- SELECT check_rate_limit('gym261-test-a', 'signup', 3, 15);   -- attendu: true
--
-- -- 2) Appel N+1 → false  (⚠️ c'est ici que la version déployée levait 42P10)
-- SELECT check_rate_limit('gym261-test-a', 'signup', 3, 15);   -- attendu: FALSE
--
-- -- 3) État de la ligne : une seule, compteur cohérent
-- SELECT identifier, action, attempts, window_start, blocked_until
-- FROM rate_limits WHERE identifier = 'gym261-test-a';
-- -- attendu: 1 ligne, attempts = 4 (les 4 appels comptés), blocked_until NULL
--
-- -- 4) Fenêtre expirée → remise à zéro → true
-- UPDATE rate_limits SET window_start = now() - interval '30 minutes'
-- WHERE identifier = 'gym261-test-a';
-- SELECT check_rate_limit('gym261-test-a', 'signup', 3, 15);   -- attendu: TRUE
-- SELECT attempts FROM rate_limits WHERE identifier = 'gym261-test-a';
-- -- attendu: 1 (compteur réinitialisé, PAS 5)
--
-- -- 5) Deux IDENTIFIANTS distincts n'interfèrent pas
-- SELECT check_rate_limit('gym261-test-b', 'signup', 1, 15);   -- attendu: true
-- SELECT check_rate_limit('gym261-test-b', 'signup', 1, 15);   -- attendu: FALSE (b saturé)
-- SELECT check_rate_limit('gym261-test-c', 'signup', 1, 15);   -- attendu: TRUE  (c intact)
--
-- -- 6) Deux ACTIONS distinctes sur le MÊME identifiant n'interfèrent pas
-- SELECT check_rate_limit('gym261-test-d', 'signup',         1, 15);  -- attendu: true
-- SELECT check_rate_limit('gym261-test-d', 'signup',         1, 15);  -- attendu: FALSE
-- SELECT check_rate_limit('gym261-test-d', 'password_reset', 1, 15);  -- attendu: TRUE
--
-- -- 7) Les valeurs par défaut sont bien 5 / 15
-- SELECT check_rate_limit('gym261-test-e', 'signup');          -- attendu: true
-- SELECT pg_get_function_arguments(oid) FROM pg_proc
-- WHERE proname = 'check_rate_limit' AND pronamespace = 'public'::regnamespace;
-- -- attendu: … p_max_attempts integer DEFAULT 5, p_window_minutes integer DEFAULT 15
--
-- -- 8) ACL inchangées : service_role seul
-- SELECT has_function_privilege('anon','public.check_rate_limit(text,text,integer,integer)','execute')          AS anon,          -- attendu: false
--        has_function_privilege('authenticated','public.check_rate_limit(text,text,integer,integer)','execute') AS authenticated, -- attendu: false
--        has_function_privilege('service_role','public.check_rate_limit(text,text,integer,integer)','execute')  AS service_role;  -- attendu: true
--
-- -- 9) NON-RÉGRESSION : la fonction des webhooks est intacte
-- SELECT check_webhook_rate_limit('gym261-test-wh', 'mollie_webhook', 2, 60);  -- attendu: true
-- SELECT check_webhook_rate_limit('gym261-test-wh', 'mollie_webhook', 2, 60);  -- attendu: true
-- SELECT check_webhook_rate_limit('gym261-test-wh', 'mollie_webhook', 2, 60);  -- attendu: FALSE
--
-- -- 10) Nettoyage
-- DELETE FROM rate_limits WHERE identifier LIKE 'gym261-test-%';
