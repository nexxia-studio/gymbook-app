#!/usr/bin/env node
// GYM-302 (1) — 🔴 LE WORDMARK EST-IL LIME LÀ OÙ IL LE DOIT, ET NULLE PART AILLEURS ?
//
// ═════════════════════════════════════════════════════════════════════════════════════
// POURQUOI CETTE RÈGLE MÉRITE UN BANC
// ═════════════════════════════════════════════════════════════════════════════════════
// `PoweredByViniz` est en pied de TROIS écrans, dont la connexion de CHAQUE salle. La
// règle « lime sur fond sombre » ne se relit pas : elle dépend du fond que le garde-fou a
// retenu pour la salle, lequel dépend des deux couleurs que le gérant a choisies. Une
// relecture ne peut pas couvrir cet espace ; un balayage, si.
//
// Le banc rejoue la règle du composant sur le VRAI `resolveTheme`, salle par salle, et
// vérifie les deux directions :
//   · aucune salle CLAIRE ne reçoit de lime  (la règle de l'écran 09) ;
//   · aucun wordmark ne descend sous 3:1     (WCAG § 1.4.11, éléments non textuels).
//
// ⚠️ LA RÈGLE EST LUE DANS LE COMPOSANT, PAS RECOPIÉE ICI. Un banc qui redéclare la règle
// qu'il vérifie ne vérifie plus que lui-même : on importe donc `wordmarkInk`, la même
// fonction que le rendu appelle.
//
// USAGE : node scripts/verify-wordmark-lime.mjs
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = mkdtempSync(join(tmpdir(), 'gym302-'))
try {
  execFileSync('npx', [
    'tsc', join(ROOT, 'lib/theme/resolveTheme.ts'), join(ROOT, 'components/viniz/wordmarkInk.ts'),
    '--outDir', out, '--module', 'esnext', '--target', 'es2020', '--skipLibCheck',
  ], { cwd: ROOT, stdio: 'pipe' })
} catch (e) {
  console.error('compilation impossible :', e.message)
  process.exit(2)
}
// ⚠️ tsc CONSERVE L'ARBORESCENCE quand les entrées viennent de deux dossiers : la sortie
// est `out/lib/theme/…` et `out/components/viniz/…`, pas un dossier plat. On parcourt donc
// récursivement — et on suffixe les imports, que l'ESM de Node exige et que tsc n'écrit pas.
const jsFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? jsFiles(join(dir, e.name)) : (e.name.endsWith('.js') ? [join(dir, e.name)] : []))
for (const p of jsFiles(out)) {
  writeFileSync(p, readFileSync(p, 'utf8')
    .replace(/(from\s+['"]\.\.?\/[^'"]+?)(['"])/g, (m, a, q) => (a.endsWith('.js') ? m : `${a}.js${q}`)))
}
const { resolveTheme, VINIZ } = await import(pathToFileURL(join(out, 'lib', 'theme', 'resolveTheme.js')).href)
const { wordmarkInk } = await import(pathToFileURL(join(out, 'components', 'viniz', 'wordmarkInk.js')).href)
const { contrastRatio, parseHex, AA_NON_TEXT } = await import(pathToFileURL(join(out, 'lib', 'theme', 'contrast.js')).href)

let echecs = 0
const ok = (nom, condition, detail) => {
  if (!condition) echecs++
  console.log(`  ${condition ? '✓' : '✗'} ${nom}`)
  if (!condition && detail) console.log(`      ${detail}`)
}

// ── LES DEUX CAS QUE LE TICKET DEMANDE DE PROUVER ───────────────────────────────────
console.log('\nLES DEUX CAS NOMMÉS\n')

// (1) L'écran Viniz : Violet Ink. C'est la palette de `app/gym/select.tsx`.
const viniz = { ...resolveTheme(VINIZ.lime, VINIZ.ink).tokens, background: VINIZ.ink, page: VINIZ.ink }
ok(`écran Viniz (Violet Ink ${VINIZ.ink}) → LIME`,
  wordmarkInk(viniz) === VINIZ.lime, `obtenu ${wordmarkInk(viniz)}`)

// (2) Une salle CLAIRE. Le garde-fou lui donne un fond clair, donc pas de lime.
const claire = resolveTheme('#2D1B69', '#F3F0FF').tokens
ok(`salle claire (fond ${claire.background}, mode ${claire.mode}) → PAS de lime`,
  wordmarkInk(claire) !== VINIZ.lime && wordmarkInk(claire) === claire.onBackgroundMuted,
  `obtenu ${wordmarkInk(claire)}`)

