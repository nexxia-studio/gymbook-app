// GYM-190 — statuts d'abonnement côté app : un membre en délai de grâce garde sa formule.
//
//     cd apps/mobile && npx tsx tests/subscription.test.ts
//
// ⚠️ SCRIPT À CORPS DE MODULE, comme les autres tests de ce dossier.
import {
  ACTIVE_SUBSCRIPTION_STATUSES, DISPLAYABLE_SUBSCRIPTION_STATUSES, isSubscriptionActive,
} from '../lib/subscription'

let failures = 0
function check(label: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ✓ ${label}`)
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}

const FUTUR = new Date(Date.now() + 30 * 86_400_000).toISOString()
const PASSE = new Date(Date.now() - 86_400_000).toISOString()
const liste = (l: string[]) => [...l].sort().join(',')

console.log('ACTIVE_SUBSCRIPTION_STATUSES')
// Même liste que le serveur (_shared/active-subscription.ts, ACCESS_SUBSCRIPTION_STATUSES).
check('active, canceling, past_due', liste(ACTIVE_SUBSCRIPTION_STATUSES) === 'active,canceling,past_due',
  liste(ACTIVE_SUBSCRIPTION_STATUSES))
check('paused n\'ouvre aucun accès', !ACTIVE_SUBSCRIPTION_STATUSES.includes('paused'))
check('suspended n\'ouvre aucun accès', !ACTIVE_SUBSCRIPTION_STATUSES.includes('suspended'))

console.log('DISPLAYABLE_SUBSCRIPTION_STATUSES')
check('tout statut d\'accès est chargé par l\'écran Ma formule',
  ACTIVE_SUBSCRIPTION_STATUSES.every((s) => DISPLAYABLE_SUBSCRIPTION_STATUSES.includes(s)))
check('completed reste chargé pour l\'état « Terminé »', DISPLAYABLE_SUBSCRIPTION_STATUSES.includes('completed'))

console.log('isSubscriptionActive')
for (const status of ['active', 'canceling', 'past_due']) {
  check(`${status}, terme futur → actif`, isSubscriptionActive(status, FUTUR) === true)
  check(`${status}, sans terme → actif`, isSubscriptionActive(status, null) === true)
  check(`${status}, terme passé → inactif`, isSubscriptionActive(status, PASSE) === false)
}
for (const status of ['paused', 'suspended', 'expired', 'cancelled', 'completed', null, undefined]) {
  check(`${String(status)}, terme futur → inactif`, isSubscriptionActive(status, FUTUR) === false)
}

if (failures > 0) {
  console.log(`\n✗ ${failures} échec(s)`)
  process.exit(1)
}
console.log('\n✅ subscription : tout passe')
