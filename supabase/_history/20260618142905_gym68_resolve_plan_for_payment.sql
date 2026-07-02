-- ============================================================================
-- ARCHIVE GYM-59 — migration prod 20260618142905 : gym68_resolve_plan_for_payment
-- Historique Couche 2. NON rejouee (deja incluse dans la baseline).
-- ============================================================================
create or replace function public.resolve_plan_for_payment(p_gym_id uuid, p_plan_id uuid)
returns table (plan_id uuid, gym_id uuid, name text, billing_type text, is_one_time boolean,
               price_cents integer, currency text, credit_count integer, duration_months integer)
language sql stable security definer set search_path = public as $$
  select gp.id, gp.gym_id, gp.name, gp.billing_type, (gp.billing_type='one_time'),
         gp.price_cents, coalesce(gp.currency,'EUR'), gp.credit_count, gp.duration_months
  from public.gym_plans gp
  where gp.id=p_plan_id and gp.gym_id=p_gym_id and gp.active=true;
$$;
revoke all on function public.resolve_plan_for_payment(uuid,uuid) from public;
grant execute on function public.resolve_plan_for_payment(uuid,uuid) to service_role;