// ── LE CONTRE-EXEMPLE QUI JUSTIFIE LA SECONDE CONDITION ─────────────────────────────
console.log('\nLE CONTRE-EXEMPLE — « sombre » ne veut pas dire « contrasté avec le lime »\n')
// ⚠️ TROUVÉ PAR BALAYAGE, PAS CHOISI À VUE. Mon premier candidat était un vert PROFOND
// (#2E4A00) : il donne 8,51:1, le lime y est parfaitement lisible. L'intuition « vert
// sombre = proche du lime » est fausse — c'est la LUMINANCE qui compte, et un vert profond
// en est loin. Les vrais cas sont des teintes MOYENNES que `hslLightness` classe encore
// « sombres » : menthe, ambre, or.
const MENTHE = '#98D8AA'
const menthe = resolveTheme(VINIZ.lime, MENTHE).tokens
const ratioMenthe = contrastRatio(parseHex(VINIZ.lime), parseHex(menthe.background))
ok(`fond menthe ${menthe.background} : sombre (limeAllowed=${menthe.limeAllowed}) mais ${ratioMenthe.toFixed(2)}:1 → PAS de lime`,
  menthe.limeAllowed === true && ratioMenthe < AA_NON_TEXT && wordmarkInk(menthe) !== VINIZ.lime,
  `limeAllowed=${menthe.limeAllowed}, ratio=${ratioMenthe.toFixed(2)}, encre=${wordmarkInk(menthe)}`)

// ── LE BALAYAGE ─────────────────────────────────────────────────────────────────────
console.log('\nBALAYAGE — 20 nuances choisies + 120 tirées (graine fixe, reproductible)\n')
const NUANCES = [
  null, '', 'pas-une-couleur', '#FFFFFF', '#000000', VINIZ.lime, VINIZ.ink, VINIZ.dark,
  VINIZ.light, '#EF4444', '#0163A6', '#101010', '#808080', '#7F7F7F', '#FFD1DC',
  '#E6E6FA', '#123456', '#ABCDEF', MENTHE, '#1A1A2E',
]
let graine = 20260828
const tirage = () => ((graine = (graine * 1103515245 + 12345) % 2147483648) / 2147483648)
NUANCES.push(...Array.from({ length: 120 }, () =>
  '#' + Math.floor(tirage() * 0x1000000).toString(16).padStart(6, '0')))

let cas = 0, limeClaire = 0, limeIllisible = 0, replisDivergents = 0, mutedIllisible = 0
for (const p of NUANCES) for (const s of NUANCES) {
  cas++
  const t = resolveTheme(p, s).tokens
  const encre = wordmarkInk(t)
  const r = contrastRatio(parseHex(encre), parseHex(t.background))
  if (encre === VINIZ.lime) {
    // Les deux garanties du lot, sur le choix QUE CE LOT INTRODUIT.
    if (t.mode === 'light') limeClaire++
    if (r < AA_NON_TEXT) limeIllisible++
  } else {
    // 🔴 LE REPLI DOIT ÊTRE L'ANCIEN RENDU, AU CARACTÈRE PRÈS. C'est la preuve de
    // non-régression : partout où le lime n'est pas retenu, GYM-302 rend EXACTEMENT ce que
    // rendait la version d'avant, qui posait `tokens.onBackgroundMuted` sans condition.
    if (encre !== t.onBackgroundMuted) replisDivergents++
    if (r < AA_NON_TEXT) mutedIllisible++
  }
}
ok(`${cas} salles : aucun lime sur fond clair`, limeClaire === 0, `${limeClaire} cas`)
ok(`${cas} salles : tout lime retenu atteint ${AA_NON_TEXT}:1`, limeIllisible === 0, `${limeIllisible} cas`)
ok(`${cas} salles : hors lime, le repli est L'ANCIEN RENDU au caractère près`,
  replisDivergents === 0, `${replisDivergents} cas divergents`)

// ── UN CONSTAT HORS PÉRIMÈTRE, MESURÉ ICI PARCE QUE LE BALAYAGE LE CROISE ───────────
// ⚠️ CE N'EST PAS UNE RÉGRESSION DE CE LOT, ET LE SCRIPT NE DOIT PAS LE FAIRE ÉCHOUER.
// `onBackgroundMuted` — l'encre atténuée du thème, celle que la signature employait DÉJÀ
// avant GYM-302 — descend sous 3:1 sur un grand nombre de salles. La cause est en amont :
// `resolveTheme` décide du mode avec `hslLightness > 80`, si bien qu'un fond VIF mais pas
// « clair » au sens HSL (le lime lui-même, un ambre, une menthe) reçoit les encres du mode
// SOMBRE, dont la lavande #C8C2E6 — quasi invisible dessus.
//
// Ce lot n'y touche pas : il ne fait que ne PAS aggraver. On le mesure et on le remonte.
console.log(`\n  ℹ️  hors périmètre — repli \`onBackgroundMuted\` sous ${AA_NON_TEXT}:1 sur ${mutedIllisible} / ${cas} salles.`)
console.log('      Défaut PRÉEXISTANT (mode décidé par hslLightness > 80, cf. resolveTheme).')
console.log('      Ce lot ne l’aggrave pas : voir la vérification « repli = ancien rendu ».')

rmSync(out, { recursive: true, force: true })
console.log(echecs
  ? `\n🔴 ${echecs} vérification(s) en échec\n`
  : '\n✅ Lime sur fond sombre et contrasté, encre atténuée partout ailleurs.\n')
process.exit(echecs ? 1 : 0)
