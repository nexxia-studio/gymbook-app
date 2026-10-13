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
//   … --falsifier=ouverture-inerte → GYM-374b : la fiche ne relit plus rien à l'ouverture
//       (le comportement d'avant) ; DOIT échouer.
//   … --falsifier=ouverture-zelee  → la fiche efface sur TOUT statut, `open` compris ;
//       DOIT échouer — c'est le garde-fou anti double paiement qui mord.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ARG = process.argv.find((a) => a.startsWith('--falsifier'))
const FALSIFIER = ARG ? (ARG.split('=')[1] ?? 'retour') : null
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
    .replace(`'@react-native-async-storage/async-storage'`, `'./stub-storage.js'`)
    // ESM sous Node exige l'extension ; Metro et tsc s'en passent dans l'app.
    .replace(`'./paymentStatus'`, `'./paymentStatus.js'`))

  const statusJs = join(out, 'paymentStatus.js')
  const remplacer = (fichier, motif, par) => {
    const src = readFileSync(fichier, 'utf8')
    const patched = src.replace(motif, par)
    if (patched === src) throw new Error(`falsification : motif introuvable (${motif})`)
    writeFileSync(fichier, patched)
  }
  if (FALSIFIER === 'ouverture-inerte') {
    remplacer(intentJs, /export async function effacerSiPaiementMort\([^)]*\) \{/, '$&\n    return false;')
    console.log('⚠️  MODE FALSIFICATION — ouverture inerte (avant GYM-374b), le contrôle DOIT échouer\n')
  }
  if (FALSIFIER === 'ouverture-zelee') {
    remplacer(intentJs, /if \(!paiementMort\(intent\.paymentId, statut\)\)/, 'if (false)')
    console.log('⚠️  MODE FALSIFICATION — ouverture zélée (efface sur tout statut), le contrôle DOIT échouer\n')
  }
  if (FALSIFIER === 'retour') {
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

  // ── ③b GYM-374b — FICHE OUVERTE, AUCUN TAP ──────────────────────────────────────────
  // Rejoue le `useFocusEffect` de la fiche : lire l'intention, l'armer si elle porte sur ce
  // créneau, puis `effacerSiPaiementMort` avec un statut simulé. « Bouton Réserver » ⇔
  // l'intention n'est plus armée (`intentionArmee ? confirm_booking : …`, l. ~819).
  console.log('\n— Fiche ouverte, aucun tap (GYM-374b) —')
  const ouvrirLaFiche = async (statutServeur, { avantEffacement } = {}) => {
    const intent = await bi.lireBookingIntent()
    let armee = bi.porteSurCeCreneau(intent, SLOT)
    let appelsStatut = 0
    if (armee) {
      const effacee = await bi.effacerSiPaiementMort(intent, async () => {
        appelsStatut++
        if (avantEffacement) await avantEffacement()
        return statutServeur
      })
      if (effacee) armee = false
    }
    return { bouton: armee ? 'CONFIRMER MA RÉSERVATION' : 'RÉSERVER', appelsStatut }
  }
  const armer = async (paymentId) => {
    await bi.__resetBookingIntent()
    await bi.poserBookingIntent({ slotId: SLOT, gymId: 'dopamine', startsAt: demain })
    if (paymentId) await bi.attacherPaiementBookingIntent(paymentId)
  }

  await armer('tr_viktor')
  let f = await ouvrirLaFiche('expired')
  verifier('cas de l\'incident : fiche ouverte, paiement `expired`, aucun tap ⇒ bouton RÉSERVER', f.bouton === 'RÉSERVER', f.bouton)
  verifier('… et l\'intention est effacée du disque', (await bi.lireBookingIntent()) === null)
  for (const st of ['failed', 'canceled', 'cancelled']) {
    await armer('tr_x'); f = await ouvrirLaFiche(st)
    verifier(`\`${st}\` à l'ouverture ⇒ RÉSERVER`, f.bouton === 'RÉSERVER', f.bouton)
  }
  for (const st of ['open', 'pending', 'paid', null]) {
    await armer('tr_x'); f = await ouvrirLaFiche(st)
    const garde = (await bi.lireBookingIntent())?.paymentId === 'tr_x'
    verifier(`\`${st}\` à l'ouverture ⇒ RIEN : bouton CONFIRMER, intention intacte`, f.bouton === 'CONFIRMER MA RÉSERVATION' && garde, f.bouton)
  }
  await armer(undefined); f = await ouvrirLaFiche('expired')
  verifier('pas de paymentId ⇒ aucune lecture de statut, rien d\'effacé à l\'ouverture',
    f.appelsStatut === 0 && f.bouton === 'CONFIRMER MA RÉSERVATION', `${f.appelsStatut} lecture(s)`)
  // Course : le membre reprend son achat pendant la lecture du statut → intention NEUVE.
  await armer('tr_mort')
  f = await ouvrirLaFiche('expired', {
    avantEffacement: () => bi.poserBookingIntent({ slotId: SLOT, gymId: 'dopamine', startsAt: demain }),
  })
  const neuve = await bi.lireBookingIntent()
  verifier('course : une intention neuve posée pendant la lecture n\'est PAS effacée', !!neuve && neuve.paymentId === undefined)

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
  const focus = fiche.slice(fiche.indexOf('useFocusEffect('), fiche.indexOf('const reprendreAchat'))
  verifier('le useFocusEffect de la fiche appelle effacerSiPaiementMort avec lireStatutPaiement, puis désarme',
    /effacerSiPaiementMort\(intent, lireStatutPaiement\)/.test(focus) && /setIntentionArmee\(false\)/.test(focus))
  verifier('… dans le même passage que rafraichirDroits()', focus.indexOf('rafraichirDroits()') !== -1
    && focus.indexOf('rafraichirDroits()') < focus.indexOf('effacerSiPaiementMort('))
  verifier('… et n\'ouvre JAMAIS la feuille d\'achat (aucun geste du membre à l\'ouverture)',
    !/setPaymentRequiredVisible|reprendreAchat\(/.test(focus))
  verifier('le libellé du bouton dépend bien de intentionArmee', /intentionArmee\s*\?\s*t\('session\.confirm_booking'\)/.test(fiche))
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
  // GYM-374b — plus aucune promesse « cours gardé » : rien n'est réservé avant le geste.
  const frJ = JSON.parse(readFileSync(join(ROOT, 'locales/fr.json'), 'utf8'))
  const enJ = JSON.parse(readFileSync(join(ROOT, 'locales/en.json'), 'utf8'))
  const textes = [
    ['fr session.intent_pending_message', frJ.session.intent_pending_message, /n'est pas encore réservée/],
    ['en session.intent_pending_message', enJ.session.intent_pending_message, /isn't booked yet/],
    ['fr payment_required.errors.not_confirmed', frJ.payment_required.errors.not_confirmed, /n'est pas encore réservée/],
    ['en payment_required.errors.not_confirmed', enJ.payment_required.errors.not_confirmed, /isn't booked yet/],
  ]
  for (const [nom, txt, dit] of textes) {
    verifier(`${nom} : ne promet plus un cours gardé, dit qu'il faut confirmer`,
      !!txt && !/gardé|is kept/i.test(txt) && dit.test(txt))
  }
  const utilisees = [...fiche.matchAll(/t\('(session\.intent_[a-z_]+)'\)/g)].map((m) => m[1])
  verifier('toutes les clés employées par la fiche existent dans les deux langues',
    utilisees.every((k) => fr.has(k) && en.has(k)), [...new Set(utilisees)].join(', '))
} finally {
  rmSync(out, { recursive: true, force: true })
}

console.log(`\n${echecs ? `❌ ${echecs} échec(s)` : '✅ tout passe'}`)
process.exit(echecs ? 1 : 0)
