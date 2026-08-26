#!/usr/bin/env node
// GYM-286a — L'INVENTAIRE, PRODUIT PAR LA MACHINE.
//
// ⚠️ CE FICHIER EXISTE POUR QUE L'INVENTAIRE NE SOIT PAS UNE LISTE ÉCRITE À LA MAIN.
// Une liste à la main est juste le jour où on l'écrit, et fausse dès la première
// migration. Celle-ci se régénère : `node scripts/inventaire-couleurs.mjs --md` rend le
// tableau de docs/GYM-286-inventaire.md, et GYM-286b peut mesurer ce qu'il lui reste.
//
// ── GYM-286b — LE PÉRIMÈTRE ÉLARGI AUX TROIS POPULATIONS OUBLIÉES ────────────────────
// 286a n'avait mandat que sur les classes `move-*` et les hexadécimaux. Il en avait
// signalé 172 autres, qu'aucun des deux `grep` ne voyait :
//   · 101 classes de la palette Tailwind par défaut (`text-red-500`, `bg-green-500/10`) ;
//   ·  64 `text-white` / `bg-black/40` / `bg-transparent` ;
//   ·   7 `rgba()` littéraux.
// Elles sont désormais comptées et classées au même format.
//
// 🔴 ET LA PLUPART NE SE MIGRENT PAS, POUR UNE RAISON DE FOND. Une valeur ne devient un
// jeton que si elle vaut EXACTEMENT ce jeton. `text-red-500` vaut #EF4444, c'est-à-dire
// SEMANTIC.danger au caractère près : elle se migre. `bg-red-500/10` vaut le même rouge à
// 10 % d'opacité — une autre couleur, qu'aucun jeton ne nomme. La migrer « à peu près »
// serait la régression d'un pixel que tout ce lot existe pour éviter.
//
// ⚠️ ET LES LAISSER N'EST PAS UN DEMI-TRAVAIL. Ces valeurs sont SÉMANTIQUES : leur seul
// devoir est de ne jamais suivre la marque, et une classe Tailwind figée le fait déjà
// parfaitement. Les rassembler sous un jeton est un gain de source unique, pas de
// correction — ce qui est exactement pourquoi cela peut attendre un arbitrage.
//
// USAGE :
//   node scripts/inventaire-couleurs.mjs          résumé par famille
//   node scripts/inventaire-couleurs.mjs --md     le tableau par fichier, en Markdown
//   node scripts/inventaire-couleurs.mjs --reste  ce qui n'est pas encore migré
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { createRequire } from 'node:module'

// ⚠️ LA PALETTE EST LUE DANS LE PAQUET INSTALLÉ, PAS RECOPIÉE. Recopier #EF4444 ici en
// affirmant que c'est `red-500` serait exactement le genre de mémoire que ce script
// existe pour remplacer — et une montée de version de Tailwind la rendrait fausse en
// silence. `createRequire` parce que `tailwindcss/colors` est du CommonJS.
const TW_COLORS = createRequire(import.meta.url)('tailwindcss/colors')

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// ── LE PÉRIMÈTRE, ET POURQUOI CELUI-LÀ ───────────────────────────────────────────────
// `app/**` et `components/**` sont EXACTEMENT les deux globs `content` de
// tailwind.config.js : hors d'eux, une classe `move-*` n'est même pas générée. Le
// périmètre n'est donc pas un choix de commodité, c'est la définition de la surface.
// `components/viniz/**` en est retiré : ces composants sont nés migrés au lot 3.
const DIRS = ['app', 'components']
const EXCLUDE = /\/components\/viniz\//

const MOVE_VALUES = {
  'move-bg': '#F5F4F0', 'move-card': '#FFFFFF', 'move-dark': '#111111',
  'move-accent': '#C8F000', 'move-accent-dim': '#9DB800',
  'move-text-secondary': '#6B6861', 'move-text-muted': '#9A9890', 'move-border': '#E8E6E0',
}

// ── LES TROIS FAMILLES ───────────────────────────────────────────────────────────────
// M = MARQUE (suit la salle) · S = SÉMANTIQUE (fixe, ne suit JAMAIS) · N = NEUTRE
// A = À ARBITRER — le cockpit tranche avant 286b, ce script ne fait que la recommandation.
const F = { M: 'MARQUE', S: 'SÉMANTIQUE', N: 'NEUTRE', A: 'À ARBITRER' }

