// GYM-190 — BANC DES DÉCISIONS DE `admin-stop-subscription`.
//
//     deno test --no-check supabase/functions/admin-stop-subscription/logic_test.ts
//
// AUCUNE DÉPENDANCE, AUCUN RÉSEAU, AUCUNE BASE : tout ce qui est testé ici est pur.
// Le handler (`index.ts`) appelle `Deno.serve()` au chargement et n'est pas importable.
import {
  bookingsToCancel, classifyMollieDelete, computeEndDate, evaluateEligibility,
  MAX_REASON, validateReason,
} from './logic.ts'

function eq(actual: unknown, expected: unknown, message = ''): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`${message}\n  attendu : ${e}\n  obtenu  : ${a}`)
}

const TIRETS = /[—–]/

// ─── 1. ÉLIGIBILITÉ ──────────────────────────────────────────────────────────────────
const recurrent = {
  status: 'active', cancellation_reason: null, source_payment_id: null,
  mollie_subscription_id: 'sub_1', mollie_customer_id: 'cst_1', ends_at: '2027-01-05T10:00:00+00:00',
}

Deno.test('actif et récurrent : éligible', () => {
  eq(evaluateEligibility(recurrent), { kind: 'eligible' })
})

Deno.test('canceling arrêté par la salle : déjà fait, avec sa date de fin', () => {
  eq(
    evaluateEligibility({ ...recurrent, status: 'canceling', cancellation_reason: 'stopped_by_gym' }),
    { kind: 'already', ends_at: '2027-01-05T10:00:00+00:00' },
  )
})

Deno.test('canceling résilié par le membre : refus NOT_STOPPABLE avec le statut', () => {
  const r = evaluateEligibility({ ...recurrent, status: 'canceling', cancellation_reason: null })
  if (r.kind !== 'refused') throw new Error('refus attendu')
  eq([r.code, r.status], ['NOT_STOPPABLE', 'canceling'])
})

for (const status of ['past_due', 'suspended', 'paused', 'cancelled', 'expired', 'completed', 'pending', 'inconnu']) {
  Deno.test(`${status} : refus NOT_STOPPABLE`, () => {
    const r = evaluateEligibility({ ...recurrent, status })
    if (r.kind !== 'refused') throw new Error('refus attendu')
    eq([r.code, r.status], ['NOT_STOPPABLE', status])
    if (!r.message.includes(status)) throw new Error(`le message doit porter le statut : ${r.message}`)
  })
}

Deno.test('actif payé en une fois (source_payment_id) : NOT_RECURRING', () => {
  const r = evaluateEligibility({
    ...recurrent, source_payment_id: 'pay_1', mollie_subscription_id: null, mollie_customer_id: null,
  })
  if (r.kind !== 'refused') throw new Error('refus attendu')
  eq(r.code, 'NOT_RECURRING')
  eq(r.message, 'Abonnement payé en une fois : remboursement à traiter à part')
})

Deno.test('actif sans identifiant Mollie (abonnement ou client) : NOT_RECURRING', () => {
  for (const trou of [{ mollie_subscription_id: null }, { mollie_customer_id: null }, { mollie_subscription_id: '' }]) {
    const r = evaluateEligibility({ ...recurrent, ...trou })
    eq(r.kind === 'refused' ? r.code : r.kind, 'NOT_RECURRING', JSON.stringify(trou))
  }
})

Deno.test('payé en une fois mais expiré : le statut prime (NOT_STOPPABLE)', () => {
  const r = evaluateEligibility({ ...recurrent, status: 'expired', source_payment_id: 'pay_1' })
  eq(r.kind === 'refused' ? r.code : r.kind, 'NOT_STOPPABLE')
})

Deno.test('aucun message de refus ne porte de tiret long', () => {
  for (const s of [{ ...recurrent, status: 'paused' }, { ...recurrent, source_payment_id: 'p' }]) {
    const r = evaluateEligibility(s)
    if (r.kind === 'refused' && TIRETS.test(r.message)) throw new Error(r.message)
  }
})

// ─── 2. DATE DE FIN ──────────────────────────────────────────────────────────────────
const TZ = 'Europe/Brussels'
const NOW = new Date('2026-11-25T10:00:00Z')
const base = { next_payment_at: null, ends_at: '2027-06-05T09:00:00+00:00', payments_count: 3, max_payments: 12 }

Deno.test('date nue (00:00 UTC) : début de ce jour dans le calendrier de la salle, en hiver', () => {
  // Le webhook écrit '2026-12-05' dans un timestamptz : 2026-12-05T00:00Z. Le jour d'échéance
  // de la salle commence à 00:00 Bruxelles, soit 23:00 UTC la veille (UTC+1).
  eq(
    computeEndDate({ ...base, next_payment_at: '2026-12-05T00:00:00+00:00' }, TZ, NOW),
    { ok: true, ends_at: '2026-12-04T23:00:00.000Z', rule: 'next_payment' },
  )
})

