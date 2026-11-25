// GYM-391 — liste de l'écran Messages : icône par type, fusion des pages sans doublon,
// « reste-t-il une page », marquage optimiste et son annulation, identifiant venu de l'URL.
//
//     cd apps/mobile && npx tsx tests/messagesList.test.ts
//
// ⚠️ SCRIPT À CORPS DE MODULE, comme les autres tests de ce dossier.
import {
  MESSAGE_ICON_BY_TYPE, hasMorePages, mergePages, messageIconName, messageIdFromParam, withRead,
  withReadStateOf,
} from '../lib/messages/list'
import { MESSAGES_PAGE_SIZE, isUnread, type MessageRow } from '../lib/messages/data'

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

function ligne(id: string, read: boolean | null = false, title = id): MessageRow {
  return { id, type: 'communication', title, body: '', data: null, read, read_at: read ? '2026-11-20T10:00:00Z' : null, created_at: '2026-11-20T09:00:00Z' }
}
const ids = (rows: MessageRow[]) => rows.map((r) => r.id)

console.log('Icône par type')
// Les neuf types que la spec route : chacun a son icône, aucun ne tombe sur la générique.
for (const type of [
  'booking_confirmed', 'waitlist_promoted', 'session_cancelled_by_gym', 'session_updated_by_gym',
  'subscription_activated', 'subscription_payment_failed', 'credits_purchased', 'no_show_suspension',
  'communication',
]) {
  check(`${type} → icône propre`, type in MESSAGE_ICON_BY_TYPE && messageIconName(type) !== 'bell')
}
egal('booking_confirmed', messageIconName('booking_confirmed'), 'calendar-check')
egal('communication', messageIconName('communication'), 'megaphone')
for (const [nom, type] of [
  ['type inconnu', 'nouveau_type'], ['vide', ''], ['null', null], ['undefined', undefined], ['non chaîne', 42],
  // Une clé héritée d'Object.prototype n'est pas un type.
  ['toString', 'toString'], ['constructor', 'constructor'], ['__proto__', '__proto__'],
] as [string, unknown][]) {
  egal(`${nom} → icône générique`, messageIconName(type as string), 'bell')
}

console.log('Fusion des pages')
egal('page suivante ajoutée à la suite', ids(mergePages([ligne('a'), ligne('b')], [ligne('c'), ligne('d')])), ['a', 'b', 'c', 'd'])
// Un message arrivé entre deux pages décale tout d'un rang : la dernière ligne de la page 1
// revient en tête de la page 2.
egal('ligne glissée d’une page à l’autre → pas de doublon', ids(mergePages([ligne('a'), ligne('b')], [ligne('b'), ligne('c')])), ['a', 'b', 'c'])
egal('doublon dans la page reçue → un seul', ids(mergePages([ligne('a')], [ligne('b'), ligne('b')])), ['a', 'b'])
egal('la première liste l’emporte sur un même id', mergePages([ligne('a', true, 'frais')], [ligne('a', false, 'ancien')])[0]?.title, 'frais')
egal('liste vide + page', ids(mergePages([], [ligne('a')])), ['a'])
egal('liste + page vide', ids(mergePages([ligne('a')], [])), ['a'])
egal('l’ordre de la première liste est gardé, les nouvelles suivent',
  ids(mergePages([ligne('n'), ligne('a'), ligne('b')], [ligne('a'), ligne('b'), ligne('c')])), ['n', 'a', 'b', 'c'])
const depart = [ligne('a')]
mergePages(depart, [ligne('b')])
egal('n’altère pas la liste reçue', ids(depart), ['a'])

console.log('Reste-t-il une page ?')
check('page pleine → oui', hasMorePages(MESSAGES_PAGE_SIZE) === true)
check('page incomplète → non', hasMorePages(MESSAGES_PAGE_SIZE - 1) === false)
check('page vide → non', hasMorePages(0) === false)

console.log('Marquage optimiste')
const avant = [ligne('a', false), ligne('b', null), ligne('c', true)]
egal('une ligne marquée lue', withRead(avant, 'a').map(isUnread), [false, true, false])
egal('toutes marquées lues', withRead(avant).map(isUnread), [false, false, false])
egal('id inconnu → rien ne change', withRead(avant, 'zzz').map(isUnread), [true, true, false])
check('une ligne déjà lue garde sa référence', withRead(avant)[2] === avant[2])
egal('n’altère pas la liste reçue', avant.map(isUnread), [true, true, false])
// Échec du marquage : seules les lignes concernées reviennent à leur état d'origine, et une
// page chargée entre-temps n'est pas perdue.
const apres = [...withRead(avant), ligne('d', false)]
const retour = withReadStateOf(apres, [avant[0]!, avant[1]!])
egal('retour à l’état précédent', retour.map(isUnread), [true, true, false, true])
egal('read d’origine rendu tel quel (null reste null)', retour.map((r) => r.read), [false, null, true, false])
egal('ligne arrivée entre-temps conservée', ids(retour), ['a', 'b', 'c', 'd'])
egal('aucune ligne d’origine → rien ne change', withReadStateOf(apres, []).map(isUnread), [false, false, false, true])

console.log('Identifiant venu de l’URL')
const ID = 'a1b2c3d4-0000-4000-8000-00000000000a'
egal('uuid → rendu', messageIdFromParam(ID), ID)
egal('uuid en majuscules → rendu', messageIdFromParam(ID.toUpperCase()), ID.toUpperCase())
egal('tableau d’un uuid → rendu', messageIdFromParam([ID]), ID)
for (const [nom, valeur] of [
  ['absent', undefined], ['null', null], ['vide', ''], ['texte', 'bonjour'], ['uuid tronqué', ID.slice(0, 20)],
  ['uuid suivi d’un filtre', `${ID},gym_id.neq.x`], ['uuid avec espaces', ` ${ID} `], ['uuid avec saut de ligne', `${ID}\n`],
  ['nombre', 42], ['objet', {}], ['tableau de deux', [ID, ID]], ['tableau vide', []],
] as [string, unknown][]) {
  egal(`${nom} → refusé`, messageIdFromParam(valeur), null)
}

console.log(failures === 0 ? '\n✅ messagesList : tout passe' : `\n🔴 messagesList : ${failures} échec(s)`)
process.exit(failures === 0 ? 0 : 1)