// Le rôle se lit dans l'ATTRIBUT qui porte la couleur, pas dans la couleur.
// C'est ce qui permet à #111111 d'être un FOND de marque ici et une ENCRE neutre là.
const FG = /^(text-|fill-|stroke-)/
const BG = /^(bg-)/
const BD = /^(border-|divide-|ring-)/
const ATTR_FG = /(color|fill|stroke|tintColor|thumbColor|placeholderTextColor)\s*[:=]/i
const ATTR_BG = /(backgroundColor|trackColor)\s*[:=]/i
const ATTR_BD = /(borderColor|borderTopColor|borderBottomColor)\s*[:=]/i
const ATTR_SH = /(shadowColor)\s*[:=]/i

/** value → [famille, jeton, note]. `null` en 2e position = pas de jeton, la valeur reste. */
const RULES = {
  '#C8F000': [F.M, 'tokens.accent', 'le lime Dopamine : l’action, donc la marque'],
  '#F5F4F0': [F.N, 'tokens.page', 'fond de page clair'],
  '#E8E6E0': [F.N, 'tokens.border', 'séparateur'],
  '#9A9890': [F.N, 'tokens.onBackgroundMuted', 'texte discret'],
  '#6B6861': [F.N, 'tokens.onSurfaceSecondary', 'texte secondaire'],
  '#EF4444': [F.S, 'SEMANTIC.danger', 'erreur, destruction, refus'],
  '#F97316': [F.S, 'SEMANTIC.warning', 'alerte, attente'],
  '#22C55E': [F.S, 'SEMANTIC.success', 'succès, disponibilité'],
  '#E5E5E5': [F.S, 'SEMANTIC.disabledTrack', 'état désactivé — piste d’interrupteur'],
  '#C9C7C0': [F.S, 'SEMANTIC.disabledInk', 'état désactivé — règle non satisfaite'],
  // Marques TIERCES : fixes comme un signal, mais sans jeton — voir la note du document.
  '#4285F4': [F.S, null, 'logo Google (bleu officiel) — immuable'],
  '#34A853': [F.S, null, 'logo Google (vert officiel) — immuable'],
  '#FBBC05': [F.S, null, 'logo Google (jaune officiel) — immuable'],
  '#EA4335': [F.S, null, 'logo Google (rouge officiel) — immuable'],
  '#25D366': [F.S, null, 'vert WhatsApp officiel — immuable'],
  // Ombres et écran de démarrage.
  '#000': [F.N, null, 'ombre portée — reste noire, une ombre n’a pas de marque'],
  '#000000': [F.N, null, 'fond du splash natif — figé par app.config.ts (GYM-238)'],
  // Gris hors palette : à rattacher, mais le rattachement change des pixels.
  '#141414': [F.A, 'tokens.background ?', 'quasi-noir voisin de move-dark #111111'],
  '#333333': [F.A, null, 'gris de piste de progression sur fond sombre'],
  '#555555': [F.A, null, 'icône inactive sur fond sombre'],
  '#666666': [F.A, null, 'gris hors palette'],
  '#888888': [F.A, null, 'gris hors palette'],
  '#999999': [F.A, null, 'gris hors palette'],
  '#E5E5E0': [F.A, 'tokens.border ?', 'gris voisin de move-border #E8E6E0'],
  '#F0EFEB': [F.A, 'tokens.page ?', 'gris voisin de move-bg #F5F4F0'],
  // ── GYM-286b — LES NUANCES DE LA PALETTE TAILWIND ──────────────────────────────────
  // Même raisonnement que pour les rouges en dur : elles DISENT la bonne chose (erreur,
  // alerte, succès) mais ne VALENT aucun jeton. `text-green-600` #16A34A n'est pas
  // `SEMANTIC.success` #22C55E — c'est un autre vert. Les rassembler relève de A-2.
  //
  // ⚠️ ET LES LAISSER EN CLASSE TAILWIND EST SANS DANGER : figées à la compilation, elles
  // ne suivront jamais la marque, ce qui est précisément ce qu'on attend d'un signal.
  '#16A34A': [F.A, 'SEMANTIC.success ?', 'vert 600 — fusionner avec #22C55E ? (A-2)'],
  '#F87171': [F.A, 'SEMANTIC.danger ?', 'rouge 400 — fusionner avec #EF4444 ? (A-2)'],
  '#FECACA': [F.A, null, 'rouge 200 — teinte de bordure, aucun jeton (A-2)'],
  '#FEF2F2': [F.A, null, 'rouge 50 — fond de bandeau d’erreur, aucun jeton (A-2)'],
  '#FB923C': [F.A, 'SEMANTIC.warning ?', 'orange 400 — fusionner avec #F97316 ? (A-2)'],
  '#C2410C': [F.A, null, 'orange 700 — encre sur fond orangé clair (A-2)'],
  '#9A3412': [F.A, null, 'orange 800 — encre sur fond orangé clair (A-2)'],
  '#FFEDD5': [F.A, null, 'orange 100 — fond de bandeau d’alerte (A-2)'],
  '#FFF7ED': [F.A, null, 'orange 50 — fond de bandeau d’alerte (A-2)'],
  '#FCD34D': [F.A, null, 'ambre 300 — bordure de bandeau (A-2)'],
  '#92400E': [F.A, null, 'ambre 800 — encre sur fond ambré (A-2)'],
  '#78350F': [F.A, null, 'ambre 900 — encre sur fond ambré (A-2)'],
  '#FFFBEB': [F.A, null, 'ambre 50 — fond de bandeau (A-2)'],
  '#DCFCE7': [F.A, null, 'vert 100 — fond de pastille de succès (A-2)'],
  '#F0FDF4': [F.A, null, 'vert 50 — fond de bandeau de succès (A-2)'],
  // Gris de la palette Tailwind : HORS de la liste des huit gris d'A-6, qui ne nomme que
  // ceux écrits en dur. Aucun jeton ne les vaut ; ils attendent leur propre arbitrage.
  '#737373': [F.A, null, 'neutral 500 — gris Tailwind, hors des huit gris d’A-6'],
  '#9CA3AF': [F.A, null, 'gray 400 — gris Tailwind, hors des huit gris d’A-6'],
  '#F3F4F6': [F.A, null, 'gray 100 — gris Tailwind, hors des huit gris d’A-6'],
  // Signaux non canoniques : la FUSION est une décision de charte, pas une migration.
  '#DC2626': [F.A, 'SEMANTIC.danger ?', 'second rouge — fusionner avec #EF4444 ?'],
  '#E53935': [F.A, 'SEMANTIC.danger ?', 'troisième rouge — fusionner ?'],
  '#EA580C': [F.A, 'SEMANTIC.warning ?', 'second orange — fusionner avec #F97316 ?'],
  '#EF9F27': [F.A, 'SEMANTIC.warning ?', 'troisième orange — fusionner ?'],
  '#F59E0B': [F.A, 'SEMANTIC.warning ?', 'ambre — fusionner ?'],
  '#B45309': [F.A, 'SEMANTIC.warning ?', 'ambre foncé — fusionner ?'],
  '#639922': [F.A, 'SEMANTIC.success ?', 'vert de variation positive (studio)'],
  '#22C55E20': [F.A, 'SEMANTIC.success + alpha', 'succès à 12,5 % — jeton ou opacité ?'],
  // Rampe d'intensité du studio : dérivée du lime, donc de la marque… ou lecture de donnée.
  '#C0DD97': [F.A, null, 'rampe d’affluence 1/3 (studio)'],
  '#97C459': [F.A, null, 'rampe d’affluence 2/3 (studio)'],
  '#3B6D11': [F.A, null, 'rampe d’affluence 3/3 (studio)'],
  // Palette d'avatars : identité du MEMBRE, pas de la salle.
  '#4ECDC4': [F.A, null, 'palette d’avatars (1/6)'],
  '#FF6B6B': [F.A, null, 'palette d’avatars (2/6)'],
  '#6C5CE7': [F.A, null, 'palette d’avatars (3/6)'],
  '#FF8E53': [F.A, null, 'palette d’avatars (4/6)'],
  '#A8E6CF': [F.A, null, 'palette d’avatars (5/6)'],
  '#B8B8FF': [F.A, null, 'palette d’avatars (6/6)'],
}

