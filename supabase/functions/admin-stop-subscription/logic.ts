// GYM-190, étape C — LES DÉCISIONS DE `admin-stop-subscription`, SANS LE MONDE.
//
// Tout ce qui DÉCIDE (qui peut être arrêté, à quelle date, comment lire les réponses de
// Mollie, quelles réservations tombent) vit ici, pur, et se vérifie hors ligne. Voir
// `logic_test.ts`. L'enchaînement, lui, vit dans `handler.ts` (dépendances injectées).

export const STOPPED_BY_GYM = 'stopped_by_gym'
export const MAX_REASON = 500
const DEFAULT_TIME_ZONE = 'Europe/Brussels'

// ─── 1. ÉLIGIBILITÉ ──────────────────────────────────────────────────────────────────

export interface SubscriptionForEligibility {
  status: string
  cancellation_reason: string | null
  source_payment_id: string | null
  mollie_subscription_id: string | null
  mollie_customer_id: string | null
  ends_at: string | null
}

export type Eligibility =
  | { kind: 'eligible' }
  | { kind: 'already'; ends_at: string | null }
  | { kind: 'refused'; code: 'NOT_RECURRING' | 'NOT_STOPPABLE'; status: string; message: string }

/**
 * Ordre des questions : déjà arrêté par la salle, puis le statut, puis la récurrence.
 * Le statut passe avant la récurrence : un abonnement payé en une fois et déjà expiré
 * n'appelle aucun remboursement, lui répondre « remboursement à traiter » serait faux.
 */
export function evaluateEligibility(sub: SubscriptionForEligibility): Eligibility {
  if (sub.status === 'canceling' && sub.cancellation_reason === STOPPED_BY_GYM) {
    return { kind: 'already', ends_at: sub.ends_at }
  }
  if (sub.status !== 'active') {
    return {
      kind: 'refused', code: 'NOT_STOPPABLE', status: sub.status,
      message: `Cet abonnement ne peut pas être arrêté dans son état actuel (${sub.status})`,
    }
  }
  if (sub.source_payment_id) {
    return {
      kind: 'refused', code: 'NOT_RECURRING', status: sub.status,
      message: 'Abonnement payé en une fois : remboursement à traiter à part',
    }
  }
  if (!sub.mollie_subscription_id || !sub.mollie_customer_id) {
    // Sans paiement source, rien ne prouve un paiement en une fois : on ne parle pas de
    // remboursement, on dit seulement pourquoi le geste n'est pas possible ici.
    return {
      kind: 'refused', code: 'NOT_RECURRING', status: sub.status,
      message: 'Cet abonnement n\'est pas prélevé par Mollie : il ne peut pas être arrêté ici.',
    }
  }
  return { kind: 'eligible' }
}

// ─── 2. DATE DE FIN ──────────────────────────────────────────────────────────────────

export interface SubscriptionForEndDate {
  next_payment_at: string | null
  ends_at: string | null
  payments_count: number | null
  max_payments: number | null
}

export type EndDate =
  | { ok: true; ends_at: string; rule: 'next_payment' | 'fully_paid' }
  | { ok: false; code: 'END_DATE_UNKNOWN' }

/** Décalage du fuseau à un instant donné. Même geste que `slot-series-op/changes.ts`. */
function tzOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0')
  // `hour12: false` rend « 24 » à minuit sur certains moteurs : le modulo le ramène à 0.
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
  return asUtc - at.getTime()
}

/** L'instant où commence le jour `y-m-d` dans le calendrier de la salle. */
function startOfZonedDay(y: number, m: number, d: number, timeZone: string): Date {
  const naive = Date.UTC(y, m, d)
  let ts = naive
  // Deux passes : la première corrige le décalage, la seconde le stabilise autour d'une
  // bascule d'heure.
  for (let i = 0; i < 2; i++) ts = naive - tzOffsetMs(new Date(ts), timeZone)
  return new Date(ts)
}

