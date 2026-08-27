#!/usr/bin/env node
// GYM-286a — 🔴 LA PREUVE DE NON-RÉGRESSION, MÉCANIQUE.
//
// ═════════════════════════════════════════════════════════════════════════════════════
// CE QUE CE SCRIPT EMPÊCHE
// ═════════════════════════════════════════════════════════════════════════════════════
// Migrer un écran, c'est remplacer `bg-move-dark` par `tokens.background`. En mode
// `single`, les deux DOIVENT valoir #111111 — sinon l'app de Nico change de couleur, et
// le changement ne se verra ni au `tsc`, ni à la relecture du diff : le diff, lui, aura
// l'air parfaitement correct.
//
// Ce script compare donc les deux sources ligne à ligne : `tailwind.config.js`, qui
// habille les classes encore en place, et `DOPAMINE_THEME`, qui habille tout ce qui est
// déjà migré. Tant que GYM-286b n'a pas retiré la DERNIÈRE classe `move-*`, les deux
// coexistent dans la même app, souvent dans le même écran — et doivent dire la même
// chose au caractère près.
//
// ⚠️ IL NE VÉRIFIE PAS QUE L'APP EST BELLE, il vérifie qu'elle n'a pas bougé. C'est la
// seule question à laquelle on peut répondre sans un téléphone, et c'est celle qui
// engage la production.
//
// USAGE :  node scripts/verify-theme-parity.mjs
// SORTIE :  0 si tout concorde, 1 au premier écart (avec les deux valeurs en regard).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

