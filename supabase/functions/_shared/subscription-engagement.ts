// GYM-113 — Engagement ferme sur les abonnements : la durée souscrite est due.
// Helper PARTAGÉ (delete-account + cancel-subscription) — une seule source de vérité pour la règle.
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export interface ActiveEngagement {
  subscriptionId: string
  endsAt: string
}

// Prédicat PUR — LA règle d'engagement (partagée serveur). Un abonnement engage encore le membre
// si son statut est 'active' ou 'canceling' ET que son terme (ends_at) est dans le futur.
//   - 'canceling' compte comme engagé : une résiliation en cours ne libère pas avant ends_at
//     (et GYM-113 a montré que 'canceling' peut être un état menteur — Mollie pas réellement annulé).
//   - ends_at NULL / passé → non engagé.
export function isEngaged(status: string, endsAt: string | null): boolean {
  return (status === 'active' || status === 'canceling')
    && !!endsAt
    && new Date(endsAt).getTime() > Date.now()
}

// Renvoie l'abonnement qui ENGAGE encore le membre (ends_at le plus lointain), sinon null.
// Réutilise isEngaged → aucune règle dupliquée. Lecture SEULE (client service_role).
// Fail-CLOSED : une erreur de requête est PROPAGÉE (l'appelant delete-account tombe dans son
// catch → 500 AVANT toute écriture) plutôt qu'interprétée comme « pas d'engagement ».
export async function getActiveEngagement(
  admin: SupabaseClient,
  memberId: string,
  gymId: string,
): Promise<ActiveEngagement | null> {
  const { data, error } = await admin
    .from('member_subscriptions')
    .select('id, status, ends_at')
    .eq('member_id', memberId)
    .eq('gym_id', gymId)
  if (error) throw new Error(`getActiveEngagement query failed: ${error.message}`)

  const engaged = (data ?? [])
    .filter((s) => isEngaged(s.status as string, (s.ends_at as string | null) ?? null))
    .sort((a, b) => new Date(b.ends_at as string).getTime() - new Date(a.ends_at as string).getTime())

  const top = engaged[0]
  return top ? { subscriptionId: top.id as string, endsAt: top.ends_at as string } : null
}
