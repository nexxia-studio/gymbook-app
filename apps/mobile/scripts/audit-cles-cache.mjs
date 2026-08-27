#!/usr/bin/env node
// GYM-292 — L'INVENTAIRE DES CLÉS DE CACHE DE DONNÉES DE SALLE.
//
// ⚠️ CETTE APP N'A PAS DE REACT QUERY. Ce qui joue le rôle d'une clé de cache, ici, ce
// sont DEUX choses :
//   · le tableau de dépendances d'un `useEffect` qui va chercher des données — s'il ne
//     contient pas la salle active, l'effet ne se rejoue pas quand elle change, et
//     l'écran garde les données de la salle quittée ;
//   · les caches de module (`let cached = …`) — s'ils ne sont pas indexés par salle,
//     ils rendent les données d'une autre salle sans même refaire de requête.
//
// USAGE : node scripts/audit-cles-cache.mjs
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIRS = ['hooks', 'lib', 'stores', 'app', 'components']

function walk(dir) {
  const out = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (/\.tsx?$/.test(p)) out.push(p)
  }
  return out
}

// Une requête de DONNÉES DE SALLE : elle touche une table dont les lignes appartiennent à
// une salle. La liste est explicite — deviner par le nom produirait des faux négatifs.
// ⚠️ LA LISTE EST ÉTABLIE PAR RELEVÉ, PAS DE MÉMOIRE :
//     grep -roh --include='*.ts' --include='*.tsx' -E "\\.from\\('[a-z_]+'\\)" hooks lib stores app components | sort -u
// Deux tables en sont VOLONTAIREMENT absentes : `profiles` (une ligne par membre, la
// salle active EST son contenu) et `avatars` (fichiers du membre). Les inclure ferait
// signaler comme défaut un filtrage par membre qui est le bon.
const TABLES_SALLE = /from\('(time_slots|bookings|activities|nexxia_gyms|gym_plans|gym_plan_translations|member_credits|member_subscriptions|payments|favorites|noshow_rules)'\)/
const RPC_SALLE = /rpc\('(my_gym_memberships|public_gym_branding|search_gyms)'/

const lignes = []
for (const abs of DIRS.flatMap((d) => walk(join(ROOT, d)))) {
  const rel = relative(ROOT, abs)
  const src = readFileSync(abs, 'utf8')
  if (!TABLES_SALLE.test(src) && !RPC_SALLE.test(src)) continue

  // Les dépendances de chaque useEffect / useCallback du fichier.
  for (const m of src.matchAll(/\b(useEffect|useCallback|useFocusEffect)\(([\s\S]*?)\n\s*\}, \[([^\]]*)\]\)/g)) {
    const [, hook, corps, deps] = m
    // ⚠️ ON NE RETIENT QUE CE QUI LIT VRAIMENT DES DONNÉES DE SALLE. Un `useCallback` qui
    // réserve un créneau ou affiche un toast n'est pas une clé de cache : le compter
    // produirait une liste de faux défauts, et une liste de faux défauts ne se lit plus.
    const litDesDonnees = TABLES_SALLE.test(corps) || RPC_SALLE.test(corps)
    if (!litDesDonnees) continue
    const ligne = src.slice(0, m.index).split('\n').length
    const porteGym = /gymId|gym_id|activeGym/.test(deps)
    // ── L'EXCEPTION DÉCLARÉE ───────────────────────────────────────────────────────────
    // 🔴 UNE LISTE QUI NE PEUT PAS ATTEINDRE ZÉRO NE SE LIT PLUS. Trois lectures ne sont
    // légitimement PAS indexées par salle : un paiement suivi par son identifiant, un
    // créneau lu par le sien, et la vérification d'engagement avant suppression de compte
    // — qui DOIT couvrir toutes les salles, puisque supprimer son compte les quitte
    // toutes. Sans moyen de les déclarer, elles resteraient rouges pour toujours et le
    // rapport finirait par se lire « il en reste quatre, c'est normal ».
    //
    // La convention est celle de GYM-286 : un commentaire contenant `GYM-292` dans les
    // douze lignes qui précèdent. La raison s'écrit À CÔTÉ du code, pas dans ce script.
    const avant = src.slice(0, m.index).split('\n').slice(-13)
    const justifiee = avant.some((l) => /(\/\/|\*).*GYM-292/.test(l))
    lignes.push({
      fichier: rel, ligne, quoi: hook + ' deps',
      deps: deps.replace(/\s+/g, ' ').trim() || '(vide)',
      porteGym, justifiee,
    })
  }
  // Les caches de module.
  for (const m of src.matchAll(/^let (cached\w*|\w*Cache)\b.*$/gm)) {
    const ligne = src.slice(0, m.index).split('\n').length
    lignes.push({ fichier: rel, ligne, quoi: 'cache module', deps: m[0].trim(), porteGym: false, justifiee: false })
  }
}

console.log('| fichier:ligne | nature | clé | porte gym_id |')
console.log('|---|---|---|---|')
for (const l of lignes.sort((a, b) => a.fichier.localeCompare(b.fichier) || a.ligne - b.ligne)) {
  const cle = l.deps.length > 58 ? l.deps.slice(0, 55) + '…' : l.deps
  const etat = l.porteGym ? '**oui**' : l.justifiee ? 'sans objet — justifié `GYM-292`' : '🔴 NON'
  console.log(`| \`${l.fichier}:${l.ligne}\` | ${l.quoi} | \`${cle}\` | ${etat} |`)
}
const ok = lignes.filter((l) => l.porteGym).length
const just = lignes.filter((l) => !l.porteGym && l.justifiee).length
const ko = lignes.filter((l) => !l.porteGym && !l.justifiee).length
console.log(`\n${lignes.length} clé(s) : ${ok} portent gym_id, ${just} hors objet (justifiées dans le code), ${ko} sans clé de salle.`)
if (ko) console.log('🔴 Une clé de données de salle sans gym_id sert les données d’une autre salle.')
else console.log('✅ Toute clé servant des données de salle porte gym_id.')
process.exit(ko ? 1 : 0)
