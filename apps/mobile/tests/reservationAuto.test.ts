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
  doitReserverAutomatiquement,
  issueEchecReservation,
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
  dejaTente: false,
  coursComplet: false,
  dejaInscrit: false,
  maintenant: MAINTENANT,
}
const decide = (patch: Partial<EntreeReservationAuto>) => doitReserverAutomatiquement({ ...base, ...patch })

console.log('\nCAS 1 — intention valide, même créneau, droit présent, jamais tenté → on réserve')
check('→ true', decide({}) === true)

console.log('\nCAS 2 — chaque condition manquante empêche l\'appel')
check('sans intention → false', decide({ intent: null }) === false)
check('intention sur un AUTRE créneau → false', decide({ slotId: 'slot-b' }) === false)
check('droit absent (crédit pas encore arrivé) → false', decide({ droitPresent: false }) === false)
// 🔴 LE POINT DU BANC : la garde anti-double. Le poll, le lien profond et la reprise de la
// fiche peuvent tous la déclencher ; un seul appel doit partir.
check('déjà tenté → false', decide({ dejaTente: true }) === false)
check('déjà inscrit → false', decide({ dejaInscrit: true }) === false)

console.log('\nCAS 3 — cours complet : JAMAIS d\'appel (le serveur inscrirait en liste d\'attente)')
check('complet → false', decide({ coursComplet: true }) === false)

console.log('\nCAS 4 — intention périmée')
check('cours commencé → false', decide({ maintenant: Date.parse('2026-11-09T18:05:00Z') }) === false)
check(
  'plafond de 24 h dépassé → false',
  decide({ intent: { ...intent, startsAt: '2026-11-20T18:00:00Z', createdAt: MAINTENANT - 25 * 60 * 60 * 1000 } }) === false,
)

console.log('\nCAS 4b — achat SANS « Payer et réserver » (formule ou carnet via Profil → Abonnement)')
// 🔴 Ce serait la réservation silencieuse de GYM-352 : le bouton manuel reste.
check('sans accord → false', decide({ intent: { ...intent, accordReservation: undefined } }) === false)

console.log('\nCAS 5 — sans paymentId (abonnement pris ailleurs, ou rattachement perdu) : le droit suffit')
check('→ true', decide({ intent: { ...intent, paymentId: undefined } }) === true)

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

console.log(failures === 0 ? '\n✅ banc complet — 0 échec\n' : `\n❌ ${failures} échec(s)\n`)
if (failures > 0) process.exit(1)
