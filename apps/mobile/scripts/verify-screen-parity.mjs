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
//
// 🔴 GYM-300 — SAUF `text-white/NN`, ET L'EXCEPTION SE MÉRITE. Cette exclusion reposait
// sur « aucun jeton ne peut les remplacer ». C'est devenu FAUX : la finition 3c migre
// exactement ces blancs, parce qu'un blanc en dur est illisible sur le fond clair d'une
// salle. Les laisser hors du motif rendrait la migration INVISIBLE au script — le côté
// « avant » ne compterait rien, le côté « après » compterait un jeton, et chaque écran
// migré sortirait en faux écart. Ils sont donc comptés des deux côtés, à leur alpha
// exact : `text-white/40` vaut #FFFFFF66, ce que rend aussi `tokens.onBackground + '66'`
// chez Dopamine. Les `move-*/alpha`, eux, restent exclus : A-3/A-4 sont toujours en
// attente, et rien ne les migre encore.
const MOVE = new RegExp(
  // `(?!\\/)` : `bg-move-accent/5` est un lavis, pas la couleur pleine — jamais migrable,
  // donc jamais comparé. Sans cette exclusion il était compté des DEUX côtés, mais à des
  // POSITIONS différentes dès qu'une migration déplace une couleur de `className` vers
  // `style` : quatre faux écarts sur WeekSlots, pour un fichier exact.
  'move-(?:bg|card|dark|accent-dim|accent|text-secondary|text-muted|border)\\b(?!\\/)'
  + '|#[0-9a-fA-F]{8}\\b|#[0-9a-fA-F]{6}\\b'
  // ⚠️ LA VARIANTE À ALPHA PASSE AVANT LA PLEINE, sans quoi `text-white/40` serait lu
  // comme `text-white` suivi d'un « /40 » orphelin — un blanc PLEIN là où il y en a 40 %.
  + `|\\b(?:${UTILS})-(?<bwAlphaName>white|black)\\/(?<bwAlphaPct>[0-9]{1,3})\\b`
  + `|\\b(?:${UTILS})-(?<palFam>${PALETTES})-(?<palTon>[0-9]{2,3})(?![0-9/])`
  + `|\\b(?:${UTILS})-(?<bwName>white|black)(?![a-z/])`,
  'g',
)

/** Tailwind exprime l'alpha en POURCENTS, le hex sur 8 chiffres en octets. */
const alphaHex = (pct) => Math.round((Number(pct) / 100) * 255).toString(16).padStart(2, '0').toUpperCase()
// ⚠️ LA CONCATÉNATION D'A-10 EST RECONNUE AVANT LE JETON NU, et l'ordre compte : sans
// elle, `SEMANTIC.success + '20'` serait lu comme le vert PLEIN #22C55E là où le fichier
// d'origine portait #22C55E20 — un succès à 12,5 % d'opacité. Le script signalerait un
// écart sur la seule écriture que le cockpit ait explicitement demandée (A-10).
//
// 🔴 GYM-300 — ET `tokens.X + 'aa'` OBÉIT À LA MÊME RÈGLE, POUR LA MÊME RAISON. La
// finition 3c écrit `tokens.onBackground + '66'` : sans cette alternative placée AVANT le
// jeton nu, le script lirait le blanc PLEIN et signalerait un écart sur l'écriture même
// que le lot demande. Les groupes sont NOMMÉS depuis ce lot — les index positionnels
// se décalaient à chaque alternative ajoutée, et une renumérotation silencieuse fait dire
// au script l'inverse de ce qu'il vérifie.
const TOKEN = new RegExp(
  "SEMANTIC\\.(?<semAlpha>[A-Za-z]+)\\s*\\+\\s*'(?<semAlphaHex>[0-9a-fA-F]{2})'"
  + "|tokens\\.(?<tokAlpha>[A-Za-z]+)\\s*\\+\\s*'(?<tokAlphaHex>[0-9a-fA-F]{2})'"
  + '|tokens\\.(?<tok>[A-Za-z]+)'
  + '|SEMANTIC\\.(?<sem>[A-Za-z]+)',
  'g',
)

/**
 * La valeur d'une occurrence « avant », quelle que soit la population dont elle vient.
 *
 * ⚠️ LIT DES GROUPES NOMMÉS (GYM-300). La version positionnelle recevait `m[5]`, `m[6]`,
 * `m[7]` — des index qui dépendaient du NOMBRE d'alternatives déclarées avant elle dans
 * `RESTE_OU_JETON`. Ajouter une alternative les décalait tous, sans erreur ni avertissement :
 * le script continuait de tourner et comparait des couleurs prises au mauvais endroit.
 */
