#!/usr/bin/env node
// GYM-286a — 🔴 « CET ÉCRAN REND-IL ENCORE COMME AVANT ? », RÉPONDU SANS TÉLÉPHONE.
//
// ═════════════════════════════════════════════════════════════════════════════════════
// L'ERREUR QUE CE SCRIPT ATTRAPE, ET QUE LA RELECTURE NE VOIT PAS
// ═════════════════════════════════════════════════════════════════════════════════════
// Migrer, c'est remplacer une couleur par un NOM. Un nom se relit très bien tout en
// désignant la mauvaise couleur : `tokens.background` à la place de `tokens.page` est un
// diff impeccable qui peint l'écran entier en noir. Chez Dopamine, `onAccent` et
// `onSurface` valent tous deux #111111 — les confondre ne se voit NULLE PART en mode
// single, et casse le premier client dont l'action est sombre.
//
// Le script rejoue donc les deux fichiers, avant et après, en résolvant chaque jeton par
// sa valeur Dopamine, et compare les deux SUITES DE COULEURS position par position.
// Même longueur, même ordre, mêmes valeurs : l'écran n'a pas bougé d'un pixel.
//
// ⚠️ CE QU'IL NE PROUVE PAS. Il compare des couleurs, pas une mise en page : déplacer un
// `<View>` ou perdre une bordure lui échappe. C'est le `tsc` et la relecture du diff qui
// couvrent cela. Ici on ne traite qu'une question, mais on la traite entièrement.
//
// USAGE :  node scripts/verify-screen-parity.mjs app/profile/security.tsx [ref]
//          `ref` vaut `develop` par défaut — l'état d'avant la migration.
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = process.argv[2]
const ref = process.argv[3] ?? 'develop'
if (!target) {
  console.error('usage : node scripts/verify-screen-parity.mjs <fichier> [ref git]')
  process.exit(2)
}

// ── Les valeurs de Dopamine, relues de leurs sources ─────────────────────────────────
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const pairs = (src, re) => Object.fromEntries([...src.matchAll(re)].map((m) => [m[1], m[2].toUpperCase()]))

const TW = pairs(read('tailwind.config.js'), /'(move-[a-z-]+)':\s*'(#[0-9a-fA-F]{6})'/g)
const DOP = pairs(read('lib/theme/ThemeProvider.tsx').match(/DOPAMINE_THEME: ThemeTokens = \{([\s\S]*?)\n\}/)[1], /^\s{2}([A-Za-z]+):\s*'([^']+)'/gm)
const SEM = pairs(read('lib/theme/semantic.ts').match(/SEMANTIC = \{([\s\S]*?)\n\} as const/)[1], /^\s{2}([A-Za-z]+):\s*'(#[0-9a-fA-F]{6})'/gm)

/**
 * Retire les commentaires AVANT de compter.
 *
 * 🔴 LA PASSE SUR `{/* … *​/}` N'EST PAS COSMÉTIQUE. Un commentaire qui explique la
 * migration cite forcément les jetons qu'elle emploie ; sans cette passe ils sont
 * comptés deux fois, la suite se décale, et une migration correcte est signalée comme
 * une régression. Constaté sur le pilote — d'où cette note.
 */
const strip = (t) => t
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')

// ── GYM-286b — LE MOTIF « AVANT » COUVRE LES CINQ POPULATIONS ────────────────────────
// 🔴 IL N'EN VOYAIT QUE DEUX, ET C'EST UN DÉFAUT QUI SE PAIE EN FAUX ÉCARTS. Écrit pour
// le pilote de 286a, ce script ne connaissait que `move-*` et `#RRGGBB`. Dès qu'on migre
// un `bg-white` ou un `text-red-500`, la colonne « avant » ignore la couleur que la
// colonne « après » compte : les deux suites se décalent, et un fichier parfaitement
// migré est signalé comme une régression. Constaté sur `components/ui/Checkbox.tsx`.
const TW_COLORS = createRequire(import.meta.url)('tailwindcss/colors')
const PALETTES = 'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald'
  + '|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'
