// GYM-191 — LA définition d'un abonnement qui ouvre encore des droits, côté Edge.
//
// Un abonnement valide, c'est status='active' ET un terme non dépassé. Historiquement
// seul le statut était testé, et RIEN ne posait 'expired' : un abonnement payé en une
// fois (GYM-189) n'a aucun webhook Mollie futur, il serait donc resté 'active' à vie.
//
// Le cron horaire expire_subscriptions() est la bretelle ; ce filtre est la CEINTURE :
// même cron en retard ou désactivé, un abonnement échu n'ouvre aucun droit.
//
// Centralisé ici parce que le prédicat était dupliqué dans quatre Edge Functions —
// c'est exactement ce qui a permis à la condition de date de manquer partout.

/**
 * GYM-195 — Statuts qui ouvrent des droits.
 *
 * 'canceling' EN FAIT PARTIE : il signifie « résiliation demandée, mandat Mollie annulé,
 * mais accès maintenu jusqu'au terme » (engagement ferme GYM-113). Le membre a payé et
 * reste engagé — le traiter comme non-abonné lui débiterait un crédit auquel il n'a pas
 * à toucher, ou lui refuserait un accès déjà réglé.
 *
 * Aligné sur _shared/subscription-engagement.ts (isEngaged) et sur lib/subscription.ts
 * côté mobile, qui retenaient déjà ces deux statuts.
 */
export const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'canceling']

/**
 * Argument `.or()` de PostgREST exprimant « terme non dépassé » :
 * ends_at IS NULL (abonnement sans terme connu) OU ends_at > maintenant.
 *
 * S'utilise en complément du filtre de statut — le prédicat complet est donc :
 *   .in('status', ACTIVE_SUBSCRIPTION_STATUSES).or(notExpiredFilter())
 */
export function notExpiredFilter(now: Date = new Date()): string {
  return `ends_at.is.null,ends_at.gt.${now.toISOString()}`
}
