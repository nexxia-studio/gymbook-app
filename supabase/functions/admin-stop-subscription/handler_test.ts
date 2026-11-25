// GYM-190 — BANC DU CŒUR DE `admin-stop-subscription`.
//
//     deno test --no-check supabase/functions/admin-stop-subscription/handler_test.ts
//
// AUCUN RÉSEAU, AUCUNE BASE : tout ce que le cœur touche du monde est une doublure qui
// note ses appels. Ce banc tient l'ORDRE et les ABSENCES : ce qui ne doit pas être appelé
// quand Mollie n'a pas confirmé, quand un prélèvement est en cours, ou en aperçu.
import { stopSubscriptionWith, type StopDeps, type StopSubscriptionRow } from './handler.ts'

function eq(actual: unknown, expected: unknown, message = ''): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`${message}\n  attendu : ${e}\n  obtenu  : ${a}`)
}

const NOW = new Date('2026-11-25T10:00:00Z')
const GYM = 'gym-1'
const GERANT = { id: 'admin-1', role: 'gym_admin', gym_id: GYM }
const ENDS_AT = '2026-12-04T23:00:00.000Z'

const SUB: StopSubscriptionRow = {
  id: 'sub-1', gym_id: GYM, member_id: 'member-1', status: 'active', plan_name: 'Illimité',
  cancellation_reason: null, ends_at: '2027-06-05T09:00:00+00:00',
  next_payment_at: '2026-12-05T00:00:00+00:00', payments_count: 3, max_payments: 12,
  source_payment_id: null, mollie_subscription_id: 'sub_mollie', mollie_customer_id: 'cst_mollie',
}

const resa = (id: string, status = 'confirmed') => ({
  id, slot_id: `slot-${id}`, status, debited_credit_id: null,
  starts_at: '2026-12-10T18:00:00+00:00', activity_name: 'Yoga',
})

const paiements = (...statuts: string[]) =>
  ({ http: 200, body: JSON.stringify({ count: statuts.length, _embedded: { payments: statuts.map((status) => ({ status })) } }) })
const abonnementMollie = (status: string) => ({ http: 200, body: JSON.stringify({ id: 'sub_mollie', status }) })

type Reponse = { http: number; body: string } | Error

interface Options {
  sub?: StopSubscriptionRow | null
  erreurLecture?: string
  reservations?: ReturnType<typeof resa>[]
  jeton?: string | null
  paiements?: Reponse
  statut?: Reponse
  suppression?: Reponse
  ecriture?: { error: string | null; touched: number } | Error
  relu?: { status: string; cancellation_reason: string | null; ends_at: string | null } | null
  journal?: { error: string | null; id: string | null } | Error
  completer?: string | null | Error
  annulation?: (id: string) => { id: string; ok: boolean; error?: 'UPDATE_FAILED' | 'STATUS_CHANGED' } | Error
  notification?: boolean | Error
  email?: boolean | Error
  alerteLeve?: boolean
}

interface Monde {
  deps: StopDeps
  appels: string[]
  patches: Record<string, unknown>[]
  journaux: Record<string, unknown>[]
  alertes: { stage: string; mollieId: string | null; gymId: string; detail: Record<string, unknown> }[]
  refs: unknown[]
  compte(nom: string): number
}

function rendre<T>(v: T | Error): Promise<T> {
  return v instanceof Error ? Promise.reject(v) : Promise.resolve(v)
}

