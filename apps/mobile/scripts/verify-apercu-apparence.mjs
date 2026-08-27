#!/usr/bin/env node
// GYM-285 — 🔴 L'APERÇU DU DASHBOARD DOIT DIRE CE QUE LE MOBILE FERA.
//
// ═════════════════════════════════════════════════════════════════════════════════════
// LE RISQUE QUE CE SCRIPT TIENT
// ═════════════════════════════════════════════════════════════════════════════════════
// Réglages → Apparence montre au gérant, AVANT enregistrement, ce que ses membres verront.
// Pour cela `apps/dashboard/src/lib/brandContrast.ts` rejoue la règle du garde-fou qui vit
// dans `apps/mobile/lib/theme/resolveTheme.ts`. Ce n'est pas un import : deux apps, deux
// runtimes, deux bundlers — le mobile n'est pas atteignable depuis le web.
//
// ⚠️ DONC C'EST UNE COPIE, ET UNE COPIE DÉRIVE. Le jour où l'on ajuste un seuil côté
// mobile, l'aperçu continue de peindre l'ancienne règle sans rien signaler : le gérant
// voit une couleur, ses membres en voient une autre, et personne ne fait le lien — c'est
// pire que pas d'aperçu du tout, parce que c'est un mensonge crédible.
//
// Ce script exécute les DEUX implémentations sur le même balayage et compare. Tant qu'il
// passe, l'aperçu ne ment pas. Le jour où il échoue, c'est la copie qu'il faut rapatrier
// sur la règle — jamais l'inverse : la référence est le mobile, c'est lui qui rend.
//
// À REJOUER après TOUTE modification de resolveTheme.ts, contrast.ts ou brandContrast.ts.
//
// USAGE : node scripts/verify-apercu-apparence.mjs
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DASH = join(ROOT, '../dashboard')
const out = mkdtempSync(join(tmpdir(), 'gym285-'))

// ⚠️ LES DEUX APPS N'ONT PAS LA MÊME VERSION DE tsc. La récente refuse de compiler un
// fichier nommé en ligne de commande tant qu'un tsconfig.json traîne (TS5112) et veut
// `--ignoreConfig` ; l'ancienne ne connaît pas ce drapeau (TS5023). On tente donc sans,
// puis avec — plutôt que de figer une version qui rendrait le script faux dans une app
// sur deux au premier `npm update`.
const compiler = (fichier, base) => {
  const args = (extra) => ['tsc', ...extra, fichier,
    '--outDir', out, '--module', 'esnext', '--target', 'es2020', '--skipLibCheck']
  try {
    execFileSync('npx', args([]), { cwd: base, stdio: 'pipe' })
  } catch {
    execFileSync('npx', args(['--ignoreConfig']), { cwd: base, stdio: 'pipe' })
  }
}

// tsc émet les imports relatifs SANS extension (`from './contrast'`) : c'est valide en
// TypeScript, mais l'ESM de Node exige `./contrast.js` et refuse de charger sinon. On
// réécrit donc les imports du JS émis — le seul endroit où ce script touche au code.
const suffixer = () => {
  for (const f of readdirSync(out).filter((n) => n.endsWith('.js'))) {
    const chemin = join(out, f)
    writeFileSync(chemin, readFileSync(chemin, 'utf8')
      .replace(/(from\s+['"]\.\.?\/[^'"]+?)(['"])/g, (m, a, q) => (a.endsWith('.js') ? m : `${a}.js${q}`)))
  }
}

let mobile, dash
try {
  compiler(join(ROOT, 'lib/theme/resolveTheme.ts'), ROOT)
  compiler(join(DASH, 'src/lib/brandContrast.ts'), DASH)
  suffixer()
  mobile = await import(pathToFileURL(join(out, 'resolveTheme.js')).href)
  dash = await import(pathToFileURL(join(out, 'brandContrast.js')).href)
} catch (e) {
  console.error('compilation impossible :', e.message)
  process.exit(2)
}
const { resolveTheme } = mobile
const { previewBrand, forecastBrand, parseHex } = dash

// Nuances CHOISIES : les cas limites auxquels on pense — blanc, noir, palette Viniz,
// saisies invalides, gris pile au seuil, pastels voisins.
const NUANCES = [
  null, undefined, '', 'pas-une-couleur', '#FFF',
  '#FFFFFF', '#000000', '#C8FF3D', '#2D1B69', '#EF4444', '#F5F4F0', '#171310',
  '#0163A6', '#101010', '#808080', '#7F7F7F', '#FFD1DC', '#E6E6FA', '#123456', '#ABCDEF',
]

// ⚠️ Une liste choisie est biaisée vers ce à quoi j'ai pensé — or une copie dérive
// précisément là où je n'ai pas regardé. Ce tirage pseudo-aléatoire est DÉTERMINISTE
// (graine fixe) : même liste à chaque exécution, donc un échec est toujours reproductible.
let graine = 20260827
const tirage = () => ((graine = (graine * 1103515245 + 12345) % 2147483648) / 2147483648)
NUANCES.push(...Array.from({ length: 120 }, () =>
  '#' + Math.floor(tirage() * 0x1000000).toString(16).padStart(6, '0')))

let cas = 0
let ecarts = 0
for (const p of NUANCES) for (const s of NUANCES) {
  cas++
  const d = resolveTheme(p, s)
  const apercu = previewBrand(p ?? null, s ?? null)
  const alerte = forecastBrand(p ?? null, s ?? null)

  // (1) LE RENDU — les 4 jetons que l'aperçu peint doivent être ceux que le mobile résout.
  const diffs = ['background', 'onBackground', 'accent', 'onAccent']
    .filter((k) => String(d.tokens[k]).toLowerCase() !== String(apercu[k]).toLowerCase())
  if (diffs.length) {
    ecarts++
    console.log(`ÉCART rendu  p=${p} s=${s} → ` +
      diffs.map((k) => `${k}: mobile=${d.tokens[k]} aperçu=${apercu[k]}`).join(', '))
  }

  // (2) L'ALERTE — critère pris du mobile LUI-MÊME (`backgroundFromGym` / `accentFromGym`)
  // et non redérivé ici : une règle réécrite dans le test ne teste plus que ma relecture.
  // Elle ne doit se déclencher que si une couleur LISIBLE a été écartée — une saisie vide
  // ou invalide n'est pas un choix rejeté, c'est un choix absent, et avertir dessus
  // apprendrait au gérant à ignorer l'encadré.
  const bgEcarte = parseHex(s) !== null && !d.notes.backgroundFromGym
  const accEcarte = parseHex(p) !== null && !d.notes.accentFromGym
  if ((bgEcarte || accEcarte) !== alerte.hasWarning) {
    ecarts++
    console.log(`ÉCART alerte p=${p} s=${s} → mobile écarte=${bgEcarte || accEcarte}, aperçu avertit=${alerte.hasWarning}`)
  }
}

rmSync(out, { recursive: true, force: true })
console.log(ecarts === 0
  ? `OK — ${cas} paires : aperçu et garde-fou mobile identiques sur les 4 jetons, alerte cohérente`
  : `ÉCHEC — ${ecarts} écarts sur ${cas} paires`)
process.exit(ecarts === 0 ? 0 : 1)