Deno.test('date nue en été : 22:00 UTC la veille (UTC+2)', () => {
  eq(
    computeEndDate({ ...base, next_payment_at: '2027-05-05T00:00:00+00:00' }, TZ, NOW),
    { ok: true, ends_at: '2027-05-04T22:00:00.000Z', rule: 'next_payment' },
  )
})

Deno.test('date nue, salle à l’ouest de UTC : le jour local commence APRÈS 00:00 UTC', () => {
  eq(
    computeEndDate({ ...base, next_payment_at: '2026-12-05T00:00:00+00:00' }, 'America/New_York', NOW),
    { ok: true, ends_at: '2026-12-05T05:00:00.000Z', rule: 'next_payment' },
  )
})

Deno.test('instant précis (pas une date nue) : repris tel quel', () => {
  eq(
    computeEndDate({ ...base, next_payment_at: '2026-12-05T14:30:00+00:00' }, TZ, NOW),
    { ok: true, ends_at: '2026-12-05T14:30:00.000Z', rule: 'next_payment' },
  )
})

Deno.test('borne haute : jamais après le ends_at actuel', () => {
  eq(
    computeEndDate({ ...base, next_payment_at: '2026-12-05T00:00:00+00:00', ends_at: '2026-12-01T09:00:00+00:00' }, TZ, NOW),
    { ok: true, ends_at: '2026-12-01T09:00:00.000Z', rule: 'next_payment' },
  )
})

Deno.test('borne basse : une échéance passée vaut l’instant de l’arrêt', () => {
  eq(
    computeEndDate({ ...base, next_payment_at: '2026-11-20T00:00:00+00:00' }, TZ, NOW),
    { ok: true, ends_at: NOW.toISOString(), rule: 'next_payment' },
  )
})

Deno.test('les deux bornes en conflit (échéance et terme passés) : le terme l’emporte', () => {
  eq(
    computeEndDate({ ...base, next_payment_at: '2026-11-20T00:00:00+00:00', ends_at: '2026-11-24T09:00:00+00:00' }, TZ, NOW),
    { ok: true, ends_at: '2026-11-24T09:00:00.000Z', rule: 'next_payment' },
  )
})

Deno.test('ends_at absent : la date d’échéance sert seule', () => {
  eq(
    computeEndDate({ ...base, next_payment_at: '2026-12-05T00:00:00+00:00', ends_at: null }, TZ, NOW),
    { ok: true, ends_at: '2026-12-04T23:00:00.000Z', rule: 'next_payment' },
  )
})

Deno.test('pas d’échéance, tout est payé : ends_at inchangé, à l’octet près', () => {
  eq(
    computeEndDate({ ...base, payments_count: 12, max_payments: 12 }, TZ, NOW),
    { ok: true, ends_at: '2027-06-05T09:00:00+00:00', rule: 'fully_paid' },
  )
  eq(computeEndDate({ ...base, payments_count: 13, max_payments: 12 }, TZ, NOW).ok, true)
})

Deno.test('pas d’échéance et échéances restantes : END_DATE_UNKNOWN', () => {
  eq(computeEndDate(base, TZ, NOW), { ok: false, code: 'END_DATE_UNKNOWN' })
})

Deno.test('pas d’échéance et compteurs absents : END_DATE_UNKNOWN', () => {
  eq(computeEndDate({ ...base, payments_count: null, max_payments: null }, TZ, NOW), { ok: false, code: 'END_DATE_UNKNOWN' })
  eq(computeEndDate({ ...base, payments_count: 12, max_payments: null }, TZ, NOW), { ok: false, code: 'END_DATE_UNKNOWN' })
})

Deno.test('tout payé mais ends_at absent : END_DATE_UNKNOWN', () => {
  eq(computeEndDate({ ...base, payments_count: 12, ends_at: null }, TZ, NOW), { ok: false, code: 'END_DATE_UNKNOWN' })
})

Deno.test('échéance illisible : END_DATE_UNKNOWN, on ne devine pas', () => {
  eq(computeEndDate({ ...base, next_payment_at: 'pas une date' }, TZ, NOW), { ok: false, code: 'END_DATE_UNKNOWN' })
})

Deno.test('fuseau illisible : repli sur Europe/Brussels', () => {
  eq(
    computeEndDate({ ...base, next_payment_at: '2026-12-05T00:00:00+00:00' }, 'Pas/UnFuseau', NOW),
    { ok: true, ends_at: '2026-12-04T23:00:00.000Z', rule: 'next_payment' },
  )
})

// ─── 3. RÉPONSE DU DELETE MOLLIE ─────────────────────────────────────────────────────
Deno.test('2xx : annulé', () => {
  eq(classifyMollieDelete(200, '{"status":"canceled"}'), 'cancelled')
  eq(classifyMollieDelete(204, ''), 'cancelled')
})

