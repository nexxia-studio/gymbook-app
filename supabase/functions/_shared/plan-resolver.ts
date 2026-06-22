import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export interface ResolvedPlan {
  plan_id: string
  gym_id: string
  name: string
  billing_type: string
  is_one_time: boolean
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
