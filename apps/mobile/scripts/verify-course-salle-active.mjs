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
import { mkdtempSync, rmSync } from 'node:fs'
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

rmSync(out, { recursive: true, force: true })
console.log(echecs ? `\n🔴 ${echecs} vérification(s) en échec\n` : '\n✅ La course est battue au timing le pire.\n')
process.exit(echecs ? 1 : 0)
