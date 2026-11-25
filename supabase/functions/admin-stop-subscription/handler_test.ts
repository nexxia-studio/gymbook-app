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
const SUB_ID = '11111111-1111-4111-8111-111111111111'
const MEMBER_ID = '22222222-2222-4222-8222-222222222222'

const SUB: StopSubscriptionRow = {
  id: SUB_ID, gym_id: GYM, member_id: MEMBER_ID, status: 'active', plan_name: 'Illimité',
  cancellation_reason: null, ends_at: '2027-06-05T09:00:00+00:00',
  next_payment_at: '2026-12-05T00:00:00+00:00', payments_count: 3, max_payments: 12,
  source_payment_id: null, mollie_subscription_id: 'sub_mollie', mollie_customer_id: 'cst_mollie',
}

const resa = (id: string, status = 'confirmed') => ({
  id, slot_id: `slot-${id}`, status, debited_credit_id: null,
  starts_at: '2026-12-10T18:00:00+00:00', activity_name: 'Yoga',
})

// Page Mollie : chaque entrée porte un identifiant `tr_p<rang>` et une date de création.
// Par défaut, la doublure `paiementsEnregistres` dit enregistrés tous les identifiants demandés.
const paiements = (...statuts: string[]) =>
  ({ http: 200, body: JSON.stringify({ count: statuts.length, _embedded: { payments: statuts.map((status, i) => ({
    id: `tr_p${i + 1}`, status, createdAt: `2026-${String(11 - i).padStart(2, '0')}-05T09:00:00+00:00`,
  })) } }) })
/** Page de paiements `paid` explicites : [identifiant, date de création]. */
const payes = (...entrees: [string, string][]) =>
  ({ http: 200, body: JSON.stringify({ _embedded: { payments: entrees.map(([id, createdAt]) => ({ id, status: 'paid', createdAt, paidAt: createdAt })) } }) })
const abonnementMollie = (status: string) => ({ http: 200, body: JSON.stringify({ id: 'sub_mollie', status }) })

type Reponse = { http: number; body: string } | Error

interface Options {
  sub?: StopSubscriptionRow | null
  erreurLecture?: string
  erreurReservations?: string
  reservations?: ReturnType<typeof resa>[]
  jeton?: string | null
  paiements?: Reponse
  /** Identifiants Mollie enregistrés chez nous ; absent = tous ceux demandés. */
  enregistres?: string[]
  erreurEnregistres?: string | Error
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
  /** Réponse de `alerteRecente` : vrai = une alerte existe déjà dans l'heure. */
  alerteRecente?: boolean | Error
}

interface Monde {
  deps: StopDeps
  appels: string[]
  patches: Record<string, unknown>[]
  journaux: Record<string, unknown>[]
  alertes: { stage: string; mollieId: string | null; gymId: string; detail: Record<string, unknown> }[]
  refs: unknown[]
  /** La salle reçue par chaque écriture ou relecture service_role. */
  verrous: string[]
  logs: { niveau: string; message: string; detail: Record<string, unknown> }[]
  compte(nom: string): number
}

function rendre<T>(v: T | Error): Promise<T> {
  return v instanceof Error ? Promise.reject(v) : Promise.resolve(v)
}

