// GYM-190 — BANC DE LA DÉCISION « RENOUVELLEMENT NORMAL » OU « PAIEMENT APRÈS ARRÊT ».
//
//     deno test supabase/functions/mollie-subscription-webhook/payment-after-stop_test.ts
//
// ⚠️ AUCUNE DÉPENDANCE, comme `renewal-date_test.ts` et pour la même raison : la fonction
// testée est PURE, le banc tourne hors ligne, sans Mollie et sans base.
//
// ⚠️ CE BANC NE COUVRE QUE LA DÉCISION. L'écriture qui en découle vit dans `index.ts`,
// qui appelle `Deno.serve()` au chargement et n'est donc pas importable ici.
import { renewalDecision, STOPPED_SUBSCRIPTION_STATUSES } from './payment-after-stop.ts'

function assertEquals(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}\n  attendu : ${String(expected)}\n  obtenu  : ${String(actual)}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────
// 1. LES QUATRE STATUTS ARRÊTÉS : le paiement ne doit rien relever
// ─────────────────────────────────────────────────────────────────────────────────────
for (const status of ['canceling', 'paused', 'cancelled', 'expired']) {
  Deno.test(`${status} → paiement après arrêt`, () => {
    assertEquals(renewalDecision(status), 'payment_after_stop', `statut ${status}`)
  })
}

Deno.test('la liste exportée contient exactement ces quatre statuts', () => {
  assertEquals(
    [...STOPPED_SUBSCRIPTION_STATUSES].sort().join(','),
    'canceling,cancelled,expired,paused',
    'liste des statuts arrêtés',
  )
})

// ─────────────────────────────────────────────────────────────────────────────────────
// 2. LE COMPORTEMENT ACTUEL EST GARDÉ POUR TOUT LE RESTE
// ─────────────────────────────────────────────────────────────────────────────────────
// `past_due` et `suspended` : c'est la réactivation automatique de GYM-252, un prélèvement
// qui aboutit referme le cycle d'impayé. `completed` : inchangé, hors périmètre.
for (const status of ['active', 'past_due', 'suspended', 'completed']) {
  Deno.test(`${status} → renouvellement normal`, () => {
    assertEquals(renewalDecision(status), 'renew', `statut ${status}`)
  })
}

// Un statut illisible ne doit pas changer le chemin d'aujourd'hui : avant ce lot, le statut
// n'était pas lu du tout.
for (const status of [null, undefined, '', 'statut_inconnu', 'canceled', 'CANCELING']) {
  Deno.test(`statut « ${String(status)} » → renouvellement normal (comportement actuel)`, () => {
    assertEquals(renewalDecision(status), 'renew', `statut ${String(status)}`)
  })
}
