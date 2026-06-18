// GYM-79 — Commission effective Nexxia : override par gym (nexxia_gyms) sinon rate du plan.
// L'override est une valeur EXPLICITE : 0 est un override valide (0 l'emporte sur le rate du plan).
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export interface EffectiveCommission {
  cbRate: number
  sepaRate: number
}

export async function getEffectiveCommission(
  admin: SupabaseClient,
  gymId: string,
): Promise<EffectiveCommission> {
  const { data: gym } = await admin
    .from('nexxia_gyms')
    .select('plan, commission_cb_rate_override, commission_sepa_rate_override')
    .eq('id', gymId)
    .single()

  let planCb = 0
  let planSepa = 0
  if (gym?.plan) {
    const { data: limits } = await admin
      .from('nexxia_plan_limits')
      .select('commission_cb_rate, commission_sepa_rate')
      .eq('plan', gym.plan)
      .single()
    planCb = Number(limits?.commission_cb_rate ?? 0)
    planSepa = Number(limits?.commission_sepa_rate ?? 0)
  }

  const cbOverride = gym?.commission_cb_rate_override
  const sepaOverride = gym?.commission_sepa_rate_override

  return {
    // override ?? planRate — null = pas d'override ; 0 = override explicite à 0
    cbRate: cbOverride != null ? Number(cbOverride) : planCb,
    sepaRate: sepaOverride != null ? Number(sepaOverride) : planSepa,
  }
}
