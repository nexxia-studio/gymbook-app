// GYM-70 — Test de concurrence : réservation atomique (STAGING buovgpokubrkejunmauq UNIQUEMENT).
// Prouve : (A) pas de double-'confirmed' sur la dernière place, (B) débit crédit unique,
// (C) sélection FIFO (GYM-94, plus de faux 402), (D) réactivation symétrique avec cancel-booking.
//
// Pattern gym76-e2e.mjs : TOUS les secrets via env, AUCUN mot de passe en dur (repo public).
// Requiert (apps/mobile/.env.test gitignoré ou environnement) :
//   STAGING_ANON_KEY            — clé anon staging
//   STAGING_SERVICE_ROLE_KEY    — clé service_role staging (setup : comptes, slots, crédits)
//   GYM70_MEMBER_A_PASSWORD     — mot de passe NEUF compte test A
//   GYM70_MEMBER_B_PASSWORD     — mot de passe NEUF compte test B
// Optionnel : GYM70_MEMBER_A_EMAIL / GYM70_MEMBER_B_EMAIL
//
// Lancement : node apps/mobile/scripts/gym70-concurrency.mjs
import { createClient } from '@supabase/supabase-js'

const URL = 'https://buovgpokubrkejunmauq.supabase.co'
const GYM_ID = 'a0000000-0000-0000-0000-0000000005ba' // Dopamine (Staging Clone)
const ACTIVITY_ID = 'adb6b609-cd2c-405c-bb91-728e05b6a919' // HIIT / Hyrox (clone)

const ANON = process.env.STAGING_ANON_KEY
const SERVICE = process.env.STAGING_SERVICE_ROLE_KEY
const A_EMAIL = process.env.GYM70_MEMBER_A_EMAIL ?? 'test-gym70-a@staging.be'
const A_PASS = process.env.GYM70_MEMBER_A_PASSWORD
const B_EMAIL = process.env.GYM70_MEMBER_B_EMAIL ?? 'test-gym70-b@staging.be'
const B_PASS = process.env.GYM70_MEMBER_B_PASSWORD

for (const [k, v] of Object.entries({
  STAGING_ANON_KEY: ANON, STAGING_SERVICE_ROLE_KEY: SERVICE,
  GYM70_MEMBER_A_PASSWORD: A_PASS, GYM70_MEMBER_B_PASSWORD: B_PASS,
})) {
  if (!v) {
    console.error(`${k} manquant — définis-le dans apps/mobile/.env.test gitignoré ou l'environnement`)
    process.exit(2)
  }
}

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } })

const results = []
const check = (id, cond, detail = '') => { results.push({ id, pass: !!cond, detail }); console.log(`${cond ? 'PASS' : 'FAIL'}  ${id}${detail ? ' — ' + detail : ''}`) }

// ── Setup helpers (service_role) ──────────────────────────────────────────────
async function ensureMember(email, password) {
  // Cherche par email, sinon crée (email confirmé). Retourne l'user id.
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 })
  let u = list?.users?.find((x) => x.email === email)
  if (!u) {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (error) throw new Error(`createUser ${email}: ${error.message}`)
    u = data.user
  } else {
    // garantit le mot de passe courant (rotation depuis env)
    await admin.auth.admin.updateUserById(u.id, { password })
  }
  // profil membre rattaché au gym clone
  await admin.from('profiles').upsert({
    id: u.id, email, gym_id: GYM_ID, role: 'member', first_name: 'GYM70', last_name: email,
  }, { onConflict: 'id' })
  return u.id
}

async function setCredits(memberId, rows) {
  await admin.from('member_credits').delete().eq('member_id', memberId).eq('gym_id', GYM_ID)
  if (rows.length) {
    await admin.from('member_credits').insert(rows.map((r) => ({
      member_id: memberId, gym_id: GYM_ID,
      credits_total: r.total, credits_used: r.used ?? 0,
      created_at: r.createdAt, expires_at: r.expiresAt ?? null,
    })))
  }
}

async function creditsUsed(memberId) {
  const { data } = await admin.from('member_credits')
    .select('id, credits_total, credits_used, created_at').eq('member_id', memberId).eq('gym_id', GYM_ID)
    .order('created_at', { ascending: true })
  return data ?? []
}

async function createSlot(capacity, hoursFromNow = 2) {
  const starts = new Date(Date.now() + hoursFromNow * 3600 * 1000)
  const ends = new Date(starts.getTime() + 3600 * 1000)
  const { data, error } = await admin.from('time_slots').insert({
    gym_id: GYM_ID, activity_id: ACTIVITY_ID, capacity,
    starts_at: starts.toISOString(), ends_at: ends.toISOString(), status: 'scheduled',
  }).select('id').single()
  if (error) throw new Error(`createSlot: ${error.message}`)
  return data.id
}

async function resetSlotBookings(slotId) {
  await admin.from('bookings').delete().eq('slot_id', slotId)
}

async function subscriptionOff(memberId) {
  // s'assure qu'aucun abonnement actif ne court-circuite le débit crédit
  await admin.from('member_subscriptions').update({ status: 'cancelled' })
    .eq('member_id', memberId).eq('gym_id', GYM_ID).eq('status', 'active')
}

// ── Auth membre → JWT, puis appel HTTP réel de create-booking ─────────────────
async function tokenFor(email, password) {
  const client = createClient(URL, ANON, { auth: { persistSession: false } })
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`signIn ${email}: ${error.message}`)
  return data.session.access_token
}

