// GYM-147 — « Un abonnement ouvre-t-il encore des droits ? », côté dashboard.
//
// ⚠️ CE MODULE NE DÉFINIT PAS UNE NOUVELLE RÈGLE — il porte la MÊME que le serveur, à
// l'endroit où le dashboard peut la lire.
//
// La définition de référence vit dans supabase/functions/_shared/active-subscription.ts
// (GYM-191, GYM-195). Elle n'est PAS importable ici : ce module est chargé par Deno depuis
// les Edge Functions, et le tsconfig du dashboard borne sa compilation à `src`. Ouvrir cette
// frontière pour deux constantes coûterait plus cher qu'elle ne rapporterait.
//
// Ce qui est copié, ce sont les VALEURS ; ce qui compte, c'est qu'il n'y ait qu'UN endroit
// côté dashboard où elles vivent. GYM-191 a dû rattraper ce prédicat dans QUATRE Edge
// Functions parce qu'il y avait été recopié inline à chaque fois — la leçon n'est pas
// « ne jamais copier », c'est « ne jamais copier DEUX FOIS DU MÊME CÔTÉ ».
//
// ⚠️ SI LA RÈGLE CHANGE SERVEUR, ELLE CHANGE ICI. Les deux fichiers se citent mutuellement.

/**
 * Statuts qui ouvrent des droits.
 *
 * 'canceling' EN FAIT PARTIE (GYM-195) : résiliation demandée, mandat Mollie annulé, mais
 * accès maintenu jusqu'au terme (engagement ferme GYM-113). Le membre a payé — l'afficher
 * comme « sans formule » serait faux, et l'inviterait à racheter ce qu'il possède déjà.
 */
export const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'canceling'] as const

/**
 * Un abonnement ouvre-t-il encore des droits ?
 *
 * Le TERME compte autant que le STATUT (GYM-191) : un abonnement échu que le cron horaire
 * n'a pas encore basculé en 'expired' ne doit rien ouvrir. C'est la ceinture du dispositif,
 * le cron n'en étant que la bretelle.
 *
 * `endsAt` NULL = abonnement sans terme connu → considéré ouvrant, comme côté serveur
 * (`ends_at.is.null` fait partie du filtre `notExpiredFilter`).
 */
export function isSubscriptionActive(
  status: string | null | undefined,
  endsAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!status || !(ACTIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(status)) return false
  if (!endsAt) return true
  const end = new Date(endsAt).getTime()
  return !Number.isNaN(end) && end > now.getTime()
}

/**
 * Fenêtre de relance : un abonnement qui se termine dans les 7 jours.
 *
 * C'est le signal le plus actionnable de la liste — le seul moment où une relance change
 * encore quelque chose. Passé le terme, on ne relance plus : on reconquiert.
 */
export const EXPIRING_SOON_DAYS = 7

/** `true` si l'abonnement est encore ouvrant MAIS se termine sous EXPIRING_SOON_DAYS. */
export function isExpiringSoon(
  endsAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!endsAt) return false // sans terme connu, rien à relancer
  const end = new Date(endsAt).getTime()
  if (Number.isNaN(end)) return false
  const days = (end - now.getTime()) / 86_400_000
  return days >= 0 && days <= EXPIRING_SOON_DAYS
}

/**
 * GYM-147 — ce que le membre POSSÈDE. Réponse à « qu'a-t-il acheté ? ».
 *
 * ⚠️ Volontairement DISTINCT de son droit d'accès (suspension). Un membre suspendu a très
 * bien pu payer 90 €/mois : « suspendu » n'exclut pas « abonné ». Les mélanger obligerait à
 * choisir laquelle des deux informations afficher — et « il paie et il est suspendu 48 h »
 * n'appelle pas la même conversation que « il n'a plus rien ».
 */
export type MemberPlanKind = 'subscription' | 'subscription_credits' | 'credits' | 'none'

export interface MemberPlan {
  kind: MemberPlanKind
  /** Terme de l'abonnement (ISO), quand il y en a un. Le signal de relance. */
  endsAt: string | null
  /** Séances restantes. Renseigné pour 'credits' ; ignoré à l'affichage sur 'subscription_credits'
   *  (les crédits sont GELÉS pendant un abonnement, GYM-94 — annoncer un nombre qui ne bouge
   *  pas laisserait croire à une consommation). */
  credits: number
  /** L'abonnement se termine sous 7 jours. Faux dès qu'il n'y a pas d'abonnement ouvrant. */
  expiringSoon: boolean
  /**
   * GYM-147 (QA 15/08) — résiliation DEMANDÉE, accès maintenu jusqu'au terme (GYM-195).
   *
   * ⚠️ Ce n'est PAS une perte d'accès : le membre peut réserver, et la colonne Formule
   * affiche « Abonnement » à juste titre. Mais pour le gérant, un membre en résiliation
   * n'est pas un membre installé — c'est quelqu'un à rappeler AVANT l'échéance. Le drawer
   * le disait déjà (badge « Résiliation en cours ») ; la liste, non.
   *
   * Faux dès que l'abonnement n'ouvre plus de droits : une résiliation dont le terme est
   * passé n'est plus une résiliation en cours, c'est un départ consommé.
   */
  isCanceling: boolean
}

/**
 * Compose l'état « formule » d'un membre à partir de son abonnement le plus récent et de
 * son solde de crédits.
 *
 * ⚠️ LE SOLDE DE CRÉDITS N'EXCLUT PAS LES CRÉDITS EXPIRÉS, et c'est délibéré : le prédicat
 * serveur qui autorise une réservation ne les exclut pas non plus (booking-guards →
 * `.gt('credits_remaining', 0)`, sans filtre sur expires_at). Cette colonne doit dire ce que
 * le membre peut RÉELLEMENT faire, pas une vérité parallèle plus stricte que la porte.
 */
export function computeMemberPlan(
  subscription: { status: string | null; endsAt: string | null } | null,
  creditsRemaining: number,
  now: Date = new Date(),
): MemberPlan {
  const subActive = !!subscription && isSubscriptionActive(subscription.status, subscription.endsAt, now)
  const endsAt = subActive ? subscription!.endsAt : null
  const hasCredits = creditsRemaining > 0

  const kind: MemberPlanKind = subActive
    ? (hasCredits ? 'subscription_credits' : 'subscription')
    : (hasCredits ? 'credits' : 'none')

  return {
    kind,
    endsAt,
    credits: creditsRemaining,
    expiringSoon: subActive && isExpiringSoon(endsAt, now),
    // Adossé à `subActive`, donc au MÊME prédicat que tout le reste : aucun troisième
    // test de statut n'est introduit ici.
    isCanceling: subActive && subscription!.status === 'canceling',
  }
}