function monde(o: Options = {}): Monde {
  const m: Monde = {
    appels: [], patches: [], journaux: [], alertes: [], refs: [], verrous: [], logs: [],
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
      if (o.erreurReservations) return Promise.resolve({ error: o.erreurReservations, rows: [] })
      return Promise.resolve({ error: null, rows: o.reservations ?? [resa('b1'), resa('b2', 'waitlisted')] })
    },
    jetonMollie() { m.appels.push('jetonMollie'); return Promise.resolve(o.jeton === undefined ? 'jeton' : o.jeton) },
    molliePaiements() { m.appels.push('molliePaiements'); return rendre(o.paiements ?? paiements('paid', 'paid')) },
    paiementsEnregistres(gymId, ids) {
      m.appels.push(`paiementsEnregistres:${gymId}:${ids.join(',')}`)
      if (o.erreurEnregistres instanceof Error) return Promise.reject(o.erreurEnregistres)
      if (o.erreurEnregistres) return Promise.resolve({ error: o.erreurEnregistres, ids: [] })
      const connus = o.enregistres ?? ids
      return Promise.resolve({ error: null, ids: ids.filter((id) => connus.includes(id)) })
    },
    mollieStatut() { m.appels.push('mollieStatut'); return rendre(o.statut ?? abonnementMollie('active')) },
    mollieDelete() { m.appels.push('mollieDelete'); return rendre(o.suppression ?? { http: 200, body: '{"status":"canceled"}' }) },
    updateSub(_id, gymId, patch) {
      m.appels.push('updateSub')
      m.verrous.push(`updateSub:${gymId}`)
      m.patches.push(patch)
      return rendre(o.ecriture ?? { error: null, touched: 1 })
    },
    relireSub(_id, gymId) { m.appels.push('relireSub'); m.verrous.push(`relireSub:${gymId}`); return Promise.resolve(o.relu ?? null) },
    journal(row) {
      m.appels.push('journal')
      m.journaux.push(row)
      return rendre(o.journal ?? { error: null, id: 'journal-1' })
    },
    completerJournal(_id, gymId, metadata) {
      m.appels.push('completerJournal')
      m.verrous.push(`completerJournal:${gymId}`)
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
    alerteRecente(stage, mollieId, gymId, depuis) {
      m.appels.push(`alerteRecente:${stage}:${mollieId}:${gymId}:${depuis.toISOString()}`)
      if (o.alerteRecente instanceof Error) return Promise.reject(o.alerteRecente)
      return Promise.resolve(o.alerteRecente ?? false)
    },
    maintenant: () => NOW,
    log(niveau, message, detail) { m.logs.push({ niveau, message, detail }) },
  }
  return m
}

const ECRITURES = ['mollieDelete', 'updateSub', 'journal', 'completerJournal', 'cancelBooking', 'notification', 'email']
function aucuneEcriture(m: Monde, message = ''): void {
  for (const nom of ECRITURES) eq(m.compte(nom), 0, `${message} : ${nom} ne doit pas être appelé`)
}

const arret = (m: Monde, body: Record<string, unknown> = { subscription_id: SUB_ID, reason: 'déménagement' }, appelant = GERANT) =>
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
    const r = await stopSubscriptionWith({ appelant, body: { subscription_id: SUB_ID, reason: 'x' } }, m.deps)
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
  const r = await arret(m, { subscription_id: SUB_ID })
  eq([r.status, r.body.code], [400, 'REASON_REQUIRED'])
  eq(m.appels, [])
  const apercu = await arret(monde(), { subscription_id: SUB_ID, dry_run: true })
  eq(apercu.status, 200)
})

Deno.test('subscription_id absent : 400', async () => {
  const r = await arret(monde(), { reason: 'x' })
  eq([r.status, r.body.code], [400, 'MISSING_SUBSCRIPTION_ID'])
})

Deno.test('membre fourni et différent de celui de l’abonnement : même 404 que l’inexistant, avant toute lecture Mollie', async () => {
  const AUTRE = '33333333-3333-4333-8333-333333333333'
  const absent = await arret(monde({ sub: null }))
  for (const dry_run of [false, true]) {
    const m = monde()
    const r = await arret(m, { subscription_id: SUB_ID, member_id: AUTRE, reason: 'x', dry_run })
    eq(r, absent, 'indiscernable de l’inexistant')
    eq(m.appels, ['lireAbonnement'])
    aucuneEcriture(m)
  }
  // Le bon membre, ou pas de membre du tout : l'arrêt se fait.
  eq((await arret(monde(), { subscription_id: SUB_ID, member_id: MEMBER_ID, reason: 'x' })).status, 200)
  eq((await arret(monde(), { subscription_id: SUB_ID, member_id: MEMBER_ID.toUpperCase(), reason: 'x' })).status, 200)
})

Deno.test('subscription_id ou member_id qui n’a pas la forme d’un UUID : 404 sans requête en base, valeur brute jamais journalisée', async () => {
  const absent = await arret(monde({ sub: null }))
  const BRUT = 'sub-1\'; drop table--'
  const cas: Record<string, unknown>[] = [
    { subscription_id: BRUT, reason: 'x' },
    { subscription_id: `${SUB_ID}x`, reason: 'x' },
    { subscription_id: SUB_ID, member_id: BRUT, reason: 'x' },
    { subscription_id: SUB_ID, member_id: 12, reason: 'x' },
    { subscription_id: SUB_ID, member_id: '', reason: 'x' },
    { subscription_id: BRUT, dry_run: true },
  ]
  for (const body of cas) {
    const m = monde()
    const r = await arret(m, body)
    eq(r, absent, JSON.stringify(body))
    eq(m.appels, [], 'aucune lecture, ni base ni Mollie')
    if (JSON.stringify(m.logs).includes('drop table')) throw new Error(JSON.stringify(m.logs))
  }
})

