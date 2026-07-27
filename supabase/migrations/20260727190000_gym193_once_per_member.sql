-- GYM-193 : une formule peut être limitée à un achat par membre.
--
-- BESOIN : une offre de découverte (chez Dopamine, une séance d'essai à 15 € contre 20 €
-- la séance à l'unité) n'a de sens qu'une fois. Sans limite, n'importe qui achète
-- indéfiniment la séance au tarif découverte.
--
-- ─── PRINCIPE : LA LIMITE EST UN ATTRIBUT DU PLAN, PAS UN NOM ────────────────
-- Chaque salle aura son offre de découverte sous son propre libellé. Aucun code ne doit
-- donc reconnaître un plan à son nom : la limite est portée par cette colonne, que
-- n'importe quel gérant active depuis /plans. Aucune donnée en dur ici, aucun UUID —
-- l'activation sur le plan de Dopamine se fera par la case à cocher de /plans.
--
-- ─── Constats base live (Règle Zéro) ─────────────────────────────────────────
--   - gym_plans n'a aucune notion de quota par membre : la colonne est bien nouvelle.
--   - payments.plan_id est un TEXT (pas une FK) pouvant contenir des codes legacy :
--     les rapprochements se font en TEXTE, jamais par cast text→uuid.
--   - payments.status ∈ pending | paid | failed | expired | canceled | refunded
--     | partially_refunded | charged_back. Seuls 'paid', 'partially_refunded' et
--     'refunded' consomment le droit (encaissement réellement survenu) — voir la
--     garde serveur dans create-payment.

ALTER TABLE public.gym_plans
  ADD COLUMN IF NOT EXISTS once_per_member boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.gym_plans.once_per_member IS
  'GYM-193 — limite l''achat de ce plan à un par membre, en libre-service (app). '
  'Typiquement une offre de découverte à tarif réduit. La garde qui fait foi est côté '
  'serveur (create-payment, 409 PLAN_ALREADY_USED) ; l''app se contente de masquer le plan '
  'déjà consommé. Le gérant peut déroger au comptoir : la vente via admin-create-member '
  'n''applique PAS cette limite (geste commercial, cas particulier).';
