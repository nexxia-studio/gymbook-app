// GYM-190 — arrêt d'un abonnement par le gérant : la logique PURE de la fiche membre.
//
// Tout ce qui se décide sans React ni réseau vit ici, pour être testé sans navigateur
// (src/tests/stop-subscription.test.ts). L'autorité reste l'Edge Function
// `admin-stop-subscription` : ce module ne fait que montrer ou cacher un bouton, lire
// une réponse et formater une date. Un bouton visible à tort se solde par un refus du
// serveur affiché en clair, jamais par un arrêt indu.

/** Longueur maximale du motif, la même que côté serveur (REASON_TOO_LONG au-delà). */
export const STOP_REASON_MAX_LENGTH = 500

/**
 * Codes de refus de `admin-stop-subscription`, relevés dans son contrat. Chacun a une
 * entrée `edge_errors.<CODE>` en fr et en en, et figure dans KNOWN_EDGE_ERROR_CODES
 * (lib/edgeErrors.ts), la table unique des refus serveur. Un code absent de cette table
 * retombe sur `edge_errors.FALLBACK`.
 */
export const STOP_ERROR_CODES = [
  'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND',
  'MISSING_SUBSCRIPTION_ID', 'REASON_REQUIRED', 'REASON_TOO_LONG',
  'NOT_STOPPABLE', 'NOT_RECURRING', 'END_DATE_UNKNOWN', 'PAYMENT_IN_FLIGHT',
  'MOLLIE_NOT_CONNECTED', 'MOLLIE_READ_FAILED', 'MOLLIE_STOP_FAILED',
  'STOP_NOT_PERSISTED', 'SERVER_ERROR',
] as const

/**
 * Le bouton « Arrêter l'abonnement » se montre-t-il, la modale s'ouvre-t-elle, l'arrêt
 * part-il ? Un seul prédicat pour les trois.
 *
 * Seulement pour un abonnement `active` ET récurrent (identifiant d'abonnement Mollie).
 * Un abonnement payé en une fois n'a rien à arrêter chez Mollie : le serveur le refuse
 * (NOT_RECURRING), inutile de proposer le geste.
 *
 * ET seulement si l'abonnement est celui du membre DONT LA FICHE EST À L'ÉCRAN. La fiche
 * charge ses données de façon asynchrone : sans ce test, l'abonnement du membre précédent
 * resté en mémoire offrirait son bouton d'arrêt sur la fiche du suivant, et l'arrêt
 * partirait sur le mauvais membre. Un identifiant absent d'un côté ou de l'autre vaut refus.
 */
export function canStopSubscription(
  subscription: { status: string; mollieSubscriptionId: string | null; memberId: string | null } | null | undefined,
  shownMemberId: string | null | undefined,
): boolean {
  if (!subscription?.memberId || subscription.memberId !== shownMemberId) return false
  return subscription.status === 'active' && !!subscription.mollieSubscriptionId?.trim()
}

/**
 * Sous-titre de la modale de confirmation : « Nom · Formule », ou le nom seul quand la
 * formule est inconnue. Jamais de tiret de remplacement : ce texte est lu par le gérant.
 */
export function stopModalSubtitle(memberName: string, planName: string | null | undefined): string {
  return [memberName, planName?.trim()].filter(Boolean).join(' · ')
}

/** Motif recevable : non vide une fois rogné (le serveur rogne aussi), 500 caractères au plus. */
export function isStopReasonValid(reason: string): boolean {
  const length = reason.trim().length
  return length > 0 && length <= STOP_REASON_MAX_LENGTH
}

/**
 * Date longue (« 15 décembre 2026 ») d'un instant, lue dans le FUSEAU DE LA SALLE.
 *
 * `ends_at` tombe à minuit heure de la salle, donc à 22:00 ou 23:00 UTC LA VEILLE pour
 * Bruxelles. Formaté en UTC, ou dans le fuseau d'un navigateur situé ailleurs, il
 * annoncerait un jour trop tôt. Intl applique les règles du fuseau À CETTE DATE : été,
 * hiver et jours de changement d'heure sont absorbés sans offset écrit à la main.
 *
 * Une langue sans traduction du dashboard (nl, de) donne l'anglais, comme le repli i18n.
 * Renvoie '' pour une date absente ou illisible : l'appelant décide quoi montrer.
 */
