-- GYM-387 — email de contact du membre.
--
-- `profiles.email` reste l'email de CONNEXION (souvent une adresse relais
-- @privaterelay.appleid.com avec « Se connecter avec Apple ») : il n'est PAS modifié ici,
-- la connexion Apple en dépend. `contact_email` est l'adresse réelle que le membre
-- choisit de donner, facultative (règle Apple 4.8 : ne jamais l'exiger).
--
-- Déjà appliquée en STAGING ; ce fichier la consigne pour la prod. Idempotente.

alter table public.profiles add column if not exists contact_email text;
alter table public.profiles drop constraint if exists profiles_contact_email_format;
alter table public.profiles add constraint profiles_contact_email_format
  check (contact_email is null or contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');
comment on column public.profiles.contact_email is 'GYM-387 — email de contact réel donné par le membre (facultatif). profiles.email reste l''email de connexion.';
