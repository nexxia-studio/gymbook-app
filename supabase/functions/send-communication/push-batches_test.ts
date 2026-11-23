// GYM-134 (Communications v1) — BANC DES LOTS DE PUSH.
//
//     deno run supabase/functions/send-communication/push-batches_test.ts
//
// ⚠️ AUCUNE DÉPENDANCE, AUCUN RÉSEAU. Script à corps de module : lire la sortie et le code
// de sortie, pas « N passed ».
import { TAILLE_LOT_EXPO, bilan, jetonsAcceptes, lotsDeJetons, paquets, type Destinataire } from './push-batches.ts'

let failures = 0
function check(label: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ✓ ${label}`)
  else { failures++; console.log(`  ✗ ${label} : ${detail}`) }
}
const membres = (n: number, sansJeton = 0): Destinataire[] =>
  Array.from({ length: n }, (_, i) => ({ member_id: `m${i}`, push_token: i < n - sansJeton ? `ExponentPushToken[${i}]` : null }))

console.log('lots de 100 jetons, pas une requête par membre')
{
  check('constante Expo = 100', TAILLE_LOT_EXPO === 100)
  const lots = lotsDeJetons(membres(171, 21))
  check('171 membres dont 21 sans jeton → 2 lots (100 + 50)', lots.map((l) => l.length).join('+') === '100+50', lots.map((l) => l.length).join('+'))
  check('exactement 100 jetons → 1 lot', lotsDeJetons(membres(100)).length === 1)
  check('101 jetons → 2 lots (100 + 1)', lotsDeJetons(membres(101)).map((l) => l.length).join('+') === '100+1')
  check('aucun jeton → aucun lot, donc aucun appel', lotsDeJetons(membres(5, 5)).length === 0)
  check('liste vide → aucun lot', lotsDeJetons([]).length === 0)
  check('jeton vide ou blanc ignoré', lotsDeJetons([{ member_id: 'a', push_token: '' }, { member_id: 'b', push_token: '   ' }]).length === 0)
  const partage = lotsDeJetons([{ member_id: 'a', push_token: 'T' }, { member_id: 'b', push_token: 'T' }, { member_id: 'c', push_token: 'U' }])
  check('même téléphone pour deux comptes → un seul envoi', partage.length === 1 && partage[0].join(',') === 'T,U')
}

console.log('lecture de la réponse de send-notification')
{
  const lot = ['A', 'B', 'C']
  check('tous acceptés', jetonsAcceptes(lot, { ok: true, results: [{ status: 'ok' }, { status: 'ok' }, { status: 'ok' }] }).join('') === 'ABC')
  check('un jeton périmé (DeviceNotRegistered) n\'est pas compté',
    jetonsAcceptes(lot, { ok: true, results: [{ status: 'ok' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }, { status: 'ok' }] }).join('') === 'AC')
  check('plan sans notifications (pas de results) → aucun', jetonsAcceptes(lot, { ok: true, sent: 0, failed: 0, skipped: 'notifications_disabled' }).length === 0)
  check('Expo en panne (ok:false) → aucun', jetonsAcceptes(lot, { ok: false, status: 502 }).length === 0)
  check('réponse illisible → aucun', jetonsAcceptes(lot, null).length === 0 && jetonsAcceptes(lot, 'oops').length === 0)
  check('longueur différente → aucun (on ne devine pas l\'ordre)', jetonsAcceptes(lot, { ok: true, results: [{ status: 'ok' }] }).length === 0)
}

console.log('bilan : X envoyés sur Y, Z sans notifications activées')
{
  const d = membres(171, 21)
  const tous = d.filter((m) => m.push_token).map((m) => m.push_token!)
  const b = bilan(d, tous)
  check('Y = 171, X = 150, Z = 21, aucun échec',
    b.recipient_count === 171 && b.push_sent === 150 && b.without_token === 21 && b.push_failed === 0 && b.with_token === 150, JSON.stringify({ ...b, parMembre: undefined }))
  check('une ligne par membre', b.parMembre.length === 171)
  check('membre sans jeton → push_sent false', b.parMembre.filter((m) => !m.push_sent).length === 21)
  const partiel = bilan(d, tous.slice(0, 100))
  check('second lot refusé : X = 100, 50 échecs, Z inchangé', partiel.push_sent === 100 && partiel.push_failed === 50 && partiel.without_token === 21)
  check('X + échecs + Z = Y', partiel.push_sent + partiel.push_failed + partiel.without_token === partiel.recipient_count)
  const partage = bilan([{ member_id: 'a', push_token: 'T' }, { member_id: 'b', push_token: 'T' }], ['T'])
  check('jeton partagé accepté → les deux membres comptés', partage.push_sent === 2)
  const vide = bilan([], [])
  check('segment vide → tout à zéro', vide.recipient_count === 0 && vide.push_sent === 0 && vide.without_token === 0)
}

console.log('paquets d\'insertion')
check('171 lignes par 500 → 1 paquet', paquets(membres(171), 500).length === 1)
check('1 201 lignes par 500 → 3 paquets', paquets(membres(1201), 500).map((p) => p.length).join('+') === '500+500+201')

console.log(failures === 0 ? '\n✅ push-batches : tout passe' : `\n🔴 push-batches : ${failures} échec(s)`)
Deno.exit(failures === 0 ? 0 : 1)