function monde(o: Options = {}): Monde {
  const m: Monde = {
    appels: [], patches: [], journaux: [], alertes: [], refs: [],
    deps: null as unknown as StopDeps,
    compte: (nom) => m.appels.filter((a) => a === nom || a.startsWith(`${nom}:`)).length,
  }
  m.deps = {
    lireAbonnement() {
      m.appels.push('lireAbonnement')
      return Promise.resolve({ error: o.erreurLecture ?? null, sub: o.sub === undefined ? SUB : o.sub })
    },
    lireFuseau() { m.appels.push('lireFuseau'); return Promise.resolve('Europe/Brussels') },
    lireReservations(q) {
      m.appels.push(`lireReservations:${q.member_id}:${q.gym_id}:${q.ends_at}`)
      return Promise.resolve({ error: null, rows: o.reservations ?? [resa('b1'), resa('b2', 'waitlisted')] })
    },
    jetonMollie() { m.appels.push('jetonMollie'); return Promise.resolve(o.jeton === undefined ? 'jeton' : o.jeton) },
    molliePaiements() { m.appels.push('molliePaiements'); return rendre(o.paiements ?? paiements('paid', 'paid')) },
    mollieStatut() { m.appels.push('mollieStatut'); return rendre(o.statut ?? abonnementMollie('active')) },
    mollieDelete() { m.appels.push('mollieDelete'); return rendre(o.suppression ?? { http: 200, body: '{"status":"canceled"}' }) },
    updateSub(_id, patch) {
      m.appels.push('updateSub')
      m.patches.push(patch)
      return rendre(o.ecriture ?? { error: null, touched: 1 })
    },
    relireSub() { m.appels.push('relireSub'); return Promise.resolve(o.relu ?? null) },
    journal(row) {
      m.appels.push('journal')
      m.journaux.push(row)
      return rendre(o.journal ?? { error: null, id: 'journal-1' })
    },
    completerJournal(_id, metadata) {
      m.appels.push('completerJournal')
      m.journaux.push(metadata)
      return rendre(o.completer === undefined ? null : o.completer)
    },
    cancelBooking(ref) {
      m.appels.push(`cancelBooking:${ref.id}`)
      m.refs.push(ref)
      return rendre(o.annulation ? o.annulation(ref.id) : { id: ref.id, ok: true })
    },
    notification() { m.appels.push('notification'); return rendre(o.notification ?? true) },
    email() { m.appels.push('email'); return rendre(o.email ?? true) },
    alerte(a) {
      m.appels.push(`alerte:${a.stage}`)
      m.alertes.push(a)
      return o.alerteLeve ? Promise.reject(new Error('slack en panne')) : Promise.resolve()
    },
    maintenant: () => NOW,
    log() {},
  }
  return m
}

const ECRITURES = ['mollieDelete', 'updateSub', 'journal', 'completerJournal', 'cancelBooking', 'notification', 'email']
function aucuneEcriture(m: Monde, message = ''): void {
  for (const nom of ECRITURES) eq(m.compte(nom), 0, `${message} : ${nom} ne doit pas être appelé`)
}

const arret = (m: Monde, body: Record<string, unknown> = { subscription_id: 'sub-1', reason: 'déménagement' }, appelant = GERANT) =>
  stopSubscriptionWith({ appelant, body }, m.deps)

// ─── APPELANT ET PÉRIMÈTRE ───────────────────────────────────────────────────────────
Deno.test('appelant qui n’est pas gérant de salle : 403, aucune lecture, ni base ni Mollie', async () => {
  for (const appelant of [
    { id: 'u', role: 'member', gym_id: GYM },
    { id: 'u', role: 'super_admin', gym_id: GYM },
    { id: 'u', role: 'gym_admin', gym_id: null },
    null,
  ]) {
    const m = monde()
    const r = await stopSubscriptionWith({ appelant, body: { subscription_id: 'sub-1', reason: 'x' } }, m.deps)
    eq([r.status, r.body.code], [403, 'FORBIDDEN'], JSON.stringify(appelant))
    eq(m.appels, [])
  }
})

Deno.test('abonnement d’une autre salle : même 404 qu’un abonnement inexistant, aucune lecture Mollie', async () => {
  const autre = monde({ sub: { ...SUB, gym_id: 'gym-2' } })
  const absent = monde({ sub: null })
  const rAutre = await arret(autre)
  const rAbsent = await arret(absent)
  eq([rAutre.status, rAutre.body.code], [404, 'NOT_FOUND'])
  eq(rAutre, rAbsent, 'les deux réponses doivent être indiscernables')
  for (const m of [autre, absent]) {
    eq(m.appels, ['lireAbonnement'])
    aucuneEcriture(m)
  }
})

