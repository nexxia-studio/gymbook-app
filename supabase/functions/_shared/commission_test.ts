// GYM-250 — BANC DE LA COMMISSION EFFECTIVE.
//
//     deno run supabase/functions/_shared/commission_test.ts
//
// ⚠️ AUCUNE DÉPENDANCE, AUCUN RÉSEAU (bancs `_shared`, cf. GYM-313/319/336/346/lot A).
// ⚠️ GYM-350 — script à corps de module : lire la sortie et le code de sortie, pas
// « N passed ». Voir docs/ops/preuves-controle-de-types.md §4.
//
// CE QUE CE BANC PROTÈGE : qu'une PANNE de résolution ne se facture jamais comme une salle
// exonérée. C'était le comportement d'avant — `{0, 0}` sur lecture en échec — et sur un
// abonnement récurrent ce zéro était scellé pour toutes les échéances.
//
// Son pendant côté base, qui prouve que le changement ne déplace aucun centime aujourd'hui
// et qu'il en déplacera le jour de l'allumage : supabase/tests/gym_trial_commission.sql.
import { commissionFromPlan, getEffectiveCommission } from './commission.ts'
import type { EffectivePlan } from './effective-plan.ts'

let failures = 0
function check(label: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ✓ ${label}`)
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}

function planAvec(sepa: unknown, cb: unknown): EffectivePlan {
  return {
    plan: 'free', effective_plan: 'pro', status: 'trialing', trial_active: true,
    limits: { max_members: 200, max_slots_per_month: null, max_admins: 5, max_sites: 1 },
    features: {
      custom_domain: false, payments_enabled: true, notifications_enabled: true,
      analytics_enabled: true, multi_site_enabled: false, ios_app_enabled: true,
      android_app_enabled: true, qr_checkin_enabled: true, export_enabled: true,
      api_access_enabled: false,
    },
    commissions: { sepa_rate: sepa as number, cb_rate: cb as number },
  }
}

/** Faux client : `rpc` rend ce qu'on lui dit. Assez pour attester le contrat d'erreur. */
// deno-lint-ignore no-explicit-any
function fauxClient(retour: { data: unknown; error: unknown }): any {
  return { rpc: () => Promise.resolve(retour) }
}

console.log('\nCAS 1 — les taux viennent des COMMISSIONS du plan, pas de ses limites')
{
  const c = commissionFromPlan(planAvec(0.01, 0.015))
  check('sepaRate = commissions.sepa_rate', c.sepaRate === 0.01, String(c.sepaRate))
  check('cbRate = commissions.cb_rate', c.cbRate === 0.015, String(c.cbRate))
  // 🔴 LE POINT DU LOT : ce plan porte `plan: 'free'` ET `effective_plan: 'pro'`. Les taux
  // servis sont ceux que le résolveur a calculés sur le plan EFFECTIF. L'ancienne version
  // serait repartie de la colonne `free` — 0 %, scellé pour douze mois.
  check('la colonne `free` du plan n\'influence RIEN', c.sepaRate !== 0 && c.cbRate !== 0,
    `plan=${planAvec(0.01, 0.015).plan}`)
}

console.log('\nCAS 2 — `numeric` traversé en chaîne reste un nombre')
{
  // `numeric` → jsonb → JSON : le contrat TypeScript ne garantit pas la forme.
  const c = commissionFromPlan(planAvec('0.0100', '0.0150'))
  check('sepaRate converti', c.sepaRate === 0.01, String(c.sepaRate))
  check('cbRate converti', c.cbRate === 0.015, String(c.cbRate))
  check('pas de concaténation accidentelle', typeof c.sepaRate === 'number', typeof c.sepaRate)
}

console.log('\nCAS 3 — 0 % reste 0 %, et n\'est pas confondu avec « pas de taux »')
{
  // La dérogation à 0 est EXPLICITE et valide (Dopamine). `get_effective_plan` l'a déjà
  // appliquée ; ce module ne doit pas la réinterpréter.
  const c = commissionFromPlan(planAvec(0, 0))
  check('sepaRate 0 conservé', c.sepaRate === 0, String(c.sepaRate))
  check('cbRate 0 conservé', c.cbRate === 0, String(c.cbRate))
}

console.log('\nCAS 4 — une PANNE ne se facture pas comme une exonération')
{
  const nul = await getEffectiveCommission(fauxClient({ data: null, error: { message: 'boom' } }), 'g')
  // 🔴 AVANT CE LOT : la même panne rendait { cbRate: 0, sepaRate: 0 } et l'abonnement
  // partait chez Mollie avec 0 % scellé. Le contrat est désormais explicite.
  check('résolution en échec → null, PAS { 0, 0 }', nul === null, JSON.stringify(nul))

  const vide = await getEffectiveCommission(fauxClient({ data: null, error: null }), 'g')
  check('réponse vide → null', vide === null, JSON.stringify(vide))

  const ok = await getEffectiveCommission(
    fauxClient({ data: planAvec(0.005, 0.01), error: null }), 'g')
  check('résolution réussie → les deux taux', ok?.sepaRate === 0.005 && ok?.cbRate === 0.01,
    JSON.stringify(ok))
}

console.log(failures === 0 ? '\n✅ banc complet — 0 échec\n' : `\n❌ ${failures} échec(s)\n`)
if (failures > 0) throw new Error(`${failures} échec(s)`)
