-- GYM-389 — politique de version minimale de l'app mobile (mise à jour obligatoire).
--
-- SQL appliqué tel quel en staging par le cockpit, qui l'appliquera en prod.
-- ⚠️ AUCUNE LIGNE N'EST INSÉRÉE ICI : les insertions (bundle, plateforme, min_version,
-- store_url) sont faites par le cockpit. Sans ligne, l'app ne bloque personne.

create table if not exists public.app_version_policy (
  bundle_id text not null, platform text not null check (platform in ('ios','android')),
  min_version text not null default '0.0.0' check (min_version ~ '^\d+\.\d+\.\d+$'),
  store_url text, updated_at timestamptz not null default now(), primary key (bundle_id, platform));
alter table public.app_version_policy enable row level security;
drop policy if exists "Lecture publique de la politique de version" on public.app_version_policy;
create policy "Lecture publique de la politique de version" on public.app_version_policy
  for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.app_version_policy from anon, authenticated;
grant select on public.app_version_policy to anon, authenticated;
