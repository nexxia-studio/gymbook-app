#!/usr/bin/env node
// GYM-312b — 🔴 « APRÈS UNE DÉCONNEXION, CHEZ QUI SOMMES-NOUS ? », RÉPONDU SANS TÉLÉPHONE.
//
// ═════════════════════════════════════════════════════════════════════════════════════
// LE DÉFAUT, ET POURQUOI IL SE CACHAIT DERRIÈRE UN BON ARGUMENT
// ═════════════════════════════════════════════════════════════════════════════════════
// `signOut` purgeait le choix de salle mémorisé — GYM-102 (2/5), « sans quoi le membre
// SUIVANT sur cet appareil arriverait dans la salle du précédent ». L'argument est juste.
// Mais la déconnexion redirige DIRECTEMENT vers `/(auth)/login` : sans slug, cet écran
// n'avait plus ni logo, ni couleurs, ni nom. Le membre qui venait de quitter SA salle
// tombait sur un écran noir anonyme — l'app avait oublié chez qui il était.
//
// Le risque de GYM-102 est couvert depuis GYM-288 par un geste VISIBLE : « Ce n'est pas ma
// salle », sur la connexion brandée, efface le slug et la marque puis renvoie à la
// recherche. Mieux qu'une purge silencieuse qui traitait tous les appareils comme partagés.
//
// CE BANC ÉPROUVE LES DEUX MOITIÉS DE LA CORRECTION :
//   1. `signOut` détruit la SESSION et rien d'autre — le slug survit ;
//   2. l'écran de connexion tranche sur TROIS états, pas deux : « pas encore lu » n'est pas
//      « aucune salle », et les confondre ferait clignoter la recherche devant tout le monde.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const echecs = []
const aNettoyer = []
const dire = (ok, txt) => { console.log(`  ${ok ? '✓' : '✗'} ${txt}`); if (!ok) echecs.push(txt) }

// ⚠️ `dansLeProjet` N'EST PAS UN CAPRICE. `useAuthStore` importe `zustand` — un specifier
// NU, que Node résout en remontant depuis le fichier. Compilé dans /tmp, il ne trouve aucun
// `node_modules` et le module ne se charge pas du tout : le banc ne mesurait rien. Compilé
// SOUS le projet, la résolution marche. La règle des trois états, elle, n'importe rien et
// se contente de /tmp.
async function compiler(cibles, dansLeProjet = false) {
  const base = dansLeProjet ? join(ROOT, '.tmp-verif') : tmpdir()
  if (dansLeProjet) mkdirSync(base, { recursive: true })
  const out = mkdtempSync(join(base, 'gym312b-'))
  try {
    execFileSync('npx', [
      'tsc', ...cibles.map((c) => join(ROOT, c)),
      '--outDir', out, '--module', 'esnext', '--target', 'es2020',
      '--skipLibCheck', '--moduleResolution', 'bundler', '--jsx', 'react',
    ], { cwd: ROOT, stdio: 'pipe' })
  } catch { /* les dépendances natives ne résolvent pas hors bundler ; l'émission suffit */ }
  const marcher = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) marcher(p)
      else if (e.name.endsWith('.js')) writeFileSync(p, readFileSync(p, 'utf8')
        .replace(/from '(\.\.?\/[A-Za-z0-9/._-]*)'/g, (m, a) => (a.endsWith('.js') ? m : `from '${a}.js'`)))
    }
  }
  marcher(out)
  return out
}

