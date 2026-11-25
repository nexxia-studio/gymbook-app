// GYM-391 — écran Messages : date relative, routage d'un message, pastille, table du push.
//
//     cd apps/mobile && npx tsx tests/messages.test.ts
//
// ⚠️ SCRIPT À CORPS DE MODULE, comme les autres tests de ce dossier.
import { badgeLabel, relativeDate, type RelativeDate } from '../lib/messages/format'
import {
  messageDestination, messageNeedsSlotTime, messageSlotId, pushRoute, type MessageDestination,
} from '../lib/messages/routing'

let failures = 0
function check(label: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ✓ ${label}`)
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
function egal(label: string, obtenu: unknown, attendu: unknown): void {
  const o = JSON.stringify(obtenu)
  const a = JSON.stringify(attendu)
  check(label, o === a, `attendu ${a}, obtenu ${o}`)
}

const S = 1_000
const MIN = 60 * S
const H = 60 * MIN
const J = 24 * H

console.log('Date relative')
// Heure locale, en milieu d'année : le test ne dépend ni du fuseau ni d'un changement d'année.
const NOW = new Date(2026, 5, 15, 12, 0, 0)
const ilYA = (ms: number): RelativeDate | null => relativeDate(new Date(NOW.getTime() - ms).toISOString(), NOW)
egal('0 s → à l’instant', ilYA(0), { kind: 'now' })
egal('59 s → à l’instant', ilYA(59 * S), { kind: 'now' })
egal('60 s → 1 min', ilYA(60 * S), { kind: 'minutes', count: 1 })
egal('59 min → 59 min', ilYA(59 * MIN), { kind: 'minutes', count: 59 })
egal('59 min 59 s → 59 min', ilYA(59 * MIN + 59 * S), { kind: 'minutes', count: 59 })
egal('60 min → 1 h', ilYA(60 * MIN), { kind: 'hours', count: 1 })
egal('23 h → 23 h', ilYA(23 * H), { kind: 'hours', count: 23 })
egal('23 h 59 → 23 h', ilYA(23 * H + 59 * MIN), { kind: 'hours', count: 23 })
// Au-delà de 24 h écoulées : jours de CALENDRIER locaux (NOW = lundi 15 juin 2026, 12 h).
egal('24 h → hier', ilYA(24 * H), { kind: 'yesterday' })
egal('veille à 00 h 00 (36 h) → hier', relativeDate(new Date(2026, 5, 14, 0, 0, 0).toISOString(), NOW), { kind: 'yesterday' })
egal('avant-veille à 23 h 59 (36 h 01) → 2 j', relativeDate(new Date(2026, 5, 13, 23, 59, 0).toISOString(), NOW), { kind: 'days', count: 2 })
egal('47 h 59 → 2 j (avant-veille), pas hier', ilYA(47 * H + 59 * MIN), { kind: 'days', count: 2 })
egal('48 h → 2 j', ilYA(48 * H), { kind: 'days', count: 2 })
egal('6 j 23 h → 7 j (7 jours de calendrier)', ilYA(6 * J + 23 * H), { kind: 'days', count: 7 })
egal('7 jours pile → 7 j', ilYA(7 * J), { kind: 'days', count: 7 })
egal('7 jours + 1 min → encore 7 j de calendrier', ilYA(7 * J + MIN), { kind: 'days', count: 7 })
egal('7 j de calendrier, à 00 h 00 → 7 j', relativeDate(new Date(2026, 5, 8, 0, 0, 0).toISOString(), NOW), { kind: 'days', count: 7 })
egal('8 j de calendrier, à 23 h 59 → date, sans année',
  relativeDate(new Date(2026, 5, 7, 23, 59, 0).toISOString(), NOW), { kind: 'date', day: 7, month: 6, year: null })
// Exemples de la spec.
egal('lundi 13 h lu mercredi 12 h (47 h) → 2 j',
  relativeDate(new Date(2026, 5, 15, 13, 0, 0).toISOString(), new Date(2026, 5, 17, 12, 0, 0)), { kind: 'days', count: 2 })
egal('lundi 08 h lu mardi 09 h (25 h) → hier',
  relativeDate(new Date(2026, 5, 15, 8, 0, 0).toISOString(), new Date(2026, 5, 16, 9, 0, 0)), { kind: 'yesterday' })
egal('lundi 13 h lu mardi 12 h (23 h) → 23 h, pas hier',
  relativeDate(new Date(2026, 5, 15, 13, 0, 0).toISOString(), new Date(2026, 5, 16, 12, 0, 0)), { kind: 'hours', count: 23 })
// 🔴 00 h 30 locale : un getUTCDate mis par erreur rendrait un autre jour dans tout fuseau
// décalé d'au moins 30 min vers l'est de UTC (et 23 h 30 couvre ceux de l'ouest).
egal('date à 00 h 30 locale → jour local',
  relativeDate(new Date(2026, 2, 10, 0, 30, 0).toISOString(), NOW), { kind: 'date', day: 10, month: 3, year: null })
egal('date à 23 h 30 locale → jour local',
  relativeDate(new Date(2026, 2, 10, 23, 30, 0).toISOString(), NOW), { kind: 'date', day: 10, month: 3, year: null })
egal('veille à 00 h 30, lu à 00 h 45 le lendemain → hier',
  relativeDate(new Date(2026, 5, 14, 0, 30, 0).toISOString(), new Date(2026, 5, 15, 0, 45, 0)), { kind: 'yesterday' })
// Changements d'heure (Europe : 29 mars et 25 octobre 2026 ; sans effet dans un fuseau fixe,
// où les mêmes attendus restent vrais). Le compte est celui du calendrier, pas des durées.
egal('passage à l’heure d’été : samedi 10 h lu lundi 09 h → 2 j',
  relativeDate(new Date(2026, 2, 28, 10, 0, 0).toISOString(), new Date(2026, 2, 30, 9, 0, 0)), { kind: 'days', count: 2 })
egal('passage à l’heure d’été : samedi 20 h lu dimanche 21 h → hier',
  relativeDate(new Date(2026, 2, 28, 20, 0, 0).toISOString(), new Date(2026, 2, 29, 21, 0, 0)), { kind: 'yesterday' })
egal('passage à l’heure d’hiver : samedi 23 h lu lundi 22 h 30 → 2 j',
  relativeDate(new Date(2026, 9, 24, 23, 0, 0).toISOString(), new Date(2026, 9, 26, 22, 30, 0)), { kind: 'days', count: 2 })
egal('passage à l’heure d’hiver : 7 j de calendrier → 7 j',
  relativeDate(new Date(2026, 9, 20, 23, 0, 0).toISOString(), new Date(2026, 9, 27, 1, 0, 0)), { kind: 'days', count: 7 })
egal('passage à l’heure d’hiver : 8 j de calendrier → date',
  relativeDate(new Date(2026, 9, 19, 23, 0, 0).toISOString(), new Date(2026, 9, 27, 1, 0, 0)), { kind: 'date', day: 19, month: 10, year: null })
// Format rendu par Postgres/PostgREST : microsecondes et décalage explicite.
const PG = '2026-11-25T10:00:00.123456+00:00'
egal('format Postgres, 5 min après → 5 min', relativeDate(PG, new Date('2026-11-25T10:05:00.200Z')), { kind: 'minutes', count: 5 })
egal('format Postgres, 3 h après → 3 h', relativeDate(PG, new Date('2026-11-25T13:00:01Z')), { kind: 'hours', count: 3 })
egal('format Postgres, décalage +02:00 → même instant',
  relativeDate('2026-11-25T12:00:00.123456+02:00', new Date('2026-11-25T10:05:00.200Z')), { kind: 'minutes', count: 5 })
egal('même année, plus ancien → date, sans année',
  relativeDate(new Date(2026, 0, 3, 9, 0, 0).toISOString(), NOW), { kind: 'date', day: 3, month: 1, year: null })
egal('année différente → date, avec année',
  relativeDate(new Date(2025, 11, 31, 9, 0, 0).toISOString(), NOW), { kind: 'date', day: 31, month: 12, year: 2025 })
egal('date future (horloge décalée) → à l’instant', ilYA(-5 * MIN), { kind: 'now' })
egal('date future lointaine → à l’instant', ilYA(-400 * J), { kind: 'now' })
egal('chaîne invalide → null', relativeDate('pas une date', NOW), null)
egal('chaîne vide → null', relativeDate('', NOW), null)
egal('null → null', relativeDate(null, NOW), null)
egal('undefined → null', relativeDate(undefined, NOW), null)
egal('« maintenant » invalide → null', relativeDate(NOW.toISOString(), new Date(NaN)), null)

console.log('Routage d’un message de la boîte')
const MAINTENANT = new Date('2026-06-15T10:00:00.000Z')
const FUTUR = '2026-06-15T11:00:00.000Z'
const PASSE = '2026-06-15T09:00:00.000Z'
const SLOT = 'a1b2c3d4-0000-4000-8000-000000000001'
const va = (type: unknown, data: unknown, slotStartsAt?: string | null): MessageDestination =>
  messageDestination(type as string, data, { now: MAINTENANT, slotStartsAt })
const TYPES_COURS = ['booking_confirmed', 'waitlist_promoted', 'session_cancelled_by_gym', 'session_updated_by_gym']
for (const type of TYPES_COURS) {
  egal(`${type}, cours à venir → fiche du cours`, va(type, { slot_id: SLOT }, FUTUR), { kind: 'session', slotId: SLOT })
  egal(`${type}, cours passé → Mes réservations`, va(type, { slot_id: SLOT }, PASSE), { kind: 'bookings' })
  egal(`${type}, cours qui commence à l’instant → Mes réservations`,
    va(type, { slot_id: SLOT }, MAINTENANT.toISOString()), { kind: 'bookings' })
  egal(`${type}, heure inconnue (null) → Mes réservations`, va(type, { slot_id: SLOT }, null), { kind: 'bookings' })
  egal(`${type}, heure non fournie → Mes réservations`, va(type, { slot_id: SLOT }), { kind: 'bookings' })
  egal(`${type}, heure illisible → Mes réservations`, va(type, { slot_id: SLOT }, 'bientôt'), { kind: 'bookings' })
  egal(`${type}, sans slot_id → Mes réservations`, va(type, {}, FUTUR), { kind: 'bookings' })
  egal(`${type}, data null → Mes réservations`, va(type, null, FUTUR), { kind: 'bookings' })
  check(`${type} a besoin de l’heure du cours`, messageNeedsSlotTime(type) === true)
  check(`${type} → slot_id extrait`, messageSlotId(type, { slot_id: SLOT }) === SLOT)
}
for (const type of ['subscription_activated', 'subscription_payment_failed', 'credits_purchased']) {
  egal(`${type} → Ma formule`, va(type, null), { kind: 'subscription' })
  egal(`${type}, même avec un slot_id → Ma formule`, va(type, { slot_id: SLOT }, FUTUR), { kind: 'subscription' })
  check(`${type} n’a pas besoin de l’heure du cours`, messageNeedsSlotTime(type) === false)
  check(`${type} → aucun slot_id à charger`, messageSlotId(type, { slot_id: SLOT }) === null)
}
egal('no_show_suspension → Profil', va('no_show_suspension', null), { kind: 'profile' })
egal('communication → le message en entier', va('communication', { slot_id: SLOT }, FUTUR), { kind: 'detail' })
egal('type inconnu → le message en entier', va('nouveau_type', { slot_id: SLOT }, FUTUR), { kind: 'detail' })
egal('type du push, absent de la boîte → le message en entier', va('reminder_24h', { slot_id: SLOT }, FUTUR), { kind: 'detail' })
egal('type vide → le message en entier', va('', null), { kind: 'detail' })
egal('type null → le message en entier', va(null, null), { kind: 'detail' })
egal('type non chaîne → le message en entier', va(42, null), { kind: 'detail' })
// 🔴 Un nom de propriété héritée d'Object ne doit jamais être pris pour un type connu.
egal('type « constructor » → le message en entier', va('constructor', null), { kind: 'detail' })
egal('type « toString » → le message en entier', va('toString', null), { kind: 'detail' })
check('type inconnu n’a pas besoin de l’heure du cours', messageNeedsSlotTime('nouveau_type') === false)
check('« constructor » n’a pas besoin de l’heure du cours', messageNeedsSlotTime('constructor') === false)
check('type null n’a pas besoin de l’heure du cours', messageNeedsSlotTime(null) === false)

console.log('data non fiable')
const B = 'booking_confirmed'
const mauvais: [string, unknown][] = [
  ['null', null], ['undefined', undefined], ['tableau', [SLOT]], ['tableau d’objets', [{ slot_id: SLOT }]],
  ['chaîne', SLOT], ['chaîne JSON', JSON.stringify({ slot_id: SLOT })], ['nombre', 12], ['booléen', true],
  ['objet vide', {}], ['slot_id nombre', { slot_id: 12 }], ['slot_id null', { slot_id: null }],
  ['slot_id objet', { slot_id: { id: SLOT } }], ['slot_id tableau', { slot_id: [SLOT] }],
  ['slot_id vide', { slot_id: '' }], ['slot_id d’espaces', { slot_id: '   ' }],
]
for (const [nom, data] of mauvais) {
  check(`${nom} → aucun slot_id`, messageSlotId(B, data) === null)
  egal(`${nom} → Mes réservations`, va(B, data, FUTUR), { kind: 'bookings' })
}
check('slot_id valide → extrait tel quel', messageSlotId(B, { slot_id: SLOT, autre: 1 }) === SLOT)

console.log('Libellé de pastille')
egal('0 → aucune pastille', badgeLabel(0), null)
egal('1 → « 1 »', badgeLabel(1), '1')
egal('9 → « 9 »', badgeLabel(9), '9')
egal('10 → « 9+ »', badgeLabel(10), '9+')
egal('250 → « 9+ »', badgeLabel(250), '9+')
egal('négatif → aucune pastille', badgeLabel(-3), null)
egal('NaN → aucune pastille', badgeLabel(NaN), null)
egal('Infinity → aucune pastille', badgeLabel(Infinity), null)
egal('null → aucune pastille', badgeLabel(null), null)
egal('undefined → aucune pastille', badgeLabel(undefined), null)
egal('chaîne → aucune pastille', badgeLabel('3' as unknown as number), null)
egal('décimal → aucune pastille', badgeLabel(2.5), null)

console.log('Table de routage du push (figée : mêmes destinations qu’avant l’extraction)')
const push = (data: Record<string, string>) => pushRoute(data)
egal('booking_confirmed', push({ type: 'booking_confirmed' }), '/(tabs)/bookings')
egal('booking_confirmed, slot_id ignoré', push({ type: 'booking_confirmed', slot_id: SLOT }), '/(tabs)/bookings')
egal('booking_cancelled', push({ type: 'booking_cancelled' }), '/(tabs)/bookings')
egal('waitlist_promotion', push({ type: 'waitlist_promotion', slot_id: SLOT }), `/session/${SLOT}`)
egal('noshow_warning', push({ type: 'noshow_warning' }), '/(tabs)/profile')
egal('noshow_suspension_48h', push({ type: 'noshow_suspension_48h' }), '/(tabs)/profile')
egal('noshow_suspension_2w', push({ type: 'noshow_suspension_2w' }), '/(tabs)/profile')
egal('slot_cancelled', push({ type: 'slot_cancelled' }), '/(tabs)/schedule')
egal('slot_cancelled, slot_id ignoré', push({ type: 'slot_cancelled', slot_id: SLOT }), '/(tabs)/schedule')
egal('reminder_24h', push({ type: 'reminder_24h', slot_id: SLOT }), `/session/${SLOT}`)
egal('reminder_2h', push({ type: 'reminder_2h', slot_id: SLOT }), `/session/${SLOT}`)
// ⚠️ Comportement existant, figé tel quel : sans slot_id, la route porte « undefined ».
// La correction est hors périmètre (spec, « Hors périmètre »).
egal('waitlist_promotion sans slot_id', push({ type: 'waitlist_promotion' }), '/session/undefined')
egal('reminder_24h sans slot_id', push({ type: 'reminder_24h' }), '/session/undefined')
egal('reminder_2h sans slot_id', push({ type: 'reminder_2h' }), '/session/undefined')
// Les types de la boîte que le push ne connaissait pas restent sans destination.
for (const type of [
  'waitlist_promoted', 'session_cancelled_by_gym', 'session_updated_by_gym', 'subscription_activated',
  'subscription_payment_failed', 'credits_purchased', 'no_show_suspension', 'communication', 'inconnu', '',
]) {
  egal(`« ${type} » → aucune navigation`, push({ type }), null)
}
egal('sans type → aucune navigation', push({}), null)
egal('sans type, avec slot_id → aucune navigation', push({ slot_id: SLOT }), null)

console.log(failures === 0 ? '\n✅ messages : tout passe' : `\n🔴 messages : ${failures} échec(s)`)
process.exit(failures === 0 ? 0 : 1)
