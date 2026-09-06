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

// ── LA SECONDE CONDITION EST DEVENUE INATTEIGNABLE, ET C'EST UNE BONNE NOUVELLE ─────
console.log('\nLA SECONDE CONDITION, APRÈS GYM-290\n')
// ⚠️ CE BLOC AFFIRMAIT LE CONTRAIRE JUSQU'À CE LOT, ET IL AVAIT RAISON À L'ÉPOQUE.
// GYM-302 avait trouvé des fonds « sombres » où le lime tombait à 1,40:1 — une menthe, un
// ambre. Ils l'étaient au sens de `hslLightness`, la mesure de TEINTE que GYM-290 vient de
// retirer du garde-fou. Décidé par la LUMINANCE, un fond menthe est désormais CLAIR : la
// condition (a) l'écarte à elle seule, et le lime n'a plus l'occasion d'échouer.
//
// Mesuré : sur 110 965 fonds tirés au hasard qui passent `limeAllowed`, le PIRE contraste
// du lime est 4,29:1 — au-dessus du seuil surface. La condition (b) ne peut plus se
// déclencher pour le lime.
//
// 🔴 ELLE RESTE DANS LE CODE, ET CE N'EST PAS DE LA SUPERSTITION. Elle ne protège plus
// contre le cas d'hier ; elle protège contre demain — un changement de `VINIZ.lime`, un
// ajustement du critère de mode. Une règle de lisibilité qui ne tient que par une
// propriété d'un AUTRE module est une règle qui casse en silence le jour où l'autre bouge.
// Ce que ce banc doit dire, c'est laquelle des deux conditions travaille aujourd'hui.
const MENTHE = '#98D8AA'
const menthe = resolveTheme(VINIZ.lime, MENTHE).tokens
ok(`fond menthe ${menthe.background} : désormais CLAIR (limeAllowed=${menthe.limeAllowed}) → PAS de lime`,
  menthe.limeAllowed === false && wordmarkInk(menthe) !== VINIZ.lime,
  `limeAllowed=${menthe.limeAllowed}, encre=${wordmarkInk(menthe)}`)

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

// ── LE CONSTAT DE LA PR #235 : REFERMÉ ─────────────────────────────────────────────
// Ce bloc mesurait un défaut PRÉEXISTANT qu'on ne pouvait alors que remonter : l'encre
// atténuée `onBackgroundMuted` descendait sous le seuil sur 7 000 salles sur 19 600, parce
// que le mode était décidé par `hslLightness`. GYM-290 a corrigé la cause. On garde la
// mesure — un chiffre qui doit rester à zéro est plus utile qu'un chiffre qu'on a effacé.
console.log(`\n  ℹ️  repli \`onBackgroundMuted\` sous ${AA_NON_TEXT}:1 : ${mutedIllisible} / ${cas} salles.`)
console.log('      Était 7 000 / 19 600 avant GYM-290 (mode décidé par hslLightness).')

rmSync(out, { recursive: true, force: true })
console.log(echecs
  ? `\n🔴 ${echecs} vérification(s) en échec\n`
  : '\n✅ Lime sur fond sombre et contrasté, encre atténuée partout ailleurs.\n')
process.exit(echecs ? 1 : 0)
