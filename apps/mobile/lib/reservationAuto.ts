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
  maintenant?: number
}

/** La fiche doit-elle appeler `createBooking(slotId)` maintenant, d'elle-même ? */
export function doitReserverAutomatiquement(e: EntreeReservationAuto): boolean {
  if (!e.intent || !porteSurCeCreneau(e.intent, e.slotId)) return false
  if (!estValide(e.intent, e.maintenant)) return false
  // L'accord du membre (« Payer et réserver ») — cf. `BookingIntent.accordReservation`.
  if (e.intent.accordReservation !== true) return false
  if (!e.droitPresent) return false
  if (e.dejaTente || e.coursComplet || e.dejaInscrit) return false
  return true
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