/** #111111 et #FFFFFF : le rôle DÉPEND de l'attribut. C'est le cœur de la méthode. */
function classify(value, role) {
  if (value === '#111111') {
    return role === 'bg'
      ? [F.M, 'tokens.background', 'FOND de la bande sombre — c’est là que la marque se voit']
      : [F.N, 'tokens.onSurface', 'ENCRE sur surface claire — ≠ onAccent, malgré la même valeur']
  }
  if (value === '#FFFFFF') {
    return role === 'bg'
      ? [F.N, 'tokens.surface', 'carte posée sur la page']
      : [F.N, 'tokens.onBackground', 'encre sur la bande sombre']
  }
  if (value === '#9DB800') {
    return [F.A, 'tokens.accentDim / SEMANTIC.success ?',
      '4 emplois sur 5 sont des SUCCÈS (règle satisfaite, envoi confirmé) : marque ou signal ?']
  }
  return RULES[value] ?? [F.A, null, 'valeur non classée — à examiner']
}

/**
 * Vide les commentaires de leur contenu SANS supprimer de ligne.
 *
 * 🔴 UN COMMENTAIRE QUI EXPLIQUE LA MIGRATION CITE LES COULEURS QU'ELLE REMPLACE. Sans
 * cette passe, ces citations sont comptées comme du code : le pilote, une fois migré,
 * « contenait » encore huit couleurs en dur qu'il n'affiche nulle part — et l'inventaire
 * de GYM-286b n'aurait jamais convergé vers zéro.
 *
 * ⚠️ ON REMPLACE PAR DES SAUTS DE LIGNE, PAS PAR DU VIDE : les numéros de ligne du
 * rapport doivent rester ceux du fichier, sinon il n'est plus consultable.
 */