export function formatGymDate(
  iso: string | null | undefined,
  timeZone: string,
  language: string,
): string {
  if (!iso) return ''
  const instant = new Date(iso)
  if (Number.isNaN(instant.getTime())) return ''
  const locale = language.toLowerCase().startsWith('fr') ? 'fr-BE' : 'en-GB'
  return new Intl.DateTimeFormat(locale, {
    timeZone, day: 'numeric', month: 'long', year: 'numeric',
  }).format(instant)
}

/**
 * Le badge « Se termine le {date} » remplace-t-il le libellé de statut ?
 *
 * Pour TOUT abonnement `canceling` daté, qu'il ait été arrêté par la salle ou résilié
 * par le membre : dans les deux cas, la date est ce que le gérant cherche.
 */
export function showsEndBadge(
  subscription: { status: string; endsAt: string | null } | null | undefined,
): boolean {
  if (subscription?.status !== 'canceling' || !subscription.endsAt) return false
  return !Number.isNaN(new Date(subscription.endsAt).getTime())
}

/**
 * Clé i18n de la ligne « réservations annulées » de la modale. Zéro a sa propre phrase
 * (« Aucune réservation ne sera annulée. ») ; un et plusieurs passent par les pluriels
 * i18next (`bookings_one`, `bookings_other`).
 */
export function stopBookingsKey(count: number): string {
  return count > 0 ? 'member_drawer.stop.bookings' : 'member_drawer.stop.bookings_none'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isReadableDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime())
}

export type StopPreview =
  /** L'abonnement est déjà arrêté par la salle : rien à confirmer, la fiche est périmée. */
  | { kind: 'already' }
  | { kind: 'preview'; endsAt: string; planName: string | null; bookingsCount: number }
  /** Réponse 200 hors contrat : on n'ouvre pas un formulaire sur des données devinées. */
  | { kind: 'invalid' }

/** Lit la réponse 200 de l'aperçu (`dry_run: true`). */
export function parseStopPreview(data: unknown): StopPreview {
  if (!isRecord(data) || data.ok !== true) return { kind: 'invalid' }
  if (data.already === true) return { kind: 'already' }
  // Sans `dry_run: true`, ce n'est pas un aperçu ; sans date lisible ou sans liste, la
  // modale annoncerait une date ou un nombre inventés.
  if (data.dry_run !== true || !isReadableDate(data.ends_at) || !Array.isArray(data.bookings)) {
    return { kind: 'invalid' }
  }
  return {
    kind: 'preview',
    endsAt: data.ends_at,
    planName: typeof data.plan_name === 'string' && data.plan_name.trim() ? data.plan_name : null,
    bookingsCount: data.bookings.length,
  }
}

export type StopResult =
  /** Un appel concurrent a gagné, ou l'abonnement était déjà arrêté : rien n'a été refait. */
  | { kind: 'already' }
  | { kind: 'stopped'; endsAt: string | null; cancelledCount: number; failedCount: number }
  | { kind: 'invalid' }

/** Lit la réponse 200 de l'arrêt réel. */
export function parseStopResult(data: unknown): StopResult {
  if (!isRecord(data) || data.ok !== true) return { kind: 'invalid' }
  if (data.already === true) return { kind: 'already' }
  // Un aperçu n'a rien arrêté : ne jamais l'annoncer comme un succès.
  if (data.dry_run === true) return { kind: 'invalid' }
  return {
    kind: 'stopped',
    endsAt: isReadableDate(data.ends_at) ? data.ends_at : null,
    cancelledCount: Array.isArray(data.cancelled_bookings) ? data.cancelled_bookings.length : 0,
    failedCount: Array.isArray(data.failed_bookings) ? data.failed_bookings.length : 0,
  }
}
