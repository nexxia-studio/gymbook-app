// GYM-387 —  npx tsx src/tests/member-contact.test.ts
import { displayEmail, hasPhone, isAppleRelayEmail } from '../lib/memberContact'

let failures = 0
function check(label: string, cond: boolean): void {
  if (cond) console.log(`  ✓ ${label}`)
  else { failures++; console.log(`  ✗ ${label}`) }
}
const RELAIS = 'x9k2@privaterelay.appleid.com'

check('email de contact prioritaire', displayEmail({ email: RELAIS, contactEmail: 'jean@example.com' }) === 'jean@example.com')
check('email de connexion réel, sans contact', displayEmail({ email: 'jean@example.com', contactEmail: null }) === 'jean@example.com')
check('relais Apple seul → null (masqué)', displayEmail({ email: RELAIS, contactEmail: null }) === null)
check('contact vide → comme absent', displayEmail({ email: RELAIS, contactEmail: '  ' }) === null)
check('relais reconnu sans tenir compte de la casse', isAppleRelayEmail('A@PrivateRelay.AppleID.com'))
check('icloud n’est pas un relais', !isAppleRelayEmail('jean@icloud.com'))
check('téléphone présent', hasPhone({ phone: '+32470123456' }))
check('téléphone null', !hasPhone({ phone: null }))
check('téléphone en espaces', !hasPhone({ phone: '  ' }))

console.log(failures === 0 ? '\n✅ member-contact : tout passe' : `\n🔴 member-contact : ${failures} échec(s)`)
process.exit(failures === 0 ? 0 : 1)
