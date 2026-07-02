-- ============================================================================
-- ARCHIVE GYM-59 — migration prod 20260618142856 : gym79_commission_override_columns
-- Historique Couche 2. NON rejouee (deja incluse dans la baseline).
-- ============================================================================
alter table public.nexxia_gyms
  add column if not exists commission_cb_rate_override   numeric(6,4) default null,
  add column if not exists commission_sepa_rate_override numeric(6,4) default null;

update public.nexxia_gyms
  set commission_cb_rate_override = 0.0000, commission_sepa_rate_override = 0.0000
  where id='a0000000-0000-0000-0000-000000000001';
