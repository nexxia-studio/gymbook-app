#!/usr/bin/env node
// GYM-293b — 🔴 « QUEL NOM S'AFFICHE QUAND ON NE SAIT PAS ENCORE ? », RÉPONDU SANS TÉLÉPHONE.
//
// ═════════════════════════════════════════════════════════════════════════════════════
// LE DÉFAUT QU'AUCUNE RELECTURE N'ATTRAPE
// ═════════════════════════════════════════════════════════════════════════════════════
// `useGymName()` retombait sur `CLUB_IDENTITY.name` — le nom de Dopamine. Le commentaire
// qui l'accompagnait était juste sur SON cas : chez Dopamine, ce repli couvre le temps
// d'une requête, et il évite un en-tête vide au lancement. Il supposait simplement qu'une
// salle finit toujours par arriver.
//
// Deux situations le démentent, et toutes deux sont NOMINALES en multi :
//   · l'écran d'INSCRIPTION — le membre n'est pas connecté, `useGymProfile()` ne rendra
//     jamais rien, et le repli est donc permanent, pas transitoire ;
//   · le COMPTE SANS SALLE — le filet de sécurité de GYM-293, quand le rattachement
//     échoue : aucune salle n'arrivera jamais.
//
// Dans les deux cas, l'app d'une autre salle affichait « Dopamine Performance Club ». Ce
// script fige les quatre combinaisons de (mode × salle connue) plutôt que de faire
// confiance à la lecture d'un `??` en bout de chaîne.
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Compile `useGymName`, avec ses trois sources BOUCHONNÉES.
 *
 * ⚠️ ON NE BOUCHONNE QUE CE QU'ON FAIT VARIER : le mode, le profil, la marque. Le reste du
 * hook — l'ordre des lectures, le repli, la règle du nom court — est le code réel, compilé
 * depuis le dépôt. Un test qui réimplémenterait la règle ne vérifierait que lui-même.
 */
async function charger(mode, profil, marque) {
  const out = mkdtempSync(join(tmpdir(), `gym293b-nom-`))
  try {
    execFileSync('npx', [
      'tsc', join(ROOT, 'hooks/useGymName.ts'),
      '--outDir', out, '--module', 'esnext', '--target', 'es2020', '--skipLibCheck', '--jsx', 'react',
    ], { cwd: ROOT, stdio: 'pipe' })
  } catch { /* `expo-constants` et `react-native` sont introuvables hors bundler : tsc
      signale, émet quand même, et les trois modules concernés sont remplacés juste après. */ }
  const fix = (p) => writeFileSync(p, readFileSync(p, 'utf8')
    .replace(/(from\s+['"]\.\.?\/[^'"]+?)(['"])/g, (m, a, q) => (a.endsWith('.js') ? m : `${a}.js${q}`)))
  const parcourir = (d) => readdirSync(d, { withFileTypes: true }).forEach((e) => (
    e.isDirectory() ? parcourir(join(d, e.name)) : e.name.endsWith('.js') && fix(join(d, e.name))))
  parcourir(out)

  writeFileSync(join(out, 'lib/gymResolver.js'), `export const GYM_MODE = '${mode}'\n`)
  writeFileSync(join(out, 'hooks/useGymProfile.js'),
    `export function useGymProfile() { return ${JSON.stringify(profil)} }\n`)
  writeFileSync(join(out, 'lib/theme/ThemeProvider.js'),
    `export function useTheme() { return { brand: ${JSON.stringify(marque)}, tokens: {} } }\n`)
  if (!existsSync(join(out, 'hooks/useGymName.js'))) throw new Error('compilation sans émission')
  return import(pathToFileURL(join(out, 'hooks/useGymName.js')).href)
}

const echecs = []
const dire = (ok, txt) => { console.log(`  ${ok ? '✓' : '✗'} ${txt}`); if (!ok) echecs.push(txt) }

const CAS = [
  // mode      profil                        marque                          attendu
  ['single', { name: 'Dopamine Performance Club' }, null, 'Dopamine Performance Club',
    'single, profil chargé — le nom de la salle'],
  ['single', null, null, 'Dopamine Performance Club',
    'single, PENDANT LE CHARGEMENT — le repli historique, inchangé'],
  ['multi', null, { name: 'Studio Yoga Test 1', shortName: null }, 'Studio Yoga Test 1',
    'multi AVANT CONNEXION — la marque, chargée sans session (écran d’inscription)'],
  ['multi', { name: 'Studio Yoga Test 1' }, { name: 'Studio Yoga Test 1', shortName: null }, 'Studio Yoga Test 1',
    'multi, connecté — le profil et la marque disent la même chose'],
  ['multi', null, null, 'Viniz',
    'multi, COMPTE SANS SALLE — la plateforme, JAMAIS un client'],
]

console.log('\nLE NOM AFFICHÉ, PAR MODE ET PAR ÉTAT DE CHARGEMENT\n')
for (const [mode, profil, marque, attendu, quoi] of CAS) {
  const { useGymName } = await charger(mode, profil, marque)
  const rendu = useGymName()
  dire(rendu === attendu, `${quoi}\n      rendu « ${rendu} »${rendu === attendu ? '' : ` — attendu « ${attendu} »`}`)
}

// 🔴 LA VÉRIFICATION QUI COMPTE VRAIMENT : aucun état de multi ne peut nommer Dopamine.
console.log('\nAUCUN ÉTAT DE MULTI NE NOMME DOPAMINE\n')
for (const [profil, marque, quoi] of [
  [null, null, 'ni profil ni marque'],
  [null, { name: 'Studio Yoga Test 1', shortName: null }, 'marque seule'],
  [{ name: 'Studio Yoga Test 1' }, null, 'profil seul'],
]) {
  const { useGymName, useGymHeaderName } = await charger('multi', profil, marque)
  const noms = [useGymName(), useGymHeaderName()]
  dire(!noms.some((n) => /dopamine/i.test(n)), `${quoi} → ${noms.map((n) => `« ${n} »`).join(' / ')}`)
}

console.log(echecs.length ? `\n🔴 ${echecs.length} cas en échec.\n`
  : '\n✅ Le repli de Dopamine est intact en single, et le nom d’un client ne fuit nulle part en multi.\n')
process.exit(echecs.length ? 1 : 0)