// ─── DÉJÀ ARRÊTÉ PAR LA SALLE, ET REPRISE D'UN ARRÊT INTERROMPU ──────────────────────
const DEJA = { ...SUB, status: 'canceling', cancellation_reason: 'stopped_by_gym', ends_at: ENDS_AT, next_payment_at: null }
const HORS_REPRISE = ['jetonMollie', 'molliePaiements', 'paiementsEnregistres', 'mollieStatut', 'mollieDelete', 'updateSub', 'relireSub', 'completerJournal', 'notification', 'email']

Deno.test('déjà arrêté, rien à reprendre : already avec des tableaux vides, zéro écriture, zéro Mollie', async () => {
  const m = monde({ sub: DEJA, reservations: [] })
  const r = await arret(m)
  eq(r, { status: 200, body: { ok: true, already: true, ends_at: ENDS_AT, cancelled_bookings: [], failed_bookings: [] } })
  eq(m.appels, ['lireAbonnement', `lireReservations:${MEMBER_ID}:${GYM}:${ENDS_AT}`])
  aucuneEcriture(m)
  eq(m.compte('alerte'), 0)
})

Deno.test('déjà arrêté il y a moins de deux minutes : pas de reprise, le premier appel est encore à l’œuvre', async () => {
  const m = monde({ sub: { ...DEJA, cancelled_at: new Date(NOW.getTime() - 30_000).toISOString() } })
  const r = await arret(m, { subscription_id: SUB_ID, reason: 'déménagement' })
  eq(r, { status: 200, body: { ok: true, already: true, ends_at: ENDS_AT, cancelled_bookings: [], failed_bookings: [] } })
  eq(m.appels, ['lireAbonnement'])
})

Deno.test('déjà arrêté depuis plus de deux minutes : la reprise a lieu', async () => {
  const m = monde({ sub: { ...DEJA, cancelled_at: new Date(NOW.getTime() - 10 * 60_000).toISOString() } })
  const r = await arret(m, { subscription_id: SUB_ID, reason: 'déménagement' })
  eq((r.body as { cancelled_bookings: string[] }).cancelled_bookings, ['b1', 'b2'])
})

Deno.test('déjà arrêté avec un reliquat : annulations et journal de reprise seulement, zéro Mollie, zéro updateSub, zéro notification', async () => {
  const m = monde({ sub: DEJA })
  const r = await arret(m, { subscription_id: SUB_ID, reason: 'déménagement' })
  eq(r, { status: 200, body: { ok: true, already: true, ends_at: ENDS_AT, cancelled_bookings: ['b1', 'b2'], failed_bookings: [] } })
  eq(m.appels, [
    'lireAbonnement', `lireReservations:${MEMBER_ID}:${GYM}:${ENDS_AT}`, 'cancelBooking:b1', 'cancelBooking:b2', 'journal',
  ])
  for (const nom of HORS_REPRISE) eq(m.compte(nom), 0, nom)
  eq(m.refs, [
    { id: 'b1', slot_id: 'slot-b1', status: 'confirmed', gym_id: GYM, member_id: MEMBER_ID },
    { id: 'b2', slot_id: 'slot-b2', status: 'waitlisted', gym_id: GYM, member_id: MEMBER_ID },
  ])
  eq(m.journaux, [{
    gym_id: GYM, admin_id: 'admin-1', target_id: MEMBER_ID, action_type: 'subscription_cancel', reason: 'déménagement',
    metadata: { subscription_id: SUB_ID, resumed: true, ends_at: ENDS_AT, cancelled_bookings: ['b1', 'b2'], failed_bookings: [] },
  }])
  eq(m.compte('alerte'), 0)
})

