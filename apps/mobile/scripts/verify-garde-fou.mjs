#!/usr/bin/env node
// GYM-290 (0) — 🔴 LE BALAYAGE DU GARDE-FOU, JETON PAR JETON.
//
// ═════════════════════════════════════════════════════════════════════════════════════
// CE QU'IL MESURE, ET POURQUOI IL EXISTE
// ═════════════════════════════════════════════════════════════════════════════════════
// La PR #235 a mesuré, incidemment, que `onBackgroundMuted` descendait sous 3:1 sur
// 7 000 salles sur 19 600. La cause était en amont : le MODE clair/sombre se décidait par
// `hslLightness > 80`, une mesure de TEINTE. Un fond vif — un lime, un ambre, une menthe —
// y est « sombre », et reçoit donc les encres du mode sombre, quasi invisibles dessus.
//
// Ce script n'est pas un test de plus : c'est l'instrument qui rend la correction VÉRIFIABLE
// plutôt que plausible. Il balaie les mêmes 19 600 salles, jeton par jeton, et compte
// combien tombent sous leur seuil. Le AVANT/APRÈS est publié dans la PR.
//
// ⚠️ DEUX SEUILS, ET ILS NE SE VALENT PAS. Une SURFACE (piste, bordure, pastille) se
// contente de 3:1 — WCAG § 1.4.11. Une encre de TEXTE demande 4,5:1 — WCAG § 1.4.3. Les
// confondre, c'est soit rendre du texte illisible, soit refuser des surfaces parfaitement
// utilisables. Chaque jeton est donc déclaré avec le seuil qui le concerne.
//
// USAGE : node scripts/verify-garde-fou.mjs [--json]
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = mkdtempSync(join(tmpdir(), 'gym290-'))
try {
  execFileSync('npx', [
    'tsc', join(ROOT, 'lib/theme/resolveTheme.ts'),
    '--outDir', out, '--module', 'esnext', '--target', 'es2020', '--skipLibCheck',
  ], { cwd: ROOT, stdio: 'pipe' })
} catch (e) {
  console.error('compilation impossible :', e.message)
  process.exit(2)
}
for (const f of readdirSync(out).filter((n) => n.endsWith('.js'))) {
  const p = join(out, f)
  writeFileSync(p, readFileSync(p, 'utf8')
    .replace(/(from\s+['"]\.\.?\/[^'"]+?)(['"])/g, (m, a, q) => (a.endsWith('.js') ? m : `${a}.js${q}`)))
}
const { resolveTheme } = await import(pathToFileURL(join(out, 'resolveTheme.js')).href)
const { contrastRatio, parseHex, AA_TEXT, AA_NON_TEXT } =
  await import(pathToFileURL(join(out, 'contrast.js')).href)