type Ymd = readonly [number, number, number]

/**
 * LA lecture de `next_payment_at` pour la date de fin : une date nue (pile 00:00 UTC) est un JOUR du calendrier de la
 * salle ; toute autre valeur est un instant réel. `null` : valeur illisible.
 */
function readNextPayment(raw: string): { day: Ymd; at: null } | { day: null; at: Date } | null {
  const due = new Date(raw)
  if (Number.isNaN(due.getTime())) return null
  if (due.getTime() % 86_400_000 !== 0) return { day: null, at: due }
  return { day: [due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate()], at: null }
}

/** Fuseau inconnu de l'environnement : le DEFAULT du schéma, pas une date devinée. */
function inZone<T>(timeZone: string | null | undefined, f: (tz: string) => T): T {
  try {
    return f(timeZone || DEFAULT_TIME_ZONE)
  } catch {
    return f(DEFAULT_TIME_ZONE)
  }
}

/**
 * Fin de la dernière période payée.
 *
 * CE QUE CONTIENT `next_payment_at`. La colonne est un timestamptz, mais le webhook y
 * écrit une date NUE (`firstRenewalDate` rend « YYYY-MM-DD », le jour d'échéance dans le
 * calendrier de la salle). Postgres la range à 00:00 UTC de ce jour. Lue comme un instant,
 * elle tombe donc à 01:00 ou 02:00 à Bruxelles, et la VEILLE au soir pour une salle à
 * l'ouest de UTC. On la relit pour ce qu'elle est : un jour du calendrier de la salle,
 * dont on prend le début. Une valeur qui n'est pas pile à 00:00 UTC est un instant réel,
 * repris tel quel.
 *
 * Bornes, dans cet ordre : une date passée vaut l'instant de l'arrêt, puis rien ne dépasse
 * le `ends_at` actuel. Quand les deux se contredisent (échéance ET terme passés), le terme
 * l'emporte : l'arrêt ne rallonge jamais un abonnement.
 */
export function computeEndDate(sub: SubscriptionForEndDate, timeZone: string | null | undefined, now: Date): EndDate {
  const currentEnd = sub.ends_at ? new Date(sub.ends_at) : null
  const currentEndValid = currentEnd !== null && !Number.isNaN(currentEnd.getTime())

  if (sub.next_payment_at) {
    const due = readNextPayment(sub.next_payment_at)
    if (!due) return { ok: false, code: 'END_DATE_UNKNOWN' }

    let end = due.at ?? inZone(timeZone, (tz) => startOfZonedDay(...due.day, tz))
    if (end.getTime() < now.getTime()) end = now
    if (currentEndValid && end.getTime() > currentEnd.getTime()) end = currentEnd
    return { ok: true, ends_at: end.toISOString(), rule: 'next_payment' }
  }

  const fullyPaid = typeof sub.payments_count === 'number' && typeof sub.max_payments === 'number'
    && sub.payments_count >= sub.max_payments
  if (fullyPaid && currentEndValid) {
    // Inchangé à l'octet près : c'est la valeur de la base qui est réécrite.
    return { ok: true, ends_at: sub.ends_at as string, rule: 'fully_paid' }
  }
  return { ok: false, code: 'END_DATE_UNKNOWN' }
}

// ─── 3. RÉPONSES DE MOLLIE ───────────────────────────────────────────────────────────
//
// Trois lectures, une seule règle : le classement porte sur le STATUT HTTP et sur des
// champs documentés, jamais sur le texte d'un message d'erreur. Ce qu'on ne sait pas lire
// est un échec : dans le doute, rien n'est écrit en base.

function parseObject(body: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(body)
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
  } catch {
    return null
  }
}

/**
 * Lecture des paiements de l'abonnement chez Mollie.
 *  - `in_flight` : un paiement `open` ou `pending` peut encore être encaissé ;
 *  - `not_found` : 404 ou 410, l'abonnement n'existe pas (ou plus) chez Mollie ;
 *  - `failed`    : réponse non comprise, donc fermé par défaut ;
 *  - `clear`     : rien en cours. `paidIds` porte les identifiants Mollie des
 *                  RECENT_PAID_WINDOW derniers paiements `paid`, du plus récent au plus ancien.
 */
