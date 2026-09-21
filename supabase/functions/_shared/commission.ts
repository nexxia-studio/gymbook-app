// GYM-79 / GYM-250 — LA COMMISSION EFFECTIVE VINIZ, résolue par le PLAN EFFECTIF.
//
// ╔═══════════════════════════════════════════════════════════════════════════════════════╗
// ║  🔴 CE FICHIER LISAIT LA COLONNE `nexxia_gyms.plan`. IL LIT MAINTENANT LE PLAN        ║
// ║  EFFECTIF. C'est le prérequis n°1 de l'essai de 14 jours, et il est prioritaire.      ║
// ╚═══════════════════════════════════════════════════════════════════════════════════════╝
//
// CE QU'IL FAISAIT, ET CE QUE ÇA AURAIT COÛTÉ. Il lisait `plan` puis allait chercher les
// taux de cette ligne de grille. Pendant un essai, la colonne vaut encore `free` — dont
// les deux taux sont à 0. Or `applicationFee` est SCELLÉE à la création de l'abonnement
// Mollie et ne change plus jamais :
//
//     tout abonnement récurrent vendu pendant les 14 jours d'essai aurait porté 0 % de
//     commission POUR TOUTE SA VIE — y compris après le passage de la salle à un plan
//     payant. Douze mois d'encaissement à 0 % pour quatorze jours d'essai.
//
// Ce n'est pas un défaut latent que l'allumage révélerait : c'est un défaut que l'allumage
// ARME, et qu'aucune migration ne peut rattraper ensuite — la valeur est chez Mollie.
//
// ⚠️ UNE SEULE SOURCE, ET ELLE NE RECALCULE RIEN. `get_effective_plan` résout DÉJÀ les
// commissions : `override ?? taux du plan effectif`, avec `0` comme override valide. Ce
// module ne refait pas ce calcul à côté — il le LIT. Deux façons de calculer un taux
// finissent par diverger, et c'est très exactement ce qui vient d'être corrigé ici.
//
// ⚠️ L'ORDRE DE RÉSOLUTION EST INCHANGÉ, ET C'EST CE QUI REND LE CHANGEMENT NEUTRE
// AUJOURD'HUI : la dérogation par salle (`commission_*_rate_override`) prime toujours sur
// le taux du plan, `NULL` = pas de dérogation, `0` = dérogation explicite à 0. Tant que
// `v_trial_enabled` est `false`, plan effectif = colonne, donc ancien et nouveau chemin
// rendent le MÊME centime. Prouvé au banc : supabase/tests/gym_trial_commission.sql.
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getEffectivePlan, type EffectivePlan } from './effective-plan.ts'

export interface EffectiveCommission {
  cbRate: number
  sepaRate: number
}

/**
 * Les deux taux d'un plan DÉJÀ résolu. Aucune requête.
 *
 * ⚠️ C'EST LA FORME À PRÉFÉRER quand l'appelant tient déjà son `EffectivePlan` —
 * `create-payment` et `create-subscription` l'ont en main depuis leur garde
 * `payments_enabled`, quelques lignes plus haut. Les faire re-résoudre le plan aurait
 * ajouté une seconde lecture qui peut répondre autre chose que la première : entre les
 * deux, un changement de plan et la salle serait facturée sur un taux qu'elle n'avait pas
 * quand on a décidé qu'elle pouvait vendre.
 *
 * `Number(...)` n'est pas décoratif : `numeric` traverse jsonb puis JSON, et le contrat
 * d'`EffectivePlan` ne garantit pas la forme au-delà du typage TypeScript.
 */
export function commissionFromPlan(plan: EffectivePlan): EffectiveCommission {
  return {
    cbRate: Number(plan.commissions.cb_rate),
    sepaRate: Number(plan.commissions.sepa_rate),
  }
}

/**
 * Résout le plan de la salle, puis en tire les deux taux.
 *
 * 🔴 `null` VEUT DIRE « ON NE SAIT PAS », JAMAIS « 0 % ». C'est le changement de contrat de
 * ce lot, et il est délibéré : l'ancienne version rendait `{0, 0}` quand la lecture
 * échouait, c'est-à-dire qu'une panne de base se facturait comme une salle exonérée. Sur
 * un abonnement récurrent, ce zéro-là était SCELLÉ pour douze mois.
 *
 * Même doctrine que GYM-246 pour `PLAN_RESOLUTION_FAILED` : une panne ne se dégrade jamais
 * en refus de droit ni en cadeau commercial. L'appelant doit la traiter comme une panne —
 * refuser, réessayer — mais jamais encaisser dessus.
 */
export async function getEffectiveCommission(
  admin: SupabaseClient,
  gymId: string,
): Promise<EffectiveCommission | null> {
  const plan = await getEffectivePlan(admin, gymId)
  return plan ? commissionFromPlan(plan) : null
}
