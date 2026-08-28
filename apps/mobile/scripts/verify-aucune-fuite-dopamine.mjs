#!/usr/bin/env node
// GYM-310 — 🔴 « LE NOM D'UN CLIENT FUIT-IL DANS L'APP D'UN AUTRE ? », RÉPONDU MÉCANIQUEMENT.
//
// ═════════════════════════════════════════════════════════════════════════════════════
// POURQUOI UN ESPACE `dopamine.*` PLUTÔT QU'UNE CHASSE AU GREP
// ═════════════════════════════════════════════════════════════════════════════════════
// Un `grep -i dopamine` sur les traductions rend des lignes de deux natures opposées, et
// rien ne les distingue :
//   · des FUITES — « Message de Dopamine Performance Club » envoyé par un gérant de Studio
//     Yoga à SES membres ; « Ex. Dopamine Performance Club » proposé à un gérant qui crée
//     sa salle ; « ton compte Dopamine » lu par un membre d'un autre club ;
//   · des mentions VOULUES — l'écran `/dopamine/reset-password`, cible d'un Universal Link
//     que l'AASA ne déclare que pour Dopamine, ou la phrase du dimanche gardée par
//     `GYM_MODE === 'single'`.
//
// Tant que les deux vivent dans le même espace de noms, la vérification est une relecture,
// et une relecture ne tient pas : #238 avait déjà « fini » ce travail sur le JSX, et #242 a
// trouvé quatre phrases de plus dans les fichiers de traduction.
//
// LA RÈGLE EST DONC STRUCTURELLE : toute chaîne qui nomme un client habite `dopamine.*`.
// Ailleurs, zéro. Ce script est la règle ; il n'y a plus rien à relire.
//
// ⚠️ IL VÉRIFIE AUSSI QUE LES CLÉS EXISTENT ENCORE. Déplacer un bloc de traduction casse
// silencieusement ses appelants : i18next rend la CLÉ elle-même quand elle manque, et
// « dopamine.reset.title » s'affiche à l'écran sans qu'aucun test ne tombe. La seconde
// passe résout chaque `t('…')` littéral des deux applications.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const APPS = [
  { nom: 'mobile', locales: 'apps/mobile/locales', code: ['apps/mobile'] },
  { nom: 'dashboard', locales: 'apps/dashboard/src/locales', code: ['apps/dashboard/src'] },
]
// ⚠️ Les clients à surveiller, pas « Dopamine » seul : le jour où une deuxième salle est
// citée en dur, la règle doit la voir sans qu'on y repense.
const CLIENTS = [/dopamine/i]

const echecs = []
const dire = (ok, txt) => { console.log(`  ${ok ? '✓' : '✗'} ${txt}`); if (!ok) echecs.push(txt) }

