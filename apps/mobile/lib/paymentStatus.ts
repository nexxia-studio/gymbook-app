// ╔═══════════════════════════════════════════════════════════════════════════════════════╗
// ║  GYM-374 — CE QUE DIT LE STATUT D'UN PAIEMENT, À UN SEUL ENDROIT                      ║
// ╚═══════════════════════════════════════════════════════════════════════════════════════╝
//
// ⚠️ MODULE PUR, SANS IMPORT : `scripts/verify-intention-sans-paiement.mjs` le compile seul
// pour falsifier la décision. Y importer supabase ou React Native casserait cette preuve.
//
// `TERMINAL_FAILURE` vivait dans `app/payment/success.tsx`. Il est DÉPLACÉ ici, pas copié :
// la fiche du cours en a désormais besoin aussi, et deux définitions du même prédicat
// finissent par diverger (motif connu sur ce dépôt).

/** Statuts terminaux d'échec (Mollie → colonne payments.status via webhook). */
export const TERMINAL_FAILURE = new Set(['failed', 'canceled', 'cancelled', 'expired'])

/**
 * Ce que la fiche du cours doit faire quand un membre qui porte une intention retape
 * « Confirmer ma réservation » et que le serveur répond PAYMENT_REQUIRED.
 *
 *   · non_finalise — il n'a jamais atteint le paiement, ou le paiement est mort
 *                    (failed / canceled / expired). On le DIT et on ROUVRE la feuille.
 *   · paye         — `paid` : le crédit arrive vraiment, seul le webhook de crédit tarde.
 *                    Le message « ton paiement est bien enregistré » est alors VRAI.
 *   · ambigu       — tout le reste : `pending` / `open`, ligne introuvable, lecture
 *                    impossible. On n'affirme RIEN, et on offre une sortie explicite.
 */
export type IssueRetour = 'non_finalise' | 'paye' | 'ambigu'

/**
 * @param paymentId l'id Mollie porté par l'intention (absent = jamais atteint le paiement)
 * @param statut    `payments.status` lu pour cet id ; `null` = introuvable ou illisible
 */
export function issueDuRetour(paymentId: string | undefined, statut: string | null): IssueRetour {
  if (!paymentId) return 'non_finalise'
  if (statut === 'paid') return 'paye'
  if (statut !== null && TERMINAL_FAILURE.has(statut)) return 'non_finalise'
  // 🔴 `pending`/`open` EST AMBIGU, ET IL FAUT L'ASSUMER. `payments.status` n'est mis à jour
  // QUE par le webhook Mollie : « il vient de payer, le webhook n'est pas arrivé » et « il
  // est parti sans payer » portent le MÊME statut pendant la fenêtre de latence (jusqu'à
  // 2 min 33 s, GYM-207). Trancher ici, dans un sens ou dans l'autre, serait mentir.
  //
  // ⚠️ L'inconnu (ligne introuvable, coupure) tombe ici aussi, et non dans `non_finalise` :
  // rouvrir d'office la feuille d'achat à quelqu'un qui a peut-être payé, c'est risquer
  // le double paiement que le garde-fou de GYM-352 existe pour empêcher.
  return 'ambigu'
}