const UTILS = 'bg|text|border|fill|stroke|ring|divide|placeholder|shadow'
// ⚠️ LES VARIANTES `/alpha` SONT EXCLUES DU MOTIF, PAS OUBLIÉES. `bg-red-500/10` n'est
// migrable par aucun jeton : il reste donc identique des deux côtés, et le compter
// ajouterait la même valeur aux deux suites — du bruit, pas une vérification.
const MOVE = new RegExp(
  'move-(?:bg|card|dark|accent-dim|accent|text-secondary|text-muted|border)\\b'
  + '|#[0-9a-fA-F]{8}\\b|#[0-9a-fA-F]{6}\\b'
  + `|\\b(?:${UTILS})-(${PALETTES})-([0-9]{2,3})(?![0-9/])`
  + `|\\b(?:${UTILS})-(white|black)(?![a-z/])`,
  'g',
)
// ⚠️ LA CONCATÉNATION D'A-10 EST RECONNUE AVANT LE JETON NU, et l'ordre compte : sans
// elle, `SEMANTIC.success + '20'` serait lu comme le vert PLEIN #22C55E là où le fichier
// d'origine portait #22C55E20 — un succès à 12,5 % d'opacité. Le script signalerait un
// écart sur la seule écriture que le cockpit ait explicitement demandée (A-10).
const TOKEN = /SEMANTIC\.([A-Za-z]+)\s*\+\s*'([0-9a-fA-F]{2})'|tokens\.([A-Za-z]+)|SEMANTIC\.([A-Za-z]+)/g

/** La valeur d'une occurrence « avant », quelle que soit la population dont elle vient. */
function valeurAvant(m) {
  const [texte, palFam, palTon, bwName] = [m[0], m[1], m[2], m[3]]
  if (texte.startsWith('#')) return texte.toUpperCase()
  if (palFam) {
    const v = TW_COLORS[palFam] && TW_COLORS[palFam][palTon]
    return typeof v === 'string' ? v.toUpperCase() : null
  }
  if (bwName) return bwName === 'white' ? '#FFFFFF' : '#000000'
  const cls = texte.match(/move-[a-z-]+/)
  return cls ? TW[cls[0]] ?? null : null
}

const rel = relative(ROOT, join(process.cwd(), target)).startsWith('..') ? target : relative(ROOT, join(process.cwd(), target))
const gitPath = join('apps/mobile', rel)
const before = strip(execFileSync('git', ['show', `${ref}:${gitPath}`], { cwd: join(ROOT, '../..'), encoding: 'utf8' }))
const after = strip(read(rel))

// ── LES DEUX SUITES, LUES DE LA MÊME FAÇON ───────────────────────────────────────────
// 🔴 LA SYMÉTRIE EST LA CONDITION DE LA VALIDITÉ. Lire « avant » avec un motif et
// « après » avec un autre compare deux choses différentes. Constaté sur le pilote de
// 286a : une fois celui-ci fusionné dans `develop`, sa version de référence était DÉJÀ
// migrée ; le côté « avant » n'y trouvait plus aucun littéral et rendait 0 contre 24.
// Le fichier n'avait pas bougé d'un pixel.
//
// Les deux côtés répondent donc à la même question — quelle est la SUITE DES COULEURS
// EFFECTIVEMENT AFFICHÉES — qu'elles viennent d'un jeton ou d'un littéral survivant.
// Qu'une couleur soit nommée ou écrite en dur ne change rien à ce qu'on voit ; et un
// littéral oublié là où un jeton était attendu reste visible dans le rapport `restes`.
//
// 🔴 COMPTER LES SURVIVANTS EST CE QUI REND CE SCRIPT UTILISABLE SUR GYM-286b. La version
// de 286a ne relevait que les `tokens.*` : elle ne pouvait valider qu'un fichier migré à
// 100 %. Or le cockpit a explicitement mis A-1, A-2, A-4, A-5 et A-8 EN ATTENTE — la
// plupart des fichiers gardent donc, sur ordre, une ou deux couleurs en dur. Chacun
// d'eux affichait une longueur différente et un « 🔴 régression » parfaitement faux.
//
// ⚠️ ET CE N'EST PAS UN ASSOUPLISSEMENT DU CONTRÔLE. La question posée reste la seule qui
// vaille : « la suite des couleurs EFFECTIVEMENT affichées est-elle inchangée ? » Qu'une
// couleur vienne d'un jeton ou d'un littéral ne change rien à ce qu'on voit — et un
// littéral oublié là où un jeton était attendu reste visible dans le rapport `restes`.
// ── L'EXTRACTION D'UN MODULE PARTAGÉ, ET CE QU'ELLE FAIT À LA SUITE ──────────────────
// 🔴 SORTIR SIX COULEURS D'UN FICHIER VERS UN MODULE LES RETIRE DE SA SUITE. C'est le cas
// de la palette d'avatars (A-7) : `edit.tsx` et `ProfileHeader.tsx` portaient chacun le
// tableau en clair ; ils n'en gardent qu'un import. Sans cette expansion, les deux
// fichiers rendaient -6 et passaient pour des régressions — alors que l'extraction est
// précisément ce que le cockpit a demandé.
//
// ⚠️ ELLE EST POSÉE À L'IMPORT, ET CE N'EST PAS ARBITRAIRE : dans les DEUX fichiers, le
// tableau était la PREMIÈRE couleur du fichier (vérifié). L'import occupe donc la même
// position dans la suite, et l'ordre est conservé — ce que ce script vérifie.
const PALETTE = (() => {
  const m = read('lib/theme/palette.ts').match(/AVATAR_COLORS = \[([^\]]+)\]/)
  return m ? [...m[1].matchAll(/'(#[0-9a-fA-F]{6})'/g)].map((x) => x[1].toUpperCase()) : []
})()
const IMPORT_PALETTE = /from '[^']*theme\/palette'/

