// GYM-190 — BANC DES DÉCISIONS DE `admin-stop-subscription`.
//
//     deno test --no-check supabase/functions/admin-stop-subscription/logic_test.ts
//
// AUCUNE DÉPENDANCE, AUCUN RÉSEAU, AUCUNE BASE : tout ce qui est testé ici est pur.
// Le handler (`index.ts`) appelle `Deno.serve()` au chargement et n'est pas importable.
import {
  bookingsToCancel, classifyMollieDelete, classifyMolliePayments, classifyMollieSubscription,
  computeEndDate, evaluateEligibility, MAX_REASON, RECENT_PAID_WINDOW, RECORDED_PAYMENT_STATUSES,
  unrecordedPaidIds, validateReason,
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

Deno.test('actif sans identifiant Mollie et sans paiement source : NOT_RECURRING, message neutre', () => {
  for (const trou of [{ mollie_subscription_id: null }, { mollie_customer_id: null }, { mollie_subscription_id: '' }]) {
    const r = evaluateEligibility({ ...recurrent, ...trou })
    if (r.kind !== 'refused') throw new Error('refus attendu')
    eq(r.code, 'NOT_RECURRING', JSON.stringify(trou))
    // Rien ne dit qu'il a été payé en une fois : on ne promet pas un remboursement.
    eq(r.message, 'Cet abonnement n\'est pas prélevé par Mollie : il ne peut pas être arrêté ici.')
  }
})

Deno.test('payé en une fois mais expiré : le statut prime (NOT_STOPPABLE)', () => {
  const r = evaluateEligibility({ ...recurrent, status: 'expired', source_payment_id: 'pay_1' })
  eq(r.kind === 'refused' ? r.code : r.kind, 'NOT_STOPPABLE')
})

Deno.test('aucun message de refus ne porte de tiret long', () => {
  for (const s of [{ ...recurrent, status: 'paused' }, { ...recurrent, source_payment_id: 'p' }, { ...recurrent, mollie_subscription_id: null }]) {
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

Deno.test('date nue le jour du passage à l’heure d’hiver (2026-10-25) : le jour commence encore en UTC+2', () => {
  // La bascule a lieu à 03:00 locales : minuit de ce jour-là est encore à l'heure d'été.
  const avant = new Date('2026-10-01T10:00:00Z')
  eq(
    computeEndDate({ ...base, next_payment_at: '2026-10-25T00:00:00+00:00' }, TZ, avant),
    { ok: true, ends_at: '2026-10-24T22:00:00.000Z', rule: 'next_payment' },
  )
  // Le lendemain commence à l'heure d'hiver.
  eq(
    computeEndDate({ ...base, next_payment_at: '2026-10-26T00:00:00+00:00' }, TZ, avant),
    { ok: true, ends_at: '2026-10-25T23:00:00.000Z', rule: 'next_payment' },
  )
})

Deno.test('date nue le jour du passage à l’heure d’été (2027-03-28) : le jour commence encore en UTC+1', () => {
  eq(
    computeEndDate({ ...base, next_payment_at: '2027-03-28T00:00:00+00:00' }, TZ, NOW),
    { ok: true, ends_at: '2027-03-27T23:00:00.000Z', rule: 'next_payment' },
  )
  eq(
    computeEndDate({ ...base, next_payment_at: '2027-03-29T00:00:00+00:00' }, TZ, NOW),
    { ok: true, ends_at: '2027-03-28T22:00:00.000Z', rule: 'next_payment' },
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

// ─── 3. RÉPONSES DE MOLLIE ───────────────────────────────────────────────────────────
const FAILED = { kind: 'failed' }
let n = 0
/** Une entrée de la page Mollie : un `paid` porte un identifiant et une date de création. */
const pm = (status: string, createdAt = '2026-11-05T09:00:00+00:00', id = `tr_t${++n}`) => ({ id, status, createdAt })
const page = (...payments: unknown[]) => JSON.stringify({ count: payments.length, _embedded: { payments } })

Deno.test('paiements : aucun open ni pending, la voie est libre ; page vide, rien à vérifier', () => {
  eq(classifyMolliePayments(200, page()), { kind: 'clear', paidIds: [] })
  eq(classifyMolliePayments(200, page({ status: 'failed' }, { status: 'expired' }, { status: 'canceled' }, { status: 'authorized' })),
    { kind: 'clear', paidIds: [] })
})

Deno.test('paiements : un open ou un pending suffit, où qu’il soit dans la page, avant tout paid', () => {
  eq(classifyMolliePayments(200, page({ status: 'open' })), { kind: 'in_flight' })
  eq(classifyMolliePayments(200, page(pm('paid'), pm('paid'), { status: 'pending' })), { kind: 'in_flight' })
})

Deno.test('paiements : 404 ou 410, abonnement introuvable (ou disparu) chez Mollie', () => {
  eq(classifyMolliePayments(404, ''), { kind: 'not_found' })
  eq(classifyMolliePayments(410, ''), { kind: 'not_found' })
})

// ─── 3 bis. PAIEMENT ENCAISSÉ MAIS PAS ENCORE ENREGISTRÉ : PAR IDENTIFIANT ───────────
Deno.test('paid : les identifiants des trois derniers, du plus récent au plus ancien, quel que soit l’ordre de la page', () => {
  eq(RECENT_PAID_WINDOW, 3)
  const corps = page(
    pm('paid', '2026-08-05T09:00:00+00:00', 'tr_aout'),
    pm('paid', '2026-11-05T09:00:00+00:00', 'tr_nov'),
    pm('failed', '2026-12-01T09:00:00+00:00', 'tr_echec'),
    pm('paid', '2026-09-05T09:00:00+00:00', 'tr_sept'),
    pm('paid', '2026-10-05T09:00:00+00:00', 'tr_oct'),
  )
  eq(classifyMolliePayments(200, corps), { kind: 'clear', paidIds: ['tr_nov', 'tr_oct', 'tr_sept'] })
})

Deno.test('paid sans identifiant Mollie lisible, ou sans date de création lisible : échec, pas « rien à signaler »', () => {
  for (const e of [
    { status: 'paid', createdAt: '2026-11-05T09:00:00+00:00' },
    { status: 'paid', id: 42, createdAt: '2026-11-05T09:00:00+00:00' },
    { status: 'paid', id: 'pas_un_id', createdAt: '2026-11-05T09:00:00+00:00' },
    { status: 'paid', id: 'tr_ok' },
    { status: 'paid', id: 'tr_ok', createdAt: 'hier' },
  ]) eq(classifyMolliePayments(200, page(e)), FAILED, JSON.stringify(e))
  // Un statut autre que paid n'a pas besoin d'identifiant ni de date.
  eq(classifyMolliePayments(200, page({ status: 'failed' })), { kind: 'clear', paidIds: [] })
})

Deno.test('unrecordedPaidIds : ce qui manque chez nous, rien de plus', () => {
  eq(unrecordedPaidIds(['tr_c', 'tr_b', 'tr_a'], ['tr_a', 'tr_b', 'tr_c']), [])
  eq(unrecordedPaidIds(['tr_c', 'tr_b', 'tr_a'], ['tr_b', 'tr_a']), ['tr_c'])
  eq(unrecordedPaidIds(['tr_c', 'tr_b'], ['tr_c']), ['tr_b'], 'un paid plus ancien non enregistré est vu aussi : aucune date n’intervient')
  eq(unrecordedPaidIds([], ['tr_a']), [])
  eq(unrecordedPaidIds(['tr_a'], []), ['tr_a'])
})

Deno.test('statuts « enregistré » : paid et ce qui ne peut venir qu’après un paid', () => {
  eq([...RECORDED_PAYMENT_STATUSES].sort().join(','), 'charged_back,paid,partially_refunded,refunded')
})

Deno.test('paiements : toute autre réponse ou corps illisible, fermé par défaut', () => {
  for (const s of [301, 400, 401, 403, 422, 429, 500, 503]) eq(classifyMolliePayments(s, page()), FAILED, String(s))
  eq(classifyMolliePayments(200, ''), FAILED)
  eq(classifyMolliePayments(200, '<html>'), FAILED)
  eq(classifyMolliePayments(200, '{}'), FAILED)
  eq(classifyMolliePayments(200, JSON.stringify({ _embedded: { payments: 'non' } })), FAILED)
  eq(classifyMolliePayments(200, 'null'), FAILED)
  // Une entrée sans statut lisible : on ne sait pas, donc on ne passe pas.
  eq(classifyMolliePayments(200, page(pm('paid'), {})), FAILED)
  eq(classifyMolliePayments(200, page(null)), FAILED)
})

Deno.test('statut de l’abonnement : active, pending, suspended sont à arrêter', () => {
  for (const status of ['active', 'pending', 'suspended']) eq(classifyMollieSubscription(200, JSON.stringify({ status })), 'live', status)
})

Deno.test('statut de l’abonnement : canceled, completed, 404 et 410 sont déjà partis', () => {
  for (const status of ['canceled', 'completed']) eq(classifyMollieSubscription(200, JSON.stringify({ status })), 'already_gone', status)
  eq(classifyMollieSubscription(404, ''), 'already_gone')
  eq(classifyMollieSubscription(410, ''), 'already_gone')
})

Deno.test('statut de l’abonnement : statut inconnu, corps illisible ou autre réponse, échec', () => {
  eq(classifyMollieSubscription(200, JSON.stringify({ status: 'cancelled' })), 'failed', 'orthographe non documentée')
  eq(classifyMollieSubscription(200, JSON.stringify({})), 'failed')
  eq(classifyMollieSubscription(200, 'pas du json'), 'failed')
  eq(classifyMollieSubscription(200, 'null'), 'failed')
  for (const s of [301, 400, 401, 403, 422, 429, 500]) eq(classifyMollieSubscription(s, JSON.stringify({ status: 'canceled' })), 'failed', String(s))
})

Deno.test('DELETE 2xx : annulé', () => {
  eq(classifyMollieDelete(200), 'cancelled')
  eq(classifyMollieDelete(204), 'cancelled')
})

Deno.test('DELETE 404 et 410 : déjà parti', () => {
  eq(classifyMollieDelete(404), 'already_gone')
  eq(classifyMollieDelete(410), 'already_gone')
})

Deno.test('DELETE : tout le reste est un échec, 422 compris', () => {
  for (const s of [301, 400, 401, 403, 409, 422, 429, 500, 502, 503]) eq(classifyMollieDelete(s), 'failed', String(s))
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