Deno.test('motif exigé pour un arrêt réel, pas pour un aperçu', async () => {
  const m = monde()
  const r = await arret(m, { subscription_id: 'sub-1' })
  eq([r.status, r.body.code], [400, 'REASON_REQUIRED'])
  eq(m.appels, [])
  const apercu = await arret(monde(), { subscription_id: 'sub-1', dry_run: true })
  eq(apercu.status, 200)
})

Deno.test('subscription_id absent : 400', async () => {
  const r = await arret(monde(), { reason: 'x' })
  eq([r.status, r.body.code], [400, 'MISSING_SUBSCRIPTION_ID'])
})

Deno.test('déjà arrêté par la salle : 200 already sans rien refaire ni lire chez Mollie, aperçu compris', async () => {
  for (const dry_run of [false, true]) {
    const m = monde({ sub: { ...SUB, status: 'canceling', cancellation_reason: 'stopped_by_gym', ends_at: ENDS_AT } })
    const r = await arret(m, { subscription_id: 'sub-1', reason: 'x', dry_run })
    eq(r, { status: 200, body: { ok: true, already: true, ends_at: ENDS_AT } })
    eq(m.appels, ['lireAbonnement'])
  }
})

Deno.test('refus d’éligibilité : 409 avec le statut, aucune lecture Mollie', async () => {
  const m = monde({ sub: { ...SUB, status: 'past_due' } })
  const r = await arret(m)
  eq([r.status, r.body.code, r.body.status], [409, 'NOT_STOPPABLE', 'past_due'])
  eq(m.appels, ['lireAbonnement'])
})

// ─── APERÇU ──────────────────────────────────────────────────────────────────────────
Deno.test('dry_run : lit les paiements chez Mollie et rien d’autre, aucune écriture', async () => {
  const m = monde()
  const r = await arret(m, { subscription_id: 'sub-1', dry_run: true })
  eq(r.status, 200)
  eq([r.body.ok, r.body.dry_run, r.body.ends_at, r.body.plan_name], [true, true, ENDS_AT, 'Illimité'])
  eq((r.body.bookings as { id: string }[]).map((b) => b.id), ['b1', 'b2'])
  eq(m.compte('molliePaiements'), 1)
  eq(m.compte('mollieStatut'), 0, 'pas de lecture du statut en aperçu')
  eq(m.compte('alerte'), 0)
  aucuneEcriture(m, 'dry_run')
})

Deno.test('dry_run avec un prélèvement en cours : 409 PAYMENT_IN_FLIGHT avant la saisie du motif', async () => {
  const m = monde({ paiements: paiements('pending', 'paid') })
  const r = await arret(m, { subscription_id: 'sub-1', dry_run: true })
  eq([r.status, r.body.code], [409, 'PAYMENT_IN_FLIGHT'])
  aucuneEcriture(m)
})

// ─── PRÉLÈVEMENT EN COURS ────────────────────────────────────────────────────────────
Deno.test('prélèvement open ou pending : 409 PAYMENT_IN_FLIGHT, rien n’est modifié', async () => {
  for (const statut of ['open', 'pending']) {
    const m = monde({ paiements: paiements('paid', statut) })
    const r = await arret(m)
    eq([r.status, r.body.code], [409, 'PAYMENT_IN_FLIGHT'], statut)
    if (/[—–]/.test(String(r.body.message))) throw new Error(String(r.body.message))
    eq(m.compte('mollieStatut'), 0)
    aucuneEcriture(m, statut)
  }
})

