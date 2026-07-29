-- GYM-203 (volet c) — gym_id IMMUABLE UNE FOIS POSÉ.
--
-- ── Pourquoi un trigger et pas un simple REVOKE ──────────────────────────────
-- gym_id est le pivot du cloisonnement multi-tenant : le réécrire, c'est se rattacher à une
-- AUTRE salle et voir ses membres. Il figure pourtant dans la liste blanche du GRANT UPDATE
-- (migration 20260729100000) et ce n'est PAS un oubli :
--
--   apps/mobile/lib/ensureProfile.ts → healProfile() ÉCRIT gym_id quand il est NULL.
--   C'est le correctif GYM-154 de l'inscription OAuth : le flux id_token Apple/Google crée
--   l'utilisateur SANS user_metadata, handle_new_user() pose donc gym_id à NULL, et l'app
--   s'ouvre ENTIÈREMENT VIDE (RLS ne matche rien). Révoquer gym_id casserait ce parcours.
--
-- D'où le partage des rôles : le GRANT autorise la COLONNE, ce trigger autorise la seule
-- TRANSITION légitime — NULL → valeur. Toute réécriture d'une valeur déjà posée est refusée.
--
-- ⚠️ NE PAS retirer gym_id de la liste blanche « par prudence » : la garde est ici.
--
-- ── Cohabitation avec les triggers existants ─────────────────────────────────
-- profiles porte déjà :
--   trg_profiles_updated  BEFORE UPDATE  → update_timestamp()      (pose NEW.updated_at)
--   trg_track_consent     AFTER  UPDATE  → track_consent_changes() (journal consent_history)
--
-- Les triggers de même moment s'exécutent dans l'ORDRE ALPHABÉTIQUE de leur nom.
-- « trg_gym_id_immutable » précède « trg_profiles_updated » : la garde tranche donc AVANT
-- que quoi que ce soit d'autre ne travaille, et l'AFTER de journalisation n'est jamais
-- atteint sur un refus (la transaction est annulée). Aucun des deux n'est perturbé :
-- celui-ci ne modifie pas NEW et se contente de laisser passer ou de lever.
--
-- À appliquer sur STAGING puis PROD.

CREATE OR REPLACE FUNCTION public.enforce_gym_id_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  -- service_role : les Edge Functions (admin-create-member, delete-account, …) et le
  -- back-office rattachent, transfèrent et anonymisent légitimement. On ne contraint rien.
  -- Les rôles d'administration sont inclus pour que les migrations de données à venir ne
  -- se heurtent pas à cette garde.
  IF current_user IN ('service_role', 'postgres', 'supabase_admin')
     OR auth.role() = 'service_role'
  THEN
    RETURN NEW;
  END IF;

  -- Pose initiale (NULL → valeur) : c'est exactement le heal GYM-154 → AUTORISÉE.
  -- Réécriture d'une valeur identique : IS DISTINCT FROM est faux → rien ne se déclenche
  -- (le trigger n'est de toute façon pas appelé, cf. la clause WHEN ci-dessous).
  IF OLD.gym_id IS NOT NULL AND NEW.gym_id IS DISTINCT FROM OLD.gym_id THEN
    RAISE EXCEPTION
      'GYM_ID_IMMUTABLE: le rattachement à une salle ne peut pas être modifié depuis le client (profil %)',
      OLD.id
      -- 42501 insufficient_privilege → PostgREST répond 403, pas 500.
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_gym_id_immutable() IS
  'GYM-203 — gym_id reste écrivable par l''utilisateur (heal GYM-154 de l''inscription '
  'OAuth) mais UNIQUEMENT tant qu''il est NULL. Toute réécriture ultérieure depuis un '
  'jeton utilisateur est refusée : ce serait un rattachement à une autre salle.';

DROP TRIGGER IF EXISTS trg_gym_id_immutable ON public.profiles;
CREATE TRIGGER trg_gym_id_immutable
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  -- Filtre en amont : la fonction n'est appelée que si gym_id change RÉELLEMENT. Une
  -- réécriture à valeur identique, ou toute écriture ne touchant pas gym_id, ne coûte rien.
  WHEN (OLD.gym_id IS DISTINCT FROM NEW.gym_id)
  EXECUTE FUNCTION public.enforce_gym_id_immutable();
