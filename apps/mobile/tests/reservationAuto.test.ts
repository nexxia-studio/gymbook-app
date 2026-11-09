// ╔═══════════════════════════════════════════════════════════════════════════════════════╗
// ║  GYM-379 — LA FICHE RÉSERVE D'ELLE-MÊME APRÈS « PAYER ET RÉSERVER », ET UNE SEULE FOIS ║
// ╚═══════════════════════════════════════════════════════════════════════════════════════╝
//
//     cd apps/mobile && npx tsx tests/reservationAuto.test.ts
//
// ⚠️ SCRIPT À CORPS DE MODULE, comme `deepLinkTarget.test.ts` : pas de cadre de test dans
// ce dépôt. Lire la sortie et le code de sortie.
import type { BookingIntent } from '../lib/bookingIntent'
import {
  accordPourCePaiement,
  doitReserverAutomatiquement,
  issueEchecReservation,
  reserverUneFois,
  type EntreeReservationAuto,
} from '../lib/reservationAuto'

let failures = 0
function check(label: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ✓ ${label}`)
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}

const MAINTENANT = Date.parse('2026-11-09T10:00:00Z')
const intent: BookingIntent = {
  slotId: 'slot-a',
  gymId: 'gym-1',
  startsAt: '2026-11-09T18:00:00Z',
  createdAt: MAINTENANT - 5 * 60 * 1000,
  paymentId: 'tr_123',
  accordReservation: true,
}
const base: EntreeReservationAuto = {
  intent,
  slotId: 'slot-a',
  droitPresent: true,
  statutPaiement: { paymentId: 'tr_123', statut: 'paid' },
  dejaTente: false,
  coursComplet: false,
  dejaInscrit: false,
  ecranVisible: true,
  maintenant: MAINTENANT,
}
const decide = (patch: Partial<EntreeReservationAuto>) => doitReserverAutomatiquement({ ...base, ...patch })

console.log('\nCAS 1 — intention valide, accord, paiement payé, droit présent, jamais tenté → on réserve')
check('séance à l\'unité → true', decide({}) === true)
// g) Formule illimitée depuis un cours : « S'abonner et réserver » pose le même accord, et
// c'est l'ABONNEMENT ACTIF qui fait le droit — aucun crédit à débiter.
check(
  'abonnement avec accord (« S\'abonner et réserver ») → true',
  decide({
    intent: { ...intent, paymentId: 'tr_sub' },
    statutPaiement: { paymentId: 'tr_sub', statut: 'paid' },
  }) === true,
)

console.log('\nCAS 2 — chaque condition manquante empêche l\'appel')
check('sans intention → false', decide({ intent: null }) === false)
check('intention sur un AUTRE créneau → false', decide({ slotId: 'slot-b' }) === false)
check('droit absent (crédit pas encore arrivé) → false', decide({ droitPresent: false }) === false)
// 🔴 LE POINT DU BANC : la garde anti-double. Le poll, le lien profond et la reprise de la
// fiche peuvent tous la déclencher ; un seul appel doit partir.
check('déjà tenté → false', decide({ dejaTente: true }) === false)
check('déjà inscrit → false', decide({ dejaInscrit: true }) === false)
// h) deux fiches ouvertes : seule celle au premier plan déclenche.
check('fiche pas au premier plan → false', decide({ ecranVisible: false }) === false)

console.log('\nCAS 3 — cours complet : JAMAIS d\'appel (le serveur inscrirait en liste d\'attente)')
check('complet → false', decide({ coursComplet: true }) === false)

console.log('\nCAS 4 — intention périmée')
check('cours commencé → false', decide({ maintenant: Date.parse('2026-11-09T18:05:00Z') }) === false)
check(
  'plafond de 24 h dépassé → false',
  decide({ intent: { ...intent, startsAt: '2026-11-20T18:00:00Z', createdAt: MAINTENANT - 25 * 60 * 60 * 1000 } }) === false,
)

console.log('\nCAS 4b — achat SANS accord (Profil → Abonnement ouvert sans cours, ou cours complet)')
// 🔴 Ce serait la réservation silencieuse de GYM-352 : le bouton manuel reste.
check('sans accord → false', decide({ intent: { ...intent, accordReservation: undefined } }) === false)
check('sans accord → aucun texte de promesse', accordPourCePaiement({ ...intent, accordReservation: undefined }) === false)
check('avec accord → texte de promesse', accordPourCePaiement(intent) === true)
check('texte : accord, mais pour un AUTRE paiement → aucune promesse', accordPourCePaiement(intent, 'tr_autre') === false)
check('texte : accord pour CE paiement → promesse', accordPourCePaiement(intent, 'tr_123') === true)

console.log('\nCAS 5 — l\'accord ne vaut que pour SON paiement, et seulement payé')
// 🔴 LE POINT DE LA RELECTURE : le droit seul ne prouve rien. Un crédit du gérant, un
// abonnement pris ailleurs ou un carnet ancien rendent le droit présent sans que CE
// paiement soit passé.
check(
  'accord d\'un ancien paiement (statut lu pour un autre paiement) → false',
  decide({ statutPaiement: { paymentId: 'tr_nouveau', statut: 'paid' } }) === false,
)
for (const statut of ['open', 'pending', 'expired', 'canceled', 'failed']) {
  check(`crédit présent, paiement de l'accord ${statut} → false`, decide({ statutPaiement: { paymentId: 'tr_123', statut } }) === false)
}
check('crédit présent, statut illisible → false', decide({ statutPaiement: { paymentId: 'tr_123', statut: null } }) === false)
check('crédit présent, statut jamais lu → false', decide({ statutPaiement: null }) === false)
check(
  'crédit présent, intention SANS paiement rattaché → false',
  decide({ intent: { ...intent, paymentId: undefined }, statutPaiement: null }) === false,
)

