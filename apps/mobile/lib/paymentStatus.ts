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
  if (paiementMort(paymentId, statut)) return 'non_finalise'
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

/**
 * GYM-374b — Le paiement rattaché à l'intention est-il MORT (failed / canceled / expired) ?
 *
 * C'est le SEUL cas où la fiche du cours agit d'elle-même, à l'ouverture, sans attendre
 * de geste : un fait serveur terminal, posé par le webhook, qui ne reviendra pas. Tout le
 * reste — pas de `paymentId`, `pending`/`open`, inconnu — rend `false` : l'ambiguïté se
 * tranche par le membre, jamais par l'app.
 */
export function paiementMort(paymentId: string | undefined, statut: string | null): boolean {
  return !!paymentId && statut !== null && TERMINAL_FAILURE.has(statut)
}

/**
 * GYM-379 — Le membre revient du navigateur (AppState → active) pendant l'attente de la
 * feuille « Payer cette séance ». Que fait la feuille, au vu de `payments.status` ?
 *
 *   · abandonner        — failed / canceled / expired : fait serveur terminal. On arrête
 *                         l'attente et on rend les options, avec un message neutre.
 *   · proposer_reprise  — `open` / `pending` : « Paiement non finalisé ? ». On propose de
 *                         ROUVRIR LE MÊME checkout, jamais d'en créer un second.
 *   · attendre          — `paid` (la boucle verra le droit) ou inconnu (lecture impossible) :
 *                         on n'affirme rien, « Annuler » reste disponible.
 *
 * 🔴 MESURÉ EN STAGING LE 09/11 : « Canceled » chez la banque (KBC via Mollie) n'envoie
 * AUCUN webhook. Le paiement reste `open` et ne passe `expired` qu'environ 17 min plus tard.
 * `abandonner` ne couvre donc presque jamais l'annulation réelle : c'est `open` qui la porte.
 *
 * ⚠️ `open` RESTE AMBIGU — il vient peut-être de payer et le webhook tarde. D'où la
 * question, et la REPRISE DU MÊME checkout : sur un paiement déjà payé, Mollie le dit, et
 * le membre ne peut pas payer deux fois. Rouvrir les OPTIONS ici, au contraire, créerait un
 * second paiement.
 */
export type IssueAuPremierPlan = 'abandonner' | 'proposer_reprise' | 'attendre'

const NON_FINALISE = new Set(['open', 'pending'])

export function issueAuPremierPlan(statut: string | null): IssueAuPremierPlan {
  if (statut === null) return 'attendre'
  if (TERMINAL_FAILURE.has(statut)) return 'abandonner'
  if (NON_FINALISE.has(statut)) return 'proposer_reprise'
  return 'attendre'
}

/**
 * 🔴 GYM-379 (relecture du 09/11) — UN NOUVEAU PAIEMENT PEUT-IL ÊTRE PROPOSÉ ?
 *
 * Seulement s'il n'y a pas de paiement précédent, ou si le précédent est MORT (failed /
 * canceled / expired). `open`, `pending`, `paid` et l'inconnu ferment la porte : le membre
 * a peut-être payé (webhook en retard), et lui rouvrir « Payer cette séance », c'est l'exposer
 * au double débit. Sur `open`, on propose de reprendre le MÊME checkout.
 */
export function nouveauPaiementAutorise(paymentIdPrecedent: string | null | undefined, statut: string | null): boolean {
  if (!paymentIdPrecedent) return true
  return statut !== null && TERMINAL_FAILURE.has(statut)
}

/**
 * GYM-379 — LA FEUILLE « PAYER CETTE SÉANCE » ARRIVE AU BOUT DE SES 5 MINUTES, se rouvre
 * sur un paiement précédent, ou le membre tape « Reprendre le paiement ». Où va-t-elle, au
 * vu de `payments.status` ?
 *
 *   · options        — échec terminal : un nouveau paiement peut être proposé ;
 *   · non_finalise   — `open` / `pending`, ET EUX SEULS : « Paiement non finalisé ? »
 *                      (Reprendre / Annuler) ; au tap sur « Reprendre », le checkout rouvre ;
 *   · paye           — `paid` : le crédit tarde. On ne propose rien à payer, on le dit ;
 *   · illisible      — `null` (hors ligne, ligne introuvable) ou statut inconnu :
 *                      « Impossible de vérifier ton paiement » (Réessayer / Annuler).
 *
 * 🔴 GYM-379 (passe finale) — L'INCONNU N'EST PLUS « NON FINALISÉ ». Il menait à
 * « Reprendre », donc à rouvrir un checkout dont on ne savait rien — peut-être déjà payé,
 * peut-être expiré. On ne propose ni de payer ni de reprendre ce qu'on n'a pas pu lire.
 */
export type IssueFinAttente = 'options' | 'non_finalise' | 'paye' | 'illisible'

export function issueFinAttente(statut: string | null): IssueFinAttente {
  if (statut === 'paid') return 'paye'
  if (statut !== null && TERMINAL_FAILURE.has(statut)) return 'options'
  if (statut !== null && NON_FINALISE.has(statut)) return 'non_finalise'
  return 'illisible'
}

/**
 * 🔴 GYM-379 (passe finale) — AVANT DE CRÉER UN PAIEMENT DEPUIS PROFIL → ABONNEMENT, que
 * faire de l'intention de réservation en cours et de son paiement ?
 *
 *   · libre             — pas de paiement rattaché, ou paiement mort : l'achat part, et
 *                         se rattache à l'intention comme avant (GYM-374) ;
 *   · paiement_en_cours — `open` / `pending` : « Un paiement est en cours pour ton cours… »,
 *                         Reprendre ce paiement / L'abandonner et continuer. JAMAIS
 *                         d'écrasement silencieux : le membre a peut-être payé ;
 *   · conserver         — `paid` : le cours se réserve d'après CE paiement. L'achat part,
 *                         mais NE TOUCHE PAS à l'intention — l'écraser retirerait l'accord
 *                         et le cours payé ne se réserverait plus ;
 *   · illisible         — statut illisible : on ne décide rien sur une lecture ratée.
 */
export type GardeAchat = 'libre' | 'paiement_en_cours' | 'conserver' | 'illisible'

export function gardeAvantAchat(paymentId: string | null | undefined, statut: string | null): GardeAchat {
  if (!paymentId) return 'libre'
  if (statut === null) return 'illisible'
  if (TERMINAL_FAILURE.has(statut)) return 'libre'
  if (NON_FINALISE.has(statut)) return 'paiement_en_cours'
  if (statut === 'paid') return 'conserver'
  return 'illisible'
}
