#!/usr/bin/env node
// GYM-312a — 🔴 « RE-CHOISIR SA PROPRE SALLE NE DÉCLENCHE RIEN », PROUVÉ PLUTÔT QUE RELU.
//
// ═════════════════════════════════════════════════════════════════════════════════════
// CE QUE « NO-OP » VEUT DIRE ICI, ET POURQUOI ÇA NE SE VOIT PAS À LA LECTURE
// ═════════════════════════════════════════════════════════════════════════════════════
// `switchGym` ne fait pas UN appel : c'est une liste de sept conséquences — RPC, purge du
// cache de marque, purge du profil de salle, écriture du slug, remise à zéro des
// réservations et des favoris, salle active, rechargement du profil. Rejouée sur la salle
// COURANTE, elle démolit l'état de l'app pour le reconstruire à l'identique : un
// clignotement complet, et une fenêtre sans données, en échange de rien.
//
// L'écran désactive déjà la ligne active. Mais une garde portée par la seule interface
// tient jusqu'au prochain appelant — un lien profond, une reprise, un bouton « revenir à ma
// salle ». La propriété appartient au module, et ce banc la mesure là où elle vit : il
// COMPTE les effets, il ne relit pas le code.
//
// ⚠️ CE QU'IL NE PROUVE PAS : que l'écran désactive bien la ligne. C'est du JSX, et le
// dépôt n'a pas d'infrastructure de rendu. Ce qu'il garantit est plus fort et plus utile —
// même si un jour l'écran laissait passer le geste, il ne se passerait rien.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = mkdtempSync(join(tmpdir(), 'gym312a-'))
try {
  execFileSync('npx', [
    'tsc', join(ROOT, 'lib/gymSwitch.ts'),
    '--outDir', out, '--module', 'esnext', '--target', 'es2020',
    '--skipLibCheck', '--moduleResolution', 'bundler',
  ], { cwd: ROOT, stdio: 'pipe' })
} catch { /* d'autres fichiers du projet peuvent échouer : seul le nôtre compte */ }

const L = join(out, 'lib'), S = join(out, 'stores')
mkdirSync(S, { recursive: true })
mkdirSync(join(L, 'theme'), { recursive: true })
writeFileSync(join(L, 'gymSwitch.js'), readFileSync(join(L, 'gymSwitch.js'), 'utf8')
  .replace(/from '(\.\.?\/[A-Za-z/]*)'/g, "from '$1.js'"))

// ── Les doublures : chacune INSCRIT son effet, aucune n'en produit ──────────────────
writeFileSync(join(L, 'trace.js'), 'export const trace = []\n')
writeFileSync(join(L, 'supabase.js'), `
import { trace } from './trace.js'
export let __err = null
export function __setErr(e) { __err = e }
export const supabase = {
  rpc: async (fn, args) => { trace.push('rpc:' + fn + '(' + args.p_gym_id + ')'); return { data: null, error: __err } },
}
`)
writeFileSync(join(L, 'gymProfile.js'), `
import { trace } from './trace.js'
export function __resetGymProfileCache() { trace.push('purge:profilSalle') }
`)
writeFileSync(join(L, 'theme', 'brand.js'), `
import { trace } from '../trace.js'
export async function clearCachedBrand() { trace.push('purge:marque') }
`)
writeFileSync(join(L, 'gymResolver.js'), `
import { trace } from './trace.js'
export async function writeSelectedGymSlug(s) { trace.push('ecrit:slug(' + s + ')') }
`)
writeFileSync(join(L, 'analytics.js'), `
import { trace } from './trace.js'
export function setAnalyticsGym(id) { trace.push('telemetrie:salle(' + id + ')') }
`)
writeFileSync(join(L, 'activeGymWrites.js'), `
export async function withActiveGymWrite(fn) { return await fn() }
`)
writeFileSync(join(S, 'useAuthStore.js'), `
import { trace } from '../lib/trace.js'
export const useAuthStore = { getState: () => ({
  user: { id: 'u-1' },
  setActiveGymConfirmed: (id) => trace.push('salleActive(' + id + ')'),
  refreshProfile: async () => trace.push('refreshProfile'),
}) }
`)
writeFileSync(join(S, 'useBookingStore.js'), `
import { trace } from '../lib/trace.js'
export const useBookingStore = { getState: () => ({
  resetForGymSwitch: () => trace.push('purge:reservations'),
  fetchBookings: async () => trace.push('recharge:reservations'),
  loadFavorites: async () => trace.push('recharge:favoris'),
}) }
`)

