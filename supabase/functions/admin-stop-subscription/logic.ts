// GYM-190, étape C — LES DÉCISIONS DE `admin-stop-subscription`, SANS LE MONDE.
//
// `index.ts` appelle `Deno.serve()` au chargement : rien de ce qu'il contient n'est
// atteignable par un banc. Tout ce qui DÉCIDE (qui peut être arrêté, à quelle date,
// comment lire la réponse de Mollie, quelles réservations tombent) vit donc ici, pur,
// et se vérifie hors ligne. Voir `logic_test.ts`.

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
  if (sub.source_payment_id || !sub.mollie_subscription_id || !sub.mollie_customer_id) {
    return {
      kind: 'refused', code: 'NOT_RECURRING', status: sub.status,
      message: 'Abonnement payé en une fois : remboursement à traiter à part',
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
    const due = new Date(sub.next_payment_at)
    if (Number.isNaN(due.getTime())) return { ok: false, code: 'END_DATE_UNKNOWN' }

    let end = due
    const isBareDate = due.getTime() % 86_400_000 === 0
    if (isBareDate) {
      const ymd = [due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate()] as const
      try {
        end = startOfZonedDay(...ymd, timeZone || DEFAULT_TIME_ZONE)
      } catch {
        // Fuseau inconnu de l'environnement : le DEFAULT du schéma, pas une date devinée.
        end = startOfZonedDay(...ymd, DEFAULT_TIME_ZONE)
      }
    }
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

// ─── 3. RÉPONSE DU DELETE MOLLIE ─────────────────────────────────────────────────────

export type MollieDeleteOutcome = 'cancelled' | 'already_gone' | 'failed'

/**
 * Le classement porte sur le STATUT. Le texte ne sert qu'à départager les 422 : seul un
 * corps JSON dont `detail` dit à la fois « already » et « cancel(l)ed » vaut « déjà parti ».
 * Tout le reste est un échec : dans le doute, on n'écrit rien en base.
 */
export function classifyMollieDelete(httpStatus: number, body: string): MollieDeleteOutcome {
  if (httpStatus >= 200 && httpStatus < 300) return 'cancelled'
  if (httpStatus === 404 || httpStatus === 410) return 'already_gone'
  if (httpStatus === 422) {
    try {
      const detail = (JSON.parse(body) as { detail?: unknown } | null)?.detail
      if (typeof detail === 'string' && /already/i.test(detail) && /cancel?led/i.test(detail)) return 'already_gone'
    } catch {
      // Corps non JSON : on ne devine pas.
    }
  }
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
