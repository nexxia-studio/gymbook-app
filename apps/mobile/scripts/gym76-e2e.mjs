// GYM-76 — Test e2e couche d'achat front ↔ backend v24 STAGING (buovgpokubrkejunmauq).
// Staging only. Ne complète aucun paiement, n'écrit aucun backend, ne merge rien.
// Réplique fidèlement les helpers front (lib/payments.ts) et valide le contrat + le mapping i18n.
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const MOBILE = join(HERE, '..')

const URL = 'https://buovgpokubrkejunmauq.supabase.co'
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ1b3ZncG9rdWJya2VqdW5tYXVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MDI5OTYsImV4cCI6MjA5NDA3ODk5Nn0.ZPyZskhD-q_syBb4IL0hBNHCGp1eHO8vSQCUbMrWsqY'
const EMAIL = process.env.STAGING_TEST_EMAIL ?? 'test-move95@gymbook.test'
const PASSWORD = process.env.STAGING_TEST_PASSWORD ?? 'GymBookTest!2026'

const results = []
const ok = (id, cond, detail = '') => results.push({ id, pass: !!cond, detail })

// --- Répliques fidèles des helpers front (lib/payments.ts) ---
function buildRedirectUrl(source) { return `https://gymbook-app.vercel.app/mollie/callback?source=${source}` }
function formatPrice(priceCents, currency = 'EUR', lang = 'fr') {
  const value = (priceCents ?? 0) / 100
  try { return new Intl.NumberFormat(lang, { style: 'currency', currency }).format(value) }
  catch { return `${value.toFixed(2)} ${currency}` }
}
function oneTimeBody(gymId, planId) { return { gym_id: gymId, plan_id: planId, redirect_url: buildRedirectUrl('one_time') } }
function subBody(gymId, memberId, planId) { return { gym_id: gymId, member_id: memberId, plan_id: planId, redirect_url: buildRedirectUrl('subscription') } }
async function extractCode(data, error) {
  const ctx = error?.context
  if (ctx && typeof ctx.json === 'function') { try { const b = await ctx.json(); if (b?.code) return b.code } catch {} }
  return data?.code
}
async function invokeRaw(sb, fn, body) {
  const { data, error } = await sb.functions.invoke(fn, { body })
  const status = error?.context?.status ?? 200
  return { data, error, status, code: await extractCode(data, error) }
}

const sb = createClient(URL, ANON)