Deno.test('reprise avec des échecs : journalisés, alerte bookings_not_cancelled, toujours ni Mollie ni notification', async () => {
  const m = monde({ sub: DEJA, annulation: (id) => id === 'b1' ? { id, ok: false, error: 'UPDATE_FAILED' } : { id, ok: true }, journal: new Error('base') })
  const r = await arret(m)
  eq([r.status, r.body.already, r.body.cancelled_bookings, r.body.failed_bookings],
    [200, true, ['b2'], [{ id: 'b1', error: 'UPDATE_FAILED' }]])
  eq((m.journaux[0].metadata as Record<string, unknown>).failed_bookings, [{ id: 'b1', error: 'UPDATE_FAILED' }])
  eq(m.alertes.map((a) => [a.stage, a.detail]), [['bookings_not_cancelled', { subscription_id: SUB_ID, resumed: true, failed_bookings: [{ id: 'b1', error: 'UPDATE_FAILED' }] }]])
  for (const nom of HORS_REPRISE) eq(m.compte(nom), 0, nom)
})

Deno.test('reprise : les réservations hors règle (crédit, avant la fin) ne sont pas touchées', async () => {
  const m = monde({ sub: DEJA, reservations: [
    { ...resa('credit'), debited_credit_id: 'c1' } as unknown as ReturnType<typeof resa>,
    { ...resa('avant'), starts_at: '2026-12-01T18:00:00+00:00' },
  ] })
  const r = await arret(m)
  eq([r.body.cancelled_bookings, r.body.failed_bookings], [[], []])
  aucuneEcriture(m)
})

Deno.test('déjà arrêté en dry_run : already, zéro écriture, aucune lecture au-delà de l’abonnement', async () => {
  const m = monde({ sub: DEJA })
  const r = await arret(m, { subscription_id: SUB_ID, dry_run: true })
  eq(r, { status: 200, body: { ok: true, already: true, ends_at: ENDS_AT } })
  eq(m.appels, ['lireAbonnement'])
  aucuneEcriture(m)
})

Deno.test('déjà arrêté, appel réel sans motif : 400 comme avant, rien n’est repris', async () => {
  const m = monde({ sub: DEJA })
  const r = await arret(m, { subscription_id: SUB_ID })
  eq([r.status, r.body.code], [400, 'REASON_REQUIRED'])
  eq(m.appels, [])
})

Deno.test('reprise impossible à borner (lecture en échec, ou ends_at absent) : 500, rien n’est annulé', async () => {
  for (const o of [{ sub: DEJA, erreurReservations: 'timeout' }, { sub: { ...DEJA, ends_at: null } }]) {
    const m = monde(o)
    const r = await arret(m)
    eq([r.status, r.body.code], [500, 'SERVER_ERROR'])
    aucuneEcriture(m)
  }
})

Deno.test('refus d’éligibilité : 409 avec le statut, aucune lecture Mollie', async () => {
  const m = monde({ sub: { ...SUB, status: 'past_due' } })
  const r = await arret(m)
  eq([r.status, r.body.code, r.body.status], [409, 'NOT_STOPPABLE', 'past_due'])
  eq(m.appels, ['lireAbonnement'])
})

Deno.test('date de fin inconnue (pas d’échéance, échéances restantes) : 409 END_DATE_UNKNOWN, ni réservations, ni Mollie, ni écriture', async () => {
  for (const dry_run of [false, true]) {
    const m = monde({ sub: { ...SUB, next_payment_at: null } })
    const r = await arret(m, { subscription_id: SUB_ID, reason: 'x', dry_run })
    eq([r.status, r.body.code], [409, 'END_DATE_UNKNOWN'])
    eq(m.appels, ['lireAbonnement', 'lireFuseau'])
    aucuneEcriture(m)
  }
})

Deno.test('lecture des réservations en échec : 500, aucun appel Mollie, aucune écriture', async () => {
  for (const dry_run of [false, true]) {
    const m = monde({ erreurReservations: 'timeout' })
    const r = await arret(m, { subscription_id: SUB_ID, reason: 'x', dry_run })
    eq([r.status, r.body.code], [500, 'SERVER_ERROR'])
    for (const nom of ['jetonMollie', 'molliePaiements', 'mollieStatut']) eq(m.compte(nom), 0, nom)
    aucuneEcriture(m)
    eq(m.compte('alerte'), 0)
  }
})

// ─── APERÇU ──────────────────────────────────────────────────────────────────────────
Deno.test('dry_run : lit les paiements chez Mollie et rien d’autre, aucune écriture', async () => {
  const m = monde()
  const r = await arret(m, { subscription_id: SUB_ID, dry_run: true })
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
  const r = await arret(m, { subscription_id: SUB_ID, dry_run: true })
  eq([r.status, r.body.code], [409, 'PAYMENT_IN_FLIGHT'])
  aucuneEcriture(m)
})