async function book(token, slotId) {
  const res = await fetch(`${URL}/functions/v1/create-booking`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: ANON },
    body: JSON.stringify({ slot_id: slotId }),
  })
  const body = await res.json().catch(() => ({}))
  return { http: res.status, status: body.status, code: body.code, booking: body.booking }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
async function run() {
  const idA = await ensureMember(A_EMAIL, A_PASS)
  const idB = await ensureMember(B_EMAIL, B_PASS)
  await subscriptionOff(idA); await subscriptionOff(idB)
  const [tokA, tokB] = [await tokenFor(A_EMAIL, A_PASS), await tokenFor(B_EMAIL, B_PASS)]

  // ── Test A — course sur la dernière place (capacité 1), 5 itérations ──
  let aOk = true
  for (let i = 1; i <= 5; i++) {
    const slot = await createSlot(1)
    await setCredits(idA, [{ total: 5 }]); await setCredits(idB, [{ total: 5 }])
    const [rA, rB] = await Promise.all([book(tokA, slot), book(tokB, slot)])
    const confirmed = [rA, rB].filter((r) => r.status === 'confirmed').length
    const waitlisted = [rA, rB].filter((r) => r.status === 'waitlisted').length
    const ok = confirmed === 1 && waitlisted === 1
    aOk = aOk && ok
    console.log(`   A#${i}: confirmed=${confirmed} waitlisted=${waitlisted} (A=${rA.status ?? rA.code} B=${rB.status ?? rB.code})`)
    if (!ok) break

    // ── Test B (sur la 1ère itération) — débit unique ──
    if (i === 1) {
      const usedA = (await creditsUsed(idA)).reduce((s, r) => s + r.credits_used, 0)
      const usedB = (await creditsUsed(idB)).reduce((s, r) => s + r.credits_used, 0)
      const confirmedIsA = rA.status === 'confirmed'
      const usedConfirmed = confirmedIsA ? usedA : usedB
      const usedWaitlisted = confirmedIsA ? usedB : usedA
      check('B — débit unique (confirmed=1, waitlisted=0)', usedConfirmed === 1 && usedWaitlisted === 0,
        `confirmed=${usedConfirmed} waitlisted=${usedWaitlisted}`)
    }
    await resetSlotBookings(slot)
  }
  check('A — jamais 2 confirmed sur la dernière place (x5)', aOk)

  // ── Test C — FIFO : ligne ancienne épuisée + ligne récente pleine → OK, débit bonne ligne ──
  {
    const slot = await createSlot(1)
    await setCredits(idA, [
      { total: 3, used: 3, createdAt: '2026-01-01T00:00:00Z', expiresAt: '2027-01-01T00:00:00Z' }, // ancienne, ÉPUISÉE
      { total: 5, used: 0, createdAt: '2026-06-01T00:00:00Z', expiresAt: '2027-06-01T00:00:00Z' }, // récente, DISPO
    ])
    const r = await book(tokA, slot)
    const rows = await creditsUsed(idA)
    const old = rows.find((x) => x.credits_total === 3)
    const fresh = rows.find((x) => x.credits_total === 5)
    check('C — pas de faux 402 malgré ligne épuisée', r.status === 'confirmed', `status=${r.status ?? r.code}`)
    check('C — débit sur la ligne dispo (pas l\'épuisée)', old?.credits_used === 3 && fresh?.credits_used === 1,
      `old.used=${old?.credits_used} fresh.used=${fresh?.credits_used}`)
    await resetSlotBookings(slot)
  }

  // ── Test D — réactivation : book → cancel → re-book, 1 seul débit net ──
  {
    const slot = await createSlot(1)
    await setCredits(idA, [{ total: 5, used: 0, createdAt: '2026-06-01T00:00:00Z' }])
    const r1 = await book(tokA, slot)
    const usedAfterBook = (await creditsUsed(idA)).reduce((s, x) => s + x.credits_used, 0)
    // cancel via l'edge cancel-booking (slot > 2h → refund attendu)
    await fetch(`${URL}/functions/v1/cancel-booking`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokA}`, apikey: ANON },
      body: JSON.stringify({ booking_id: r1.booking?.id }),
    })
    const usedAfterCancel = (await creditsUsed(idA)).reduce((s, x) => s + x.credits_used, 0)
    const r2 = await book(tokA, slot)
    const usedAfterRebook = (await creditsUsed(idA)).reduce((s, x) => s + x.credits_used, 0)
    const { data: rows2 } = await admin.from('bookings').select('id, status').eq('slot_id', slot).eq('member_id', idA)
    check('D — re-book réutilise la ligne (1 seule booking row)', (rows2?.length ?? 0) === 1, `rows=${rows2?.length}`)
    check('D — 1 débit net après refund+rebook', usedAfterBook === 1 && usedAfterCancel === 0 && usedAfterRebook === 1,
      `book=${usedAfterBook} cancel=${usedAfterCancel} rebook=${usedAfterRebook}`)
    await resetSlotBookings(slot)
  }

  const failed = results.filter((r) => !r.pass)
  console.log(`\n${failed.length === 0 ? '✅ TOUS PASS' : '❌ ' + failed.length + ' FAIL'} (${results.length} checks)`)
  process.exit(failed.length === 0 ? 0 : 1)
}

run().catch((e) => { console.error('ERREUR:', e.message); process.exit(3) })
