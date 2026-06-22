import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { type TestResult, printReport } from './rls-report.js'

// ─── Config ────────────────────────────────────────────────────
const SUPABASE_URL = 'https://buovgpokubrkejunmauq.supabase.co'
// GYM-72 — clé anon de test lue depuis l'environnement (voir apps/dashboard/.env.test, gitignoré).
const SUPABASE_ANON_KEY = process.env.STAGING_ANON_KEY
if (!SUPABASE_ANON_KEY) {
  throw new Error('STAGING_ANON_KEY manquant — définis-le dans apps/dashboard/.env.test (gitignoré) ou l\'environnement')
}

const MOVE95_ID = 'a0000000-0000-0000-0000-000000000001'
const STUDIO_TEST_ID = 'b0000000-0000-0000-0000-000000000002'

const MOVE95_EMAIL = 'test-move95@gymbook.test'
const MOVE95_PASSWORD = 'TestMove95!2026'
const STUDIO_EMAIL = 'test-studiotest@gymbook.test'
const STUDIO_PASSWORD = 'TestStudio!2026'

// ─── Helpers ───────────────────────────────────────────────────
async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`Auth failed for ${email}: ${error.message}`)
  return client
}

function test(
  name: string,
  passed: boolean,
  expected: string,
  actual: string,
  critical = true,
): TestResult {
  return { name, passed, expected, actual, critical }
}

// ─── Test Suites ───────────────────────────────────────────────
async function testGymIsolation(
  move95: SupabaseClient,
  studio: SupabaseClient,
): Promise<TestResult[]> {
  const results: TestResult[] = []

  // Move95 sees only Move95
  const { data: m95gyms } = await move95.from('nexxia_gyms').select('id')
  results.push(test(
    'Move95 admin sees ONLY Move95 gym',
    m95gyms?.length === 1 && m95gyms[0].id === MOVE95_ID,
    '1 row (Move95)',
    `${m95gyms?.length ?? 0} rows${m95gyms?.[0]?.id ? ` (${m95gyms[0].id})` : ''}`,
  ))

  // Studio Test sees only Studio Test
  const { data: stGyms } = await studio.from('nexxia_gyms').select('id')
  results.push(test(
    'Studio Test admin sees ONLY Studio Test gym',
    stGyms?.length === 1 && stGyms[0].id === STUDIO_TEST_ID,
    '1 row (Studio Test)',
    `${stGyms?.length ?? 0} rows${stGyms?.[0]?.id ? ` (${stGyms[0].id})` : ''}`,
  ))

  // Cross-tenant: Move95 can't see Studio Test
  const { data: m95cross } = await move95.from('nexxia_gyms').select('id').eq('id', STUDIO_TEST_ID)
  results.push(test(
    'Move95 admin CANNOT see Studio Test gym',
    m95cross?.length === 0,
    '0 rows',
    `${m95cross?.length ?? 0} rows`,
  ))

  // Cross-tenant: Studio Test can't see Move95
  const { data: stCross } = await studio.from('nexxia_gyms').select('id').eq('id', MOVE95_ID)
  results.push(test(
    'Studio Test admin CANNOT see Move95 gym',
    stCross?.length === 0,
    '0 rows',
    `${stCross?.length ?? 0} rows`,
  ))

  return results
}

async function testTableIsolation(
  move95: SupabaseClient,
  studio: SupabaseClient,
  table: string,
  label: string,
  expectedMove95Count: number,
): Promise<TestResult[]> {
  const results: TestResult[] = []

  // Move95 sees only its own rows
  const { data: m95rows } = await move95.from(table).select('id, gym_id')
  const m95count = m95rows?.length ?? 0
  const allOwnGym = m95rows?.every((r: { gym_id: string }) => r.gym_id === MOVE95_ID) ?? true
  results.push(test(
    `Move95 admin sees ONLY its ${label} (${expectedMove95Count} expected)`,
    m95count === expectedMove95Count && allOwnGym,
    `${expectedMove95Count} rows, all gym_id=Move95`,
    `${m95count} rows${allOwnGym ? '' : ', MIXED GYM IDS!'}`,
  ))

  // Studio Test sees 0 rows
  const { data: stRows } = await studio.from(table).select('id')
  results.push(test(
    `Studio Test admin sees 0 ${label}`,
    (stRows?.length ?? 0) === 0,
    '0 rows',
    `${stRows?.length ?? 0} rows`,
  ))

  return results
}