function valeurAvant(texte, g) {
  if (texte.startsWith('#')) return texte.toUpperCase()
  if (g.palFam) {
    const v = TW_COLORS[g.palFam] && TW_COLORS[g.palFam][g.palTon]
    return typeof v === 'string' ? v.toUpperCase() : null
  }
  // GYM-300 — `text-white/40` → #FFFFFF66, la valeur que rend aussi `tokens.X + '66'`.
  if (g.bwAlphaName) {
    return (g.bwAlphaName === 'white' ? '#FFFFFF' : '#000000') + alphaHex(g.bwAlphaPct)
  }
  if (g.bwName) return g.bwName === 'white' ? '#FFFFFF' : '#000000'
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
const suite = (src0, avecBrut = false) => {
  const CST = constantes(src0)
  // La déclaration est neutralisée sur place — sans quoi elle compterait EN PLUS de ses
  // emplois. On garde la longueur de la ligne pour ne pas décaler ce qui suit.
  const src = src0.replace(
    /\bconst\s+([A-Z][A-Z_0-9]*)\s*(?::\s*string\s*)?=\s*'(#[0-9a-fA-F]{3,8})'/g,
    (t) => t.replace(/[^\n]/g, ' '),
  )
  const noms = Object.keys(CST)
  const motif = noms.length
    ? new RegExp(`${RESTE_OU_JETON.source}|\\b(?<cst>${noms.join('|')})\\b`, 'g')
    : RESTE_OU_JETON
  return [...src.matchAll(motif)].flatMap((m) => {
    const g = m.groups ?? {}
    let valeurs
    if (CST[m[0]]) valeurs = [CST[m[0]]]
    else if (IMPORT_PALETTE.test(m[0])) valeurs = PALETTE  // le module partagé, déplié
    else if (g.semAlpha) valeurs = [SEM[g.semAlpha] + g.semAlphaHex.toUpperCase()]  // A-10
    else if (g.tokAlpha) valeurs = [DOP[g.tokAlpha] + g.tokAlphaHex.toUpperCase()]  // 3c
    else if (g.tok) valeurs = [DOP[g.tok]]
    else if (g.sem) valeurs = [SEM[g.sem]]
    else valeurs = [valeurAvant(m[0], g)]
    return avecBrut ? valeurs.map((valeur) => ({ valeur, brut: m[0] })) : valeurs
  })
}
// ═════════════════════════════════════════════════════════════════════════════════════
// 🔴 GYM-301 — LE SEUL CAS OÙ UN JETON AJOUTÉ NE DÉPLACE AUCUN PIXEL
// ═════════════════════════════════════════════════════════════════════════════════════
// Poser un FOND SOUS UN VOILE ajoute une couleur au fichier sans rien changer à l'écran,
// dès lors que le voile est OPAQUE en single — il couvre alors intégralement le fond
// ajouté. Ce script compte des couleurs, pas des calques : il verrait une régression là
// où il n'y en a pas.
//
// ⚠️ L'EXEMPTION EST NOMMÉE, LOCALE, ET BRUYANTE. Elle ne s'applique qu'aux lignes
// portant le marqueur exact, elle est ANNONCÉE à chaque exécution, et elle ne dispense de
// rien : l'opacité du voile en single est vérifiée par `verify-theme-parity.mjs`, qui
// échoue si `DOPAMINE_THEME.surface` cesse d'être opaque. Sans cette seconde vérification
// le marqueur serait un permis de masquer une régression.
const MARQUEUR = 'parité:fond-sous-voile'

/** Les jetons posés sur une ligne marquée, retirés de la suite « après ». */
function sansFondSousVoile(src, jetons) {
  // ⚠️ ON DÉBALLE MÊME SANS MARQUEUR. Rendre les objets tels quels ici comparait des
  // enveloppes à des chaînes : les 83 fichiers sortaient en écart d'un coup.
  if (!src.includes(MARQUEUR)) return { jetons: jetons.map((j) => j.valeur), ignores: [] }
  const lignesMarquees = new Set(
    src.split('\n').flatMap((l, i) => (l.includes(MARQUEUR) ? [i] : [])),
  )
  const ignores = []
  const gardes = []
  let curseur = 0
  for (const j of jetons) {
    // Les jetons sont produits dans l'ordre du texte : on avance en parallèle pour
    // retrouver la ligne de chacun.
    const pos = src.indexOf(j.brut, curseur)
    if (pos >= 0) curseur = pos + j.brut.length
    const ligne = pos < 0 ? -1 : src.slice(0, pos).split('\n').length - 1
    if (lignesMarquees.has(ligne)) ignores.push(j.valeur)
    else gardes.push(j.valeur)
  }
  return { jetons: gardes, ignores }
}

const A = suite(before).map((v) => v)
const brutsApres = suite(after, true)
const { jetons: B, ignores } = sansFondSousVoile(after, brutsApres)
if (ignores.length) {
  console.log(`\n⚠️  ${ignores.length} jeton(s) exemptés — « ${MARQUEUR} » : ${ignores.join(', ')}`)
  console.log('   Un fond posé SOUS un voile opaque : compté par le script, invisible à l’écran.')
  console.log('   L’opacité du voile est vérifiée séparément par verify-theme-parity.mjs.')
}
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