const imp = (p) => import(pathToFileURL(join(out, p)).href)
const { switchGym } = await imp('lib/gymSwitch.js')
const { trace } = await imp('lib/trace.js')

const COURANTE = { gymId: 'g-courante', slug: 'ma-salle', name: 'Ma Salle', logoUrl: null, isActive: true }
const AUTRE = { gymId: 'g-autre', slug: 'autre-salle', name: 'Autre Salle', logoUrl: null, isActive: false }

const echecs = []
const dire = (ok, txt) => { console.log(`  ${ok ? '✓' : '✗'} ${txt}`); if (!ok) echecs.push(txt) }

// ── 1. LA SALLE COURANTE : rien du tout ─────────────────────────────────────────────
console.log('\nRE-CHOISIR LA SALLE COURANTE\n')
trace.length = 0
const r1 = await switchGym(COURANTE)
dire(r1.status === 'ok', `l’issue est un SUCCÈS (« ${r1.status} ») — la salle demandée EST la salle active`)
dire(trace.length === 0, `aucun effet : ${trace.length === 0 ? 'trace vide' : trace.join(' · ')}`)
dire(!trace.some((e) => e.startsWith('rpc:')), 'aucune requête serveur')
dire(!trace.some((e) => e.startsWith('telemetrie:')), 'aucune télémétrie de bascule')
dire(!trace.some((e) => e.startsWith('purge:')), 'aucun cache vidé — pas de clignotement')

// ── 2. UNE AUTRE SALLE : la séquence complète, dans l'ordre ─────────────────────────
console.log('\nCHOISIR UNE AUTRE SALLE — la bascule fait bien son travail\n')
trace.length = 0
const r2 = await switchGym(AUTRE)
dire(r2.status === 'ok', `l’issue est un succès (« ${r2.status} »)`)
const ATTENDU = [
  'rpc:switch_active_gym(g-autre)',
  'purge:profilSalle',
  'purge:marque',
  'ecrit:slug(autre-salle)',
  'purge:reservations',
  'salleActive(g-autre)',
  'refreshProfile',
  'telemetrie:salle(g-autre)',
  'recharge:reservations',
  'recharge:favoris',
]
dire(JSON.stringify(trace) === JSON.stringify(ATTENDU),
  `les ${ATTENDU.length} effets, dans l’ordre\n      ${trace.join('\n      ')}`)

// ── 3. LA GARDE PASSE AVANT TOUT, MÊME QUAND LE SERVEUR EST EN PANNE ────────────────
// Si elle était placée après la RPC, une salle déjà active provoquerait un aller-retour —
// et rendrait `offline` là où il n'y a rien à faire.
console.log('\nLA GARDE PRÉCÈDE LA REQUÊTE, ET NON L’INVERSE\n')
const { __setErr } = await imp('lib/supabase.js')
__setErr({ message: 'network request failed' })
trace.length = 0
const r3 = await switchGym(COURANTE)
dire(r3.status === 'ok' && trace.length === 0,
  `serveur injoignable, salle courante → « ${r3.status} », ${trace.length} effet(s)`)

console.log(echecs.length
  ? `\n🔴 ${echecs.length} vérification(s) en échec.\n`
  : '\n✅ Re-choisir sa salle ne déclenche rien ; en choisir une autre déclenche tout.\n')
process.exit(echecs.length ? 1 : 0)
