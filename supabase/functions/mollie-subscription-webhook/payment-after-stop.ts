// ╔═══════════════════════════════════════════════════════════════════════════════════════╗
// ║  🔴 GYM-190 — UN PRÉLÈVEMENT PAYÉ NE RELÈVE PLUS UN ABONNEMENT ARRÊTÉ.                ║
// ╚═══════════════════════════════════════════════════════════════════════════════════════╝
//
// CE QUI SE PASSAIT : la branche « renouvellement payé » de `index.ts` relisait la ligne par
// `mollie_subscription_id` SANS regarder son statut, puis écrivait `status: 'active'`. Un
// prélèvement arrivé après un arrêt (paiement déjà créé chez Mollie au moment du DELETE,
// annulation Mollie qui n'a pas pris) rouvrait donc l'abonnement sans bruit : le membre
// était débité, et la salle croyait l'avoir arrêté.
//
// CE QUE CE MODULE DÉCIDE, ET RIEN D'AUTRE : pour le statut lu en base, le paiement est-il
// un renouvellement normal, ou un paiement reçu sur un abonnement arrêté ? Dans le second
// cas, `index.ts` compte l'échéance (l'argent est bien entré), ne touche à rien d'autre et
// lève une alerte : c'est à un humain de décider d'un remboursement.
//
// ⚠️ ELLE VIT ICI POUR ÊTRE ÉPROUVÉE, comme `renewal-date.ts` : `index.ts` appelle
// `Deno.serve()` au chargement. Voir `payment-after-stop_test.ts`.

/**
 * Statuts sur lesquels un prélèvement payé est une ANOMALIE.
 *
 * - `canceling` : résiliation ou arrêt demandé, l'abonnement Mollie est censé être annulé.
 * - `paused`    : gelé, aucun prélèvement ne doit partir pendant le gel.
 * - `cancelled`, `expired` : états terminaux.
 *
 * ⚠️ `past_due` ET `suspended` N'Y FIGURENT PAS, et c'est voulu : un prélèvement qui aboutit
 * sur un impayé est la RÉACTIVATION AUTOMATIQUE de GYM-252. Les ranger ici laisserait un
 * membre qui vient de régulariser sans accès.
 */
export const STOPPED_SUBSCRIPTION_STATUSES: readonly string[] = ['canceling', 'paused', 'cancelled', 'expired']

export type RenewalDecision = 'renew' | 'payment_after_stop'

/**
 * `'payment_after_stop'` pour un abonnement arrêté, `'renew'` pour tout le reste.
 *
 * ⚠️ LE REPLI EST `'renew'`, DONC LE COMPORTEMENT D'AVANT CE LOT. Un statut absent ou
 * inconnu ne change pas de chemin : avant GYM-190, le statut n'était pas lu du tout.
 */
export function renewalDecision(status: string | null | undefined): RenewalDecision {
  return status != null && STOPPED_SUBSCRIPTION_STATUSES.includes(status) ? 'payment_after_stop' : 'renew'
}