// ─── PAIEMENT ENCAISSÉ, PAS ENCORE ENREGISTRÉ : PAR IDENTIFIANT ──────────────────────
const MSG_NON_ENREGISTRE = 'Un prélèvement vient d\'être encaissé et n\'est pas encore enregistré. Réessayez dans quelques minutes. '
  + 'Si le problème persiste après quelques minutes, contactez le support.'
const NON_ENREGISTRE = {
  paiements: payes(['tr_dec', '2026-12-02T06:00:00+00:00'], ['tr_nov', '2026-11-05T09:00:00+00:00']),
  enregistres: ['tr_nov'],
}

Deno.test('refus RENEWAL_NOT_RECORDED : une alerte avec les identifiants manquants, le membre et la salle, aperçu compris', async () => {
  for (const dry_run of [false, true]) {
    const m = monde(NON_ENREGISTRE)
    const r = await arret(m, { subscription_id: SUB_ID, reason: 'x', dry_run })
    eq(r.body.code, 'RENEWAL_NOT_RECORDED')
    const depuis = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString()
    eq(m.appels.includes(`alerteRecente:renewal_not_recorded:${SUB.mollie_subscription_id}:${GYM}:${depuis}`), true, 'fenêtre d’une heure')
    eq(m.alertes, [{
      stage: 'renewal_not_recorded', mollieId: SUB.mollie_subscription_id, gymId: GYM,
      detail: { subscription_id: SUB_ID, member_id: MEMBER_ID, gym_id: GYM, missing_mollie_payment_ids: ['tr_dec'] },
    }], String(dry_run))
    aucuneEcriture(m)
  }
})

Deno.test('refus RENEWAL_NOT_RECORDED : pas de seconde alerte dans l’heure pour le même abonnement', async () => {
  const m = monde({ ...NON_ENREGISTRE, alerteRecente: true })
  const r = await arret(m)
  eq([r.status, r.body.code], [409, 'RENEWAL_NOT_RECORDED'])
  eq(m.compte('alerte'), 0)
})

Deno.test('refus RENEWAL_NOT_RECORDED : alertes récentes illisibles, on alerte quand même ; alerte en panne, le refus reste', async () => {
  const lecture = monde({ ...NON_ENREGISTRE, alerteRecente: new Error('base') })
  eq((await arret(lecture)).body.code, 'RENEWAL_NOT_RECORDED')
  eq(lecture.compte('alerte'), 1)
  const envoi = monde({ ...NON_ENREGISTRE, alerteLeve: true })
  eq((await arret(envoi)).body.code, 'RENEWAL_NOT_RECORDED')
})

Deno.test('aucun refus, aucune alerte de ce type', async () => {
  const m = monde()
  eq((await arret(m)).status, 200)
  eq(m.compte('alerteRecente'), 0)
})

Deno.test('a) prélèvement payé et enregistré : l’arrêt passe', async () => {
  const m = monde({ paiements: payes(['tr_nov', '2026-11-05T09:00:00+00:00'], ['tr_oct', '2026-10-05T09:00:00+00:00']), enregistres: ['tr_nov', 'tr_oct'] })
  const r = await arret(m)
  eq([r.status, r.body.ok, r.body.mollie], [200, true, 'cancelled'])
  eq(m.appels.includes(`paiementsEnregistres:${GYM}:tr_nov,tr_oct`), true, 'la lecture porte sur les identifiants Mollie, dans la salle')
})

Deno.test('b) prélèvement payé, non enregistré, daté AVANT le précédent : refus RENEWAL_NOT_RECORDED, aperçu compris, rien n’est modifié', async () => {
  // Le cas qui échappait à la comparaison de dates : `tr_dec` a été créé avant le 5 déc.
  // (échéance enregistrée de SUB) et plus tôt dans le mois que le précédent. Par identifiant,
  // il est vu : il manque chez nous.
  for (const dry_run of [false, true]) {
    const m = monde({
      paiements: payes(['tr_dec', '2026-12-02T06:00:00+00:00'], ['tr_nov', '2026-11-05T09:00:00+00:00']),
      enregistres: ['tr_nov'],
    })
    const r = await arret(m, { subscription_id: SUB_ID, reason: 'x', dry_run })
    eq([r.status, r.body.code, r.body.message], [409, 'RENEWAL_NOT_RECORDED', MSG_NON_ENREGISTRE], String(dry_run))
    eq(m.compte('mollieStatut'), 0)
    aucuneEcriture(m, `dry_run=${dry_run}`)
  }
})

