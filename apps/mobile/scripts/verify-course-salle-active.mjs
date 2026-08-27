#!/usr/bin/env node
// GYM-292 — 🔴 LA COURSE, ÉPROUVÉE SANS APPAREIL.
//
// ═════════════════════════════════════════════════════════════════════════════════════
// POURQUOI CE SCRIPT PLUTÔT QU'UN TEST UNITAIRE
// ═════════════════════════════════════════════════════════════════════════════════════
// `apps/mobile` n'a AUCUNE infrastructure de test : ni jest, ni vitest, ni script `test`,
// ni un seul fichier de test. En monter une — preset jest-expo, babel de test, doublures
// pour supabase, zustand et AsyncStorage — pour éprouver un compteur de vingt lignes
// serait hors de proportion, et ajouterait une dépendance de build à une app gelée pour
// la QA.
//
// Ce que la course a de testable est PUR : `lib/activeGymWrites.ts` n'importe rien. Ce
// script compile ce seul fichier et l'exerce, en entrelaçant écritures et lectures — y
// compris au timing le PIRE, celui qu'un appareil ne produit qu'une fois sur cent.
//
// ⚠️ CE QU'IL NE COUVRE PAS, ET IL FAUT LE DIRE : il éprouve la RÈGLE (« aucune lecture
// n'abaisse la salle tant qu'une écriture est en vol »), pas son CÂBLAGE dans le store.
// Que `refreshProfile` consulte bien la garde se lit dans stores/useAuthStore.ts et se
// vérifie à la recette, pas ici.
//
// USAGE : node scripts/verify-course-salle-active.mjs
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = mkdtempSync(join(tmpdir(), 'gym292-'))

let module_
try {
  execFileSync('npx', [
    'tsc', join(ROOT, 'lib/activeGymWrites.ts'),
    '--outDir', out, '--module', 'esnext', '--target', 'es2020', '--skipLibCheck',
  ], { cwd: ROOT, stdio: 'pipe' })
  module_ = await import(pathToFileURL(join(out, 'activeGymWrites.js')).href)
} catch (e) {
  console.error('compilation impossible :', e.message)
  process.exit(2)
}

const { withActiveGymWrite, activeGymWriteInFlight, __resetActiveGymWrites } = module_

const attendre = (ms) => new Promise((r) => setTimeout(r, ms))
let echecs = 0
function verifie(nom, condition, detail) {
  if (condition) {
    console.log(`  ✓ ${nom}`)
  } else {
    console.log(`  ✗ ${nom}${detail ? ' — ' + detail : ''}`)
    echecs++
  }
}

console.log('\nRÈGLE : une lecture ne peut pas abaisser la salle tant qu’une écriture est en vol.\n')

// ── 1. Le cas nominal ────────────────────────────────────────────────────────────────
__resetActiveGymWrites()
verifie('au repos, aucune écriture en vol', activeGymWriteInFlight() === false)

// ── 2. 🔴 LE CAS QUI FAIT LE BUG : la lecture revient PENDANT l'écriture ─────────────
// C'est le scénario de R1 vu à l'envers — une lecture de profil partie avant la bascule
// et revenue après. Sans garde, elle réappliquerait la salle QUITTÉE.
__resetActiveGymWrites()
let vueParLaLecture = null
const ecriture = withActiveGymWrite(async () => {
  await attendre(30)
  return 'salle-B'
})
await attendre(10) // la lecture revient au milieu de l'écriture
vueParLaLecture = activeGymWriteInFlight()
await ecriture
verifie('pendant l’écriture, la lecture voit « en vol »', vueParLaLecture === true)
verifie('après l’écriture, la fenêtre est refermée', activeGymWriteInFlight() === false)

// ── 3. 🔴 DEUX ÉCRITURES QUI SE CHEVAUCHENT ──────────────────────────────────────────
// Le membre tape deux fois, ou la réconciliation croise un switch manuel. Un BOOLÉEN
// remettrait la garde à `false` à la fin de la PREMIÈRE — rouvrant la fenêtre alors que la
// seconde est encore en vol. C'est exactement l'erreur que ce test interdit.
__resetActiveGymWrites()
const lente = withActiveGymWrite(() => attendre(40))
const rapide = withActiveGymWrite(() => attendre(5))
await rapide
verifie('la rapide terminée, la lente maintient la garde', activeGymWriteInFlight() === true)
await lente
verifie('les deux terminées, la garde retombe', activeGymWriteInFlight() === false)

