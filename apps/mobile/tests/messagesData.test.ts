// GYM-391 — données de l'écran Messages : périmètre des requêtes, pagination, « non lu »,
// charge utile du marquage, garde « la dernière demande gagne » du compteur.
//
//     cd apps/mobile && npx tsx tests/messagesData.test.ts
//
// ⚠️ SCRIPT À CORPS DE MODULE, comme les autres tests de ce dossier.
import {
  MESSAGE_COLUMNS, MESSAGES_PAGE_SIZE, createLatestGuard, isUnread, messageScope, pageRange, readPayload,
  sameScope,
} from '../lib/messages/data'

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

const MEMBRE = 'a1b2c3d4-0000-4000-8000-00000000000a'
const SALLE = 'a1b2c3d4-0000-4000-8000-00000000000b'

console.log('Périmètre : pas de requête sans membre ET salle')
egal('membre et salle → périmètre', messageScope(MEMBRE, SALLE), { memberId: MEMBRE, gymId: SALLE })
for (const [nom, membre, salle] of [
  ['membre null', null, SALLE], ['membre undefined', undefined, SALLE], ['membre vide', '', SALLE],
  ['membre d’espaces', '   ', SALLE], ['salle null', MEMBRE, null], ['salle undefined', MEMBRE, undefined],
  ['salle vide', MEMBRE, ''], ['salle d’espaces', MEMBRE, '  '], ['rien', null, null],
  ['membre non chaîne', 42, SALLE], ['salle non chaîne', MEMBRE, {}],
] as [string, unknown, unknown][]) {
  egal(`${nom} → aucun périmètre`, messageScope(membre as string, salle as string), null)
}
const P = messageScope(MEMBRE, SALLE)
check('même membre, même salle → même périmètre', sameScope(P, messageScope(MEMBRE, SALLE)) === true)
check('autre salle → périmètre différent', sameScope(P, messageScope(MEMBRE, 'autre')) === false)
check('autre membre → périmètre différent', sameScope(P, messageScope('autre', SALLE)) === false)
check('périmètre contre null → différent', sameScope(P, null) === false)
check('null contre périmètre → différent', sameScope(null, P) === false)
// 🔴 Deux « rien » ne sont pas un même périmètre : une réponse ne s'applique jamais à personne.
check('null contre null → différent', sameScope(null, null) === false)

console.log('Pagination')
check('30 par page', MESSAGES_PAGE_SIZE === 30)
egal('page 0 → 0 à 29', pageRange(0), { from: 0, to: 29 })
egal('page 1 → 30 à 59', pageRange(1), { from: 30, to: 59 })
egal('page 3 → 90 à 119', pageRange(3), { from: 90, to: 119 })
egal('page négative → première page', pageRange(-1), { from: 0, to: 29 })
egal('page NaN → première page', pageRange(NaN), { from: 0, to: 29 })
egal('page décimale → page entière inférieure', pageRange(1.7), { from: 30, to: 59 })
egal('colonnes strictement nécessaires',
  MESSAGE_COLUMNS.split(',').map((c) => c.trim()), ['id', 'type', 'title', 'body', 'data', 'read', 'read_at', 'created_at'])

console.log('« Non lu » = read n’est pas true')
check('read false → non lu', isUnread({ read: false }) === true)
check('read null → non lu', isUnread({ read: null }) === true)
check('read absent → non lu', isUnread({}) === true)
check('read true → lu', isUnread({ read: true }) === false)

console.log('Charge utile du marquage : read et read_at, rien d’autre')
const MAINTENANT = new Date('2026-11-25T10:00:00.123Z')
const charge = readPayload(MAINTENANT)
egal('clés exactes', Object.keys(charge).sort(), ['read', 'read_at'])
check('read vaut true', charge.read === true)
check('read_at est l’instant fourni, en ISO', charge.read_at === '2026-11-25T10:00:00.123Z')
egal('charge complète', charge, { read: true, read_at: '2026-11-25T10:00:00.123Z' })

console.log('Garde du compteur : la dernière demande gagne')
const garde = createLatestGuard()
const a = garde.begin()
check('demande seule → appliquée', garde.isCurrent(a) === true)
const b = garde.begin()
check('réponse tardive de la première → ignorée', garde.isCurrent(a) === false)
check('réponse de la seconde → appliquée', garde.isCurrent(b) === true)
garde.invalidate()
check('après remise à zéro (déconnexion, changement de salle) → ignorée', garde.isCurrent(b) === false)
const c = garde.begin()
check('nouvelle demande après remise à zéro → appliquée', garde.isCurrent(c) === true)
check('les anciennes restent ignorées', garde.isCurrent(a) === false && garde.isCurrent(b) === false)
const autre = createLatestGuard()
const d = autre.begin()
garde.begin()
check('deux gardes sont indépendantes', autre.isCurrent(d) === true)

console.log(failures === 0 ? '\n✅ messagesData : tout passe' : `\n🔴 messagesData : ${failures} échec(s)`)
process.exit(failures === 0 ? 0 : 1)
