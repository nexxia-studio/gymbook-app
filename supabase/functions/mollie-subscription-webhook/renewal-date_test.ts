// GYM-319 — BANC DE LA DATE DE PREMIER RENOUVELLEMENT.
//
//     deno test supabase/functions/mollie-subscription-webhook/renewal-date_test.ts
//
// ⚠️ AUCUNE DÉPENDANCE, comme le banc de GYM-313 et pour la même raison : le dépôt n'a pas
// d'`import_map` ni de `deno.json` côté functions, et tirer `jsr:@std/assert` pour des
// égalités de chaînes ajouterait une entrée au lock et exigerait le réseau. La fonction
// testée est PURE — le banc tourne hors ligne, sans Mollie et sans base.
//
// ⚠️ CE BANC NE COUVRE QUE LA DATE. Le reste du chemin (payload, idempotence, insert)
// vit dans `index.ts`, qui appelle `Deno.serve()` au chargement et n'est donc pas
// importable ici. C'est précisément ce qui a justifié de sortir la date dans son module.
import { firstRenewalDate } from './renewal-date.ts'

function assertEquals(actual: string, expected: string, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}\n  attendu : ${expected}\n  obtenu  : ${actual}`)
  }
}

const BRUSSELS = 'Europe/Brussels'

// ─────────────────────────────────────────────────────────────────────────────────────
// 1. LE CAS RÉEL DEMANDÉ — Camille Dupont
// ─────────────────────────────────────────────────────────────────────────────────────
Deno.test('Camille Dupont : paiement 04/09, plan 3 mois → première échéance le 04/10', () => {
  // 14h32 à Bruxelles le 04/09/2026 (CEST, UTC+2) = 12:32Z.
  assertEquals(
    firstRenewalDate(new Date('2026-09-04T12:32:00Z'), BRUSSELS, 1),
    '2026-10-04',
    'un intervalle après le paiement initial, quelle que soit la durée du plan',
  )
})

Deno.test('l\'intervalle est UN mois, pas la durée du plan', () => {
  // `times` (durée − 1) porte le NOMBRE de prélèvements ; `startDate` porte le DÉBUT.
  // Confondre les deux daterait la première échéance à la FIN de l'engagement : le membre
  // de Camille (plan 3 mois) serait prélevé le 04/12 au lieu du 04/10, et les échéances
  // suivantes déborderaient de la période payée. Le call site passe donc 1 — la valeur de
  // `interval: '1 month'` du même payload ; ce banc montre ce que 3 donnerait.
  const paid = new Date('2026-09-04T12:32:00Z')
  assertEquals(firstRenewalDate(paid, BRUSSELS, 1), '2026-10-04', 'un intervalle mensuel')
  assertEquals(firstRenewalDate(paid, BRUSSELS, 3), '2026-12-04', 'trois mois : ce n\'est PAS ce qu\'on envoie')
})

// ─────────────────────────────────────────────────────────────────────────────────────
// 2. LE PIÈGE UTC — la nuit où la salle n'est pas au même jour que Greenwich
// ─────────────────────────────────────────────────────────────────────────────────────
Deno.test('nuit CEST : le jour qui compte est celui de la SALLE, pas celui d\'UTC', () => {
  // 05/09/2026 à 01h30 à Bruxelles = 04/09 23:30Z. Lire les composantes UTC daterait
  // l'échéance du 04/10 — un jour AVANT l'anniversaire réel du membre.
  assertEquals(
    firstRenewalDate(new Date('2026-09-04T23:30:00Z'), BRUSSELS, 1),
    '2026-10-05',
    'le membre a payé le 05/09 chez lui : il doit être prélevé le 05/10',
  )
})

Deno.test('nuit CET : même règle en hiver, offset +01:00', () => {
  // 01/12/2026 à 00h30 à Bruxelles = 30/11 23:30Z.
  assertEquals(
    firstRenewalDate(new Date('2026-11-30T23:30:00Z'), BRUSSELS, 1),
    '2027-01-01',
    'paiement local du 01/12 → échéance du 01/01, passage d\'année compris',
  )
})

// ─────────────────────────────────────────────────────────────────────────────────────
// 3. LE PIÈGE DST — la bascule du 25/10, entre le paiement et l'échéance
// ─────────────────────────────────────────────────────────────────────────────────────
Deno.test('bascule du 25/10 : l\'offset change entre les deux dates, le JOUR ne bouge pas', () => {
  // Paiement le 25/09/2026 à 23h30 CEST (+02:00) = 21:30Z. L'échéance tombe le 25/10,
  // jour où Bruxelles repasse en CET. Ajouter 30 × 86 400 000 ms, ou figer l'offset,
  // ferait glisser d'une heure — et cette heure fait changer de jour à 23h30.
  assertEquals(
    firstRenewalDate(new Date('2026-09-25T21:30:00Z'), BRUSSELS, 1),
    '2026-10-25',
    'le 25/09 local donne le 25/10 local, bascule ou pas',
  )
})

Deno.test('bascule du 25/10 : un paiement APRÈS la bascule reste sur son jour', () => {
  // 26/10/2026 à 00h30, désormais CET (+01:00) = 25/10 23:30Z.
  assertEquals(
    firstRenewalDate(new Date('2026-10-25T23:30:00Z'), BRUSSELS, 1),
    '2026-11-26',
    'paiement local du 26/10 → échéance du 26/11',
  )
})

// ─────────────────────────────────────────────────────────────────────────────────────
// 4. FINS DE MOIS — le jour n'existe pas dans le mois cible
// ─────────────────────────────────────────────────────────────────────────────────────
Deno.test('31/08 → 30/09, et non 01/10', () => {
  // `setMonth(+1)` déborderait sur le 01/10 : une échéance HORS de la période payée.
  assertEquals(
    firstRenewalDate(new Date('2026-08-31T10:00:00Z'), BRUSSELS, 1),
    '2026-09-30',
    'le jour est ramené au dernier du mois cible',
  )
})

Deno.test('31/01 → 28/02 en année ordinaire, 29/02 en bissextile', () => {
  assertEquals(
    firstRenewalDate(new Date('2026-01-31T10:00:00Z'), BRUSSELS, 1),
    '2026-02-28',
    '2026 n\'est pas bissextile',
  )
  assertEquals(
    firstRenewalDate(new Date('2028-01-31T10:00:00Z'), BRUSSELS, 1),
    '2028-02-29',
    '2028 est bissextile',
  )
})

Deno.test('31/12 → 31/01 de l\'année suivante', () => {
  assertEquals(
    firstRenewalDate(new Date('2026-12-31T10:00:00Z'), BRUSSELS, 1),
    '2027-01-31',
    'le passage d\'année ne perd pas le jour',
  )
})

// ─────────────────────────────────────────────────────────────────────────────────────
// 5. MULTI-TENANT — la règle vaut pour tout fuseau, aucune salle en dur
// ─────────────────────────────────────────────────────────────────────────────────────
Deno.test('un autre fuseau donne un autre jour, par le même chemin de code', () => {
  const instant = new Date('2026-09-04T23:30:00Z')
  assertEquals(firstRenewalDate(instant, 'Europe/Brussels', 1), '2026-10-05', 'Bruxelles : déjà le 05/09')
  assertEquals(firstRenewalDate(instant, 'UTC', 1), '2026-10-04', 'UTC : encore le 04/09')
  assertEquals(firstRenewalDate(instant, 'America/New_York', 1), '2026-10-04', 'New York : encore le 04/09')
})

// ─────────────────────────────────────────────────────────────────────────────────────
// 6. LA GARANTIE DE L'INCIDENT — la date rendue n'est JAMAIS le jour du paiement
// ─────────────────────────────────────────────────────────────────────────────────────
Deno.test('aucune date rendue ne tombe le jour du paiement (c\'était l\'incident)', () => {
  // Un an de paiements, un par jour, à l'heure la plus piégeuse : 23h30 locale d'été.
  // Sans `startDate`, Mollie prélevait CE jour-là. Le banc vérifie qu'aucun cas ne le
  // reproduit — ni par débordement de mois, ni par bascule d'heure.
  for (let i = 0; i < 365; i++) {
    const paid = new Date(Date.UTC(2026, 0, 1, 21, 30) + i * 86_400_000)
    const local = new Intl.DateTimeFormat('en-CA', {
      timeZone: BRUSSELS, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(paid)
    const next = firstRenewalDate(paid, BRUSSELS, 1)
    if (next <= local) {
      throw new Error(`échéance non postérieure au paiement\n  payé le : ${local}\n  échéance : ${next}`)
    }
  }
})