;(async () => {
  // ===== PRÉREQUIS — Auth =====
  const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (authErr || !auth?.user) {
    console.log(`\n🛑 BLOQUANT : pas de session test (${EMAIL}) — ${authErr?.message ?? 'no user'}`)
    console.log('Définis STAGING_TEST_EMAIL / STAGING_TEST_PASSWORD ou crée un membre test staging.')
    process.exit(2)
  }
  const memberId = auth.user.id
  const { data: prof } = await sb.from('profiles').select('gym_id').eq('id', memberId).single()
  const gymId = prof?.gym_id
  console.log(`Auth OK — member=${memberId} gym=${gymId}`)

  // ===== Données live (gym_plans, aucun UUID hardcodé) =====
  const { data: plans } = await sb.from('gym_plans')
    .select('id,name,billing_type,price_cents,currency,credit_count,duration_months')
    .eq('gym_id', gymId).eq('active', true).order('price_cents', { ascending: true })
  const oneTime = plans.filter(p => p.billing_type === 'one_time')
  const recurring = plans.filter(p => p.billing_type !== 'one_time')
  const planOneTime = oneTime[0]              // le moins cher (drop-in)
  const planRecurring = recurring[0]
  ok('PREREQ_plans', oneTime.length > 0 && recurring.length > 0, `one_time=${oneTime.length} recurring=${recurring.length}`)

  // ===== A1 — one-time =====
  {
    const body = oneTimeBody(gymId, planOneTime.id)
    const noForbidden = !('amount' in body) && !('payment_type' in body)
    const bodyShape = JSON.stringify(Object.keys(body).sort()) === JSON.stringify(['gym_id', 'plan_id', 'redirect_url'])
    const r = await invokeRaw(sb, 'create-payment', body)
    const mollie = typeof r.data?.checkout_url === 'string' && /mollie\.com/.test(r.data.checkout_url)
    ok('A1_body_no_amount_payment_type', noForbidden && bodyShape, JSON.stringify(body))
    ok('A1_success_checkout', r.data?.success === true && mollie, r.data?.checkout_url ?? r.code ?? 'no resp')
  }

  // ===== A2 — abonnement =====
  {
    const body = subBody(gymId, memberId, planRecurring.id)
    const bodyShape = JSON.stringify(Object.keys(body).sort()) === JSON.stringify(['gym_id', 'member_id', 'plan_id', 'redirect_url'])
    const r = await invokeRaw(sb, 'create-subscription', body)
    const mollie = typeof r.data?.checkout_url === 'string' && /mollie\.com/.test(r.data.checkout_url)
    ok('A2_body_shape', bodyShape, JSON.stringify(Object.keys(body)))
    ok('A2_success_customer_checkout', r.data?.success === true && !!r.data?.customer_id && mollie, r.data?.checkout_url ?? r.code ?? 'no resp')
  }

  // ===== A3 — prix via formatPrice, aucun prix en dur =====
  {
    let allFormatted = true
    const rendered = plans.map(p => {
      const f = formatPrice(p.price_cents, p.currency)
      const valOk = f.includes((p.price_cents / 100).toFixed(2).replace('.', ',')) || f.includes((p.price_cents / 100).toFixed(2))
      if (!valOk) allFormatted = false
      return `${p.name}=${f}`
    })
    ok('A3_formatPrice_each_plan', allFormatted, rendered.join(' | '))
    // aucun prix € en dur dans les surfaces d'achat
    const sub = readFileSync(join(MOBILE, 'app/profile/subscription.tsx'), 'utf8')
    const sheet = readFileSync(join(MOBILE, 'components/session/PaymentRequiredSheet.tsx'), 'utf8')
    const hardcoded = /\b\d{1,4}\s*€|DROP_IN_AMOUNT_EUR|const PLANS\b|price:\s*\d/
    ok('A3_no_hardcoded_price', !hardcoded.test(sub) && !hardcoded.test(sheet),
      `subscription:${hardcoded.test(sub) ? 'HARDCODE' : 'clean'} sheet:${hardcoded.test(sheet) ? 'HARDCODE' : 'clean'}`)
  }

  // ===== A4 — PaymentRequiredSheet : résolution drop-in (credit_count=1, le moins cher) =====
  {
    const dropIn = oneTime.filter(p => p.credit_count === 1).sort((a, b) => a.price_cents - b.price_cents)[0]
    const body = dropIn ? oneTimeBody(gymId, dropIn.id) : null
    const shapeOk = body && !('amount' in body) && !('payment_type' in body) && body.plan_id === dropIn.id
    ok('A4_dropin_resolved', !!dropIn && shapeOk, dropIn ? `${dropIn.name} (${dropIn.credit_count} crédit, ${formatPrice(dropIn.price_cents, dropIn.currency)})` : 'aucun plan credit_count=1')
    // preuve contrat backend (création d'un paiement pending, NON complété)
    if (body) {
      const r = await invokeRaw(sb, 'create-payment', body)
      ok('A4_create_payment_v24', r.data?.success === true, r.data?.checkout_url ?? r.code ?? 'no resp')
    }
  }

  // ===== PARTIE B — codes déclenchables en live =====
  const liveCases = [
    { id: 'B_MISSING_PLAN_ID', fn: 'create-payment', body: { gym_id: gymId, redirect_url: buildRedirectUrl('one_time') }, status: 400, code: 'MISSING_PLAN_ID' },
    { id: 'B_PLAN_NOT_ONE_TIME', fn: 'create-payment', body: oneTimeBody(gymId, planRecurring.id), status: 400, code: 'PLAN_NOT_ONE_TIME' },
    { id: 'B_PLAN_NOT_FOUND', fn: 'create-payment', body: oneTimeBody(gymId, '00000000-0000-0000-0000-000000000000'), status: 404, code: 'PLAN_NOT_FOUND' },
    { id: 'B_GYM_FORBIDDEN', fn: 'create-payment', body: oneTimeBody('11111111-1111-1111-1111-111111111111', planOneTime.id), status: 403, code: 'GYM_FORBIDDEN' },
  ]
  for (const c of liveCases) {
    const r = await invokeRaw(sb, c.fn, c.body)
    ok(c.id, r.status === c.status && r.code === c.code, `got status=${r.status} code=${r.code} (attendu ${c.status}/${c.code})`)
  }

  // ===== PARTIE B — unit : mapPaymentError (mapping réel) + clés i18n présentes fr & en =====
  {
    const fr = JSON.parse(readFileSync(join(MOBILE, 'locales/fr.json'), 'utf8'))
    const en = JSON.parse(readFileSync(join(MOBILE, 'locales/en.json'), 'utf8'))
    const get = (obj, path) => path.split('.').reduce((o, k) => (o ?? {})[k], obj)
    const src = readFileSync(join(MOBILE, 'lib/payments.ts'), 'utf8')
    // extraire toutes les clés retournées par le mapping réel
    const keys = [...src.matchAll(/messageKey:\s*'([^']+)'/g)].map(m => m[1])
    const uniqueKeys = [...new Set(keys)]
    // mapping attendu (codes non-déclenchables + fallback)
    const expected = {
      PLAN_MISCONFIGURED: 'payments.errors.PLAN_MISCONFIGURED',
      PAYMENTS_DISABLED: 'payments.errors.PAYMENTS_DISABLED',
      MOLLIE_TOKEN_EXPIRED: 'payments.errors.MOLLIE_TOKEN_EXPIRED',
      MOLLIE_ERROR: 'payments.errors.MOLLIE_ERROR',
      __fallback__: 'payments.errors.FALLBACK',
    }
    let mapOk = true
    for (const [code, key] of Object.entries(expected)) {
      const present = src.includes(`'${key}'`)
      if (!present) { mapOk = false; console.log(`  ✗ mapping ${code} -> ${key} absent du code`) }
    }
    ok('B_unit_map_codes', mapOk, Object.keys(expected).join(','))
    // toutes les clés i18n du mapping existent dans fr ET en
    const missing = uniqueKeys.filter(k => get(fr, k) == null || get(en, k) == null)
    ok('B_unit_i18n_keys_fr_en', missing.length === 0,
      missing.length ? `MANQUANTES: ${missing.join(', ')}` : `${uniqueKeys.length} clés OK (fr+en)`)
  }

  // ===== Rapport =====
  console.log('\n================ RAPPORT GYM-76 e2e ================')
  let pass = 0
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id}  — ${r.detail}`)
    if (r.pass) pass++
  }
  console.log(`---------------------------------------------------`)
  console.log(`${pass}/${results.length} PASS`)
  process.exit(results.every(r => r.pass) ? 0 : 1)
})().catch(e => { console.error('UNCAUGHT', e); process.exit(3) })