Deno.test('404 et 410 : déjà parti', () => {
  eq(classifyMollieDelete(404, ''), 'already_gone')
  eq(classifyMollieDelete(410, '{"detail":"Gone"}'), 'already_gone')
})

Deno.test('422 dont le corps dit déjà annulé : déjà parti', () => {
  for (const detail of [
    'The subscription has been canceled already',
    'The subscription has already been cancelled',
    'This subscription is already canceled.',
    'Subscription was cancelled already',
  ]) {
    eq(classifyMollieDelete(422, JSON.stringify({ status: 422, title: 'Unprocessable Entity', detail })), 'already_gone', detail)
  }
})

Deno.test('422 pour une autre raison, ou corps illisible : échec', () => {
  eq(classifyMollieDelete(422, JSON.stringify({ detail: 'The subscription cannot be canceled right now' })), 'failed')
  eq(classifyMollieDelete(422, JSON.stringify({ detail: 'The mandate is invalid' })), 'failed')
  eq(classifyMollieDelete(422, ''), 'failed')
  eq(classifyMollieDelete(422, '<html>Bad gateway</html>'), 'failed')
  eq(classifyMollieDelete(422, JSON.stringify({ detail: 42 })), 'failed')
})

Deno.test('401, 403, 400, 429, 5xx, 3xx : échec', () => {
  for (const s of [301, 400, 401, 403, 409, 429, 500, 502, 503]) eq(classifyMollieDelete(s, ''), 'failed', String(s))
})

Deno.test('"already canceled" hors d’un 422 ne suffit pas', () => {
  eq(classifyMollieDelete(500, JSON.stringify({ detail: 'already canceled' })), 'failed')
})

// ─── 4. MOTIF ────────────────────────────────────────────────────────────────────────
Deno.test('motif rogné', () => {
  eq(validateReason('  déménagement  '), { ok: true, reason: 'déménagement' })
})

Deno.test('motif absent, vide, blanc ou non textuel : REASON_REQUIRED', () => {
  for (const v of [undefined, null, '', '   \n', 12, {}]) {
    const r = validateReason(v)
    eq(r.ok ? 'ok' : r.code, 'REASON_REQUIRED', JSON.stringify(v))
  }
})

Deno.test('motif : 500 caractères acceptés, 501 refusés, longueur mesurée après rognage', () => {
  eq(MAX_REASON, 500)
  eq(validateReason('a'.repeat(500)).ok, true)
  eq(validateReason(`  ${'a'.repeat(500)}  `).ok, true)
  const r = validateReason('a'.repeat(501))
  eq(r.ok ? 'ok' : r.code, 'REASON_TOO_LONG')
  if (!r.ok && TIRETS.test(r.message)) throw new Error(r.message)
})

// ─── 5. RÉSERVATIONS CONCERNÉES ──────────────────────────────────────────────────────
const END = '2026-12-04T23:00:00.000Z'
const resa = (o: Record<string, unknown>) => ({
  id: 'b', slot_id: 's', status: 'confirmed', debited_credit_id: null,
  starts_at: '2026-12-10T18:00:00+00:00', activity_name: 'Yoga', ...o,
})

Deno.test('réservations : après la fin, confirmée ou en attente, sans crédit', () => {
  const r = bookingsToCancel([
    resa({ id: 'avant', starts_at: '2026-12-04T18:00:00+00:00' }),
    resa({ id: 'pile', starts_at: '2026-12-04T23:00:00+00:00' }),
    resa({ id: 'apres' }),
    resa({ id: 'attente', status: 'waitlisted' }),
    resa({ id: 'credit', debited_credit_id: 'c1' }),
    resa({ id: 'annulee', status: 'cancelled' }),
    resa({ id: 'venue', status: 'attended' }),
    resa({ id: 'sans-date', starts_at: null }),
  ], END)
  eq(r.map((b) => b.id), ['pile', 'apres', 'attente'])
})

Deno.test('réservations : triées par date, forme de la réponse dry_run', () => {
  const r = bookingsToCancel([
    resa({ id: 'b2', starts_at: '2026-12-20T18:00:00+00:00' }),
    resa({ id: 'b1', slot_id: 's1', starts_at: '2026-12-10T18:00:00+00:00', activity_name: null }),
  ], END)
  eq(r, [
    { id: 'b1', slot_id: 's1', starts_at: '2026-12-10T18:00:00+00:00', activity_name: null, status: 'confirmed' },
    { id: 'b2', slot_id: 's', starts_at: '2026-12-20T18:00:00+00:00', activity_name: 'Yoga', status: 'confirmed' },
  ])
})

Deno.test('réservations : date de fin illisible, rien n’est sélectionné', () => {
  eq(bookingsToCancel([resa({})], 'pas une date'), [])
})