Deno.test('b bis) seuls les trois derniers paid sont vérifiés ; un manque parmi eux suffit', async () => {
  const page = payes(
    ['tr_4', '2026-11-05T09:00:00+00:00'], ['tr_3', '2026-10-05T09:00:00+00:00'],
    ['tr_2', '2026-09-05T09:00:00+00:00'], ['tr_1', '2026-08-05T09:00:00+00:00'],
  )
  const ok = monde({ paiements: page, enregistres: ['tr_4', 'tr_3', 'tr_2'] })
  eq((await arret(ok)).status, 200)
  eq(ok.appels.includes(`paiementsEnregistres:${GYM}:tr_4,tr_3,tr_2`), true)
  const manque = monde({ paiements: page, enregistres: ['tr_4', 'tr_2'] })
  eq((await arret(manque)).body.code, 'RENEWAL_NOT_RECORDED')
})

Deno.test('c) aucun paiement payé : l’arrêt passe, sans lecture des paiements enregistrés', async () => {
  for (const p of [paiements(), paiements('failed', 'expired')]) {
    const m = monde({ paiements: p })
    eq((await arret(m)).status, 200)
    eq(m.appels.some((a) => a.startsWith('paiementsEnregistres')), false)
  }
  // Abonnement disparu chez Mollie (404) : rien à vérifier non plus.
  const parti = monde({ paiements: { http: 404, body: '' } })
  eq((await arret(parti)).status, 200)
  eq(parti.appels.some((a) => a.startsWith('paiementsEnregistres')), false)
})

Deno.test('d) panne de lecture Mollie : MOLLIE_READ_FAILED, jamais de passage', async () => {
  for (const p of [{ http: 500, body: '' }, { http: 200, body: '<html>' }, new Error('réseau'),
    { http: 200, body: JSON.stringify({ _embedded: { payments: [{ status: 'paid', createdAt: '2026-11-05T09:00:00+00:00' }] } }) }]) {
    for (const dry_run of [false, true]) {
      const m = monde({ paiements: p })
      const r = await arret(m, { subscription_id: SUB_ID, reason: 'x', dry_run })
      eq([r.status, r.body.code], [502, 'MOLLIE_READ_FAILED'], String(dry_run))
      eq(m.appels.some((a) => a.startsWith('paiementsEnregistres')), false)
      aucuneEcriture(m)
    }
  }
})

Deno.test('lecture de NOS paiements en panne (erreur ou exception) : 500, rien n’est modifié, jamais de passage', async () => {
  for (const erreurEnregistres of ['timeout', new Error('base')]) {
    const m = monde({ erreurEnregistres })
    const r = await arret(m)
    eq([r.status, r.body.code], [500, 'SERVER_ERROR'])
    eq(m.compte('mollieStatut'), 0)
    aucuneEcriture(m)
  }
})

Deno.test('abonnement entièrement payé (next_payment_at nul) : un paid récent enregistré ne bloque pas', async () => {
  const m = monde({ sub: { ...SUB, next_payment_at: null, payments_count: 12 }, paiements: payes(['tr_der', '2026-11-25T08:00:00+00:00']), reservations: [] })
  const r = await arret(m)
  eq([r.status, r.body.ends_at], [200, SUB.ends_at])
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
    { http: 500, body: '' }, { http: 401, body: '' },
    { http: 200, body: '<html>' }, { http: 200, body: '{}' },
    new Error('délai dépassé'),
  ]
  for (const p of cas) {
    for (const dry_run of [false, true]) {
      const m = monde({ paiements: p })
      const r = await arret(m, { subscription_id: SUB_ID, reason: 'x', dry_run })
      eq([r.status, r.body.code], [502, 'MOLLIE_READ_FAILED'], JSON.stringify(p))
      eq(m.compte('mollieStatut'), 0)
      aucuneEcriture(m)
    }
  }
})