// ── 1. `signOut` : la session part, le choix de salle reste ─────────────────────────
console.log('\nLA DÉCONNEXION — ce qu’elle détruit, et ce qu’elle laisse\n')
{
  const out = await compiler(['stores/useAuthStore.ts'], true)
  aNettoyer.push(out)
  const L = join(out, 'lib')
  mkdirSync(L, { recursive: true })
  writeFileSync(join(L, 'trace.js'), 'export const trace = []\nexport let slug = "ma-salle"\nexport function setSlug(s) { slug = s }\n')
  writeFileSync(join(L, 'supabase.js'), `
import { trace } from './trace.js'
export const supabase = {
  auth: { signOut: async () => { trace.push('session:detruite') },
          getUser: async () => ({ data: { user: null } }) },
  from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }) }),
}
`)
  // ⚠️ LE BOUCHON EXPOSE `clearSelectedGymSlug` MÊME SI PLUS PERSONNE NE L'IMPORTE : c'est
  // précisément ce qu'on veut mesurer. S'il réapparaissait un jour dans `signOut`, la trace
  // le dirait — un banc qui ne peut pas voir la régression qu'il surveille ne sert à rien.
  writeFileSync(join(L, 'gymResolver.js'), `
import { trace, setSlug } from './trace.js'
export const GYM_MODE = 'multi'
export const FIXED_GYM_ID = null
export async function clearSelectedGymSlug() { trace.push('slug:efface'); setSlug(null) }
`)
  writeFileSync(join(L, 'analytics.js'), 'export function setAnalyticsGym() {}\nexport function captureEvent() {}\nexport function identifyUser() {}\nexport function resetAnalytics() {}\n')
  // ⚠️ LA CHAÎNE D'IMPORTS VA PLUS LOIN QUE LES APPELS. `useAuthStore` → `gymUrls` →
  // `constants/dopamine` → `expo-constants`, que Node ne sait pas charger. Aucun de ces
  // modules n'intervient dans `signOut` : on les bouchonne pour que le module se CHARGE,
  // pas pour changer ce qu'il fait.
  writeFileSync(join(L, 'gymUrls.js'), 'export function buildMemberSignupConfirmUrl() { return null }\n')
  writeFileSync(join(L, 'activeGymWrites.js'), 'export function activeGymWriteInFlight() { return false }\n')
  const imp = (p) => import(pathToFileURL(join(out, p)).href)
  let store
  try { store = (await imp('stores/useAuthStore.js')).useAuthStore } catch (e) {
    dire(false, `le module ne se charge pas : ${e.message.split('\n')[0]}`)
  }
  if (store) {
    const T = await imp('lib/trace.js')
    T.trace.length = 0
    await store.getState().signOut()
    dire(T.trace.includes('session:detruite'), 'la session est bien détruite')
    dire(!T.trace.includes('slug:efface'), `le choix de salle SURVIT — trace : ${T.trace.join(' · ') || '(rien d’autre)'}`)
    dire(T.slug === 'ma-salle', `le slug vaut encore « ${T.slug} » après la déconnexion`)
    dire(store.getState().session === null && store.getState().user === null,
      'ni session ni utilisateur ne restent en mémoire')
  }
}

// ── 2. L'aiguillage de la connexion : trois états, trois destinations ───────────────
console.log('\nL’ÉCRAN DE CONNEXION — trois états, et jamais le noir anonyme\n')
{
  const out = await compiler(['lib/destinationConnexion.ts'])
  const { destinationConnexion } = await import(pathToFileURL(join(out, 'destinationConnexion.js')).href)
  const CAS = [
    [undefined, 'attente', 'slug pas encore lu — on attend, sur le fond de la salle'],
    [null, 'recherche', 'aucune salle — la RECHERCHE Viniz, jamais un écran sans marque'],
    ['ma-salle', 'brandee', 'salle mémorisée — la connexion à ses couleurs'],
    ['', 'brandee', 'chaîne vide : le stockage ne rend jamais ça, mais la règle ne bronche pas'],
  ]
  for (const [slug, attendu, quoi] of CAS) {
    const rendu = destinationConnexion(slug)
    dire(rendu === attendu, `${quoi}\n      ${JSON.stringify(slug)} → « ${rendu} »${rendu === attendu ? '' : ` (attendu « ${attendu} »)`}`)
  }
}

for (const d of aNettoyer) rmSync(d, { recursive: true, force: true })
rmSync(join(ROOT, '.tmp-verif'), { recursive: true, force: true })

console.log(echecs.length
  ? `\n🔴 ${echecs.length} vérification(s) en échec.\n`
  : '\n✅ La déconnexion ne détruit que la session, et l’écran suivant porte toujours une marque.\n')
process.exit(echecs.length ? 1 : 0)