// ── Les jetons, leur fond de référence, et le seuil qui les concerne ────────────────
// ⚠️ LE FOND DE RÉFÉRENCE N'EST PAS TOUJOURS `background`. Une encre `onAccent` se juge sur
// l'ACCENT, pas sur la page : la mesurer sur le mauvais fond donnerait un chiffre vrai et
// une conclusion fausse.
const JETONS = [
  { nom: 'onBackground', sur: 'background', seuil: AA_TEXT, quoi: 'texte principal' },
  { nom: 'onBackgroundMuted', sur: 'background', seuil: AA_TEXT, quoi: 'texte secondaire' },
  { nom: 'onAccent', sur: 'accent', seuil: AA_TEXT, quoi: 'libellé sur action' },
  { nom: 'onSurface', sur: 'surface', seuil: AA_TEXT, quoi: 'texte sur carte' },
  { nom: 'onSurfaceSecondary', sur: 'surface', seuil: AA_TEXT, quoi: 'texte secondaire sur carte' },
  { nom: 'accent', sur: 'background', seuil: AA_NON_TEXT, quoi: 'surface d’action' },
  // 🔴 GYM-290 (décision A) — LE COUPLE DU BOUTON PRIMAIRE. C'est une ENCRE posée sur une
  // surface : seuil TEXTE. Les 22 pressables débloqués par la décision A en dépendent tous
  // — s'il tombe, c'est le libellé de l'action principale de l'app qui devient illisible.
  { nom: 'onAction', sur: 'actionBg', seuil: AA_TEXT, quoi: 'libellé du bouton primaire' },
  { nom: 'actionBg', sur: 'page', seuil: AA_NON_TEXT, quoi: 'bouton primaire sur la page' },
  // ⚠️ `border` EST MESURÉ, PAS SANCTIONNÉ — et il faut dire pourquoi plutôt que de le
  // retirer du tableau. C'est un filet de séparation à 12-14 % : le soumettre à 3:1
  // reviendrait à exiger un trait épais et sombre entre chaque ligne de liste. WCAG
  // § 1.4.11 vise les éléments qu'il faut DISTINGUER pour comprendre l'interface — un
  // bouton, un champ — pas les traits décoratifs. On publie donc son chiffre, et on
  // n'échoue pas dessus : un seuil qu'on ne peut pas tenir et qu'on garde quand même
  // apprend à ignorer les rouges.
  { nom: 'border', sur: 'background', seuil: AA_NON_TEXT, quoi: 'séparateur (décoratif)', informatif: true },
  // 🔴 GYM-290 (décision B) — LA PAGE EST UN SECOND FOND, DONC UN SECOND JEU DE MESURES.
  // Séparer `page` de `background` crée une surface de plus sur laquelle du texte est
  // posé — et qui n'était vérifiée par rien, puisque les deux étaient la même couleur.
  // Les écrans posent `onBackground` et `onBackgroundMuted` indifféremment sur l'une ou
  // l'autre : les deux doivent tenir sur les DEUX fonds, sans quoi on aurait corrigé la
  // bande en cassant la page.
  { nom: 'onBackground', sur: 'page', seuil: AA_TEXT, quoi: 'texte principal SUR LA PAGE' },
  { nom: 'onBackgroundMuted', sur: 'page', seuil: AA_TEXT, quoi: 'texte secondaire SUR LA PAGE' },
  { nom: 'accent', sur: 'page', seuil: AA_NON_TEXT, quoi: 'action posée sur la page' },
  // 🔴 GYM-293b — LE FORMULAIRE, QUI N'ÉTAIT MESURÉ PAR RIEN. Les champs empruntaient les
  // jetons de la CARTE (`surface`, `onSurface`, `border`) et le gris du FOND
  // (`onBackgroundMuted`) : chacun tenait son seuil sur SON fond de référence, et aucun ne
  // le tenait là où il était réellement posé. Le balayage ne pouvait donc rien voir — c'est
  // la recette sur salle claire qui a trouvé, ce qui est exactement l'inverse de l'ordre
  // voulu. Les quatre rôles nommés, ils se mesurent.
  // GYM-304 — la pastille vide. Comme `border` et `field`, elle n'est pas SANCTIONNÉE : ce
  // n'est ni du texte ni une frontière, et lui imposer 3:1 en ferait un point dur au milieu
  // d'une liste. Son chiffre est publié, et le seuil affiché est le pas visé (PAS_RAIL_FORT,
  // calibré sur le #555555 de Dopamine).
  { nom: 'railStrong', sur: 'background', seuil: 2.53, quoi: 'pastille vide (état à faire)', informatif: true },
  { nom: 'onField', sur: 'field', seuil: AA_TEXT, quoi: 'saisie dans le champ' },
  { nom: 'onFieldMuted', sur: 'field', seuil: AA_TEXT, quoi: 'placeholder' },
  // ⚠️ LE CONTOUR SE MESURE SUR SES DEUX VOISINS, PAS SUR UN SEUL. WCAG § 1.4.11 demande
  // 3:1 avec les couleurs ADJACENTES : un trait qui se détache du champ mais se fond dans
  // la carte ne dessine rien. C'est lui qui porte l'identification du champ — celui-là est
  // sanctionné, contrairement au `border` décoratif ci-dessus.
  { nom: 'fieldBorder', sur: 'field', seuil: AA_NON_TEXT, quoi: 'contour du champ' },
  { nom: 'fieldBorder', sur: 'surface', seuil: AA_NON_TEXT, quoi: 'contour du champ, côté carte' },
  // Le creux du champ dans sa carte : une NUANCE, pas une frontière — on publie son chiffre
  // sans échouer dessus, comme pour `border`. Le seuil affiché est le pas visé (PAS_CHAMP).
  { nom: 'field', sur: 'surface', seuil: 1.2, quoi: 'creux du champ dans la carte', informatif: true },
]

