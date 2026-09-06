#!/usr/bin/env node
// GYM-301 (1) — 🔴 LE THÈME SUIT-IL LA SALLE, SUR LES DEUX CHEMINS ?
//
// ═════════════════════════════════════════════════════════════════════════════════════
// CE QUE CE SCRIPT MESURE, ET POURQUOI CE N'EST PAS « LA TAB BAR »
// ═════════════════════════════════════════════════════════════════════════════════════
// La tab bar lit `useTheme()` à chaque rendu, comme tout le reste : elle ne mémorise rien
// et n'a aucun moyen de retarder une couleur. Si elle affiche l'ancienne salle, c'est que
// le FOURNISSEUR lui donne l'ancienne salle — et la question devient : le slug qui pilote
// le fournisseur change-t-il, sur les DEUX chemins de bascule ?
//
//   · chemin A — « Ce n'est pas ma salle » : clearCachedBrand + clearSelectedGymSlug
//   · chemin B — Profil → Changer de salle  : switchGym()
//
// Ce banc rejoue les deux sur le VRAI code (`gymResolver`, `theme/brand`, `gymSwitch`),
// s'abonne exactement comme le fait `app/_layout.tsx`, et observe ce que le fournisseur
// aurait reçu. Une bascule qui ne notifie pas, ou qui notifie le mauvais slug, se voit ici.
//
// ⚠️ CE QU'IL NE COUVRE PAS : le rendu React lui-même. Que `BrandThemeProvider` réagisse à
// un changement de `slug` se lit dans lib/theme/ThemeProvider.tsx et se vérifie à l'œil en
// recette ; ce banc garantit qu'il REÇOIT bien le changement, ce qui était la question.
//
// USAGE : node scripts/verify-theme-suit-salle.mjs
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = mkdtempSync(join(tmpdir(), 'gym301-'))

try {
  execFileSync('npx', [
    'tsc', join(ROOT, 'lib/gymSwitch.ts'), join(ROOT, 'lib/gymResolver.ts'),
    join(ROOT, 'lib/theme/brand.ts'), join(ROOT, 'lib/theme/resolveTheme.ts'),
    '--outDir', out, '--module', 'esnext', '--target', 'es2020',
    '--skipLibCheck', '--moduleResolution', 'bundler',
  ], { cwd: ROOT, stdio: 'pipe' })
} catch { /* d'autres fichiers peuvent échouer : seuls les nôtres comptent */ }

const L = join(out, 'lib')
const S = join(out, 'stores')
mkdirSync(S, { recursive: true })
for (const f of ['gymSwitch.js', 'gymResolver.js', 'theme/brand.js', 'theme/resolveTheme.js', 'theme/contrast.js']) {
  const p = join(L, f)
  writeFileSync(p, readFileSync(p, 'utf8').replace(/from '(\.\.?\/[A-Za-z/.]*)'/g, "from '$1.js'"))
}

// ── Les doublures : tout ce qui n'est pas le chemin mesuré ───────────────────────────
// AsyncStorage en mémoire — le vrai est natif, et c'est le SEUL rôle qu'il joue ici.
writeFileSync(join(out, 'async-storage.js'), `
const m = new Map()
export default {
  getItem: async (k) => (m.has(k) ? m.get(k) : null),
  setItem: async (k, v) => { m.set(k, v) },
  removeItem: async (k) => { m.delete(k) },
  __dump: () => Object.fromEntries(m),
}
`)
// Les marques des trois salles, telles que `public_gym_branding` les rendrait.
writeFileSync(join(L, 'supabase.js'), `
export const MARQUES = {
  'salle-a': { slug: 'salle-a', name: 'Salle A', logo_url: null, primary_color: '#C8FF3D', secondary_color: '#2D1B69' },
  'salle-b': { slug: 'salle-b', name: 'Salle B', logo_url: null, primary_color: '#FF6B6B', secondary_color: '#101010' },
  'salle-c': { slug: 'salle-c', name: 'Salle C', logo_url: null, primary_color: '#4ECDC4', secondary_color: '#1A1A2E' },
}
export let __rpcEchoue = false
export function __setRpcEchoue(v) { __rpcEchoue = v }
export const supabase = {
  rpc: async (fn, args) => {
    if (fn === 'public_gym_branding') {
      if (__rpcEchoue) return { data: null, error: { message: 'network request failed' } }
      const r = MARQUES[args.p_slug]
      return { data: r ? [r] : [], error: null }
    }
    if (fn === 'switch_active_gym') return { data: { status: 'switched' }, error: null }
    return { data: null, error: null }
  },
}
`)
writeFileSync(join(L, 'gymProfile.js'), 'export function __resetGymProfileCache() {}\n')
writeFileSync(join(L, 'analytics.js'), 'export function setAnalyticsGym() {}\nexport function captureEvent() {}\n')
writeFileSync(join(L, 'activeGymWrites.js'), `
let n = 0
export async function withActiveGymWrite(fn) { n++; try { return await fn() } finally { n-- } }
export function activeGymWriteInFlight() { return n > 0 }
`)
writeFileSync(join(S, 'useAuthStore.js'), `
export const useAuthStore = {
  getState: () => ({
    user: { id: 'u1' },
    setActiveGymConfirmed: () => {},
    refreshProfile: async () => {},
  }),
}
`)
writeFileSync(join(S, 'useBookingStore.js'), `
export const useBookingStore = {
  getState: () => ({ resetForGymSwitch: () => {}, fetchBookings: async () => {}, loadFavorites: async () => {} }),
}
`)
// `expo-constants` : `gymResolver` n'en lit qu'`expoConfig.extra`, pour le mode de build.
// ⚠️ `multi` EN DUR, ET C'EST LE POINT : en `single` le module se court-circuite partout
// (aucune notification, aucun slug). Ce banc n'a de sens qu'en multi.
writeFileSync(join(out, 'expo-constants.js'),
  "export default { expoConfig: { extra: { gymMode: 'multi' } } }\n")