function blankComments(src) {
  const blank = (m) => m.replace(/[^\n]/g, ' ')
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/^[ \t]*\/\/.*$/gm, blank)
}

/**
 * La classification, alpha compris.
 *
 * 🔴 UNE VALEUR TRANSPARENTE NE SE MIGRE JAMAIS, et ce n'est pas une prudence excessive :
 * `bg-red-500/10` n'est pas le rouge d'erreur, c'est un lavis de ce rouge. Aucun jeton ne
 * le nomme, et l'approcher par `SEMANTIC.danger` changerait un fond plein en un fond à
 * 10 % — la plus voyante des régressions, obtenue en croyant bien faire.
 *
 * ⚠️ CE N'EST PAS UNE DETTE POUR AUTANT. Ces valeurs sont sémantiques : elles doivent
 * rester fixes, et une classe Tailwind figée est déjà exactement cela. Ce qui manque est
 * une source unique, pas une correction.
 */
function classifyAny(value, role, alpha) {
  if (value === 'TRANSPARENT') {
    return [F.N, null, 'absence de fond — ce n’est pas une couleur, rien à migrer']
  }
  if (alpha) {
    const base = RULES[value]
    const nom = base && base[1] ? base[1] : 'aucun jeton'
    return [F.A, null,
      `${value} à ${alpha === 'litt' ? 'opacité littérale' : alpha + ' %'} — ${nom} ne vaut que la valeur PLEINE`]
  }
  return classify(value, role)
}

function walk(dir) {
  const out = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (/\.tsx?$/.test(p) && !EXCLUDE.test(p)) out.push(p)
  }
  return out
}

// ── LE MOTIF, ET SES CINQ ALTERNATIVES ───────────────────────────────────────────────
//   1. `<préfixe>move-<nom>`      les classes de Dopamine
//   2. `#RRGGBB`                  les littéraux
//   3. `<util>-<famille>-<ton>`   la palette Tailwind par défaut, avec son `/alpha`
//   4. `<util>-white|black|transparent`, avec son `/alpha`
//   5. `rgba(…)`                  les littéraux transparents
const PALETTES = 'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald'
  + '|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'