async function testCrossTenantRead(
  studio: SupabaseClient,
): Promise<TestResult[]> {
  const results: TestResult[] = []

  // Studio tries to read Move95 activities by gym_id filter
  const { data: stAct } = await studio.from('activities').select('id').eq('gym_id', MOVE95_ID)
  results.push(test(
    'Studio Test CANNOT read Move95 activities (explicit gym_id filter)',
    (stAct?.length ?? 0) === 0,
    '0 rows (RLS blocks)',
    `${stAct?.length ?? 0} rows`,
  ))

  // Studio tries to read Move95 coaches by gym_id filter
  const { data: stCoach } = await studio.from('coaches').select('id').eq('gym_id', MOVE95_ID)
  results.push(test(
    'Studio Test CANNOT read Move95 coaches (explicit gym_id filter)',
    (stCoach?.length ?? 0) === 0,
    '0 rows (RLS blocks)',
    `${stCoach?.length ?? 0} rows`,
  ))

  // Studio tries to read Move95 plans
  const { data: stPlans } = await studio.from('gym_plans').select('id').eq('gym_id', MOVE95_ID)
  results.push(test(
    'Studio Test CANNOT read Move95 plans (explicit gym_id filter)',
    (stPlans?.length ?? 0) === 0,
    '0 rows (RLS blocks)',
    `${stPlans?.length ?? 0} rows`,
  ))

  // Studio tries to read Move95 member subscriptions
  const { data: stSubs } = await studio.from('member_subscriptions').select('id').eq('gym_id', MOVE95_ID)
  results.push(test(
    'Studio Test CANNOT read Move95 subscriptions',
    (stSubs?.length ?? 0) === 0,
    '0 rows (RLS blocks)',
    `${stSubs?.length ?? 0} rows`,
  ))

  return results
}

async function testCrossTenantWrite(
  studio: SupabaseClient,
): Promise<TestResult[]> {
  const results: TestResult[] = []

  // Studio tries to INSERT an activity into Move95
  const { error: insertErr } = await studio.from('activities').insert({
    gym_id: MOVE95_ID,
    name: 'HACKED ACTIVITY',
    slug: 'hacked',
    duration_min: 60,
    default_capacity: 10,
  })
  results.push(test(
    'Studio Test CANNOT INSERT activity into Move95',
    !!insertErr,
    'Error (RLS blocks insert)',
    insertErr ? `Blocked: ${insertErr.code}` : 'NO ERROR — INSERT SUCCEEDED!',
  ))

  // Studio tries to UPDATE Move95 coaches
  const { count } = await studio
    .from('coaches')
    .update({ name: 'HACKED' })
    .eq('gym_id', MOVE95_ID)
    .select('id', { count: 'exact', head: true })
  results.push(test(
    'Studio Test CANNOT UPDATE Move95 coaches',
    (count ?? 0) === 0,
    '0 rows affected',
    `${count ?? 0} rows affected`,
  ))

  // Studio tries to DELETE Move95 activities
  const { count: delCount } = await studio
    .from('activities')
    .delete()
    .eq('gym_id', MOVE95_ID)
    .select('id', { count: 'exact', head: true })
  results.push(test(
    'Studio Test CANNOT DELETE Move95 activities',
    (delCount ?? 0) === 0,
    '0 rows affected',
    `${delCount ?? 0} rows affected`,
  ))

  return results
}

// ─── Main ──────────────────────────────────────────────────────
async function main() {
  console.log('Authenticating test users...')

  let move95: SupabaseClient
  let studio: SupabaseClient

  try {
    move95 = await signIn(MOVE95_EMAIL, MOVE95_PASSWORD)
    console.log('  Move95 admin: authenticated')
  } catch (e) {
    console.error(`  Move95 auth FAILED: ${e}`)
    process.exit(1)
  }

  try {
    studio = await signIn(STUDIO_EMAIL, STUDIO_PASSWORD)
    console.log('  Studio Test admin: authenticated')
  } catch (e) {
    console.error(`  Studio Test auth FAILED: ${e}`)
    process.exit(1)
  }

  const results: TestResult[] = []

  // 1. Gym isolation
  console.log('\nRunning gym isolation tests...')
  results.push(...await testGymIsolation(move95, studio))

  // 2. Table isolation
  console.log('Running table isolation tests...')
  results.push(...await testTableIsolation(move95, studio, 'activities', 'activities', 8))
  results.push(...await testTableIsolation(move95, studio, 'coaches', 'coaches', 5))
  results.push(...await testTableIsolation(move95, studio, 'time_slots', 'time slots', 0))
  results.push(...await testTableIsolation(move95, studio, 'bookings', 'bookings', 0))
  results.push(...await testTableIsolation(move95, studio, 'gym_plans', 'plans', 4))
  results.push(...await testTableIsolation(move95, studio, 'member_subscriptions', 'subscriptions', 0))

  // 3. Cross-tenant read attacks
  console.log('Running cross-tenant read tests...')
  results.push(...await testCrossTenantRead(studio))

  // 4. Cross-tenant write attacks
  console.log('Running cross-tenant write tests...')
  results.push(...await testCrossTenantWrite(studio))

  // Report
  const allPassed = printReport(results)
  process.exit(allPassed ? 0 : 1)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