// Les deux paquets natifs sont importés par leur NOM : on les redirige vers les doublures.
for (const f of ['gymResolver.js', 'theme/brand.js']) {
  const p = join(L, f)
  const vers = f.includes('/') ? '../..' : '..'
  writeFileSync(p, readFileSync(p, 'utf8')
    .replace(/from '@react-native-async-storage\/async-storage'/, `from '${vers}/async-storage.js'`)
    .replace(/from 'expo-constants'/, `from '${vers}/expo-constants.js'`))
}

const R = await import(pathToFileURL(join(L, 'gymResolver.js')).href)
const B = await import(pathToFileURL(join(L, 'theme', 'brand.js')).href)
const SW = await import(pathToFileURL(join(L, 'gymSwitch.js')).href)

let echecs = 0
const ok = (nom, condition, detail) => {
  if (!condition) echecs++
  console.log(`  ${condition ? '✓' : '✗'} ${nom}`)
  if (!condition && detail) console.log(`      ${detail}`)
}

// ── L'ABONNÉ : exactement ce que fait `app/_layout.tsx` ──────────────────────────────
// `brandSlug` est l'état de la racine ; c'est LUI que reçoit `BrandThemeProvider`.
let brandSlug = null
const recus = []
R.subscribeSelectedGymSlug((slug) => { brandSlug = slug; recus.push(slug) })

/** Ce que le fournisseur afficherait : la marque du slug courant, ou rien. */
async function marqueAffichee() {
  if (!brandSlug) return null
  const cache = await B.readCachedBrand(brandSlug)
  if (cache) return cache.slug
  const res = await B.fetchBrand(brandSlug)
  return res.status === 'ok' ? res.brand.slug : null
}

const membership = (slug) => ({ gymId: 'g-' + slug, slug, name: slug, logoUrl: null, isActive: false })

console.log('\nCHEMIN A — « Ce n’est pas ma salle » puis nouvelle sélection\n')
await R.writeSelectedGymSlug('salle-a')
await B.fetchBrand('salle-a')
ok('sélection initiale : la marque affichée est celle de la salle A',
  (await marqueAffichee()) === 'salle-a', `obtenu ${await marqueAffichee()}`)

await B.clearCachedBrand()
await R.clearSelectedGymSlug()
ok('« ce n’est pas ma salle » : le fournisseur reçoit `null`', brandSlug === null, `obtenu ${brandSlug}`)

await R.writeSelectedGymSlug('salle-b')
ok('nouvelle sélection : le fournisseur reçoit salle-b', brandSlug === 'salle-b', `obtenu ${brandSlug}`)
ok('et la marque affichée SUIT', (await marqueAffichee()) === 'salle-b', `obtenu ${await marqueAffichee()}`)

console.log('\nCHEMIN B — Profil → Changer de salle, TROIS bascules d’affilée\n')
// 🔴 TROIS, parce que c'est là que le constat a été fait. Une seule bascule peut réussir
// par chance — le cache venait d'être vidé, le réseau était prompt. La troisième dit si
// quelque chose se fige au fil de la session.
await R.writeSelectedGymSlug('salle-a')
await B.fetchBrand('salle-a')
for (const cible of ['salle-b', 'salle-c', 'salle-a']) {
  const res = await SW.switchGym(membership(cible))
  const affichee = await marqueAffichee()
  ok(`bascule vers ${cible} (${res.status}) : slug reçu = ${brandSlug}, marque affichée = ${affichee}`,
    res.status === 'ok' && brandSlug === cible && affichee === cible,
    `attendu ${cible} des deux côtés`)
}