// ── 4. 🔴 UNE ÉCRITURE QUI ÉCHOUE DOIT REFERMER LA FENÊTRE ──────────────────────────
// Sans `finally`, la première erreur réseau condamnerait toutes les lectures suivantes à
// être ignorées : l'app resterait figée sur une salle jusqu'au prochain lancement.
__resetActiveGymWrites()
try {
  await withActiveGymWrite(async () => { throw new Error('réseau') })
} catch { /* attendu */ }
verifie('après un échec, la garde est refermée', activeGymWriteInFlight() === false)

// ── 5. TROIS ALLERS-RETOURS D'AFFILÉE ────────────────────────────────────────────────
// Le scénario de recette demandé, en accéléré : la garde doit être exactement fermée à la
// fin, sans dérive du compteur.
__resetActiveGymWrites()
for (let i = 0; i < 3; i++) {
  await Promise.all([
    withActiveGymWrite(() => attendre(3)),
    withActiveGymWrite(() => attendre(1)),
  ])
}
verifie('après trois allers-retours, compteur exactement à zéro', activeGymWriteInFlight() === false)

// ═════════════════════════════════════════════════════════════════════════════════════
// GYM-292b — LA RÉCONCILIATION D'OUVERTURE DE SESSION, AVEC UN CHOIX LOCAL
// ═════════════════════════════════════════════════════════════════════════════════════
// 🔴 CE QUE CETTE SECONDE MOITIÉ AURAIT ATTRAPÉ. La première version de
// `reconcileActiveGym` adoptait `profiles.gym_id` AVANT de regarder le choix du membre,
// et toute issue non-`ok` du switch — coupure réseau comprise — réécrivait le slug avec
// la salle du serveur. Le choix était perdu, définitivement. Aucun test ne le disait :
// il n'y en avait aucun sur cette fonction.
//
// On l'exerce donc en compilant le VRAI module et en substituant ses trois dépendances.
// ⚠️ CE SONT DES DOUBLURES, PAS LE SERVEUR : elles prouvent l'ORDRE et les BRANCHES, pas
// que la RPC répond. Le comportement réel se vérifie à la recette.
import { writeFileSync, mkdirSync } from 'node:fs'

const out2 = mkdtempSync(join(tmpdir(), 'gym292b-'))
let reconcile
try {
  execFileSync('npx', [
    'tsc', join(ROOT, 'lib/activeGymSession.ts'),
    '--outDir', out2, '--module', 'esnext', '--target', 'es2020',
    '--skipLibCheck', '--moduleResolution', 'bundler',
  ], { cwd: ROOT, stdio: 'pipe' })
} catch { /* d'autres fichiers du projet peuvent échouer : seul le nôtre compte */ }

const L = join(out2, 'lib')
const S = join(out2, 'stores')
mkdirSync(S, { recursive: true })

// Le module compilé importe sans extension ; Node en ESM les exige.
const compile = readFileSync(join(L, 'activeGymSession.js'), 'utf8')
  .replace(/from '(\.\.?\/[A-Za-z/]*)'/g, "from '$1.js'")
writeFileSync(join(L, 'activeGymSession.js'), compile)

