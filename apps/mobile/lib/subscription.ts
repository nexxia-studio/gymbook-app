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

// GYM-191 — LE STATUT NE SUFFIT PAS : il faut aussi que le terme ne soit pas dépassé.
// Le backend expire les abonnements échus par un cron HORAIRE ; entre l'échéance réelle
// et le passage du cron (≤ 1 h), la ligne porte encore status='active'. Sans condition de
// date, l'app afficherait « actif » un abonnement que le serveur refuse déjà.
// Prédicat aligné sur le serveur (_shared/active-subscription.ts, promote_waitlist_atomic) :
//     statut actif ET (ends_at absent OU ends_at > maintenant)

/**
 * Statuts donnant accès. À n'utiliser que comme PRÉ-FILTRE de requête (`.in('status', …)`) :
 * il ne dit rien du terme. L'autorité côté app est isSubscriptionActive(), à appliquer sur
 * la ligne obtenue — et donc à charger `ends_at` avec.
 */
export const ACTIVE_SUBSCRIPTION_STATUSES: string[] = ['active', 'canceling']

/**
 * Statuts pertinents à charger pour l'écran abonnement (accès OU affichage « Terminé »).
 * Même réserve que ci-dessus : pré-filtre de requête, pas un verdict.
 */
export const DISPLAYABLE_SUBSCRIPTION_STATUSES: string[] = ['active', 'canceling', 'completed']

/**
 * True uniquement pour un abonnement donnant RÉELLEMENT accès : statut actif
 * (active/canceling) ET terme non dépassé.
 *
 * `endsAt` est un paramètre REQUIS à dessein : le rendre optionnel laisserait un appelant
 * retomber silencieusement sur l'ancien comportement (statut seul), qui est le bug que
 * GYM-191 corrige. Le compilateur oblige donc chaque site à fournir la date.
 * `endsAt` null/undefined = abonnement sans terme connu → considéré actif.
 */
export function isSubscriptionActive(
  status: string | null | undefined,
  endsAt: string | null | undefined,
): boolean {
  const statusOk = status === 'active' || status === 'canceling'
  if (!statusOk) return false
  if (!endsAt) return true
  return new Date(endsAt).getTime() > Date.now()
}

/** Engagement arrivé à son terme (état neutre/positif, distinct de cancelled/expired). */
export function isSubscriptionCompleted(status: string | null | undefined): boolean {
  return status === 'completed'
}
