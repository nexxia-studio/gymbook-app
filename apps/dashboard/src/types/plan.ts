// GYM-56 — Formules (gym_plans). billing_type réel : 'one_time' | 'recurring_fixed'.
// La colonne `type` (NOT NULL, CHECK) est dérivée de billing_type côté hook :
//   one_time → 'credits' (credit_count requis) ; recurring_fixed → 'unlimited' (duration_months requis).
export type BillingType = 'one_time' | 'recurring_fixed'

export interface PlanItem {
  id: string
  name: string
  description: string
  billingType: BillingType
  creditCount: number | null
  durationMonths: number | null
  priceCents: number
  currency: string
  isPopular: boolean
  active: boolean
  sortOrder: number
}

export interface PlanFormData {
  name: string
  description: string
  billingType: BillingType
  creditCount: number | null
  durationMonths: number | null
  priceEuros: number // saisie en euros ; stockée en cents
  isPopular: boolean
  active: boolean
  sortOrder: number
}
