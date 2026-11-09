// ╔═══════════════════════════════════════════════════════════════════════════════════════╗
// ║  GYM-379 — « PAYER ET RÉSERVER » : LA FICHE RÉSERVE D'ELLE-MÊME, UNE FOIS             ║
// ╚═══════════════════════════════════════════════════════════════════════════════════════╝
//
// 🔴 DÉCISION PRODUIT DU 09/11, QUI REVIENT SUR CELLE DE GYM-352 (« plus de réservation
// silencieuse »). Le membre tape « Payer et réserver » sur la feuille ouverte depuis un
// cours, sous un texte qui dit que le cours sera réservé dès le paiement confirmé : C'EST CE
// GESTE QUI VAUT ACCORD. La réservation qui suit n'est donc pas silencieuse — elle exécute
// ce qu'il a demandé.
//
// ⚠️ UN SEUL ENDROIT DÉCIDE : `app/session/[id].tsx`. Ce module ne fait que trancher, sans
// réseau ni disque, pour que la règle se teste seule (tests/reservationAuto.test.ts).
//
// ⚠️ `estValide` et `porteSurCeCreneau` viennent de `bookingIntent.ts`, PAS recopiés : la
// validité d'une intention a déjà une définition, en écrire une seconde ici la ferait
// diverger. (`bookingIntent.ts` se charge sous `tsx` : AsyncStorage n'est pas appelé à
// l'import.)
import { estValide, porteSurCeCreneau, type BookingIntent } from './bookingIntent'

/**
 * Le statut LU EN BASE pour un paiement donné (`payments.status`, via `lireStatutPaiement`).
 * Il porte son `paymentId` : un statut lu pour un autre paiement ne vaut rien ici.
 */
export interface StatutLu {
  paymentId: string
  statut: string | null
}

export interface EntreeReservationAuto {
  /** L'intention connue de la fiche (`null` = aucune). */
  intent: BookingIntent | null
  /** Le créneau affiché par la fiche. */
  slotId: string
  /**
   * Crédit > 0 OU abonnement actif — `useSubscriptionSummary().summary.isActive`, c'est-à-dire
   * les MÊMES prédicats que le serveur et que la boucle de la feuille.
   */
  droitPresent: boolean
  /**
   * 🔴 GYM-379 (relecture du 09/11) — LE STATUT DU PAIEMENT DE L'ACCORD, LU EN BASE.
   *
   * Le droit seul ne prouve pas que CE paiement est passé : un crédit posé par le gérant, un
   * abonnement pris sur un autre appareil, un carnet ancien rendent le droit présent sans
   * que le membre ait payé ce qu'il a accepté de voir transformé en réservation. L'accord
   * vaut pour UN paiement ; il ne s'exécute que quand CE paiement est `paid`.
   */
  statutPaiement: StatutLu | null
  /** Un appel a déjà été tenté (ou est en vol) pour ce créneau : jamais deux. */
  dejaTente: boolean
  /**
   * Le cours est complet, d'après la dernière lecture.
   *
   * 🔴 HORS DU CADRAGE, MAIS IMPOSÉ PAR LE SERVEUR : sur un créneau plein, `create-booking`
   * ne refuse pas — il INSCRIT EN LISTE D'ATTENTE (`create_booking_atomic` → 'full' →
   * `waitlist_join_atomic`). Appeler ici, ce serait inscrire le membre sur la liste sans son
   * geste. GYM-352 en fait un SECOND GESTE explicite : on ne l'appelle donc pas.
   */
  coursComplet: boolean
  /** Le membre est déjà inscrit (confirmé ou en attente) sur ce créneau. */
  dejaInscrit: boolean
  /**
   * La fiche est l'écran au premier plan. Deux instances de la fiche coexistent après le
   * `router.replace` de l'écran de retour de paiement : seule la visible déclenche.
   */
  ecranVisible: boolean
  maintenant?: number
}

/**
 * L'intention porte-t-elle l'ACCORD du membre pour CE paiement ?
 *
 * C'est la seule question que posent les TEXTES : tout texte qui annonce une réservation
 * automatique s'affiche sous cette condition, et sous elle seule. Sans accord — achat parti
 * d'ailleurs, cours complet (liste d'attente), ancien paiement — le texte dit « confirme ta
 * réservation sur la fiche du cours », sans promesse.
 *
 * @param paymentId le paiement dont parle l'écran ; absent = celui de l'intention.
 */
