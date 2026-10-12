#!/usr/bin/env node
// GYM-374 — 🔴 « TON PAIEMENT EST BIEN ENREGISTRÉ » À QUELQU'UN QUI N'A JAMAIS PAYÉ.
//
// Ce script rejoue, sur le VRAI code compilé (lib/paymentStatus.ts, lib/bookingIntent.ts),
// le parcours mesuré le 12/10 chez Dopamine et les quatre issues du retour de paiement.
// AsyncStorage est remplacé par une Map en mémoire — c'est la seule substitution.
//
//   node scripts/verify-intention-sans-paiement.mjs              → doit passer (exit 0)
//   node scripts/verify-intention-sans-paiement.mjs --falsifier  → réinjecte la règle
//       d'avant (« intention présente ⇒ il a payé ») et DOIT échouer (exit 1). Un contrôle
//       qui passe aussi sur le code fautif ne prouve rien.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FALSIFIER = process.argv.includes('--falsifier')
const out = mkdtempSync(join(tmpdir(), 'gym374-'))
let echecs = 0
const verifier = (nom, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${nom}${detail ? ` — ${detail}` : ''}`)
  if (!ok) echecs++
}

try {
  execFileSync('npx', [
    'tsc', join(ROOT, 'lib/paymentStatus.ts'), join(ROOT, 'lib/bookingIntent.ts'),
    '--outDir', out, '--module', 'esnext', '--moduleResolution', 'bundler', '--target', 'es2020', '--skipLibCheck',
  ], { cwd: ROOT, stdio: 'pipe' })

  // AsyncStorage → Map en mémoire.
  writeFileSync(join(out, 'stub-storage.js'), `
    const m = new Map()
    export default {
      getItem: async (k) => (m.has(k) ? m.get(k) : null),
      setItem: async (k, v) => { m.set(k, v) },
      removeItem: async (k) => { m.delete(k) },
    }
  `)
  const intentJs = join(out, 'bookingIntent.js')
  writeFileSync(intentJs, readFileSync(intentJs, 'utf8')
    .replace(`'@react-native-async-storage/async-storage'`, `'./stub-storage.js'`))

  const statusJs = join(out, 'paymentStatus.js')
  if (FALSIFIER) {
    // La règle d'avant GYM-374 : l'intention présente suffisait à conclure « il a payé ».
    const src = readFileSync(statusJs, 'utf8')
    const patched = src.replace(/export function issueDuRetour\([^)]*\) \{/, '$&\n    return \'paye\';')
    if (patched === src) throw new Error('falsification : motif introuvable')
    writeFileSync(statusJs, patched)
    console.log('⚠️  MODE FALSIFICATION — règle d\'avant réinjectée, le contrôle DOIT échouer\n')
  }

  const { issueDuRetour, TERMINAL_FAILURE } = await import(pathToFileURL(statusJs).href)
  const bi = await import(pathToFileURL(intentJs).href)

  const demain = new Date(Date.now() + 24 * 3600e3 - 60e3).toISOString()
  const hier = new Date(Date.now() - 3600e3).toISOString()
  const SLOT = 'slot-open-gym-12-10-19h'

  // ── ① LE CAS MESURÉ : achat lancé, jamais payé, retour sur la fiche ──────────────────
  console.log('— Cas mesuré du 12/10 (One-Shot 20 €, jamais payé, `expired`) —')
  await bi.__resetBookingIntent()
  await bi.poserBookingIntent({ slotId: SLOT, gymId: 'dopamine', startsAt: demain })
  // create-payment a rendu son id : les deux chemins d'achat le rattachent désormais.
  await bi.attacherPaiementBookingIntent('tr_viktor')
  let i = await bi.lireBookingIntent()
  verifier('paymentId écrit sur l\'intention', i?.paymentId === 'tr_viktor', `lu : ${i?.paymentId}`)
  verifier('createdAt conservé par le rattachement', typeof i?.createdAt === 'number')
  const issueMesuree = issueDuRetour(i.paymentId, 'expired')
  verifier('`expired` ⇒ achat non finalisé (et non « paiement enregistré »)', issueMesuree === 'non_finalise', issueMesuree)

  // ── ② LES QUATRE CAS ────────────────────────────────────────────────────────────────
  console.log('\n— Les quatre issues —')
  const cas = [
    ['pas de paymentId (jamais atteint le paiement)', undefined, null, 'non_finalise'],
    ['failed', 'tr_x', 'failed', 'non_finalise'],
    ['canceled', 'tr_x', 'canceled', 'non_finalise'],
    ['cancelled', 'tr_x', 'cancelled', 'non_finalise'],
    ['expired', 'tr_x', 'expired', 'non_finalise'],
    ['paid ⇒ message « crédit en route » conservé', 'tr_x', 'paid', 'paye'],
    ['pending (statut posé par create-payment) ⇒ ambigu', 'tr_x', 'pending', 'ambigu'],
    ['open ⇒ ambigu', 'tr_x', 'open', 'ambigu'],
    ['ligne introuvable / hors ligne ⇒ ambigu, jamais « non finalisé »', 'tr_x', null, 'ambigu'],
  ]
  for (const [nom, pid, st, attendu] of cas) {
    const r = issueDuRetour(pid, st)
    verifier(nom, r === attendu, `rendu ${r}, attendu ${attendu}`)
  }
  // Le garde-fou anti double paiement : `paid`, `open`, `pending` et l'inconnu ne
  // doivent JAMAIS mener à une réouverture d'office de la feuille d'achat.
  const jamaisDOffice = [['tr', 'paid'], ['tr', 'open'], ['tr', 'pending'], ['tr', null]]
    .every(([p, s]) => issueDuRetour(p, s) !== 'non_finalise')
  verifier('garde-fou GYM-352 : aucun membre peut-être payé ne se voit rouvrir l\'achat d\'office', jamaisDOffice)
  verifier('TERMINAL_FAILURE inchangé', [...TERMINAL_FAILURE].sort().join() === 'canceled,cancelled,expired,failed')

  // ── ③ LE RATTACHEMENT NE CRÉE RIEN, ET NE RESSUSCITE RIEN (audit c.) ─────────────────
  console.log('\n— Rattachement et effacement des intentions périmées —')
  await bi.__resetBookingIntent()
  await bi.attacherPaiementBookingIntent('tr_profil')
  verifier('achat depuis le profil sans intention : aucune intention créée', (await bi.lireBookingIntent()) === null)

  await bi.__resetBookingIntent()
  await bi.poserBookingIntent({ slotId: SLOT, gymId: 'dopamine', startsAt: hier })
  await bi.attacherPaiementBookingIntent('tr_tardif')
  verifier('créneau passé : l\'intention reste effacée par `estValide`, pas ressuscitée', (await bi.lireBookingIntent()) === null)

  await bi.__resetBookingIntent()
  await bi.poserBookingIntent({ slotId: SLOT, gymId: 'dopamine', startsAt: demain })
  await bi.attacherPaiementBookingIntent('tr_mort')
  await bi.poserBookingIntent({ slotId: SLOT, gymId: 'dopamine', startsAt: demain })
  i = await bi.lireBookingIntent()
  verifier('reprise de l\'achat : l\'intention reposée n\'emporte pas le paymentId mort', i && i.paymentId === undefined)

  // ── ④ LE CÂBLAGE : la fiche ne dit plus « crédit en route » hors du cas `paye` ────────
  console.log('\n— Câblage —')
  const fiche = readFileSync(join(ROOT, 'app/session/[id].tsx'), 'utf8')
  const pending = [...fiche.matchAll(/t\('session\.intent_pending_title'\)/g)]
  const avantPending = fiche.slice(0, pending[0]?.index ?? 0).split('\n').slice(-6).join('\n')
  verifier('« Crédit en route » n\'est émis que sous `issue === \'paye\'`',
    pending.length === 1 && /issue === 'paye'/.test(avantPending))
  verifier('les deux chemins d\'achat rattachent le paiement',
    /attacherPaiementBookingIntent\(result\.paymentId\)/.test(readFileSync(join(ROOT, 'components/session/PaymentRequiredSheet.tsx'), 'utf8'))
    && /attacherPaiementBookingIntent\(result\.paymentId\)/.test(readFileSync(join(ROOT, 'app/profile/subscription.tsx'), 'utf8')))
  const succes = readFileSync(join(ROOT, 'app/payment/success.tsx'), 'utf8')
  verifier('un seul TERMINAL_FAILURE dans le dépôt mobile (success.tsx l\'importe)',
    !/const TERMINAL_FAILURE/.test(succes) && /from '\.\.\/\.\.\/lib\/paymentStatus'/.test(succes))

  // ── ⑤ PARITÉ i18n fr/en ─────────────────────────────────────────────────────────────
  console.log('\n— Parité i18n —')
  const aplatir = (o, p = '') => Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === 'object' ? aplatir(v, `${p}${k}.`) : [`${p}${k}`])
  const fr = new Set(aplatir(JSON.parse(readFileSync(join(ROOT, 'locales/fr.json'), 'utf8'))))
  const en = new Set(aplatir(JSON.parse(readFileSync(join(ROOT, 'locales/en.json'), 'utf8'))))
  const manqueEn = [...fr].filter((k) => !en.has(k))
  const manqueFr = [...en].filter((k) => !fr.has(k))
  verifier('fr ⊆ en et en ⊆ fr', !manqueEn.length && !manqueFr.length,
    `${fr.size} clés fr, ${en.size} clés en${manqueEn.length ? ` ; absentes en : ${manqueEn.join(', ')}` : ''}${manqueFr.length ? ` ; absentes fr : ${manqueFr.join(', ')}` : ''}`)
  const utilisees = [...fiche.matchAll(/t\('(session\.intent_[a-z_]+)'\)/g)].map((m) => m[1])
  verifier('toutes les clés employées par la fiche existent dans les deux langues',
    utilisees.every((k) => fr.has(k) && en.has(k)), [...new Set(utilisees)].join(', '))
} finally {
  rmSync(out, { recursive: true, force: true })
}

console.log(`\n${echecs ? `❌ ${echecs} échec(s)` : '✅ tout passe'}`)
process.exit(echecs ? 1 : 0)
