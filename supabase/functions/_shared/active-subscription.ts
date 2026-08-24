// GYM-191 — LA définition d'un abonnement qui ouvre encore des droits, côté Edge.
//
// Un abonnement valide, c'est un statut ouvrant ET un terme non dépassé. Historiquement
// seul le statut était testé, et RIEN ne posait 'expired' : un abonnement payé en une
// fois (GYM-189) n'a aucun webhook Mollie futur, il serait donc resté 'active' à vie.
//
// Le cron horaire expire_subscriptions() est la bretelle ; ce filtre est la CEINTURE :
// même cron en retard ou désactivé, un abonnement échu n'ouvre aucun droit.
//
// Centralisé ici parce que le prédicat était dupliqué dans quatre Edge Functions —
// c'est exactement ce qui a permis à la condition de date de manquer partout.
//
// ═════════════════════════════════════════════════════════════════════════════════════
// 🔴 GYM-252 — DEUX QUESTIONS, DEUX PRÉDICATS. NE JAMAIS LES CONFONDRE.
// ═════════════════════════════════════════════════════════════════════════════════════
// Ce module portait UNE liste, `ACTIVE_SUBSCRIPTION_STATUSES`, employée indifféremment
// pour deux questions qui ne se ressemblent qu'en surface :
//
//   (a) « ce membre a-t-il des DROITS D'ACCÈS ? »        → décide un débit de crédit
//   (b) « ce membre a-t-il un abonnement qui BLOQUE       → décide un refus 409 à l'achat
//        l'ouverture d'un NOUVEL abonnement ? » (GYM-94)
//
// Elles divergent sur EXACTEMENT UN statut, et c'est celui qui coûte de l'argent :
//
//   `suspended` (impayé) → PAS de droits d'accès, MAIS BLOQUE l'achat.
//
// Sans cette distinction, un membre suspendu pour impayé contourne sa suspension en
// souscrivant un second abonnement « à côté » ; puis Mollie régularise le premier (il
// retente jusqu'à 5 fois) et le membre se retrouve avec DEUX abonnements actifs, deux
// mandats SEPA et deux prélèvements mensuels. C'est le risque financier de tout le lot.
//
// `past_due` bloque AUSSI l'achat, pour la même raison : le premier abonnement est
// toujours vivant chez Mollie, qui est précisément en train de le représenter.
//
// ⚠️ UN BOOLÉEN NOMMÉ « actif » NE PEUT PAS SERVIR LES DEUX. C'est pourquoi il n'existe
// plus : `hasAccessRights` (booking-guards) répond à (a),
// `findPurchaseBlockingSubscription` ci-dessous répond à (b), et leurs noms disent
// laquelle. Un appelant qui se trompe de fonction se voit désormais en revue.
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * (a) STATUTS QUI OUVRENT DES DROITS D'ACCÈS.
 *
 * 'canceling' EN FAIT PARTIE (GYM-195) : « résiliation demandée, mandat Mollie annulé,
 * mais accès maintenu jusqu'au terme » (engagement ferme GYM-113). Le membre a payé —
 * le traiter comme non-abonné lui débiterait un crédit auquel il n'a pas à toucher.
 *
 * 'past_due' EN FAIT PARTIE (GYM-252) : le prélèvement a échoué, mais la politique
 * maintient VOLONTAIREMENT l'accès pendant les 3 jours de grâce. L'omettre ici couperait
 * l'accès dès J0 — l'inverse exact de la politique, et de façon quasi invisible : le
 * membre verrait simplement ses crédits prépayés fondre sans comprendre pourquoi.
 *
 * ⚠️ 'suspended' N'EN FAIT PAS PARTIE, et c'est tout le mécanisme de coupure : la
 * suspension n'est pas un drapeau qu'il faudrait penser à lire quelque part, c'est la
 * SORTIE de cette liste. Même chemin que l'expiration.
 *
 * Aligné sur _shared/subscription-engagement.ts, sur les prédicats SQL
 * (promote_waitlist_atomic, get_communication_recipients) et sur
 * apps/dashboard/src/lib/subscription.ts. ⚠️ Si la règle change, elle change PARTOUT —
 * ces endroits se citent mutuellement.
 */