// ── LES CONSTANTES DE COULEUR HISSÉES ────────────────────────────────────────────────
// 🔴 UNE COULEUR DÉCLARÉE UNE FOIS ET EMPLOYÉE TROIS FOIS COMPTAIT POUR UNE.
// `const ACTIVE_COLOR = '#111111'` puis deux `color={ACTIVE_COLOR}` : le côté « avant »
// voyait UNE couleur, le côté « après » — où la constante a disparu au profit de deux
// `tokens.onSurface` — en voyait DEUX. Les suites se décalaient sur tout le fichier.
// Constaté sur components/navigation/TabBar.tsx, qui en hisse trois.
//
// On résout donc les constantes : la DÉCLARATION ne compte pas, chaque EMPLOI compte pour
// sa valeur. C'est ce que voit l'écran, et c'est symétrique des deux côtés.
function constantes(src) {
  const m = {}
  for (const d of src.matchAll(/\bconst\s+([A-Z][A-Z_0-9]*)\s*(?::\s*string\s*)?=\s*'(#[0-9a-fA-F]{3,8})'/g)) {
    m[d[1]] = d[2].toUpperCase()
  }
  return m
}

const RESTE_OU_JETON = new RegExp(`${IMPORT_PALETTE.source}|${TOKEN.source}|${MOVE.source}`, 'g')
const suite = (src0) => {
  const CST = constantes(src0)
  // La déclaration est neutralisée sur place — sans quoi elle compterait EN PLUS de ses
  // emplois. On garde la longueur de la ligne pour ne pas décaler ce qui suit.
  const src = src0.replace(
    /\bconst\s+([A-Z][A-Z_0-9]*)\s*(?::\s*string\s*)?=\s*'(#[0-9a-fA-F]{3,8})'/g,
    (t) => t.replace(/[^\n]/g, ' '),
  )
  const noms = Object.keys(CST)
  const motif = noms.length
    ? new RegExp(`${RESTE_OU_JETON.source}|\\b(${noms.join('|')})\\b`, 'g')
    : RESTE_OU_JETON
  return [...src.matchAll(motif)].flatMap((m) => {
    if (CST[m[0]]) return [CST[m[0]]]
    if (IMPORT_PALETTE.test(m[0])) return PALETTE   // le module partagé, déplié à sa place
    if (m[1]) return [SEM[m[1]] + m[2].toUpperCase()] // SEMANTIC.X + 'aa'  (A-10)
    if (m[3]) return [DOP[m[3]]]                   // tokens.X
    if (m[4]) return [SEM[m[4]]]                   // SEMANTIC.X
    return [valeurAvant({ 0: m[0], 1: m[5], 2: m[6], 3: m[7] })]
  })
}
const A = suite(before)
const B = suite(after)
// Ce qui n'a PAS été migré : toute couleur encore écrite en dur après la passe.
const restes = [...after.matchAll(MOVE)].map((m) => m[0])

console.log(`\n${rel}  —  ${ref} → travail en cours`)
console.log(`couleurs avant : ${A.length}   |   jetons après : ${B.length}`)

let bad = 0
for (let i = 0; i < Math.max(A.length, B.length); i++) {
  const ok = A[i] === B[i]
  if (!ok) bad++
  console.log(`${String(i + 1).padStart(3)} ${ok ? '✓' : '✗'}  avant ${A[i] ?? '—'}   après ${B[i] ?? '—'}`)
}

if (restes.length) {
  console.log(`\n⚠️  ${restes.length} couleur(s) encore en dur : ${[...new Set(restes)].join(', ')}`)
  console.log('   Ce n’est pas forcément une faute — un signal fixe ou un logo tiers en')
  console.log('   garde le droit. Mais chacune doit être justifiée, pas oubliée.')
}

if (bad) {
  console.error(`\n🔴 ${bad} écart(s) : l’écran NE rend PAS comme avant en mode single.`)
  console.error('   Une longueur différente signale presque toujours un jeton oublié ou')
  console.error('   un jeton cité dans un commentaire que `strip` n’a pas retiré.\n')
  process.exit(1)
}
console.log('\n✅ Suite de couleurs identique, dans le même ordre. Aucun pixel déplacé.\n')