// ── 1. LA SOURCE : tailwind.config.js ────────────────────────────────────────────────
// Lu par expression régulière plutôt que par `require`. Le fichier est du CommonJS et
// ce script est un module ES : l'importer demanderait une passe d'interopérabilité qui
// n'apporterait rien ici — on ne cherche que huit paires « nom : #hex ».
function tailwindColors() {
  const src = read('tailwind.config.js')
  const block = src.match(/colors:\s*\{([\s\S]*?)\}/)
  if (!block) throw new Error('tailwind.config.js : bloc `colors` introuvable')
  const out = {}
  for (const m of block[1].matchAll(/'([^']+)':\s*'(#[0-9a-fA-F]{3,8})'/g)) out[m[1]] = m[2].toUpperCase()
  return out
}

// ── 2. LA COPIE : DOPAMINE_THEME ─────────────────────────────────────────────────────
function dopamineTheme() {
  const src = read('lib/theme/ThemeProvider.tsx')
  const block = src.match(/export const DOPAMINE_THEME: ThemeTokens = \{([\s\S]*?)\n\}/)
  if (!block) throw new Error('ThemeProvider.tsx : DOPAMINE_THEME introuvable')
  const out = {}
  for (const m of block[1].matchAll(/^\s{2}([A-Za-z]+):\s*'([^']+)'/gm)) out[m[1]] = m[2].toUpperCase()
  return out
}

// ── 3. LA TABLE DE CORRESPONDANCE ────────────────────────────────────────────────────
// 🔴 C'EST LE CŒUR DU LOT, ET C'EST ICI QU'IL SE RELIT. Chaque ligne dit : « telle
// classe Tailwind devient tel jeton ». GYM-286b n'a pas à réinventer ces couples ; il
// les applique. Toute ligne ajoutée ici doit l'être avec sa vérification.
//
// ⚠️ `move-dark` APPARAÎT DEUX FOIS, ET C'EST LA LEÇON DU PILOTE. La même couleur sert
// deux rôles que le thème sépare : FOND de la bande d'en-tête (`background`) et ENCRE
// du texte sur les surfaces claires (`onSurface`). Chez Dopamine les deux valent
// #111111, ce qui rend la confusion indolore — et invisible. Chez une salle, `background`
// devient sa couleur et `onSurface` reste une encre lisible : un écran qui aurait migré
// `text-move-dark` vers `background` écrirait son texte dans la couleur du fond.
const MAP = [
  ['move-dark',           'background',         'FOND de la bande sombre (bg-move-dark)'],
  ['move-dark',           'onSurface',          'ENCRE sur surface claire (text-move-dark)'],
  ['move-card',           'surface',            'carte (bg-move-card)'],
  ['move-bg',             'page',               'fond de page clair (bg-move-bg)'],
  ['move-border',         'border',             'séparateur (border-move-border)'],
  ['move-accent',         'accent',             'action (bg-/text-move-accent)'],
  ['move-accent-dim',     'accentDim',          'action atténuée (text-move-accent-dim)'],
  ['move-text-secondary', 'onSurfaceSecondary', 'texte secondaire'],
  ['move-text-muted',     'onBackgroundMuted',  'texte discret'],
]

// ── 4. LES LITTÉRAUX QUI N'ONT PAS DE CLASSE ─────────────────────────────────────────
// Deux couleurs de l'app n'ont jamais eu de nom dans `tailwind.config.js` : le blanc
// posé sur la bande sombre, et le noir des icônes sur fond clair. Elles n'en sont pas
// moins des jetons — et leur valeur doit être vérifiée comme les autres.
const LITERALS = [
  ['#FFFFFF', 'onBackground', 'texte et icônes sur la bande sombre'],
  ['#111111', 'onAccent',     'encre sur l’action (lime Dopamine)'],
]

// ── 5. LES SIGNAUX ───────────────────────────────────────────────────────────────────
// Vérification d'une autre nature : un jeton sémantique ne se compare à aucune source,
// il SE CONSTATE DANS LE CODE. On exige donc que chaque valeur déclarée soit encore
// employée en dur quelque part — sinon le jeton a dérivé de ce qu'il prétend remplacer,
// ou la valeur a disparu de l'app et le jeton est un fantôme.
function semanticTokens() {
  const src = read('lib/theme/semantic.ts')
  const block = src.match(/export const SEMANTIC = \{([\s\S]*?)\n\} as const/)
  if (!block) throw new Error('semantic.ts : SEMANTIC introuvable')
  const out = {}
  for (const m of block[1].matchAll(/^\s{2}([A-Za-z]+):\s*'(#[0-9a-fA-F]{3,8})'/gm)) out[m[1]] = m[2].toUpperCase()
  return out
}

// ─────────────────────────────────────────────────────────────────────────────────────
const tw = tailwindColors()
const dop = dopamineTheme()
const sem = semanticTokens()
const fails = []
const lines = []

for (const [cls, token, role] of MAP) {
  const a = tw[cls]
  const b = dop[token]
  const ok = a !== undefined && a === b
  if (!ok) fails.push(`${cls} (${a ?? 'ABSENT'}) ≠ tokens.${token} (${b ?? 'ABSENT'})  — ${role}`)
  lines.push(`  ${ok ? '✓' : '✗'} ${cls.padEnd(20)} → tokens.${token.padEnd(19)} ${a ?? '—'}  ${role}`)
}

for (const [hex, token, role] of LITERALS) {
  const b = dop[token]
  const ok = hex.toUpperCase() === b
  if (!ok) fails.push(`littéral ${hex} ≠ tokens.${token} (${b ?? 'ABSENT'}) — ${role}`)
  lines.push(`  ${ok ? '✓' : '✗'} ${hex.padEnd(20)} → tokens.${token.padEnd(19)} ${hex}  ${role}`)
}

console.log('\nMARQUE + NEUTRE — jeton résolu contre valeur en dur (mode single)')
console.log(lines.join('\n'))

// ── SÉMANTIQUE — LA QUESTION A DÛ ÊTRE REFORMULÉE (GYM-286b) ─────────────────────────
// 🔴 LA VERSION DE 286a SE CONDAMNAIT ELLE-MÊME. Elle exigeait que la valeur d'un jeton
// sémantique soit ENCORE ÉCRITE EN DUR quelque part — bonne règle tant que rien
// n'employait les jetons, absurde dès qu'on s'en sert : migrer le dernier #C9C7C0 vers
// `SEMANTIC.disabledInk` faisait échouer la vérification pour cause de succès.
// Constaté au premier lot de 286b, sur `components/ui/PasswordRules.tsx`.
//
// La question utile n'était pas « la valeur survit-elle » mais « le jeton est-il encore
// RATTACHÉ À QUELQUE CHOSE ». Un jeton est sain s'il est EMPLOYÉ (`SEMANTIC.x` apparaît
// dans l'app) OU si sa valeur reste en dur quelque part — donc en cours de migration.
// Les deux absents : plus personne ne s'en sert et plus rien ne lui correspond, c'est un
// fantôme, et c'est cela qu'il faut signaler.
console.log('\nSÉMANTIQUE — le jeton est-il rattaché à quelque chose ?')
// ⚠️ LES COMMENTAIRES SONT VIDÉS AVANT LA MESURE — piège P-1, et il mord ici plus fort
// qu'ailleurs. Un fichier qui EXPLIQUE pourquoi il n'emploie PAS `SEMANTIC.warning`
// contient le texte « SEMANTIC.warning » : sans cette passe, le jeton était compté comme
// employé par la phrase même qui disait le contraire. Constaté sur PasswordStrength.tsx
// et PasswordRules.tsx, dont les commentaires d'attente A-1/A-2 nomment les jetons
// qu'ils refusent d'utiliser.
const videCommentaires = (t) => t
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^[ \t]*\/\/.*$/gm, ' ')
const appSrc = ['app', 'components']
  .flatMap((d) => listFiles(join(ROOT, d)))
  .filter((f) => /\.tsx?$/.test(f) && !f.includes('/components/viniz/'))
  .map((f) => videCommentaires(readFileSync(f, 'utf8')))
  .join('\n')
for (const [name, hex] of Object.entries(sem)) {
  const enDur = new RegExp(hex, 'i').test(appSrc)
  const employe = new RegExp(`SEMANTIC\\.${name}\\b`).test(appSrc)
  const ok = enDur || employe
  if (!ok) {
    fails.push(`SEMANTIC.${name} = ${hex} : jeton fantôme — ni employé, ni présent en dur`)
  }
  const etat = employe && enDur ? 'employé, migration en cours'
    : employe ? 'employé, migration terminée'
      : enDur ? 'pas encore employé' : 'FANTÔME'
  console.log(`  ${ok ? '✓' : '✗'} SEMANTIC.${name.padEnd(15)} ${hex}   ${etat}`)
}

function listFiles(dir) {
  const out = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) out.push(...listFiles(p))
    else out.push(p)
  }
  return out
}

if (fails.length) {
  console.error(`\n🔴 ${fails.length} ÉCART(S) — LA MIGRATION CHANGERAIT LES PIXELS DE DOPAMINE :\n`)
  for (const f of fails) console.error(`   ${f}`)
  console.error('\nNe pas « corriger » en alignant le jeton : c’est l’écart lui-même qu’il faut')
  console.error('remonter, il signale une décision de charte que ce lot n’a pas à prendre.\n')
  process.exit(1)
}
console.log('\n✅ Aucun écart. Un écran migré rend à l’identique en mode single.\n')