writeFileSync(join(L, 'gymResolver.js'), `
export const trace = []
export let __slug = null
export const GYM_MODE = 'multi'
export function __setSlug(s) { __slug = s }
export async function readSelectedGymSlug() { return __slug }
export async function writeSelectedGymSlug(s) { __slug = s; trace.push('writeSlug(' + s + ')') }
`)
// ⚠️ L'analytique est une doublure vide : ce script prouve des DÉCISIONS, pas de la
// télémétrie. La journaliser vraiment ferait dépendre un test de PostHog.
writeFileSync(join(L, 'analytics.js'), 'export function captureEvent() {}\n')
writeFileSync(join(L, 'activeGymWrites.js'), `
let n = 0
export async function withActiveGymWrite(fn) { n++; try { return await fn() } finally { n-- } }
export function activeGymWriteInFlight() { return n > 0 }
`)
writeFileSync(join(L, 'gymSwitch.js'), `
import { trace, writeSelectedGymSlug } from './gymResolver.js'
import { useAuthStore } from '../stores/useAuthStore.js'
export let __gyms = []
export let __res = { status: 'ok' }
export function __setGyms(g) { __gyms = g }
export function __setRes(r) { __res = r }
export async function listMyGyms() { trace.push('listMyGyms'); return { status: 'ok', gyms: __gyms } }
export async function switchGym(g) {
  trace.push('switchGym(' + g.slug + ') → ' + __res.status)
  if (__res.status === 'ok') {
    await writeSelectedGymSlug(g.slug)
    useAuthStore.getState().setActiveGymConfirmed(g.gymId)
  }
  return __res
}
`)
writeFileSync(join(S, 'useAuthStore.js'), `
import { trace } from '../lib/gymResolver.js'
import { activeGymWriteInFlight } from '../lib/activeGymWrites.js'
let etat = { gym_id: null }
export let __serveur = null
export function __setServeur(id) { __serveur = id; etat.gym_id = null }
export function __gymId() { return etat.gym_id }
export const useAuthStore = {
  getState: () => ({
    refreshProfile: async () => {
      if (activeGymWriteInFlight()) { trace.push('refreshProfile (profil seul — salle NON adoptée)'); return }
      trace.push('refreshProfile → ADOPTE ' + __serveur); etat.gym_id = __serveur
    },
    setActiveGymConfirmed: (id) => { trace.push('setActiveGymConfirmed(' + id + ')'); etat.gym_id = id },
  }),
}
`)

const R = await import(pathToFileURL(join(L, 'gymResolver.js')).href)
const SW = await import(pathToFileURL(join(L, 'gymSwitch.js')).href)
const AU = await import(pathToFileURL(join(S, 'useAuthStore.js')).href)
const SESSION = await import(pathToFileURL(join(L, 'activeGymSession.js')).href)
reconcile = SESSION.reconcileActiveGym

const GYMS = [
  { gymId: 'g-studio', slug: 'studio-test-staging', name: 'Studio Test', logoUrl: null, isActive: false },
  { gymId: 'g-yoga', slug: 'studio-yoga-test-1', name: 'Yoga', logoUrl: null, isActive: false },
  { gymId: 'g-dopa', slug: 'dopamine-staging', name: 'Dopamine', logoUrl: null, isActive: false },
]

async function cas(nom, { slug, serveur, switchRes = { status: 'ok' }, attendu, salleAttendue, slugAttendu }) {
  R.trace.length = 0
  R.__setSlug(slug)
  AU.__setServeur(serveur)
  SW.__setGyms(GYMS.map((g) => ({ ...g, isActive: g.gymId === serveur })))
  SW.__setRes(switchRes)
  const res = await reconcile()
  const okStatut = res.status === attendu
  const okSalle = AU.__gymId() === salleAttendue
  const okSlug = R.__slug === slugAttendu
  // 🔴 L'ORDRE EST UNE ASSERTION À PART ENTIÈRE : aucune adoption du serveur ne doit
  // précéder la soumission du choix. C'est le défaut exact que ce lot corrige.
  const pasDAdoptionPrecoce = !R.trace.some((t) => t.startsWith('refreshProfile → ADOPTE'))
  const bon = okStatut && okSalle && okSlug && pasDAdoptionPrecoce
  if (!bon) echecs++
  console.log(`  ${bon ? '✓' : '✗'} ${nom}`)
  console.log(`      ${R.trace.join(' → ')}`)
  if (!bon) {
    console.log(`      attendu : ${attendu} / salle ${salleAttendue} / slug ${slugAttendu}`)
    console.log(`      obtenu  : ${res.status} / salle ${AU.__gymId()} / slug ${R.__slug}`)
    if (!pasDAdoptionPrecoce) console.log('      🔴 la salle du serveur a été adoptée AVANT la soumission du choix')
  }
}

console.log('\nRÉCONCILIATION : le choix pré-connexion l’emporte, sauf refus explicite du serveur.\n')