// ⚠️ `surface` EST UN VOILE TRANSLUCIDE (GYM-302) : le composer sur le fond est la SEULE
// façon de mesurer ce que l'œil voit. Le lire brut donnerait « rgba(...) », impossible à
// contraster, et le script sauterait silencieusement les deux jetons de carte.
function composer(voile, fond) {
  const f = parseHex(fond)
  const m = String(voile).match(/rgba?\(([^)]+)\)/)
  if (!m) return String(voile)
  const [r, g, b, a = '1'] = m[1].split(',').map((x) => x.trim())
  const mix = [r, g, b].map((c, i) => Math.round(Number(c) * Number(a) + [f.r, f.g, f.b][i] * (1 - Number(a))))
  return '#' + mix.map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase()
}

const NUANCES = [
  null, '', 'pas-une-couleur', '#FFFFFF', '#000000', '#C8FF3D', '#2D1B69', '#171310',
  '#F3F0FF', '#EF4444', '#0163A6', '#101010', '#808080', '#7F7F7F', '#FFD1DC',
  '#E6E6FA', '#123456', '#ABCDEF', '#98D8AA', '#1A1A2E',
]
let graine = 20260829
const tirage = () => ((graine = (graine * 1103515245 + 12345) % 2147483648) / 2147483648)
NUANCES.push(...Array.from({ length: 120 }, () =>
  '#' + Math.floor(tirage() * 0x1000000).toString(16).padStart(6, '0')))

const cle = (j) => `${j.nom}@${j.sur}`
const compteurs = Object.fromEntries(JETONS.map((j) => [cle(j), { sous: 0, pire: Infinity }]))
let total = 0
for (const p of NUANCES) for (const s of NUANCES) {
  total++
  const t = resolveTheme(p, s).tokens
  for (const j of JETONS) {
    if (j.seuil === 0) continue
    const fond = composer(t[j.sur], t.background)
    const encre = composer(t[j.nom], t.background)
    const r = contrastRatio(parseHex(encre), parseHex(fond))
    if (r < j.seuil) compteurs[cle(j)].sous++
    if (r < compteurs[cle(j)].pire) compteurs[cle(j)].pire = r
  }
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ total, compteurs }, null, 2))
  rmSync(out, { recursive: true, force: true })
  process.exit(0)
}

console.log(`\nBALAYAGE DU GARDE-FOU — ${total} salles\n`)
console.log('jeton @ fond'.padEnd(36) + 'rôle'.padEnd(32) + 'seuil'.padEnd(8) + 'sous seuil'.padEnd(14) + 'pire')
let echecs = 0
for (const j of JETONS) {
  if (j.seuil === 0) continue
  const c = compteurs[cle(j)]
  const ko = c.sous > 0 && !j.informatif
  if (ko) echecs++
  console.log(
    `${ko ? '✗' : (j.informatif && c.sous ? 'ℹ' : '✓')} ${(j.nom + '@' + j.sur).padEnd(34)}${j.quoi.padEnd(32)}${String(j.seuil).padEnd(8)}`
    + `${(c.sous + ' / ' + total).padEnd(14)}${c.pire.toFixed(2)}:1`,
  )
}
rmSync(out, { recursive: true, force: true })
console.log(echecs
  ? `\n🔴 ${echecs} jeton(s) descendent sous leur seuil.\n`
  : '\n✅ Aucun jeton sous son seuil, sur aucune des salles balayées.\n')
process.exit(echecs ? 1 : 0)
