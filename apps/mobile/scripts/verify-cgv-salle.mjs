#!/usr/bin/env node
// GYM-293b — 🔴 « LES CGV NOMMENT-ELLES ENCORE LE BON VENDEUR ? », RÉPONDU SANS TÉLÉPHONE.
//
// ═════════════════════════════════════════════════════════════════════════════════════
// DEUX QUESTIONS, ET AUCUNE NE SE RELIT
// ═════════════════════════════════════════════════════════════════════════════════════
// 1. EN SINGLE, LE DOCUMENT N'A PAS BOUGÉ D'UN CARACTÈRE. L'article 1 des CGV de Dopamine
//    est publié ; le retoucher en croyant ne toucher qu'un gabarit serait une modification
//    contractuelle silencieuse. On rejoue donc le rendu d'AVANT (depuis `develop`, en
//    substituant à la main les trois constantes que le gabarit interpolait) et on le
//    compare au rendu d'après, octet par octet.
//
// 2. EN MULTI, LE DOCUMENT NE NOMME PLUS DOPAMINE. C'est le défaut corrigé : un membre de
//    Studio Yoga acceptait les conditions d'un club où il n'a jamais mis les pieds. On
//    rend les quatre documents avec l'identité d'une autre salle et on vérifie qu'aucune
//    occurrence ne subsiste — nom du club comme nom de l'application.
//
// ⚠️ LE MODE EST FIGÉ À LA COMPILATION (`GYM_MODE`), donc impossible à faire varier dans un
// même processus. Le script compile deux fois, avec un `gymResolver` bouchonné à chaque
// valeur : c'est la seule façon de vérifier les deux modes, et elle vaut mieux qu'une
// vérification qui n'en couvrirait qu'un.
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { execFileSync, execSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REF = process.argv[2] ?? 'develop'

/** Compile le graphe des textes légaux, `gymResolver` bouchonné sur le mode demandé. */
async function charger(mode) {
  const out = mkdtempSync(join(tmpdir(), `gym293b-${mode}-`))
  // ⚠️ `tsc` SORT EN ERREUR ET ÉMET QUAND MÊME. `gymResolver` importe `expo-constants`,
  // introuvable hors bundler : la compilation signale le module manquant mais produit bien
  // le JavaScript, qui n'en a pas besoin puisqu'on bouchonne ce module juste après. On
  // ignore donc le code de sortie, et on VÉRIFIE l'émission — ce qui est plus sûr que de
  // faire confiance à un code de retour.
  try {
    execFileSync('npx', [
    'tsc',
    join(ROOT, 'constants/legal/params.ts'),
    join(ROOT, 'constants/legal/cgu.fr.ts'),
    join(ROOT, 'constants/legal/cgu.en.ts'),
    join(ROOT, 'constants/legal/privacy.fr.ts'),
    join(ROOT, 'constants/legal/privacy.en.ts'),
    '--outDir', out, '--module', 'esnext', '--target', 'es2020', '--skipLibCheck',
  ], { cwd: ROOT, stdio: 'pipe' })
  } catch { /* voir ci-dessus : l'émission compte, pas le code de sortie */ }

  const fix = (p) => writeFileSync(p, readFileSync(p, 'utf8')
    .replace(/(from\s+['"]\.\.?\/[^'"]+?)(['"])/g, (m, a, q) => (a.endsWith('.js') ? m : `${a}.js${q}`)))
  const parcourir = (d) => readdirSync(d, { withFileTypes: true }).forEach((e) => (
    e.isDirectory() ? parcourir(join(d, e.name)) : e.name.endsWith('.js') && fix(join(d, e.name))))
  parcourir(out)

  // 🔴 LE BOUCHON. `gymResolver` tire `expo-constants` et le stockage natif : impossible à
  // charger hors application. Seul `GYM_MODE` est lu par les textes légaux — on ne bouchonne
  // donc que lui, et on ne fait pas semblant de simuler le reste.
  writeFileSync(join(out, 'lib/gymResolver.js'), `export const GYM_MODE = '${mode}'\n`)
  for (const attendu of ['constants/legal/params.js', 'constants/legal/cgu.fr.js']) {
    if (!existsSync(join(out, attendu))) throw new Error(`compilation sans émission : ${attendu} absent`)
  }

  const imp = (p) => import(pathToFileURL(join(out, p)).href)
  return {
    params: await imp('constants/legal/params.js'),
    cguFr: (await imp('constants/legal/cgu.fr.js')).cguFr,
    cguEn: (await imp('constants/legal/cgu.en.js')).cguEn,
    privacyFr: (await imp('constants/legal/privacy.fr.js')).privacyFr,
    privacyEn: (await imp('constants/legal/privacy.en.js')).privacyEn,
    meta: await imp('constants/legal/meta.js'),
  }
}

/** Le gabarit d'AVANT, avec ses trois interpolations résolues comme le faisait le module. */
function gabaritAvant(fichier, symbole, meta) {
  const src = execSync(`git show ${REF}:apps/mobile/constants/legal/${fichier}`, { cwd: ROOT }).toString()
  const m = src.match(new RegExp(`export const ${symbole} = \`([\\s\\S]*?)\`\\n`))
  if (!m) throw new Error(`${fichier} : gabarit ${symbole} introuvable sur ${REF}`)
  return m[1]
    .replace(/\$\{CLUB_IDENTITY\.name\}/g, 'Dopamine Performance Club')
    .replace(/\$\{CLUB_IDENTITY\.commune\}/g, 'Neupré')
    .replace(/\$\{LEGAL_UPDATED_AT\}/g, meta.LEGAL_UPDATED_AT)
    .replace(/\$\{LEGAL_VERSION\}/g, meta.LEGAL_VERSION)
}

const echecs = []
const dire = (ok, txt) => { console.log(`  ${ok ? '✓' : '✗'} ${txt}`); if (!ok) echecs.push(txt) }

// ── 1. SINGLE : le document publié n'a pas bougé ─────────────────────────────────────
const single = await charger('single')
console.log('\nMODE SINGLE — le document rendu contre celui d’avant (' + REF + ')')
for (const [fichier, symbole, lang] of [
  ['cgu.fr.ts', 'cguFr', 'fr'], ['cgu.en.ts', 'cguEn', 'en'],
  ['privacy.fr.ts', 'privacyFr', 'fr'], ['privacy.en.ts', 'privacyEn', 'en'],
]) {
  const avant = single.params.renderLegal(gabaritAvant(fichier, symbole, single.meta), single.params.DEFAULT_LEGAL_PARAMS, lang)
  const apres = single.params.renderLegal(single[symbole], single.params.DEFAULT_LEGAL_PARAMS, lang)
  dire(avant === apres, `${fichier.padEnd(15)} ${avant === apres ? 'identique à l’octet' : 'A CHANGÉ'} (${apres.length} car.)`)
  if (avant !== apres) {
    const i = [...avant].findIndex((c, k) => c !== apres[k])
    console.log(`      premier écart au caractère ${i} :\n      avant « ${avant.slice(i - 40, i + 60)} »\n      après « ${apres.slice(i - 40, i + 60)} »`)
  }
}

// ── 2. MULTI : plus aucun nom de client dans les documents d'une autre salle ─────────
const multi = await charger('multi')
const SALLE = { ...multi.params.DEFAULT_LEGAL_PARAMS, clubName: 'Studio Yoga Test 1', clubCommune: 'Liège' }
console.log('\nMODE MULTI — les mêmes documents, rendus pour une AUTRE salle')
for (const [symbole, lang] of [['cguFr', 'fr'], ['cguEn', 'en'], ['privacyFr', 'fr'], ['privacyEn', 'en']]) {
  const doc = multi.params.renderLegal(multi[symbole], SALLE, lang)
  dire(!/Dopamine/i.test(doc), `${symbole.padEnd(10)} ne cite plus Dopamine`)
  dire(!/\{\{\w+\}\}/.test(doc), `${symbole.padEnd(10)} aucun placeholder résiduel`)
}
const art1 = multi.params.renderLegal(multi.cguFr, SALLE, 'fr')
dire(art1.includes('**Studio Yoga Test 1**, Liège'), 'art. 1 nomme la salle de contexte et sa commune')
dire(art1.includes("l'application Viniz"), 'art. 1 nomme l’application Viniz, pas un client')

// ── 3. LE REPLI SANS SALLE : neutre, jamais un nom de client ────────────────────────
console.log('\nMODE MULTI, SANS SALLE — le repli ne nomme personne')
const sans = multi.params.renderLegal(multi.cguFr, multi.params.DEFAULT_LEGAL_PARAMS, 'fr')
dire(!/Dopamine/i.test(sans), 'le repli ne cite pas Dopamine')
dire(sans.includes('**votre salle** ('), 'le repli dit « votre salle », sans virgule orpheline')

console.log(echecs.length
  ? `\n🔴 ${echecs.length} vérification(s) en échec.\n`
  : '\n✅ Le document de Dopamine est intact, et celui d’une autre salle ne la nomme plus.\n')
process.exit(echecs.length ? 1 : 0)
