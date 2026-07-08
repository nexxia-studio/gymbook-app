// GYM-113 — Engagement ferme sur les abonnements : la durée souscrite est due.
// Helper PARTAGÉ (delete-account maintenant, cancel-subscription ensuite) — ne pas dupliquer.
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export interface ActiveEngagement {
  subscriptionId: string
  endsAt: string
}

// Renvoie l'abonnement qui ENGAGE encore le membre, sinon null.
// Règle : status IN ('active','canceling') ET ends_at > now().
//   - 'canceling' compte comme engagé : sous engagement ferme, une résiliation en cours ne libère
//     pas le membre avant ends_at (et GYM-113 a montré que 'canceling' peut être un état menteur).
//   - ends_at NULL → non engagé (NULL > now() est faux).
// Plusieurs lignes → on prend le ends_at le plus lointain. Lecture SEULE (client service_role).
export async function getActiveEngagement(
  admin: SupabaseClient,
  memberId: string,
  gymId: string,
): Promise<ActiveEngagement | null> {
  const nowIso = new Date().toISOString()
  const { data, error } = await admin
    .from('member_subscriptions')
    .select('id, ends_at')
    .eq('member_id', memberId)
    .eq('gym_id', gymId)
    .in('status', ['active', 'canceling'])
    .gt('ends_at', nowIso)
    .order('ends_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Fail-CLOSED : une erreur de requête ne doit PAS être interprétée comme « pas d'engagement »
  // (sinon un incident transitoire laisserait supprimer un compte engagé). On propage → l'appelant
  // (delete-account) tombe dans son catch → 500 AVANT toute écriture, donc aucune anonymisation.
  if (error) throw new Error(`getActiveEngagement query failed: ${error.message}`)
  if (!data || !data.ends_at) return null
  return { subscriptionId: data.id as string, endsAt: data.ends_at as string }
}