console.log('\nCHEMIN B DÉGRADÉ — la marque de la salle suivante est INJOIGNABLE\n')
// C'est le cas que GYM-300 (3b) a corrigé côté rendu : le fournisseur doit alors montrer
// la palette Viniz, jamais la salle précédente. Ici on vérifie l'entrée du fournisseur —
// le slug DOIT quand même avoir changé, sans quoi il n'aurait rien à réévaluer.
await R.writeSelectedGymSlug('salle-a')
await B.fetchBrand('salle-a')
const { __setRpcEchoue } = await import(pathToFileURL(join(L, 'supabase.js')).href)
__setRpcEchoue(true)
await SW.switchGym(membership('salle-b'))
ok('le slug bascule malgré la panne réseau', brandSlug === 'salle-b', `obtenu ${brandSlug}`)
ok('🔴 aucune marque de la salle PRÉCÉDENTE ne subsiste en cache',
  (await B.readCachedBrand('salle-b')) === null && (await B.readCachedBrand('salle-a')) === null,
  'le cache doit être vide : il a été purgé, et le rechargement a échoué')
__setRpcEchoue(false)

// ═════════════════════════════════════════════════════════════════════════════════════
// 🔴 LA BARRE PORTE-T-ELLE VRAIMENT UNE COULEUR DE SALLE ?
// ═════════════════════════════════════════════════════════════════════════════════════
// Recevoir le bon slug ne suffit pas : encore faut-il que la couleur QUI EN RÉSULTE
// diffère d'une salle à l'autre. C'est là que le défaut se tenait — `tokens.surface` est
// un VOILE qui ne dépend que du mode, identique au caractère près pour toutes les salles
// sombres. Peint sans fond dessous, il ne pouvait rien montrer de la salle.
//
// On compose donc ici ce que la barre rend désormais : le voile PAR-DESSUS le fond de la
// salle. Trois salles sombres doivent donner trois couleurs distinctes.
console.log('\nLA COULEUR EFFECTIVE DE LA BARRE — voile composé sur le fond de la salle\n')
const { resolveTheme } = await import(pathToFileURL(join(L, 'theme', 'resolveTheme.js')).href)

/** Compose `rgba(r,g,b,a)` (ou un hex opaque) sur un fond `#RRGGBB`. */
function composer(voile, fond) {
  const f = [1, 3, 5].map((i) => parseInt(fond.slice(i, i + 2), 16))
  const m = String(voile).match(/rgba?\(([^)]+)\)/)
  if (!m) return voile.toUpperCase()          // voile opaque : il masque tout
  const [r, g, b, a = '1'] = m[1].split(',').map((x) => x.trim())
  const mix = [r, g, b].map((c, i) => Math.round(Number(c) * Number(a) + f[i] * (1 - Number(a))))
  return '#' + mix.map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase()
}

const SOMBRES = [['salle-a', '#C8FF3D', '#2D1B69'], ['salle-b', '#FF6B6B', '#101010'], ['salle-c', '#4ECDC4', '#1A1A2E']]
const rendus = SOMBRES.map(([nom, p, sec]) => {
  const t = resolveTheme(p, sec).tokens
  const effectif = composer(t.surface, t.background)
  console.log(`      ${nom} : fond ${t.background} + voile ${t.surface} → ${effectif}`)
  return effectif
})
ok('🔴 trois salles sombres donnent TROIS couleurs de barre distinctes',
  new Set(rendus).size === 3,
  `obtenu ${new Set(rendus).size} couleur(s) — le voile seul en donnait UNE pour toutes`)

// 🔴 LA CONTRE-ÉPREUVE A CHANGÉ DE SENS AVEC GYM-290, ET C'EST UNE VICTOIRE.
// Elle vérifiait que le voile NU était identique pour les trois salles — le défaut que
// GYM-302 avait corrigé en peignant un fond dessous. GYM-290 s'attaque à la CAUSE : les
// surfaces sont désormais composées une fois pour toutes et sortent OPAQUES, donc propres à
// chaque salle. Le voile partagé n'existe plus.
//
// On vérifie donc l'inverse : trois salles, trois surfaces distinctes. Le correctif de la
// tab bar (peindre le fond dessous) devient une ceinture par-dessus les bretelles — on le
// garde, il ne coûte rien et il protégera le jour où une surface redeviendrait translucide.
const surfaces = new Set(SOMBRES.map(([, p, sec]) => resolveTheme(p, sec).tokens.surface))
ok('la surface est désormais PROPRE à chaque salle (GYM-290 a corrigé la cause)',
  surfaces.size === 3, `obtenu ${surfaces.size} surface(s) distincte(s) sur 3`)

rmSync(out, { recursive: true, force: true })
console.log(echecs
  ? `\n🔴 ${echecs} vérification(s) en échec — le thème NE suit PAS la salle sur au moins un chemin\n`
  : '\n✅ Le thème suit la salle sur les deux chemins, y compris après trois bascules.\n')
process.exit(echecs ? 1 : 0)
