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
  + '|#[0-9a-fA-F]{6}\\b'
  + `|\\b(?:${UTILS})-(${PALETTES})-([0-9]{2,3})(?![0-9/])`
  + `|\\b(?:${UTILS})-(white|black)(?![a-z/])`,
  'g',
)
const TOKEN = /tokens\.([A-Za-z]+)|SEMANTIC\.([A-Za-z]+)/g

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
const RESTE_OU_JETON = new RegExp(`${TOKEN.source}|${MOVE.source}`, 'g')
const suite = (src) => [...src.matchAll(RESTE_OU_JETON)].map((m) => {
  if (m[1]) return DOP[m[1]]                    // tokens.X
  if (m[2]) return SEM[m[2]]                    // SEMANTIC.X
  return valeurAvant({ 0: m[0], 1: m[3], 2: m[4], 3: m[5] })
})
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
