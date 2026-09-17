// ╔═══════════════════════════════════════════════════════════════════════════════════════╗
// ║  BANC D'ISOLATION RLS — deux salles, deux gérants, les deux sens                      ║
// ╚═══════════════════════════════════════════════════════════════════════════════════════╝
//
//     npx tsx src/tests/rls-isolation.test.ts        (depuis apps/dashboard)
//
// ⚠️ IL ÉCRIT. Les tentatives d'écriture inter-locataires visent DÉLIBÉRÉMENT « Studio Yoga
// Test 1 » — 1 activité, 1 coach, 6 créneaux, 0 réservation. Si les RLS lâchaient, le dégât
// y serait minime et sans cascade. Ne PAS rediriger ces tests vers « Dopamine (Staging
// Clone) » : ses 2 activités portent 293 créneaux et 28 réservations (GYM-350).
//
// ─── CE QUE GYM-350 A CORRIGÉ, ET POURQUOI C'EST ÉCRIT ICI ────────────────────────────
//
// Ce banc était vert et ne prouvait RIEN. Trois défauts superposés, tous de la même
// famille — une preuve qui ne peut pas échouer :
//
//   1. Les identifiants de salles pointaient sur `a0000000-…-0001` (la salle de PRODUCTION)
//      et `b0000000-…-0002` (inexistante partout). Toute lecture « inter-locataires »
//      interrogeait une salle absente de staging : 0 ligne, toujours, RLS ou pas.
//   2. `.select('id', { count: 'exact', head: true })` après `.update()`/`.delete()` : sur un
//      PostgrestTransformBuilder, `select` n'accepte QU'UN argument et ignore le second.
//      `count` restait `null`, et `(count ?? 0) === 0` était vrai même RLS grandes ouvertes.
//   3. Des compteurs EN DUR (« 8 activities », « 5 coaches ») périmés, et une assertion
//      « l'autre gérant voit 0 ligne AU TOTAL » qui n'était pas un test d'isolation mais une
//      hypothèse de jeu de données — fausse dès que l'autre salle contient quoi que ce soit.
//
// Les leçons sont inscrites dans le code :
//   · aucun compteur en dur — on vérifie que TOUTES les lignes vues portent SON gym_id ;
//   · toute assertion dont la cible est vide est marquée `vacuous` et comptée à part ;
//   · l'INSERT doit échouer avec le code 42501 (refus RLS), pas « une erreur quelconque ».
//
// Voir docs/ops/preuves-controle-de-types.md et docs/recettes/GYM-350.md.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { type TestResult, printReport } from './rls-report.js'

// ─── Config ────────────────────────────────────────────────────
const SUPABASE_URL = 'https://buovgpokubrkejunmauq.supabase.co'

// Salles mesurées en staging le 17/09/2026 — NE PAS deviner ces valeurs.
const CLONE_ID = 'a0000000-0000-0000-0000-0000000005ba' // Dopamine (Staging Clone)
const YOGA_ID = '96294d6f-9b91-4e65-803c-a610547d0aaa' // Studio Yoga Test 1

const TABLES = ['activities', 'coaches', 'time_slots', 'bookings', 'gym_plans', 'member_subscriptions'] as const
type Table = (typeof TABLES)[number]

// Identifiants lus depuis l'environnement (apps/dashboard/.env.test, gitignoré), jamais en dur.
const SUPABASE_ANON_KEY = process.env.STAGING_ANON_KEY
if (!SUPABASE_ANON_KEY) {
  throw new Error('STAGING_ANON_KEY manquant — définis-le dans apps/dashboard/.env.test (gitignoré) ou l\'environnement')
}

const ADMIN_CLONE_EMAIL = process.env.STAGING_ADMIN_CLONE_EMAIL
const ADMIN_CLONE_PASSWORD = process.env.STAGING_ADMIN_CLONE_PASSWORD
const ADMIN_YOGA_EMAIL = process.env.STAGING_ADMIN_YOGA_EMAIL
const ADMIN_YOGA_PASSWORD = process.env.STAGING_ADMIN_YOGA_PASSWORD
if (!ADMIN_CLONE_EMAIL || !ADMIN_CLONE_PASSWORD || !ADMIN_YOGA_EMAIL || !ADMIN_YOGA_PASSWORD) {
  throw new Error('STAGING_ADMIN_CLONE_EMAIL / STAGING_ADMIN_CLONE_PASSWORD / STAGING_ADMIN_YOGA_EMAIL / STAGING_ADMIN_YOGA_PASSWORD manquant — définis-les dans apps/dashboard/.env.test (gitignoré) ou l\'environnement')
}

