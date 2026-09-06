-- ═══════════════════════════════════════════════════════════════════════════════════════
-- GYM-289 — my_gym_memberships() : les salles du membre APPELANT, avec leur identité.
-- ═══════════════════════════════════════════════════════════════════════════════════════
--
-- POURQUOI ELLE MANQUE AUJOURD'HUI. L'app ne peut pas NOMMER les salles d'un membre :
--   · member_gyms ne porte que (member_id, gym_id, joined_at) — ni nom, ni slug, ni logo ;
--   · la RLS de nexxia_gyms n'expose que la salle ACTIVE (« Members voient leur salle ») ;
--   · les trois fonctions publiques du lot 1 prennent un SLUG, pas un identifiant.
-- Une liste « mes salles » afficherait donc un nom et des UUID. Cette fonction comble
-- exactement ce trou, et rien de plus.
--
-- ⚠️ L'IDENTITÉ VIENT DE auth.uid(), JAMAIS D'UN PARAMÈTRE. C'est la règle de
-- switch_active_gym (GYM-283), et elle n'est pas décorative : une fonction SECURITY
-- DEFINER qui accepterait un member_id en argument permettrait à n'importe quel membre
-- connecté de lire les appartenances de n'importe quel autre. La fonction ne prend donc
-- AUCUN paramètre — il n'y a rien à falsifier.
--
-- ⚠️ LISTE DE COLONNES EXPLICITE, comme les fonctions publiques du lot 1. Pas de
-- `SELECT *` : une colonne ajoutée un jour à nexxia_gyms — un chiffre d'affaires, un plan,
-- une note interne — se retrouverait exposée sans que personne ne l'ait décidé. Rien de
-- commercial ne sort d'ici : identité visuelle et rien d'autre.

create or replace function public.my_gym_memberships()
returns table (
  gym_id     uuid,
  slug       text,
  name       text,
  logo_url   text,
  is_active  boolean,
  joined_at  timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    g.id,
    g.slug,
    g.name,
    g.logo_url,
    -- ⚠️ « Active » se lit dans profiles.gym_id, la colonne que switch_active_gym met à
    -- jour : c'est la MÊME source que celle qui décide des données affichées. La déduire
    -- autrement — la première ligne, la plus récente — ferait diverger la liste et
    -- l'écran, et le membre verrait une salle cochée dont il ne voit pas les données.
    (g.id = p.gym_id) as is_active,
    mg.joined_at
  from public.member_gyms mg
  join public.nexxia_gyms g on g.id = mg.gym_id
  join public.profiles p    on p.id = mg.member_id
  where mg.member_id = auth.uid()
    -- Une salle supprimée reste une appartenance en base ; elle n'a rien à faire dans une
    -- liste où l'on choisit. Même filtre que public_gym_branding.
    and g.deleted_at is null
  order by (g.id = p.gym_id) desc, g.name;
$$;

-- ⚠️ CE REVOKE NE SUFFIT PAS, ET LA SUITE LE CORRIGE (20260827140000).
-- `PUBLIC` est le pseudo-rôle « tout le monde » ; `anon` est un RÔLE RÉEL qui tient son
-- droit des privilèges par défaut du schéma `public` (ALTER DEFAULT PRIVILEGES … GRANT
-- EXECUTE ON FUNCTIONS TO anon, authenticated, service_role). Après application, mesuré :
-- has_function_privilege('anon', …) = TRUE. Sans conséquence ici — auth.uid() NULL rend un
-- ensemble vide — mais le fichier annonçait « authenticated seulement », ce qui était faux.
revoke execute on function public.my_gym_memberships() from public;
grant  execute on function public.my_gym_memberships() to authenticated;

comment on function public.my_gym_memberships() is
  'GYM-289 — appartenances du membre appelant (auth.uid()), avec identité visuelle de '
  'chaque salle et drapeau « salle active » lu dans profiles.gym_id. Requise par l''écran '
  '« changer de salle » (GYM-288 livrable 3). Aucun paramètre : rien à falsifier.';
