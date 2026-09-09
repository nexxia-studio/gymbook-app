-- ╔═══════════════════════════════════════════════════════════════════════════════════════╗
-- ║  GYM-199 (VOLET 1) — FAIRE FONCTIONNER LA JOURNALISATION DU CONSENTEMENT              ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════════╝
--
-- 🔴 CE FICHIER N'EST PAS APPLIQUÉ PAR CE LOT. Le cockpit l'exécute, staging puis prod.
-- Le versionnement et la réacceptation NE SONT PAS dans ce lot.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- LE FAIT, MESURÉ SUR LE DÉPLOYÉ LE 09/09
-- ─────────────────────────────────────────────────────────────────────────────────────
-- `consent_history` : ZÉRO ligne, pour 97 profils vivants.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- DEUX CAUSES, ET LA SECONDE N'ÉTAIT PAS AU TICKET
-- ─────────────────────────────────────────────────────────────────────────────────────
-- CAUSE 1 — celle du ticket, VÉRIFIÉE sur le déployé et non reprise de confiance :
--   `trg_track_consent` est un trigger AFTER **UPDATE** seul (pg_trigger, tgtype), et les
--   trois branches de `track_consent_changes` testent `TG_OP = 'UPDATE'`. Or le cas
--   nominal pose le consentement à la CRÉATION : `handle_new_user` écrit
--   `terms_version` / `privacy_policy_version` dans son INSERT, depuis les metadata
--   `terms_accepted` / `privacy_policy_accepted` / `legal_version`. Aucun UPDATE ne suit,
--   donc rien n'est jamais journalisé.
--
-- 🔴 CAUSE 2 — LATENTE, ET ELLE AURAIT TRANSFORMÉ LE CORRECTIF EN PANNE :
--   `consent_history` a la RLS ACTIVE et ne porte que deux policies — « Super admins
--   voient tout » [ALL] et « Voir son historique de consentements » [SELECT]. AUCUNE
--   policy INSERT pour un utilisateur ordinaire. Et `track_consent_changes` était en
--   SECURITY INVOKER.
--
--   Tant que le trigger ne mordait que sur UPDATE, cela ne se voyait pas : la version ne
--   change jamais (le versionnement est le volet 2). Mais étendre à INSERT sans traiter
--   ceci aurait fait ÉCHOUER toute création de profil faite par un client — le repli
--   `apps/mobile/lib/ensureProfile.ts` insère dans `profiles` sous le rôle
--   `authenticated` : le trigger aurait tenté son INSERT sous ce même rôle, la RLS
--   l'aurait refusé, et l'ERREUR AURAIT REMONTÉ jusqu'à annuler la création du profil.
--
--   D'où le passage en SECURITY DEFINER ci-dessous. Ce n'est pas un contournement de
--   confort : un journal d'audit doit pouvoir écrire sa ligne quel que soit l'appelant,
--   sinon il n'est pas un journal. `handle_new_user` (SECURITY DEFINER, propriétaire
--   `postgres`) passait déjà, parce que `consent_history` appartient à `postgres` et que
--   FORCE ROW LEVEL SECURITY n'est PAS posé — le propriétaire contourne la RLS. Le
--   correctif aligne simplement tous les appelants sur ce comportement.

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 1. LA FONCTION — les branches UPDATE INCHANGÉES, trois branches INSERT ajoutées
-- ═════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ LES BRANCHES `UPDATE` SONT RECOPIÉES À L'IDENTIQUE. Elles sont déployées et n'ont
-- jamais eu l'occasion de mal se comporter : les toucher mêlerait un correctif à une
-- réécriture, et rendrait impossible de dire laquelle des deux a changé quelque chose.
--
-- ⚠️ BRANCHES SÉPARÉES PAR OPÉRATION, ET NON UNE CONDITION COMBINÉE. Écrire
-- `TG_OP = 'INSERT' OR OLD.x IS DISTINCT FROM NEW.x` ferait dépendre la correction d'une
-- évaluation en court-circuit que PL/pgSQL ne garantit pas : `OLD` n'est pas assigné dans
-- un trigger INSERT, et l'y référencer lève. La forme verbeuse est la forme sûre.
CREATE OR REPLACE FUNCTION public.track_consent_changes()
RETURNS trigger
LANGUAGE plpgsql
-- 🔴 AJOUTÉ PAR CE LOT — voir CAUSE 2 en tête de fichier.
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- ══ INSERT — LE CAS NOMINAL, CELUI QUI MANQUAIT ═══════════════════════════════════
  -- Mêmes gardes de non-nullité que les branches UPDATE : une version absente n'est pas
  -- un consentement. C'est ce qui fait qu'un profil créé sans consentement (le chemin
  -- `admin-create-member`, cf. l'inventaire en PR) ne produit AUCUNE ligne — plutôt
  -- qu'une ligne qui affirmerait une acceptation qui n'a pas eu lieu.
  IF (TG_OP = 'INSERT' AND NEW.privacy_policy_version IS NOT NULL) THEN
    INSERT INTO consent_history (user_id, consent_type, version, granted)
    VALUES (NEW.id, 'privacy_policy', NEW.privacy_policy_version, true);
  END IF;

  IF (TG_OP = 'INSERT' AND NEW.terms_version IS NOT NULL) THEN
    INSERT INTO consent_history (user_id, consent_type, version, granted)
    VALUES (NEW.id, 'terms', NEW.terms_version, true);
  END IF;

  -- ⚠️ `marketing` N'A PAS DE BRANCHE INSERT, ET C'EST DÉLIBÉRÉ.
  -- `profiles.marketing_consent` a pour DÉFAUT `false` : journaliser à la création
  -- écrirait une ligne « refus » pour CHAQUE compte, y compris ceux dont personne n'a
  -- jamais posé la question. Un refus par défaut n'est pas une décision de l'utilisateur,
  -- et un journal de consentement qui en est rempli perd sa valeur probante. Seul un
  -- CHANGEMENT de `marketing_consent` (branche UPDATE ci-dessous) est un acte.
  --
  -- ⚠️ Le cadrage ne demandait que `terms` et `privacy_policy` : cette note explique
  -- pourquoi le troisième n'a pas suivi, plutôt que de laisser croire à un oubli.

  -- ══ UPDATE — RECOPIÉ À L'IDENTIQUE DU DÉPLOYÉ ═════════════════════════════════════
  IF (TG_OP = 'UPDATE'
      AND OLD.privacy_policy_version IS DISTINCT FROM NEW.privacy_policy_version
      AND NEW.privacy_policy_version IS NOT NULL) THEN
    INSERT INTO consent_history (user_id, consent_type, version, granted)
    VALUES (NEW.id, 'privacy_policy', NEW.privacy_policy_version, true);
  END IF;

  -- GYM-197 — acceptation des CGU, sur le même modèle que privacy_policy.
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
  'GYM-199 (volet 1) — journalise dans consent_history les acceptations posées à la '
  'CRÉATION du profil (INSERT) autant qu''à sa modification (UPDATE). Le trigger ne '
  'mordait que sur UPDATE : le cas nominal de l''inscription n''était jamais journalisé. '
  'SECURITY DEFINER parce que consent_history n''expose aucune policy INSERT — un journal '
  'd''audit doit pouvoir écrire quel que soit l''appelant.';

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 2. LE TRIGGER — étendu à INSERT
-- ═════════════════════════════════════════════════════════════════════════════════════
-- La liste d'événements d'un trigger ne s'ALTER pas : il faut le reposer. Le DROP est
-- conditionnel pour que la migration soit rejouable.
DROP TRIGGER IF EXISTS trg_track_consent ON public.profiles;

CREATE TRIGGER trg_track_consent
  AFTER INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.track_consent_changes();

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 3. CE QUE CE LOT NE FAIT PAS
-- ═════════════════════════════════════════════════════════════════════════════════════
-- 🔴 AUCUNE REPRISE D'HISTORIQUE N'EST EXÉCUTÉE ICI, et ce n'est pas un oubli : c'est une
-- décision de cockpit. Journaliser après coup n'a pas la même valeur probante qu'un
-- journal tenu au moment de l'acte — la ligne dirait « consentement enregistré le
-- <date de l'acceptation> » alors qu'elle aurait été écrite des mois plus tard.
--
-- La proposition, prête à exécuter mais VOLONTAIREMENT COMMENTÉE, est en fin de PR avec
-- son périmètre exact : 49 profils sur 97 portent un `terms_version` ; les 48 autres n'ont
-- de consentement NULLE PART, et aucune reprise ne peut les inventer.