const UTILS = 'bg|text|border|fill|stroke|ring|divide|placeholder|shadow'
const RE = new RegExp(
  '([a-z-]*)(move-(?:bg|card|dark|accent-dim|accent|text-secondary|text-muted|border))(?:\\/([0-9]+))?\\b'
  + '|(#[0-9a-fA-F]{3,8})\\b'
  + `|\\b(${UTILS})-(${PALETTES})-([0-9]{2,3})(?:\\/([0-9]+))?\\b`
  + `|\\b(${UTILS})-(white|black|transparent)(?:\\/([0-9]+))?\\b`
  + '|(rgba?\\([0-9., ]+\\))',
  'g',
)

/**
 * Ce que vaut une classe de la palette Tailwind, alpha compris.
 *
 * 🔴 L'ALPHA EST CE QUI DÉCIDE DE TOUT. Sans lui, `bg-red-500` et `bg-red-500/10` se
 * ressemblent ; avec lui, la première EST `SEMANTIC.danger` et la seconde ne l'est pas.
 * On rend donc la valeur ET l'opacité, et la classification ne migre que ce qui est opaque.
 */
function twValue(famille, ton) {
  const f = TW_COLORS[famille]
  const v = f && f[ton]
  return typeof v === 'string' ? v.toUpperCase() : null
}

const rows = []
for (const abs of DIRS.flatMap((d) => walk(join(ROOT, d)))) {
  const rel = relative(ROOT, abs)
  const src = blankComments(readFileSync(abs, 'utf8'))
  src.split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return // les commentaires ne peignent rien
    for (const m of line.matchAll(RE)) {
      const [prefix, cls, clsAlpha, hex] = [m[1] ?? '', m[2], m[3], m[4]]
      const [palUtil, palFam, palTon, palAlpha] = [m[5], m[6], m[7], m[8]]
      const [bwUtil, bwName, bwAlpha] = [m[9], m[10], m[11]]
      const rgbaLit = m[12]

      let value = null
      let raw = null
      let alpha = null
      let utilPrefix = prefix

      if (cls) {
        // ⚠️ `bg-move-accent/15` N'EST PAS `bg-move-accent`. Même règle que pour la
        // palette Tailwind : un lavis à 15 % n'est pas la couleur pleine, et
        // `tokens.accent` ne le vaut pas. Sans ce groupe, l'inventaire annonçait 15
        // occurrences migrables qui, migrées, auraient rempli à 100 % des fonds prévus
        // à 5, 10, 15, 30 ou 50 % — la régression la plus voyante du lot.
        value = MOVE_VALUES[cls]
        raw = prefix + cls + (clsAlpha ? '/' + clsAlpha : '')
        alpha = clsAlpha ?? null
      } else if (hex) {
        value = hex.toUpperCase()
        raw = hex
      } else if (palFam) {
        value = twValue(palFam, palTon)
        raw = `${palUtil}-${palFam}-${palTon}${palAlpha ? '/' + palAlpha : ''}`
        alpha = palAlpha ?? null
        utilPrefix = palUtil + '-'
      } else if (bwName) {
        // `transparent` n'est PAS une couleur : c'est l'absence de fond. Elle n'a rien à
        // devenir, et la compter comme migrable ferait mentir le reste-à-faire.
        value = bwName === 'white' ? '#FFFFFF' : bwName === 'black' ? '#000000' : 'TRANSPARENT'
        raw = `${bwUtil}-${bwName}${bwAlpha ? '/' + bwAlpha : ''}`
        alpha = bwAlpha ?? null
        utilPrefix = bwUtil + '-'
      } else if (rgbaLit) {
        value = rgbaLit.replace(/\s+/g, '')
        raw = rgbaLit
        alpha = 'litt'
      }
      if (!value) continue

      let role
      if (cls || palFam || bwName) {
        role = BG.test(utilPrefix) ? 'bg' : BD.test(utilPrefix) ? 'bd' : 'fg'
      } else if (ATTR_BG.test(line)) role = 'bg'
      else if (ATTR_BD.test(line)) role = 'bd'
      else if (ATTR_SH.test(line)) role = 'sh'
      else if (ATTR_FG.test(line)) role = 'fg'
      else role = 'bg' // style={{ backgroundColor }} multiligne : le fond est le cas par défaut

      const [fam, token, note] = classifyAny(value, role, alpha)
      rows.push({ file: rel, line: i + 1, raw, value, role, fam, token, note, alpha })
    }
  })
}

const arg = process.argv[2]