Deno.test('paiements en 404 ou 410 : abonnement introuvable (ou disparu) chez Mollie, on continue', async () => {
  for (const http of [404, 410]) {
    const m = monde({ paiements: { http, body: '' }, statut: { http, body: '' } })
    const r = await arret(m)
    eq([r.status, r.body.mollie], [200, 'already_gone'], String(http))
    eq(m.compte('mollieDelete'), 0)
    eq(m.compte('updateSub'), 1)
  }
})

Deno.test('pas de jeton Mollie : 502 MOLLIE_NOT_CONNECTED, aucun appel Mollie, aucune écriture', async () => {
  for (const dry_run of [false, true]) {
    const m = monde({ jeton: null })
    const r = await arret(m, { subscription_id: SUB_ID, reason: 'x', dry_run })
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

Deno.test('DELETE refusé : le journal porte le statut HTTP, jamais le corps de la réponse', async () => {
  const m = monde({ suppression: { http: 422, body: JSON.stringify({ detail: 'CORPS-MOLLIE customer cst_x' }) } })
  await arret(m)
  const refuse = m.logs.filter((l) => l.niveau === 'error')
  eq(refuse.length, 1)
  eq(refuse[0].detail, { subscription_id: SUB_ID, gym_id: GYM, http: 422 })
  if (JSON.stringify(m.logs).includes('CORPS-MOLLIE')) throw new Error(JSON.stringify(m.logs))
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
    'lireAbonnement', 'lireFuseau', `lireReservations:${MEMBER_ID}:${GYM}:${ENDS_AT}`, 'jetonMollie',
    'molliePaiements', `paiementsEnregistres:${GYM}:tr_p1,tr_p2`, 'mollieStatut', 'mollieDelete', 'updateSub', 'journal',
    'cancelBooking:b1', 'cancelBooking:b2', 'completerJournal', 'notification', 'email',
  ])
  eq(m.patches[0], {
    status: 'canceling', auto_renew: false, cancelled_at: NOW.toISOString(),
    cancellation_reason: 'stopped_by_gym', ends_at: ENDS_AT, next_payment_at: null,
    prenotification_sent_at: null, updated_at: NOW.toISOString(),
  })
  eq([m.journaux[0].gym_id, m.journaux[0].admin_id, m.journaux[0].target_id, m.journaux[0].action_type, m.journaux[0].reason],
    [GYM, 'admin-1', MEMBER_ID, 'subscription_cancel', 'déménagement'])
  eq(m.compte('alerte'), 0)
})

Deno.test('chaque annulation est verrouillée sur la salle et le membre de l’abonnement', async () => {
  const m = monde()
  await arret(m)
  eq(m.refs, [
    { id: 'b1', slot_id: 'slot-b1', status: 'confirmed', gym_id: GYM, member_id: MEMBER_ID },
    { id: 'b2', slot_id: 'slot-b2', status: 'waitlisted', gym_id: GYM, member_id: MEMBER_ID },
  ])
})

Deno.test('écritures et relecture service_role : chacune reçoit la salle de l’appelant', async () => {
  const m = monde()
  await arret(m)
  eq(m.verrous, [`updateSub:${GYM}`, `completerJournal:${GYM}`])
  const course = monde({ ecriture: { error: null, touched: 0 }, relu: { status: 'canceling', cancellation_reason: 'stopped_by_gym', ends_at: ENDS_AT } })
  await arret(course)
  eq(course.verrous, [`updateSub:${GYM}`, `relireSub:${GYM}`])
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
  eq(m.compte('lireReservations'), 1, 'pas de reprise ici : l’autre appel est en train de faire ce travail')
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
  eq(m.alertes[0].detail, { subscription_id: SUB_ID, failed_bookings: [{ id: 'b1', error: 'STATUS_CHANGED' }, { id: 'b3', error: 'UPDATE_FAILED' }] })
  eq(m.compte('notification'), 1, 'le membre est prévenu quand même')
  const complement = m.journaux[1]
  eq(complement.failed_bookings, r.body.failed_bookings)
})

Deno.test('aucune alerte ne porte l’identité du membre ni le motif saisi', async () => {
  const m = monde({ ecriture: { error: 'deadlock', touched: 0 } })
  await arret(m, { subscription_id: SUB_ID, reason: 'MOTIF-SECRET' })
  const texte = JSON.stringify(m.alertes)
  if (texte.includes('MOTIF-SECRET') || texte.includes(MEMBER_ID)) throw new Error(texte)
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
