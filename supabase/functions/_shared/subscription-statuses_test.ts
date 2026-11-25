// GYM-190 — BANC DES LISTES DE STATUTS D'ABONNEMENT QUI PROTÈGENT L'ARGENT.
//
//     deno test --no-check supabase/functions/_shared/subscription-statuses_test.ts
//
// ⚠️ `--no-check` : les deux modules testés importent le client Supabase depuis esm.sh, et
// le contrôle de types de `deno test` échoue sur ce graphe dans ce dépôt (ni `deno.json` ni
// `node_modules`, même constat que `booking-guards_test.ts`). Les types se contrôlent à
// part : `deno check` sur ce fichier.
//
// AUCUN RÉSEAU, AUCUNE BASE : seules des constantes et un prédicat pur sont lus.
import { ACCESS_SUBSCRIPTION_STATUSES, PURCHASE_BLOCKING_STATUSES } from './active-subscription.ts'
import { isEngaged, SEPA_SAFETY_NET_STATUSES } from './subscription-engagement.ts'

function assertEquals(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}\n  attendu : ${String(expected)}\n  obtenu  : ${String(actual)}`)
  }
}

const liste = (l: readonly string[]) => [...l].sort().join(',')
const FUTUR = new Date(Date.now() + 30 * 86_400_000).toISOString()
const PASSE = new Date(Date.now() - 86_400_000).toISOString()

// ─────────────────────────────────────────────────────────────────────────────────────
// 1b. `paused` BLOQUE L'ACHAT, N'OUVRE AUCUN ACCÈS
// ─────────────────────────────────────────────────────────────────────────────────────
Deno.test('PURCHASE_BLOCKING_STATUSES : active, canceling, past_due, suspended, paused', () => {
  assertEquals(liste(PURCHASE_BLOCKING_STATUSES), 'active,canceling,past_due,paused,suspended', 'liste')
})

Deno.test('ACCESS_SUBSCRIPTION_STATUSES ne reçoit PAS paused', () => {
  assertEquals(liste(ACCESS_SUBSCRIPTION_STATUSES), 'active,canceling,past_due', 'liste')
})

// ─────────────────────────────────────────────────────────────────────────────────────
// 1b. `paused` ENGAGE, COMME active ET canceling
// ─────────────────────────────────────────────────────────────────────────────────────
for (const status of ['active', 'canceling', 'paused']) {
  Deno.test(`isEngaged : ${status} au terme futur → engagé`, () => {
    assertEquals(isEngaged(status, FUTUR), true, status)
  })
  Deno.test(`isEngaged : ${status} au terme passé ou absent → non engagé`, () => {
    assertEquals(isEngaged(status, PASSE), false, `${status}, terme passé`)
    assertEquals(isEngaged(status, null), false, `${status}, sans terme`)
  })
}

// Inchangé par ce lot : ces statuts n'engageaient pas, ils n'engagent toujours pas.
for (const status of ['past_due', 'suspended', 'expired', 'cancelled', 'completed']) {
  Deno.test(`isEngaged : ${status} au terme futur → non engagé (inchangé)`, () => {
    assertEquals(isEngaged(status, FUTUR), false, status)
  })
}

// ─────────────────────────────────────────────────────────────────────────────────────
// 1c. FILET SEPA DE delete-account
// ─────────────────────────────────────────────────────────────────────────────────────
Deno.test('SEPA_SAFETY_NET_STATUSES : active, canceling, past_due, paused', () => {
  assertEquals(liste(SEPA_SAFETY_NET_STATUSES), 'active,canceling,past_due,paused', 'liste')
})