// GYM-350 — alias resserrés. Les gardes ci-dessus suffisent à l'exécution, mais pas au
// contrôle de types : les fonctions ci-dessous sont des DÉCLARATIONS, donc hoistées, et le
// resserrement obtenu ici au niveau du module ne les traverse pas. Aucun changement de
// comportement.
const ANON_KEY: string = SUPABASE_ANON_KEY
const CLONE_USER: string = ADMIN_CLONE_EMAIL
const CLONE_PASS: string = ADMIN_CLONE_PASSWORD
const YOGA_USER: string = ADMIN_YOGA_EMAIL
const YOGA_PASS: string = ADMIN_YOGA_PASSWORD

// ─── Helpers ───────────────────────────────────────────────────
interface Actor {
  label: string
  gymId: string
  client: SupabaseClient
  /** Lignes visibles par table, MESURÉES à l'exécution — aucun compteur en dur. */
  counts: Record<Table, number>
}

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, ANON_KEY)
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
  vacuous = false,
): TestResult {
  return { name, passed, expected, actual, critical, vacuous }
}

async function buildActor(label: string, gymId: string, email: string, password: string): Promise<Actor> {
  const client = await signIn(email, password)
  const counts = {} as Record<Table, number>
  for (const t of TABLES) {
    const { data } = await client.from(t).select('id')
    counts[t] = data?.length ?? 0
  }
  return { label, gymId, client, counts }
}

// ─── 1. Isolation des salles ───────────────────────────────────
async function testGymIsolation(a: Actor, b: Actor): Promise<TestResult[]> {
  const results: TestResult[] = []

  for (const [self, other] of [[a, b], [b, a]] as const) {
    const { data: own } = await self.client.from('nexxia_gyms').select('id')
    results.push(test(
      `${self.label} ne voit QUE sa salle`,
      own?.length === 1 && own[0].id === self.gymId,
      `1 ligne (${self.gymId})`,
      `${own?.length ?? 0} ligne(s)${own?.[0]?.id ? ` (${own[0].id})` : ''}`,
    ))

    const { data: cross } = await self.client.from('nexxia_gyms').select('id').eq('id', other.gymId)
    results.push(test(
      `${self.label} NE VOIT PAS la salle de ${other.label}`,
      (cross?.length ?? 0) === 0,
      '0 ligne',
      `${cross?.length ?? 0} ligne(s)`,
    ))
  }

  return results
}

// ─── 2. Toutes les lignes vues portent SON gym_id ──────────────
// Remplace les compteurs en dur : cette formulation ne périme pas quand le jeu de données
// change. Marquée « à vide » quand la table ne contient aucune ligne visible.
async function testOwnRowsOnly(actor: Actor): Promise<TestResult[]> {
  const results: TestResult[] = []

  for (const t of TABLES) {
    const { data: rows, error } = await actor.client.from(t).select('id, gym_id')
    const n = rows?.length ?? 0
    const strays = (rows ?? []).filter((r: { gym_id: string }) => r.gym_id !== actor.gymId)
    results.push(test(
      `${actor.label} — toutes ses lignes ${t} portent SON gym_id`,
      !error && strays.length === 0,
      `toutes gym_id=${actor.gymId}`,
      error
        ? `ERREUR ${error.code}`
        : n === 0
          ? `0 ligne visible — la table est vide pour ce gérant, l'assertion ne prouve rien`
          : `${n} ligne(s), ${strays.length} étrangère(s)`,
      true,
      n === 0,
    ))
  }

  return results
}

// ─── 3. Lecture inter-locataires ───────────────────────────────
// `victim.counts[t]` mesure ce qu'il Y AVAIT à protéger. Zéro ⇒ assertion à vide.
async function testCrossTenantRead(attacker: Actor, victim: Actor): Promise<TestResult[]> {
  const results: TestResult[] = []

  for (const t of TABLES) {
    const { data } = await attacker.client.from(t).select('id').eq('gym_id', victim.gymId)
    const n = data?.length ?? 0
    const toProtect = victim.counts[t]
    results.push(test(
      `${attacker.label} NE LIT PAS les ${t} de ${victim.label}`,
      n === 0,
      '0 ligne (RLS bloque)',
      toProtect === 0
        ? `0 ligne — mais ${victim.label} n'a AUCUNE ligne ${t} : rien à protéger, l'assertion ne prouve rien`
        : `${n} ligne(s) sur ${toProtect} à protéger`,
      true,
      toProtect === 0,
    ))
  }

  return results
}

