// GYM-151 — Statuts d'abonnement (helper central, source unique de vérité côté app).
//
// CHECK DB member_subscriptions (volet 1) :
//   'active' | 'suspended' | 'expired' | 'cancelled' | 'paused' | 'completed'
// + 'canceling' : valeur portée en base par le flux Mollie de résiliation programmée
//   (abonnement encore en cours jusqu'au terme) — l'app l'a TOUJOURS traitée comme active.
//
// COMPORTEMENT EXISTANT CONSTATÉ (repris tel quel, rien inventé) : l'app ne considère
// « actif / donnant accès » QUE 'active' et 'canceling'. Les autres statuts
// (suspended / expired / cancelled / paused / completed) ne sont pas traités comme actifs
// (ils n'étaient d'ailleurs jamais chargés : requêtes filtrées sur ['active','canceling']).
//
// 'completed' (GYM-151) = engagement arrivé à son terme : INACTIF partout — n'ouvre aucun
// droit de réservation et ne bloque AUCUN achat (un membre au terme doit pouvoir se
// réabonner / racheter une carte immédiatement, contrairement à un abonnement actif qui
// bloque en 409, GYM-94). C'est un état neutre/positif, distinct de cancelled/expired.

/** Statuts qui donnent accès (et bloquent l'achat d'un 2e abonnement — GYM-94). */
export const ACTIVE_SUBSCRIPTION_STATUSES: string[] = ['active', 'canceling']

/** Statuts pertinents à charger pour l'écran abonnement (accès OU affichage « Terminé »). */
export const DISPLAYABLE_SUBSCRIPTION_STATUSES: string[] = ['active', 'canceling', 'completed']

/** True uniquement pour un abonnement donnant accès (comportement existant : active/canceling). */
export function isSubscriptionActive(status: string | null | undefined): boolean {
  return status === 'active' || status === 'canceling'
}

/** Engagement arrivé à son terme (état neutre/positif, distinct de cancelled/expired). */
export function isSubscriptionCompleted(status: string | null | undefined): boolean {
  return status === 'completed'
}