await cas('choix ACCEPTÉ — membre des 3 salles, serveur sur Dopamine', {
  slug: 'studio-test-staging', serveur: 'g-dopa',
  attendu: 'switched', salleAttendue: 'g-studio', slugAttendu: 'studio-test-staging',
})
await cas('choix ACCEPTÉ — deuxième salle, même compte', {
  slug: 'studio-yoga-test-1', serveur: 'g-dopa',
  attendu: 'switched', salleAttendue: 'g-yoga', slugAttendu: 'studio-yoga-test-1',
})
await cas('choix DÉJÀ actif — rien à basculer', {
  slug: 'dopamine-staging', serveur: 'g-dopa',
  attendu: 'aligned', salleAttendue: 'g-dopa', slugAttendu: 'dopamine-staging',
})
await cas('choix REFUSÉ (PT403) — le serveur garde la main, slug corrigé', {
  slug: 'studio-test-staging', serveur: 'g-dopa', switchRes: { status: 'not_a_member' },
  attendu: 'server_wins', salleAttendue: 'g-dopa', slugAttendu: 'dopamine-staging',
})
await cas('choix ABSENT — le serveur est la seule réponse', {
  slug: null, serveur: 'g-dopa',
  attendu: 'aligned', salleAttendue: 'g-dopa', slugAttendu: 'dopamine-staging',
})
// 🔴 LE CAS QUI DÉTRUISAIT LE CHOIX. Avant ce lot, une simple coupure retombait sur
// « le serveur fait foi » ET réécrivait le slug : le choix était perdu pour de bon.
await cas('INCIDENT RÉSEAU — le choix survit, rien n’est touché', {
  slug: 'studio-test-staging', serveur: 'g-dopa', switchRes: { status: 'offline' },
  attendu: 'unavailable', salleAttendue: null, slugAttendu: 'studio-test-staging',
})

// ═════════════════════════════════════════════════════════════════════════════════════
// GYM-298 — QUELLES ISSUES ARMENT LA REPRISE
// ═════════════════════════════════════════════════════════════════════════════════════
// 🔴 LA RÈGLE PURE QUE CE LOT AJOUTE, ET LA SEULE. Le déclencheur (AppState → active) n'est
// pas testable ici — il tient à React Native. Mais la question qu'il pose l'est
// entièrement : « faut-il réessayer ? » Et elle a une mauvaise réponse évidente, qu'il
// faut interdire : réessayer après un `server_wins` relancerait à CHAQUE retour de veille
// un `switch_active_gym` que le serveur vient de refuser — indéfiniment.
console.log('\nREPRISE : seule une issue INDÉCISE (`unavailable`) l’arme.\n')

async function arme(nom, opts, attendu) {
  SESSION.__resetReconcileState()
  R.trace.length = 0
  R.__setSlug(opts.slug)
  AU.__setServeur(opts.serveur)
  SW.__setGyms(GYMS.map((g) => ({ ...g, isActive: g.gymId === opts.serveur })))
  SW.__setRes(opts.switchRes ?? { status: 'ok' })
  const res = await reconcile()
  const obtenu = SESSION.activeGymNeedsRetry()
  const bon = obtenu === attendu
  if (!bon) echecs++
  console.log(`  ${bon ? '✓' : '✗'} ${nom} → ${res.status} : reprise ${obtenu ? 'ARMÉE' : 'au repos'}`)
  if (!bon) console.log(`      attendu : ${attendu ? 'ARMÉE' : 'au repos'}`)
}

await arme('bascule réussie', { slug: 'studio-test-staging', serveur: 'g-dopa' }, false)
await arme('déjà aligné', { slug: 'dopamine-staging', serveur: 'g-dopa' }, false)
await arme('refus explicite du serveur (PT403)',
  { slug: 'studio-test-staging', serveur: 'g-dopa', switchRes: { status: 'not_a_member' } }, false)
await arme('aucun choix local', { slug: null, serveur: 'g-dopa' }, false)
await arme('🔴 incident réseau',
  { slug: 'studio-test-staging', serveur: 'g-dopa', switchRes: { status: 'offline' } }, true)

// 🔴 ET ELLE SE DÉSARME QUAND LA REPRISE ABOUTIT. Sans cela, chaque retour de veille
// relancerait la réconciliation pour toujours, même une fois le réseau revenu.
SW.__setRes({ status: 'ok' })
const res2 = await reconcile()
const desarmee = !SESSION.activeGymNeedsRetry()
if (!desarmee) echecs++
console.log(`  ${desarmee ? '✓' : '✗'} la reprise aboutit (${res2.status}) : reprise au repos`)

rmSync(out, { recursive: true, force: true })
rmSync(out2, { recursive: true, force: true })
console.log(echecs ? `\n🔴 ${echecs} vérification(s) en échec\n` : '\n✅ Course battue, choix respecté, reprise armée au bon moment.\n')
process.exit(echecs ? 1 : 0)