Deno.test('lecture des paiements en échec, illisible ou en exception : 502, rien n’est modifié', async () => {
  const cas: Reponse[] = [
    { http: 500, body: '' }, { http: 401, body: '' }, { http: 410, body: '' },
    { http: 200, body: '<html>' }, { http: 200, body: '{}' },
    new Error('délai dépassé'),
  ]
  for (const p of cas) {
    for (const dry_run of [false, true]) {
      const m = monde({ paiements: p })
      const r = await arret(m, { subscription_id: 'sub-1', reason: 'x', dry_run })
      eq([r.status, r.body.code], [502, 'MOLLIE_READ_FAILED'], JSON.stringify(p))
      eq(m.compte('mollieStatut'), 0)
      aucuneEcriture(m)
    }
  }
})

Deno.test('paiements en 404 : abonnement introuvable chez Mollie, on continue', async () => {
  const m = monde({ paiements: { http: 404, body: '' }, statut: { http: 404, body: '' } })
  const r = await arret(m)
  eq([r.status, r.body.mollie], [200, 'already_gone'])
  eq(m.compte('mollieDelete'), 0)
  eq(m.compte('updateSub'), 1)
})

Deno.test('pas de jeton Mollie : 502 MOLLIE_NOT_CONNECTED, aucun appel Mollie, aucune écriture', async () => {
  for (const dry_run of [false, true]) {
    const m = monde({ jeton: null })
    const r = await arret(m, { subscription_id: 'sub-1', reason: 'x', dry_run })
    eq([r.status, r.body.code], [502, 'MOLLIE_NOT_CONNECTED'])
    eq(m.compte('molliePaiements') + m.compte('mollieStatut'), 0)
    aucuneEcriture(m)
  }
})

// ─── STATUT MOLLIE ET DELETE ─────────────────────────────────────────────────────────
Deno.test('statut Mollie canceled ou completed : pas de DELETE, mais l’arrêt est écrit en base', async () => {
  for (const statut of ['canceled', 'completed']) {
    const m = monde({ statut: abonnementMollie(statut) })
    const r = await arret(m)
    eq([r.status, r.body.mollie], [200, 'already_gone'], statut)
    eq(m.compte('mollieDelete'), 0)
    eq(m.compte('updateSub'), 1)
    eq(m.patches[0].status, 'canceling')
  }
})

Deno.test('statut Mollie en 404 ou 410 : déjà parti, pas de DELETE', async () => {
  for (const http of [404, 410]) {
    const m = monde({ statut: { http, body: '' } })
    const r = await arret(m)
    eq([r.status, r.body.mollie], [200, 'already_gone'], String(http))
    eq(m.compte('mollieDelete'), 0)
  }
})

Deno.test('statut Mollie active, pending ou suspended : DELETE', async () => {
  for (const statut of ['active', 'pending', 'suspended']) {
    const m = monde({ statut: abonnementMollie(statut) })
    const r = await arret(m)
    eq([r.status, r.body.mollie], [200, 'cancelled'], statut)
    eq(m.compte('mollieDelete'), 1)
  }
})

Deno.test('lecture du statut en échec, statut inconnu ou exception : 502, rien n’est modifié', async () => {
  const cas: Reponse[] = [
    { http: 500, body: '' }, { http: 403, body: '' }, { http: 200, body: 'pas du json' },
    abonnementMollie('autre_chose'), new Error('réseau'),
  ]
  for (const s of cas) {
    const m = monde({ statut: s })
    const r = await arret(m)
    eq([r.status, r.body.code], [502, 'MOLLIE_READ_FAILED'], JSON.stringify(s))
    aucuneEcriture(m)
  }
})

Deno.test('DELETE refusé (dont 422, quel que soit son texte) ou en exception : 502, aucune écriture en base', async () => {
  const cas: Reponse[] = [
    { http: 500, body: '' }, { http: 401, body: '' },
    { http: 422, body: JSON.stringify({ detail: 'The subscription has already been cancelled' }) },
    new Error('délai dépassé'),
  ]
  for (const s of cas) {
    const m = monde({ suppression: s })
    const r = await arret(m)
    eq([r.status, r.body.code], [502, 'MOLLIE_STOP_FAILED'], JSON.stringify(s))
    eq(m.compte('mollieDelete'), 1)
    for (const nom of ECRITURES.filter((n) => n !== 'mollieDelete')) eq(m.compte(nom), 0, nom)
  }
})

