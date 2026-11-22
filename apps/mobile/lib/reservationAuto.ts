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
//
// 🔴 GYM-379 (21/11) — ET, SUR UN COURS COMPLET, ELLE INSCRIT EN LISTE D'ATTENTE. Décision
// produit d'Antoine : l'achat fait depuis un cours déclenche l'action commencée, sans geste
// supplémentaire. Même appel serveur, même garde anti-double, même accord.

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
   * 🔴 DÉCISION PRODUIT DU 21/11, QUI REVIENT SUR « LA LISTE D'ATTENTE EST UN SECOND GESTE »
   * (GYM-352). L'achat déclenche l'action que le membre avait commencée : place libre →
   * réservation ; cours complet → liste d'attente. Sur un créneau plein, `create-booking`
   * INSCRIT EN LISTE D'ATTENTE (`create_booking_atomic` → 'full' → `waitlist_join_atomic`),
   * SANS AUCUN DÉBIT : le crédit n'est débité qu'à la confirmation d'une place libérée
   * (confirm-waitlist). C'est le MÊME appel que le bouton « Liste d'attente ».
   *
   * ⚠️ Ce champ ne décide donc plus SI on appelle, seulement CE QU'ON ANNONCE pendant
   * l'appel. Le résultat affiché, lui, vient toujours de la réponse du serveur.
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
 * ou une inscription en liste d'attente automatique s'affiche sous cette condition, et sous
 * elle seule. Sans accord — achat parti d'ailleurs, ancien paiement — le texte dit « confirme
 * ta réservation sur la fiche du cours », sans promesse.
 *
 * @param paymentId le paiement dont parle l'écran ; absent = celui de l'intention.
 */
export function accordPourCePaiement(intent: BookingIntent | null, paymentId?: string | null): boolean {
  if (!intent || intent.accordReservation !== true || !intent.paymentId) return false
  return paymentId == null || paymentId === intent.paymentId
}

/**
 * GYM-379 (21/11) — QUELLE PROMESSE LES TEXTES D'ATTENTE PEUVENT-ILS FAIRE ?
 *
 *   · reservation   — accord donné par « Payer et réserver » ;
 *   · liste_attente — accord donné par « Payer et rejoindre la liste d'attente » ;
 *   · manuel        — pas d'accord pour CE paiement : aucune promesse.
 */
export type VarianteTexte = 'reservation' | 'liste_attente' | 'manuel'

export function varianteTexteAccord(intent: BookingIntent | null, paymentId?: string | null): VarianteTexte {
  if (!accordPourCePaiement(intent, paymentId)) return 'manuel'
  return intent?.accordContexte === 'waitlist' ? 'liste_attente' : 'reservation'
}

/** La clé i18n d'un texte de promesse : `base`, `base_waitlist` ou `base_manual`. */
export function cleSelonAccord(base: string, variante: VarianteTexte): string {
  if (variante === 'reservation') return base
  return variante === 'liste_attente' ? `${base}_waitlist` : `${base}_manual`
}

/**
 * Ce que la fiche fait d'elle-même après l'achat :
 *   · reserver      — elle appelle `createBooking(slotId)` : une place est libre ;
 *   · liste_attente — elle appelle LE MÊME `createBooking(slotId)` : le cours est complet,
 *                     le serveur inscrira en liste d'attente (aucun débit) ;
 *   · rien          — aucun appel.
 *
 * ⚠️ `reserver` ET `liste_attente` SONT LE MÊME APPEL. La distinction ne sert qu'à dire au
 * membre ce qui se passe PENDANT l'appel ; ce qui s'est passé, c'est le serveur qui le dit.
 */
export type ActionApresAchat = 'reserver' | 'liste_attente' | 'rien'

export function actionApresAchat(e: EntreeReservationAuto): ActionApresAchat {
  if (!e.ecranVisible) return 'rien'
  if (!e.intent || !porteSurCeCreneau(e.intent, e.slotId)) return 'rien'
  if (!estValide(e.intent, e.maintenant)) return 'rien'
  // L'accord du membre (« Payer et réserver », « Payer et rejoindre la liste d'attente »,
  // « S'abonner et réserver »…) — pour CE paiement.
  if (!accordPourCePaiement(e.intent)) return 'rien'
  // ⚠️ ET CE PAIEMENT EST PAYÉ, LU EN BASE. Un statut lu pour un autre paiement ne compte pas.
  if (!e.statutPaiement || e.statutPaiement.paymentId !== e.intent.paymentId) return 'rien'
  if (e.statutPaiement.statut !== 'paid') return 'rien'
  if (!e.droitPresent) return 'rien'
  // Déjà inscrit — confirmé OU en liste d'attente : jamais de doublon.
  if (e.dejaTente || e.dejaInscrit) return 'rien'
  return e.coursComplet ? 'liste_attente' : 'reserver'
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
 *   · liste_indisponible — le serveur refuse la liste d'attente pour ce cours. Aucune
 *                       inscription, aucun débit ; l'intention est effacée.
 *                       ⚠️ AUCUN CODE DE CE GENRE N'EST ÉMIS AUJOURD'HUI par `create-booking`
 *                       (pas de réglage « liste d'attente désactivée » en base au 21/11) :
 *                       la branche existe pour qu'un tel refus, le jour où il arrive, soit
 *                       dit honnêtement au lieu de tomber dans « réessaie ».
 *   · reessayable     — tout le reste (hors ligne, suspension, limite atteinte, erreur
 *                       serveur, code inconnu). L'intention est GARDÉE et le bouton manuel
 *                       « Confirmer ma réservation » reste le secours.
 *
 * ⚠️ L'INCONNU EST RÉESSAYABLE, JAMAIS DÉFINITIF : effacer l'intention d'un membre qui a
 * payé sur un code qu'on ne connaît pas, c'est lui faire perdre son cours.
 */
export type IssueEchecReservation = 'definitif' | 'deja_inscrit' | 'credit_en_route' | 'liste_indisponible' | 'reessayable'

const DEFINITIFS = new Set(['SLOT_PAST', 'SLOT_CANCELLED', 'SLOT_NOT_FOUND', 'WRONG_GYM'])
const DEJA_INSCRIT = new Set(['ALREADY_BOOKED', 'ALREADY_WAITLISTED'])
const LISTE_INDISPONIBLE = new Set(['WAITLIST_DISABLED'])

export function issueEchecReservation(code: string | undefined): IssueEchecReservation {
  if (code === 'PAYMENT_REQUIRED') return 'credit_en_route'
  if (code && DEJA_INSCRIT.has(code)) return 'deja_inscrit'
  if (code && DEFINITIFS.has(code)) return 'definitif'
  if (code && LISTE_INDISPONIBLE.has(code)) return 'liste_indisponible'
  return 'reessayable'
}