export const ACCESS_SUBSCRIPTION_STATUSES = ['active', 'canceling', 'past_due']

/**
 * (b) GYM-94 / GYM-252 — STATUTS QUI BLOQUENT L'OUVERTURE D'UN NOUVEL ABONNEMENT.
 *
 * = les statuts ouvrants, PLUS 'suspended'. Un abonnement suspendu pour impayé n'ouvre
 * plus rien, mais il EXISTE toujours chez Mollie, qui le représente. Autoriser un second
 * abonnement pendant ce temps, c'est fabriquer le double débit.
 *
 * ⚠️ 'canceling' Y FIGURE, ce qui ALIGNE create-payment et create-subscription sur
 * _shared/counter-sale.ts. Les deux premiers testaient encore `status = 'active'` seul, et
 * counter-sale documentait déjà l'écart comme « à arbitrer » : il est tranché ici, dans le
 * sens sûr. Un membre en résiliation garde son accès jusqu'au terme — lui ouvrir un second
 * abonnement le ferait payer deux fois la même période. Conséquence à connaître : il doit
 * attendre son terme pour se réabonner (`notExpiredFilter` libère la ligne au terme).
 */
export const PURCHASE_BLOCKING_STATUSES = ['active', 'canceling', 'past_due', 'suspended']

/**
 * Argument `.or()` de PostgREST exprimant « terme non dépassé » :
 * ends_at IS NULL (abonnement sans terme connu) OU ends_at > maintenant.
 *
 * S'utilise en complément du filtre de statut — le prédicat complet est donc :
 *   .in('status', ACCESS_SUBSCRIPTION_STATUSES).or(notExpiredFilter())
 */
export function notExpiredFilter(now: Date = new Date()): string {
  return `ends_at.is.null,ends_at.gt.${now.toISOString()}`
}

/** Abonnement qui empêche l'ouverture d'un nouveau. Le STATUT décide du message. */
export interface PurchaseBlockingSubscription {
  id: string
  status: string
}

/**
 * (b) — Trouve l'abonnement qui doit faire refuser l'achat d'un abonnement, ou `null`.
 *
 * Rend la LIGNE et non un booléen, délibérément : l'appelant doit pouvoir distinguer
 * « tu es déjà abonné » de « régularise d'abord ton impayé ». Les deux refus appellent des
 * gestes opposés côté membre ; un booléen les rendrait indistinguables et ramènerait
 * l'ambiguïté que ce module vient de supprimer.
 *
 * ⚠️ `notExpiredFilter()` est conservé : un abonnement ÉCHU ne bloque rien, suspendu
 * compris. Refuser un réabonnement à quelqu'un dont l'abonnement impayé est arrivé à son
 * terme reviendrait à lui interdire de revenir — c'est la leçon de GYM-191, qui a dû
 * corriger exactement ce blocage pour les abonnements expirés.
 */
export async function findPurchaseBlockingSubscription(
  admin: SupabaseClient,
  memberId: string,
  gymId: string,
): Promise<PurchaseBlockingSubscription | null> {
  const { data } = await admin
    .from('member_subscriptions')
    .select('id, status')
    .eq('member_id', memberId)
    .eq('gym_id', gymId)
    .in('status', PURCHASE_BLOCKING_STATUSES)
    .or(notExpiredFilter())
    .limit(1)
    .maybeSingle()

  if (!data) return null
  return { id: data.id as string, status: data.status as string }
}

/** L'achat est-il bloqué par un IMPAYÉ, plutôt que par un abonnement sain ? */
export function isPaymentIssue(status: string): boolean {
  return status === 'past_due' || status === 'suspended'
}

/**
 * GYM-252 — le refus opposé à un achat d'abonnement empêché par un impayé.
 *
 * Code et message centralisés : trois appelants (create-subscription, create-payment,
 * counter-sale) doivent dire la MÊME chose, sans quoi le membre lirait trois explications
 * différentes du même refus selon l'écran par lequel il passe.
 */
export const SUBSCRIPTION_PAST_DUE_CODE = 'SUBSCRIPTION_PAST_DUE'
export const SUBSCRIPTION_PAST_DUE_MESSAGE =
  "Régularise ton abonnement en cours avant d'en souscrire un nouveau"