Deno.test('DELETE en 404 ou 410 : déjà parti, l’arrêt est écrit', async () => {
  for (const http of [404, 410]) {
    const m = monde({ suppression: { http, body: '' } })
    const r = await arret(m)
    eq([r.status, r.body.mollie], [200, 'already_gone'])
    eq(m.compte('updateSub'), 1)
  }
})

// ─── ARRÊT NOMINAL ───────────────────────────────────────────────────────────────────
Deno.test('arrêt nominal : paiements, statut, DELETE, base, journal, réservations, membre prévenu, dans cet ordre', async () => {
  const m = monde()
  const r = await arret(m)
  eq(r, {
    status: 200,
    body: { ok: true, ends_at: ENDS_AT, mollie: 'cancelled', cancelled_bookings: ['b1', 'b2'], failed_bookings: [] },
  })
  eq(m.appels, [
    'lireAbonnement', 'lireFuseau', `lireReservations:member-1:${GYM}:${ENDS_AT}`, 'jetonMollie',
    'molliePaiements', 'mollieStatut', 'mollieDelete', 'updateSub', 'journal',
    'cancelBooking:b1', 'cancelBooking:b2', 'completerJournal', 'notification', 'email',
  ])
  eq(m.patches[0], {
    status: 'canceling', auto_renew: false, cancelled_at: NOW.toISOString(),
    cancellation_reason: 'stopped_by_gym', ends_at: ENDS_AT, next_payment_at: null,
    prenotification_sent_at: null, updated_at: NOW.toISOString(),
  })
  eq([m.journaux[0].gym_id, m.journaux[0].admin_id, m.journaux[0].target_id, m.journaux[0].action_type, m.journaux[0].reason],
    [GYM, 'admin-1', 'member-1', 'subscription_cancel', 'déménagement'])
  eq(m.compte('alerte'), 0)
})

Deno.test('chaque annulation est verrouillée sur la salle et le membre de l’abonnement', async () => {
  const m = monde()
  await arret(m)
  eq(m.refs, [
    { id: 'b1', slot_id: 'slot-b1', status: 'confirmed', gym_id: GYM, member_id: 'member-1' },
    { id: 'b2', slot_id: 'slot-b2', status: 'waitlisted', gym_id: GYM, member_id: 'member-1' },
  ])
})

// ─── COURSE ET ÉTAT DIVERGENT ────────────────────────────────────────────────────────
Deno.test('zéro ligne touchée et ligne déjà stopped_by_gym : already, ni journal, ni annulation, ni notification', async () => {
  const m = monde({
    ecriture: { error: null, touched: 0 },
    relu: { status: 'canceling', cancellation_reason: 'stopped_by_gym', ends_at: '2026-12-01T00:00:00+00:00' },
  })
  const r = await arret(m)
  eq(r, { status: 200, body: { ok: true, already: true, ends_at: '2026-12-01T00:00:00+00:00' } })
  for (const nom of ['journal', 'completerJournal', 'cancelBooking', 'notification', 'email', 'alerte']) eq(m.compte(nom), 0, nom)
})

Deno.test('zéro ligne touchée et autre statut : 500 STOP_NOT_PERSISTED et alerte', async () => {
  for (const relu of [{ status: 'past_due', cancellation_reason: null, ends_at: null }, { status: 'canceling', cancellation_reason: null, ends_at: null }, null]) {
    const m = monde({ ecriture: { error: null, touched: 0 }, relu })
    const r = await arret(m)
    eq([r.status, r.body.code], [500, 'STOP_NOT_PERSISTED'], JSON.stringify(relu))
    eq(m.alertes.map((a) => a.stage), ['stop_not_persisted'])
    for (const nom of ['journal', 'cancelBooking', 'notification', 'email']) eq(m.compte(nom), 0, nom)
  }
})