export type MolliePaymentsRead =
  | { kind: 'clear'; paidIds: string[] }
  | { kind: 'in_flight' }
  | { kind: 'not_found' }
  | { kind: 'failed' }

/** Un prélèvement `open` ou `pending` peut encore être encaissé : il est « en cours ». */
const IN_FLIGHT_PAYMENT_STATUSES = ['open', 'pending']

/**
 * Nombre de paiements `paid` récents dont on vérifie l'enregistrement. Un paiement encaissé
 * que notre webhook n'a pas traité est forcément l'un des derniers : trois couvre l'échéance
 * en cours et deux échéances en retard, sans relire tout l'historique.
 */
export const RECENT_PAID_WINDOW = 3

/** Forme d'un identifiant de paiement Mollie (`tr_…`). */
const MOLLIE_PAYMENT_ID = /^tr_[A-Za-z0-9]+$/

/**
 * Statuts d'une ligne `payments` qui prouvent que notre webhook a traité le paiement comme
 * encaissé : il l'écrit `paid` (upsert sur `mollie_payment_id`), et seuls un remboursement
 * ou une contestation le font changer ensuite. `pending`, `failed`, `expired`, `canceled`
 * ne prouvent rien.
 */
export const RECORDED_PAYMENT_STATUSES = ['paid', 'refunded', 'partially_refunded', 'charged_back']

/**
 * « List subscription payments » : `_embedded.payments[]`, chacun avec `id`, `status`,
 * `createdAt`. Une liste absente, une entrée sans statut lisible, ou un `paid` sans
 * identifiant ni date de création lisibles valent un échec : on ne déclare pas la voie
 * libre sur une réponse qu'on n'a pas comprise. Le tri se fait sur `createdAt`, sans
 * dépendre de l'ordre de la page.
 */
export function classifyMolliePayments(httpStatus: number, body: string): MolliePaymentsRead {
  if (httpStatus === 404 || httpStatus === 410) return { kind: 'not_found' }
  if (httpStatus < 200 || httpStatus >= 300) return { kind: 'failed' }
  const payments = (parseObject(body)?._embedded as { payments?: unknown } | null | undefined)?.payments
  if (!Array.isArray(payments)) return { kind: 'failed' }

  let inFlight = false
  const paid: { id: string; at: number }[] = []
  for (const p of payments) {
    const { id, status, createdAt } = (p ?? {}) as { id?: unknown; status?: unknown; createdAt?: unknown }
    if (typeof status !== 'string') return { kind: 'failed' }
    if (IN_FLIGHT_PAYMENT_STATUSES.includes(status)) inFlight = true
    if (status === 'paid') {
      const at = typeof createdAt === 'string' ? new Date(createdAt).getTime() : NaN
      if (typeof id !== 'string' || !MOLLIE_PAYMENT_ID.test(id) || Number.isNaN(at)) return { kind: 'failed' }
      paid.push({ id, at })
    }
  }
  if (inFlight) return { kind: 'in_flight' }
  paid.sort((a, b) => b.at - a.at)
  return { kind: 'clear', paidIds: paid.slice(0, RECENT_PAID_WINDOW).map((p) => p.id) }
}

/**
 * PAIEMENT ENCAISSÉ MAIS PAS ENCORE ENREGISTRÉ. Les identifiants `paid` récents chez Mollie
 * qui n'ont pas de ligne enregistrée chez nous. Non vide = refus : notre webhook n'a pas
 * encore traité un encaissement, et la date de fin couperait l'accès tout juste payé.
 * La comparaison porte sur les identifiants, jamais sur les dates : un prélèvement encaissé
 * plus vite que le précédent échappait à une comparaison de jours.
 */