export function accordPourCePaiement(intent: BookingIntent | null, paymentId?: string | null): boolean {
  if (!intent || intent.accordReservation !== true || !intent.paymentId) return false
  return paymentId == null || paymentId === intent.paymentId
}

/** La fiche doit-elle appeler `createBooking(slotId)` maintenant, d'elle-même ? */
export function doitReserverAutomatiquement(e: EntreeReservationAuto): boolean {
  if (!e.ecranVisible) return false
  if (!e.intent || !porteSurCeCreneau(e.intent, e.slotId)) return false
  if (!estValide(e.intent, e.maintenant)) return false
  // L'accord du membre (« Payer et réserver », « S'abonner et réserver »…) — pour CE paiement.
  if (!accordPourCePaiement(e.intent)) return false
  // ⚠️ ET CE PAIEMENT EST PAYÉ, LU EN BASE. Un statut lu pour un autre paiement ne compte pas.
  if (!e.statutPaiement || e.statutPaiement.paymentId !== e.intent.paymentId) return false
  if (e.statutPaiement.statut !== 'paid') return false
  if (!e.droitPresent) return false
  if (e.dejaTente || e.coursComplet || e.dejaInscrit) return false
  return true
}

// ╔═══════════════════════════════════════════════════════════════════════════════════════╗
// ║  🔴 UNE SEULE FICHE RÉSERVE — GARDE AU NIVEAU DU MODULE, PAS DE L'INSTANCE            ║
// ╚═══════════════════════════════════════════════════════════════════════════════════════╝
//
// Un `ref` de composant ne protège que SA fiche. Or deux instances de `session/[id]`
// coexistent après le `router.replace` de `payment/success` (la fiche d'origine reste
// montée sous la pile) : chacune avait sa garde, et chacune pouvait appeler. La garde vit
// donc ici, une fois par processus : créneau → promesse en vol.
//
// ⚠️ LA SECONDE FICHE N'APPELLE PAS ET N'AFFICHE RIEN. Elle reçoit `premier: false`,
// attend la même promesse, puis relit l'état réel — c'est la première qui parle.
const enVol = new Map<string, Promise<unknown>>()

export function reserverUneFois<T>(
  slotId: string,
  appel: () => Promise<T>,
): { premier: boolean; promesse: Promise<T> } {
  const existante = enVol.get(slotId) as Promise<T> | undefined
  if (existante) return { premier: false, promesse: existante }
  const promesse = appel().finally(() => { enVol.delete(slotId) })
  enVol.set(slotId, promesse)
  return { premier: true, promesse }
}

/**
 * Ce que la fiche fait d'un REFUS de `create-booking` sur l'appel automatique.
 *
 *   · definitif       — le cours ne se réservera plus (commencé, annulé, introuvable, autre
 *                       salle). L'intention est effacée ; le crédit, jamais débité, reste.
 *   · deja_inscrit    — un appel précédent (manuel, ou l'idempotence serveur) a déjà abouti.
 *                       Ce n'est pas un échec : la fiche relit son état.
 *   · credit_en_route — PAYMENT_REQUIRED : le droit vu par l'app n'est pas encore vu par le
 *                       serveur. L'intention est GARDÉE, la fiche réessaiera quand le droit
 *                       réapparaîtra.
 *   · reessayable     — tout le reste (hors ligne, suspension, limite atteinte, erreur
 *                       serveur, code inconnu). L'intention est GARDÉE et le bouton manuel
 *                       « Confirmer ma réservation » reste le secours.
 *
 * ⚠️ L'INCONNU EST RÉESSAYABLE, JAMAIS DÉFINITIF : effacer l'intention d'un membre qui a
 * payé sur un code qu'on ne connaît pas, c'est lui faire perdre son cours.
 */
export type IssueEchecReservation = 'definitif' | 'deja_inscrit' | 'credit_en_route' | 'reessayable'

const DEFINITIFS = new Set(['SLOT_PAST', 'SLOT_CANCELLED', 'SLOT_NOT_FOUND', 'WRONG_GYM'])
const DEJA_INSCRIT = new Set(['ALREADY_BOOKED', 'ALREADY_WAITLISTED'])

export function issueEchecReservation(code: string | undefined): IssueEchecReservation {
  if (code === 'PAYMENT_REQUIRED') return 'credit_en_route'
  if (code && DEJA_INSCRIT.has(code)) return 'deja_inscrit'
  if (code && DEFINITIFS.has(code)) return 'definitif'
  return 'reessayable'
}