// ─── 4. Écriture inter-locataires ──────────────────────────────
// ⚠️ Les tentatives DESTRUCTRICES (UPDATE/DELETE) ne visent QUE Studio Yoga Test 1.
// Voir l'avertissement en tête de fichier.
async function testCrossTenantInsert(attacker: Actor, victim: Actor): Promise<TestResult[]> {
  const { data: inserted, error } = await attacker.client
    .from('activities')
    .insert({ gym_id: victim.gymId, name: 'HACKED ACTIVITY', slug: `hacked-${Date.now()}`, duration_min: 60, default_capacity: 10 })
    .select('id')

  // Si l'INSERT a RÉUSSI, c'est une faille — on retire la ligne pour ne pas polluer staging.
  let cleanup = ''
  if (!error && inserted?.length) {
    const { error: delErr } = await attacker.client.from('activities').delete().eq('id', inserted[0].id)
    cleanup = delErr ? ' (ligne insérée NON nettoyée !)' : ' (ligne insérée retirée)'
  }

  // On exige le refus RLS (42501), pas « une erreur quelconque » : une violation NOT NULL ou
  // de clé étrangère passerait pour une preuve d'isolation alors qu'elle n'en est pas une.
  return [test(
    `${attacker.label} N'INSÈRE PAS d'activité chez ${victim.label}`,
    error?.code === '42501',
    'refus RLS (42501)',
    error ? `erreur ${error.code} — ${error.message}` : `INSERT ACCEPTÉ !${cleanup}`,
  )]
}

async function testCrossTenantWrite(attacker: Actor, victim: Actor): Promise<TestResult[]> {
  const results: TestResult[] = []

  results.push(...await testCrossTenantInsert(attacker, victim))

  // ⚠️ On compte les lignes RENVOYÉES, pas `count`. Après `.update()`/`.delete()` on est sur
  // un PostgrestTransformBuilder, dont `select(columns)` n'accepte QU'UN argument et ignore
  // silencieusement `{ count, head }` : `count` restait `null`, et l'assertion était vraie
  // quoi qu'il arrive (GYM-350). `.select('id')` pose `Prefer: return=representation` :
  // la liste renvoyée est celle des lignes RÉELLEMENT touchées — vide quand RLS bloque.
  const { data: updRows, error: updErr } = await attacker.client
    .from('coaches')
    .update({ name: 'HACKED' })
    .eq('gym_id', victim.gymId)
    .select('id')
  results.push(test(
    `${attacker.label} NE MODIFIE PAS les coaches de ${victim.label}`,
    !!updErr || (updRows?.length ?? 0) === 0,
    '0 ligne touchée',
    updErr
      ? `bloqué : ${updErr.code}`
      : `${updRows?.length ?? 0} ligne(s) touchée(s) sur ${victim.counts.coaches} à protéger`,
    true,
    victim.counts.coaches === 0,
  ))

  const { data: delRows, error: delErr } = await attacker.client
    .from('activities')
    .delete()
    .eq('gym_id', victim.gymId)
    .select('id')
  results.push(test(
    `${attacker.label} NE SUPPRIME PAS les activities de ${victim.label}`,
    !!delErr || (delRows?.length ?? 0) === 0,
    '0 ligne touchée',
    delErr
      ? `bloqué : ${delErr.code}`
      : `${delRows?.length ?? 0} ligne(s) touchée(s) sur ${victim.counts.activities} à protéger`,
    true,
    victim.counts.activities === 0,
  ))

  return results
}

// ─── Main ──────────────────────────────────────────────────────
async function main() {
  console.log('Authentification des deux gérants...')

  let clone: Actor
  let yoga: Actor

  try {
    clone = await buildActor('admin Dopamine (Clone)', CLONE_ID, CLONE_USER, CLONE_PASS)
    console.log(`  admin Dopamine (Clone) : authentifié — ${JSON.stringify(clone.counts)}`)
  } catch (e) {
    console.error(`  admin Dopamine (Clone) ECHEC : ${e}`)
    process.exit(1)
  }

  try {
    yoga = await buildActor('admin Studio Yoga', YOGA_ID, YOGA_USER, YOGA_PASS)
    console.log(`  admin Studio Yoga      : authentifié — ${JSON.stringify(yoga.counts)}`)
  } catch (e) {
    console.error(`  admin Studio Yoga ECHEC : ${e}`)
    process.exit(1)
  }

  const results: TestResult[] = []

  console.log('\nIsolation des salles...')
  results.push(...await testGymIsolation(clone, yoga))

  console.log('Lignes propres à chaque salle...')
  results.push(...await testOwnRowsOnly(clone))
  results.push(...await testOwnRowsOnly(yoga))

  console.log('Lecture inter-locataires (les deux sens)...')
  results.push(...await testCrossTenantRead(yoga, clone))
  results.push(...await testCrossTenantRead(clone, yoga))

  // ⚠️ ASYMÉTRIQUE ET VOULU. Sens Clone → Yoga : les trois tentatives, y compris les
  // destructrices, car Yoga est la cible sacrifiable. Sens Yoga → Clone : INSERT SEUL —
  // un UPDATE ou un DELETE sur Dopamine (Staging Clone) détruirait, en cas de faille, des
  // données portant 293 créneaux et 28 réservations.
  console.log('Écriture inter-locataires (destructrices sur Yoga uniquement)...')
  results.push(...await testCrossTenantWrite(clone, yoga))
  results.push(...await testCrossTenantInsert(yoga, clone))

  const allPassed = printReport(results)
  process.exit(allPassed ? 0 : 1)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