console.log('\nCAS 6 — classement des refus de create-booking')
for (const [code, attendu] of [
  ['SLOT_PAST', 'definitif'],
  ['SLOT_CANCELLED', 'definitif'],
  ['SLOT_NOT_FOUND', 'definitif'],
  ['WRONG_GYM', 'definitif'],
  ['ALREADY_BOOKED', 'deja_inscrit'],
  ['ALREADY_WAITLISTED', 'deja_inscrit'],
  ['PAYMENT_REQUIRED', 'credit_en_route'],
  ['NETWORK_OFFLINE', 'reessayable'],
  ['SUSPENDED', 'reessayable'],
  ['MAX_BOOKINGS_REACHED', 'reessayable'],
  ['BOOKING_FAILED', 'reessayable'],
  ['CODE_INCONNU', 'reessayable'],
  [undefined, 'reessayable'],
] as const) {
  const issue = issueEchecReservation(code)
  check(`${code ?? 'undefined'} → ${attendu}`, issue === attendu, issue)
}

// ⚠️ IIFE : `tsx` compile en CJS, sans `await` au niveau du module.
void (async () => {
console.log('\nCAS 7 — garde au niveau du MODULE : deux fiches, un seul appel')
{
  let appels = 0
  let liberer: (v: string) => void = () => {}
  const appel = () => { appels++; return new Promise<string>((r) => { liberer = r }) }
  const a = reserverUneFois('slot-a', appel)
  const b = reserverUneFois('slot-a', appel)
  const autre = reserverUneFois('slot-b', async () => { appels++; return 'b' })
  check('la seconde fiche n\'appelle pas', appels === 2 && a.premier && !b.premier && autre.premier, `appels=${appels}`)
  check('elle attend la MÊME promesse', a.promesse === b.promesse)
  liberer('ok')
  const [ra, rb] = await Promise.all([a.promesse, b.promesse])
  check('les deux voient le même résultat', ra === 'ok' && rb === 'ok')
  const apres = reserverUneFois('slot-a', async () => { appels++; return 'encore' })
  check('une fois l\'appel terminé, la garde se libère', apres.premier && (await apres.promesse) === 'encore')
}

console.log(failures === 0 ? '\n✅ banc complet — 0 échec\n' : `\n❌ ${failures} échec(s)\n`)
if (failures > 0) process.exit(1)
})()
