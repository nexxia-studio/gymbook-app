// GYM-56 / GYM-188 — Formules (gym_plans).
//
// DEUX AXES INDÉPENDANTS, à ne jamais déduire l'un de l'autre :
//   - `type` (PlanType)        : ce que le membre obtient — N séances, ou un accès illimité
//                                pendant N mois.
//   - `billing_type`           : comment il le paie — en une fois, ou par prélèvement mensuel.
//
// GYM-188 : `type` était DÉRIVÉ de billing_type côté hook (one_time ⇒ credits,
// recurring ⇒ unlimited), ce qui réduisait à 2 les 4 combinaisons permises par le schéma
// et rendait impossible l'« Illimité 12 mois payé en une fois ». Les deux axes sont
// désormais saisis séparément.
//
// Contraintes réelles de gym_plans (vérifiées en base) :
//   type IN ('unlimited','credits') ; billing_type IN ('one_time','recurring_fixed','recurring_infinite')
//   CHECK (type='unlimited' AND duration_months IS NOT NULL)
//      OR (type='credits'   AND credit_count   IS NOT NULL)
//   credit_count > 0 si non NULL ; duration_months > 0 si non NULL
export type BillingType = 'one_time' | 'recurring_fixed'

export type PlanType = 'credits' | 'unlimited'

export interface PlanItem {
  id: string
  name: string
  description: string
  planType: PlanType
  billingType: BillingType
  creditCount: number | null
  durationMonths: number | null
  priceCents: number
  currency: string
  isPopular: boolean
  /**
   * GYM-193 — limite l'achat à un par membre en libre-service (offre de découverte).
   * Attribut du plan, jamais son nom : aucun code ne doit reconnaître une offre à son
   * libellé, chaque salle nomme la sienne comme elle veut.
   */
  oncePerMember: boolean
  active: boolean
  sortOrder: number
}

export interface PlanFormData {
  name: string
  description: string
  planType: PlanType
  billingType: BillingType
  // NULL = « non renseigné / sans objet pour ce type ». Jamais de valeur de repli
  // silencieuse : c'est ce qui transformait un abonnement en carte de 10 séances (GYM-188).
  creditCount: number | null
  durationMonths: number | null
  priceEuros: number // saisie en euros ; stockée en cents
  isPopular: boolean
  oncePerMember: boolean
  active: boolean
  sortOrder: number
}
