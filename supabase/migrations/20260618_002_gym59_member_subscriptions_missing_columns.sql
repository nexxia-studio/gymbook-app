-- GYM-59 (partiel) : colonnes member_subscriptions manquantes sur staging,
-- rapatriées depuis prod (fcjupgvmjkqztxtwymdb, lecture seule). Additif uniquement.
alter table public.member_subscriptions
  add column if not exists plan_name      text,
  add column if not exists amount         numeric(10,2),
  add column if not exists max_payments   integer,
  add column if not exists payments_count integer default 0,
  add column if not exists next_payment_at timestamptz;
