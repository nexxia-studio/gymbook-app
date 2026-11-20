-- GYM-387 — le membre doit pouvoir ÉCRIRE son email de contact.
--
-- 🔴 À VALIDER PAR LE COCKPIT : ce fichier n'était pas dans la demande.
--
-- La policy « Modifier son propre profil » (id = auth.uid()) restreint la LIGNE. Les
-- COLONNES, elles, sont fixées par la liste blanche de GYM-203
-- (20260729100000_gym203_profiles_column_whitelist.sql) : UPDATE est révoqué au niveau
-- table pour `authenticated`, puis rendu colonne par colonne. `phone` y figure ;
-- `contact_email`, créée après, n'y figure pas. Sans ce GRANT, l'écriture depuis l'app
-- est refusée par Postgres (42501, permission denied) malgré la policy.
--
-- Séparé de la migration de la colonne pour que celle-ci reste, à l'octet, le SQL appliqué
-- en staging. Idempotent : un GRANT déjà posé est sans effet.

grant update (contact_email) on public.profiles to authenticated;
