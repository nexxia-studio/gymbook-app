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

const MOVE = /move-(bg|card|dark|accent-dim|accent|text-secondary|text-muted|border)\b|#[0-9a-fA-F]{6}\b/g
const TOKEN = /tokens\.([A-Za-z]+)|SEMANTIC\.([A-Za-z]+)/g

const rel = relative(ROOT, join(process.cwd(), target)).startsWith('..') ? target : relative(ROOT, join(process.cwd(), target))
const gitPath = join('apps/mobile', rel)
const before = strip(execFileSync('git', ['show', `${ref}:${gitPath}`], { cwd: join(ROOT, '../..'), encoding: 'utf8' }))
const after = strip(read(rel))

// AVANT : classes et littéraux, résolus par tailwind.config.js.
const A = [...before.matchAll(MOVE)].map((m) => (m[0].startsWith('#') ? m[0].toUpperCase() : TW['move-' + m[1]]))
// APRÈS : jetons, résolus par DOPAMINE_THEME et SEMANTIC — c'est-à-dire le mode single.
const B = [...after.matchAll(TOKEN)].map((m) => (m[1] ? DOP[m[1]] : SEM[m[2]]))
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
