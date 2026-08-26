#!/usr/bin/env node
// GYM-286a — L'INVENTAIRE, PRODUIT PAR LA MACHINE.
//
// ⚠️ CE FICHIER EXISTE POUR QUE L'INVENTAIRE NE SOIT PAS UNE LISTE ÉCRITE À LA MAIN.
// Une liste à la main est juste le jour où on l'écrit, et fausse dès la première
// migration. Celle-ci se régénère : `node scripts/inventaire-couleurs.mjs --md` rend le
// tableau de docs/GYM-286-inventaire.md, et GYM-286b peut mesurer ce qu'il lui reste.
//
// USAGE :
//   node scripts/inventaire-couleurs.mjs          résumé par famille
//   node scripts/inventaire-couleurs.mjs --md     le tableau par fichier, en Markdown
//   node scripts/inventaire-couleurs.mjs --reste  ce qui n'est pas encore migré
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

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

function walk(dir) {
  const out = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (/\.tsx?$/.test(p) && !EXCLUDE.test(p)) out.push(p)
  }
  return out
}

const RE = /([a-z-]*)(move-(?:bg|card|dark|accent-dim|accent|text-secondary|text-muted|border))\b|(#[0-9a-fA-F]{3,8})\b/g

const rows = []
for (const abs of DIRS.flatMap((d) => walk(join(ROOT, d)))) {
  const rel = relative(ROOT, abs)
  const src = blankComments(readFileSync(abs, 'utf8'))
  src.split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return // les commentaires ne peignent rien
    for (const m of line.matchAll(RE)) {
      const [prefix, cls, hex] = [m[1] ?? '', m[2], m[3]]
      const value = cls ? MOVE_VALUES[cls] : hex.toUpperCase()
      let role = 'fg'
      if (cls) role = BG.test(prefix) ? 'bg' : BD.test(prefix) ? 'bd' : FG.test(prefix) ? 'fg' : 'fg'
      else if (ATTR_BG.test(line)) role = 'bg'
      else if (ATTR_BD.test(line)) role = 'bd'
      else if (ATTR_SH.test(line)) role = 'sh'
      else if (ATTR_FG.test(line)) role = 'fg'
      else role = 'bg' // style={{ backgroundColor }} multiligne : le fond est le cas par défaut
      const [fam, token, note] = classify(value, role)
      rows.push({ file: rel, line: i + 1, raw: cls ? prefix + cls : hex, value, role, fam, token, note })
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
  const restants = rows.filter((r) => r.token && !r.token.includes('?'))
  console.log(`${restants.length} occurrence(s) migrables encore en dur, sur ${new Set(restants.map((r) => r.file)).size} fichier(s).`)
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