export function unrecordedPaidIds(paidIds: string[], recordedIds: string[]): string[] {
  const recorded = new Set(recordedIds)
  return paidIds.filter((id) => !recorded.has(id))
}

export type MollieSubscriptionOutcome = 'live' | 'already_gone' | 'failed'

/**
 * « Get subscription » : `canceled` ou `completed` ne prélèvent plus (comme un 404 ou un
 * 410), il n'y a rien à supprimer. `active`, `pending` et `suspended` sont à arrêter.
 * Tout autre statut est inconnu de ce code : échec.
 */
export function classifyMollieSubscription(httpStatus: number, body: string): MollieSubscriptionOutcome {
  if (httpStatus === 404 || httpStatus === 410) return 'already_gone'
  if (httpStatus < 200 || httpStatus >= 300) return 'failed'
  const status = parseObject(body)?.status
  if (status === 'canceled' || status === 'completed') return 'already_gone'
  if (status === 'active' || status === 'pending' || status === 'suspended') return 'live'
  return 'failed'
}

export type MollieDeleteOutcome = 'cancelled' | 'already_gone' | 'failed'

/**
 * Le DELETE : succès, ou abonnement introuvable (404, 410). Un 422 est un échec, quel que
 * soit son texte : « déjà annulé » se lit sur le statut de l'abonnement, AVANT le DELETE.
 */
export function classifyMollieDelete(httpStatus: number): MollieDeleteOutcome {
  if (httpStatus >= 200 && httpStatus < 300) return 'cancelled'
  if (httpStatus === 404 || httpStatus === 410) return 'already_gone'
  return 'failed'
}

// ─── 4. MOTIF ────────────────────────────────────────────────────────────────────────

export type ReasonCheck =
  | { ok: true; reason: string }
  | { ok: false; code: 'REASON_REQUIRED' | 'REASON_TOO_LONG'; message: string }

export function validateReason(raw: unknown): ReasonCheck {
  const reason = typeof raw === 'string' ? raw.trim() : ''
  if (!reason) {
    return { ok: false, code: 'REASON_REQUIRED', message: 'Un motif est obligatoire pour arrêter un abonnement' }
  }
  if (reason.length > MAX_REASON) {
    return { ok: false, code: 'REASON_TOO_LONG', message: `Motif trop long (${MAX_REASON} caractères au plus)` }
  }
  return { ok: true, reason }
}

// ─── 5. RÉSERVATIONS CONCERNÉES ──────────────────────────────────────────────────────

export interface BookingCandidate {
  id: string
  slot_id: string
  status: string
  debited_credit_id: string | null
  starts_at: string | null
  activity_name: string | null
}

export interface BookingToCancel {
  id: string
  slot_id: string
  starts_at: string
  activity_name: string | null
  status: 'confirmed' | 'waitlisted'
}

/**
 * Les réservations qui tombent avec l'abonnement : confirmées ou en attente, créneau qui
 * commence à la date de fin ou après, et prises SOUS abonnement (`debited_credit_id` nul).
 * Une réservation payée par un crédit ne dépend pas de l'abonnement : elle reste.
 */
export function bookingsToCancel(candidates: BookingCandidate[], endsAt: string): BookingToCancel[] {
  const end = new Date(endsAt).getTime()
  if (Number.isNaN(end)) return []
  return candidates
    .filter((b) => {
      if (b.status !== 'confirmed' && b.status !== 'waitlisted') return false
      if (b.debited_credit_id !== null) return false
      const start = b.starts_at ? new Date(b.starts_at).getTime() : NaN
      return !Number.isNaN(start) && start >= end
    })
    .sort((a, b) => new Date(a.starts_at as string).getTime() - new Date(b.starts_at as string).getTime())
    .map((b) => ({
      id: b.id, slot_id: b.slot_id, starts_at: b.starts_at as string,
      activity_name: b.activity_name, status: b.status as 'confirmed' | 'waitlisted',
    }))
}