Deno.test('écriture en base en erreur ou en exception après Mollie : 500 STOP_NOT_PERSISTED et alerte', async () => {
  for (const ecriture of [{ error: 'deadlock', touched: 0 }, new Error('base injoignable')]) {
    const m = monde({ ecriture })
    const r = await arret(m)
    eq([r.status, r.body.code], [500, 'STOP_NOT_PERSISTED'])
    eq(m.alertes.map((a) => [a.stage, a.mollieId, a.gymId]), [['stop_not_persisted', 'sub_mollie', GYM]])
    for (const nom of ['journal', 'cancelBooking', 'notification', 'email']) eq(m.compte(nom), 0, nom)
  }
})

Deno.test('une alerte qui lève ne change pas la réponse', async () => {
  const m = monde({ ecriture: { error: 'deadlock', touched: 0 }, alerteLeve: true })
  const r = await arret(m)
  eq([r.status, r.body.code], [500, 'STOP_NOT_PERSISTED'])
  const m2 = monde({ annulation: () => ({ id: 'x', ok: false, error: 'UPDATE_FAILED' }), alerteLeve: true })
  eq((await arret(m2)).status, 200)
})

// ─── RÉSERVATIONS ────────────────────────────────────────────────────────────────────
Deno.test('une annulation en échec ou en exception n’arrête pas les autres ; alerte sans donnée personnelle', async () => {
  const m = monde({
    reservations: [resa('b1'), resa('b2'), resa('b3'), resa('b4')],
    annulation: (id) => id === 'b1' ? { id, ok: false, error: 'STATUS_CHANGED' }
      : id === 'b3' ? new Error('rpc') : { id, ok: true },
  })
  const r = await arret(m)
  eq(r.status, 200)
  eq(r.body.cancelled_bookings, ['b2', 'b4'])
  eq(r.body.failed_bookings, [{ id: 'b1', error: 'STATUS_CHANGED' }, { id: 'b3', error: 'UPDATE_FAILED' }])
  eq(m.compte('cancelBooking'), 4)
  eq(m.alertes.map((a) => a.stage), ['bookings_not_cancelled'])
  eq(m.alertes[0].detail, { subscription_id: 'sub-1', failed_bookings: [{ id: 'b1', error: 'STATUS_CHANGED' }, { id: 'b3', error: 'UPDATE_FAILED' }] })
  eq(m.compte('notification'), 1, 'le membre est prévenu quand même')
  const complement = m.journaux[1]
  eq(complement.failed_bookings, r.body.failed_bookings)
})

Deno.test('aucune alerte ne porte l’identité du membre ni le motif saisi', async () => {
  const m = monde({ ecriture: { error: 'deadlock', touched: 0 } })
  await arret(m, { subscription_id: 'sub-1', reason: 'MOTIF-SECRET' })
  const texte = JSON.stringify(m.alertes)
  if (texte.includes('MOTIF-SECRET') || texte.includes('member-1')) throw new Error(texte)
})

// ─── SUITES AU MIEUX ─────────────────────────────────────────────────────────────────
Deno.test('journal en erreur ou en exception : l’arrêt aboutit, les réservations tombent', async () => {
  for (const journal of [{ error: 'check violation', id: null }, new Error('base')]) {
    const m = monde({ journal })
    const r = await arret(m)
    eq([r.status, r.body.ok, r.body.cancelled_bookings], [200, true, ['b1', 'b2']])
    eq(m.compte('completerJournal'), 0)
    eq(m.compte('notification'), 1)
  }
  const m = monde({ completer: new Error('base') })
  eq((await arret(m)).status, 200)
})

Deno.test('notification et email en erreur ou en exception : l’arrêt aboutit', async () => {
  for (const o of [{ notification: new Error('push'), email: new Error('resend') }, { notification: false, email: false }]) {
    const m = monde(o)
    const r = await arret(m)
    eq([r.status, r.body.ok], [200, true])
    eq([m.compte('notification'), m.compte('email')], [1, 1], 'l’email part même si la notification lève')
  }
})
