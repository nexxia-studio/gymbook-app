// ╔═══════════════════════════════════════════════════════════════════════════════════════╗
// ║  GYM-371 — UN LIEN À SCHÉMA PERSONNALISÉ OUVRE SON ÉCRAN, PAS +not-found              ║
// ╚═══════════════════════════════════════════════════════════════════════════════════════╝
//
//     cd apps/mobile && npx tsx tests/deepLinkTarget.test.ts
//
// ⚠️ SCRIPT À CORPS DE MODULE, comme les bancs du dashboard : pas de cadre de test dans ce
// dépôt. Lire la sortie et le code de sortie.
//
// ⚠️ CE BANC N'APPELLE PAS `Linking.parse` LUI-MÊME : `expo-linking` tire `react-native` et
// ne se charge pas sous `tsx`. Il en RECOPIE la partie utile (build/createURL.js, `parse`,
// branche des builds — la branche Expo Go est hors sujet) et, pour que la copie ne puisse
// pas diverger en silence, le CAS 0 vérifie que le fichier installé contient toujours les
// lignes recopiées. Si expo-linking change, le banc échoue au lieu de mentir.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { cibleDepuisUrlAnalysee, type UrlAnalysee } from '../lib/deepLinkTarget'

let failures = 0
function check(label: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ✓ ${label}`)
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}

/** Copie de `parse` (expo-linking build/createURL.js), branche des builds. */
function parseCommeExpoLinking(url: string): UrlAnalysee {
  const queryParams: Record<string, string> = {}
  let path: string | null = null
  let hostname: string | null = null
  let scheme: string | null = null
  try {
    const parsed = new URL(url)
    parsed.searchParams.forEach((value, key) => { queryParams[key] = decodeURIComponent(value) })
    path = parsed.pathname || null
    hostname = parsed.hostname || null
    scheme = parsed.protocol || null
  } catch {
    path = url
  }
  if (scheme) scheme = scheme.substring(0, scheme.length - 1)
  if (path) {
    path = path.replace(/^\//, '')
    if (path.indexOf('+') > -1) path = path.substring(path.indexOf('+') + 1)
  }
  return { hostname, path, queryParams, scheme }
}

const cible = (url: string) => cibleDepuisUrlAnalysee(parseCommeExpoLinking(url))
const egal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

console.log('\nCAS 0 — la copie de `parse` correspond toujours à expo-linking installé')
{
  const require = createRequire(import.meta.url)
  const racine = dirname(require.resolve('expo-linking/package.json'))
  const source = readFileSync(join(racine, 'build/createURL.js'), 'utf8')
  for (const ligne of [
    'const parsed = new URL(url);',
    'path = parsed.pathname || null;',
    'hostname = parsed.hostname || null;',
    'scheme = parsed.protocol || null;',
  ]) check(`createURL.js contient « ${ligne} »`, source.includes(ligne))
}

console.log('\nCAS 1 — dopamine://payment/success?id=x (page de retour Mollie)')
{
  const c = cible('dopamine://payment/success?id=x')
  // 🔴 LE POINT DU BANC : avant GYM-371, '/success' — route inexistante.
  check('→ /payment/success', c?.pathname === '/payment/success', JSON.stringify(c))
  check('params { id: "x" }', egal(c?.params, { id: 'x' }), JSON.stringify(c?.params))
}

console.log('\nCAS 2 — viniz://payment/success?id=x (app Viniz, même logique)')
{
  const c = cible('viniz://payment/success?id=x')
  check('→ /payment/success', c?.pathname === '/payment/success', JSON.stringify(c))
  check('params { id: "x" }', egal(c?.params, { id: 'x' }), JSON.stringify(c?.params))
}

console.log('\nCAS 3 — https://links.viniz.app/dopamine/payment-success?id=x (inchangé)')
{
  const c = cible('https://links.viniz.app/dopamine/payment-success?id=x')
  check('→ /dopamine/payment-success', c?.pathname === '/dopamine/payment-success', JSON.stringify(c))
  check('params { id: "x" }', egal(c?.params, { id: 'x' }), JSON.stringify(c?.params))
}

console.log('\nCAS 4 — dopamine:// ne rejoue rien')
{
  const c = cible('dopamine://')
  check('→ null', c === null, JSON.stringify(c))
}

console.log('\nCAS 5 — garde « nos liens seulement » : un hôte https étranger ne rejoue rien')
{
  const c = cible('https://example.com/payment/success?id=x')
  check('→ null', c === null, JSON.stringify(c))
}

console.log(failures === 0 ? '\n✅ banc complet — 0 échec\n' : `\n❌ ${failures} échec(s)\n`)
if (failures > 0) process.exit(1)