/** Aplatit un JSON de traduction en chemins pointés. */
function aplatir(obj, prefixe = '') {
  const out = []
  for (const [k, v] of Object.entries(obj)) {
    const chemin = prefixe ? `${prefixe}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...aplatir(v, chemin))
    else out.push([chemin, String(v)])
  }
  return out
}

function fichiersCode(base) {
  const out = []
  const marcher = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) {
        if (['node_modules', 'dist', '.expo', 'ios', 'android', 'locales'].includes(e.name)) continue
        marcher(p)
      } else if (/\.(ts|tsx)$/.test(e.name)) out.push(p)
    }
  }
  marcher(join(RACINE, base))
  return out
}

// ── 1. AUCUNE MENTION D'UN CLIENT HORS DE SON ESPACE ────────────────────────────────
console.log('\nLES TRADUCTIONS — un nom de client ne vit que dans son espace\n')
for (const app of APPS) {
  for (const f of readdirSync(join(RACINE, app.locales)).filter((n) => n.endsWith('.json'))) {
    const d = JSON.parse(readFileSync(join(RACINE, app.locales, f), 'utf8'))
    const fuites = aplatir(d)
      .filter(([cle, val]) => CLIENTS.some((re) => re.test(val)))
      .filter(([cle]) => !cle.startsWith('dopamine.'))
    dire(fuites.length === 0, `${app.nom}/${f}${fuites.length ? ` — ${fuites.length} fuite(s) :\n${fuites.map(([k, v]) => `        ${k} = « ${v.slice(0, 70)} »`).join('\n')}` : ''}`)
  }
}

// ── 2. TOUT CE QUI VIT DANS `dopamine.*` EST CONSOMMÉ SOUS GARDE ────────────────────
// Un espace réservé n'a de valeur que si personne n'y puise depuis un chemin partagé.
console.log('\nL’ESPACE `dopamine.*` — qui y puise, et depuis où\n')
const CONSOMMATEURS_AUTORISES = [
  // La route est `/dopamine/*` : l'AASA ne déclare ce chemin que pour Dopamine.
  /apps\/mobile\/app\/dopamine\//,
  // Gardé par `GYM_MODE === 'single'` — vérifié ligne à ligne ci-dessous.
  /apps\/mobile\/components\/home\/EmptyDayState\.tsx$/,
  // Sélectionne explicitement sur le slug du lien (`?gym=dopamine`), cf. GYM-303b.
  /apps\/dashboard\/src\/pages\/ResetPassword\.tsx$/,
]
for (const app of APPS) {
  for (const f of app.code.flatMap(fichiersCode)) {
    const src = readFileSync(f, 'utf8')
    // ⚠️ ON CHERCHE UN APPEL DE TRADUCTION, PAS LA CHAÎNE « dopamine. ». Le motif large
    // attrapait `splash-dopamine.png` et `icon-dopamine.png` — des NOMS DE FICHIERS d'assets,
    // qui n'ont rien à voir avec l'espace de traduction. Deux faux positifs suffisent à faire
    // ignorer un script.
    // ⚠️ ET LA CLÉ N'EST PAS TOUJOURS LITTÉRALE. `ResetPassword.tsx` la COMPOSE
    // (`\`dopamine.reset.${base}\``) : exiger `t('dopamine.` l'aurait rendu invisible à cette
    // passe — le consommateur le moins évident des trois, donc celui qu'il faut le plus voir.
    if (!/(\bt\(\s*['"`]|`)dopamine\./.test(src.replace(/^\s*(\/\/|\*).*$/gm, ''))) continue
    const rel = relative(RACINE, f)
    dire(CONSOMMATEURS_AUTORISES.some((re) => re.test(f)),
      `${rel} puise dans dopamine.*`)
  }
}
// La garde de EmptyDayState, lue et pas supposée.
{
  const src = readFileSync(join(RACINE, 'apps/mobile/components/home/EmptyDayState.tsx'), 'utf8')
  dire(/GYM_MODE === 'single' \? t\('dopamine\./.test(src),
    "EmptyDayState — la phrase du dimanche reste derrière `GYM_MODE === 'single'`")
}

// ⚠️ LES PLURIELS N'ONT PAS DE CLÉ EXACTE, ET C'EST NORMAL. i18next résout
// `t('members.plan_credits', { count })` vers `plan_credits_one` ou `plan_credits_other` :
// la clé citée dans le code n'existe littéralement dans AUCUNE table. Les compter comme
// orphelines rendait 40 faux positifs et aurait fait ignorer le script — ce qui coûte
// exactement ce qu'il devait apporter.
const SUFFIXES = ['_zero', '_one', '_two', '_few', '_many', '_other']
const resout = (table, cle) => table.has(cle) || SUFFIXES.some((s) => table.has(cle + s))

// ── 3. AUCUNE CLÉ ORPHELINE ─────────────────────────────────────────────────────────
// 🔴 C'EST LA PASSE QUI RATTRAPE UN RENOMMAGE RATÉ. i18next affiche la clé quand elle
// manque : sans cette vérification, « dopamine.reset.title » s'écrirait à l'écran, en
// production, sans qu'aucune erreur ne soit levée nulle part.
console.log('\nLES CLÉS CITÉES DANS LE CODE — toutes résolues\n')
for (const app of APPS) {
  const tables = Object.fromEntries(
    readdirSync(join(RACINE, app.locales)).filter((n) => n.endsWith('.json')).map((f) => [
      f.replace('.json', ''),
      new Map(aplatir(JSON.parse(readFileSync(join(RACINE, app.locales, f), 'utf8')))),
    ]),
  )
  // fr et en sont les tables COMPLÈTES ; nl et de sont partielles et retombent sur elles.
  const complets = ['fr', 'en'].filter((l) => tables[l])
  const manquantes = []
  for (const f of app.code.flatMap(fichiersCode)) {
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(/\bt\(\s*'([a-z0-9_]+(?:\.[a-z0-9_]+)+)'/gi)) {
      for (const l of complets) {
        if (!resout(tables[l], m[1])) manquantes.push(`${relative(RACINE, f)} → ${m[1]} (${l})`)
      }
    }
  }
  dire(manquantes.length === 0,
    `${app.nom} — ${manquantes.length ? `${manquantes.length} clé(s) introuvable(s) :\n${manquantes.map((x) => `        ${x}`).join('\n')}` : 'toutes les clés littérales résolvent en fr et en'}`)
}

console.log(echecs.length
  ? `\n🔴 ${echecs.length} vérification(s) en échec.\n`
  : '\n✅ Aucun nom de client hors de son espace, et aucune clé orpheline.\n')
process.exit(echecs.length ? 1 : 0)
