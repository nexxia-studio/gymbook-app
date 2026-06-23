-- GYM-59 (partiel) : DDL rapatrié depuis prod (fcjupgvmjkqztxtwymdb) — lecture seule.
-- Tables payments, member_credits, mollie_customers + RLS, à l'identique de prod.
-- Périmètre strict : ces 3 tables uniquement.

-- ============================================================
-- payments
-- ============================================================
create table if not exists public.payments (
  id                uuid primary key default gen_random_uuid(),
  gym_id            uuid not null references public.nexxia_gyms(id) on delete cascade,
  member_id         uuid not null references public.profiles(id) on delete cascade,
  mollie_payment_id text,
  plan_id           text not null,
  plan_name         text not null,
  amount            numeric(10,2) not null,
  currency          text not null default 'EUR',
  status            text not null default 'pending',
  payment_method    text,
  checkout_url      text,
  credits_granted   integer default 0,
  nexxia_fee        numeric(10,2),
  paid_at           timestamptz,
  expires_at        timestamptz,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),
  invoice_number    text,
  constraint payments_status_check check (status = any (array['pending','paid','failed','expired','canceled'])),
  constraint payments_invoice_number_key unique (invoice_number),
  constraint payments_mollie_payment_id_key unique (mollie_payment_id)
);
create index if not exists idx_payments_gym    on public.payments using btree (gym_id, created_at);
create index if not exists idx_payments_member on public.payments using btree (member_id, status);
create index if not exists idx_payments_mollie on public.payments using btree (mollie_payment_id);

-- ============================================================
-- member_credits
-- ============================================================
create table if not exists public.member_credits (
  id                uuid primary key default gen_random_uuid(),
  gym_id            uuid not null references public.nexxia_gyms(id) on delete cascade,
  member_id         uuid not null references public.profiles(id) on delete cascade,
  plan_id           text,
  credits_total     integer not null default 0,
  credits_used      integer not null default 0,
  credits_remaining integer generated always as (credits_total - credits_used) stored,
  expires_at        timestamptz,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);
create index if not exists idx_member_credits_member on public.member_credits using btree (member_id);

-- ============================================================
-- mollie_customers
-- ============================================================
create table if not exists public.mollie_customers (
  id                 uuid primary key default gen_random_uuid(),
  gym_id             uuid not null references public.nexxia_gyms(id) on delete cascade,
  member_id          uuid not null references public.profiles(id) on delete cascade,
  mollie_customer_id text not null,
  has_valid_mandate  boolean default false,
  mollie_mandate_id  text,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now(),
  constraint mollie_customers_gym_id_member_id_key unique (gym_id, member_id)
);
create index if not exists idx_mollie_customers_member on public.mollie_customers using btree (member_id);

-- ============================================================
-- RLS (identique prod)
-- ============================================================
alter table public.payments         enable row level security;
alter table public.member_credits   enable row level security;
alter table public.mollie_customers enable row level security;

drop policy if exists "Gym admin gere les paiements" on public.payments;
create policy "Gym admin gere les paiements" on public.payments
  for all using ((gym_id = get_my_gym_id()) and is_gym_admin())
  with check ((gym_id = get_my_gym_id()) and is_gym_admin());

drop policy if exists "Membres voient leurs paiements" on public.payments;
create policy "Membres voient leurs paiements" on public.payments
  for select using (member_id = auth.uid());

drop policy if exists "Gym admin gere les credits" on public.member_credits;
create policy "Gym admin gere les credits" on public.member_credits
  for all using ((gym_id = get_my_gym_id()) and is_gym_admin())
  with check ((gym_id = get_my_gym_id()) and is_gym_admin());

drop policy if exists "Membres voient leurs credits" on public.member_credits;
create policy "Membres voient leurs credits" on public.member_credits
  for select using (member_id = auth.uid());

drop policy if exists "Admin voit les customers de sa gym" on public.mollie_customers;
create policy "Admin voit les customers de sa gym" on public.mollie_customers
  for all using ((gym_id = get_my_gym_id()) and is_gym_admin())
  with check ((gym_id = get_my_gym_id()) and is_gym_admin());

drop policy if exists "Membre voit son customer" on public.mollie_customers;
create policy "Membre voit son customer" on public.mollie_customers
  for select using (member_id = auth.uid());
