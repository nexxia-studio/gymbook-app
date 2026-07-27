import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export interface ResolvedPlan {
  plan_id: string
  gym_id: string
  name: string
  /** Comment le membre paie : 'one_time' | 'recurring_fixed' | 'recurring_infinite'. */
  billing_type: string
  is_one_time: boolean
  /**
   * GYM-189 — CE QUE LE MEMBRE OBTIENT : 'credits' | 'unlimited'.
   * À ne pas confondre avec billing_type : un plan 'unlimited' peut être payé en une
   * fois. C'est ce champ, et non le mode de paiement, qui décide de la contrepartie
   * (crédit de séances vs ouverture d'abonnement).
   */
  plan_type: string
  price_cents: number
  currency: string
  credit_count: number | null
  duration_months: number | null
}

export async function resolvePlan(
  admin: SupabaseClient,
  gymId: string,
  planId: string,
): Promise<ResolvedPlan | null> {
  const { data, error } = await admin.rpc('resolve_plan_for_payment', {
    p_gym_id: gymId,
    p_plan_id: planId,
  })
  if (error) {
    console.error('[plan-resolver] rpc error:', error)
    return null
  }
  return (data?.[0] as ResolvedPlan | undefined) ?? null
}