if (arg === '--md') {
  const byFile = new Map()
  for (const r of rows) {
    if (!byFile.has(r.file)) byFile.set(r.file, [])
    byFile.get(r.file).push(r)
  }
  const ordered = [...byFile.entries()].sort((a, b) => b[1].length - a[1].length)
  for (const [file, rs] of ordered) {
    const n = rs.length
    console.log(`\n#### \`${file}\` — ${n} occurrence${n > 1 ? 's' : ''}\n`)
    console.log('| valeur | ×  | rôle | famille | jeton cible |')
    console.log('|---|---|---|---|---|')
    const agg = new Map()
    for (const r of rs) {
      const k = `${r.value}|${r.role}`
      if (!agg.has(k)) agg.set(k, { ...r, n: 0, raws: new Set() })
      agg.get(k).n++
      agg.get(k).raws.add(r.raw)
    }
    for (const a of [...agg.values()].sort((x, y) => y.n - x.n)) {
      const roleLabel = { bg: 'fond', fg: 'encre', bd: 'bordure', sh: 'ombre' }[a.role]
      // Un littéral EST déjà sa valeur : la répéter alourdit le tableau sans rien dire.
      const ecritures = [...a.raws].filter((r) => r.toUpperCase() !== a.value)
      const libelle = ecritures.length ? `${a.value} — \`${ecritures.join('`, `')}\`` : a.value
      console.log(`| ${libelle} | ${a.n} | ${roleLabel} | ${a.fam} | ${a.token ? `\`${a.token}\`` : '— *(reste en dur)*'} |`)
    }
  }
} else if (arg === '--reste') {
  // ── LA MÉTRIQUE DE FIN DE LOT ──────────────────────────────────────────────────────
  // 🔴 « COMBIEN RESTE-T-IL » N'EST PAS UNE QUESTION UTILE SANS « POURQUOI ». Une
  // occurrence laissée sur ordre du cockpit et une occurrence oubliée se ressemblent dans
  // un total ; elles n'ont rien à voir. Ce mode ventile, pour qu'un reste-à-faire ne
  // puisse pas se confondre avec un travail non fait.
  const migrables = rows.filter((r) => r.token && !r.token.includes('?'))
  const attentes = rows.filter((r) => !r.token || r.token.includes('?'))

  console.log(`\n🔴 MIGRABLES ENCORE EN DUR : ${migrables.length} sur ${new Set(migrables.map((r) => r.file)).size} fichier(s)`)
  if (migrables.length) {
    const parFichier = {}
    for (const r of migrables) parFichier[r.file] = (parFichier[r.file] ?? 0) + 1
    for (const [f, n] of Object.entries(parFichier).sort((a, b) => b[1] - a[1])) {
      console.log(`   ${String(n).padStart(4)}  ${f}`)
    }
  } else {
    console.log('   (aucune — la cible du lot est atteinte)')
  }

  console.log(`\nLAISSÉ EN PLACE DÉLIBÉRÉMENT : ${attentes.length}`)
  const parRaison = {}
  for (const r of attentes) {
    const raison = r.alpha
      ? 'valeur transparente — aucun jeton ne la nomme'
      : r.value === 'TRANSPARENT'
        ? 'bg-transparent — absence de fond, pas une couleur'
        : (r.note ?? 'non classé')
    parRaison[raison] = (parRaison[raison] ?? 0) + 1
  }
  for (const [raison, n] of Object.entries(parRaison).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(n).padStart(4)}  ${raison}`)
  }
  console.log()
} else {
  const par = {}
  for (const r of rows) par[r.fam] = (par[r.fam] ?? 0) + 1
  console.log(`\nPÉRIMÈTRE : ${new Set(rows.map((r) => r.file)).size} fichiers, ${rows.length} occurrences de couleur.\n`)
  for (const [f, n] of Object.entries(par).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${f.padEnd(12)} ${String(n).padStart(4)}   ${(100 * n / rows.length).toFixed(1)} %`)
  }
  console.log('\nPar valeur :')
  const parVal = {}
  for (const r of rows) {
    const k = `${r.value} (${r.fam})`
    parVal[k] = (parVal[k] ?? 0) + 1
  }
  for (const [v, n] of Object.entries(parVal).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${v}`)
  }
}
