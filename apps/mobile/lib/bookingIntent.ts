// ╔═══════════════════════════════════════════════════════════════════════════════════════╗
// ║  GYM-352 — « JE VOULAIS RÉSERVER CE COURS-LÀ »                                        ║
// ╚═══════════════════════════════════════════════════════════════════════════════════════╝
//
// LE DÉFAUT. Un membre choisit un cours, tape « Réserver », n'a pas de crédit, part acheter,
// revient — et croit avoir réservé. Il n'a acheté qu'un crédit. Le cours, la date et le
// créneau sont perdus. Signalé par des membres de Dopamine ; 25 achats payés sur 70 ne sont
// suivis d'aucune réservation dans l'heure.
//
// Trois défauts superposés, tous mesurés dans le code :
//
//   ① `session/[id].tsx` n'écrivait l'intention NULLE PART — le `slotId` ne vivait qu'en
//      mémoire du composant.
//   ② `buildPaymentReturnUrl` ne mettait jamais `slot_id` dans l'URL de retour, alors que
//      `payment/success.tsx` ne monte son écran de reprise que si `slot_id` est présent :
//      cet écran n'a donc JAMAIS tourné en production.
//   ③ La seule continuation vivante — le poll en mémoire de `PaymentRequiredSheet` — durait
//      60 s, alors que le crédit met jusqu'à 2 min 33 s (mesuré en prod, GYM-207). Elle
//      était 2,5 fois trop courte pour ce qu'elle devait couvrir.
//
// ⚠️ CE MODULE REND LE POLL NON CRITIQUE. C'est son objet : même si le crédit arrive après
// la fin de tout poll, l'intention survit sur le disque et le membre retrouve son cours au
// prochain lancement. Le poll redevient un confort, plus une condition.
//
// ⚠️ MOTIF REPRIS DE `lib/signupIntent.ts`, DÉLIBÉRÉMENT : clé `viniz.*`, `try/catch`
// best-effort, lecture destructrice pour la consommation, `__reset` pour les tests. Le
// dépôt a déjà un module d'intention persistée — en inventer un second dialecte pour la
// même idée serait le genre d'écart qui finit par diverger.
import AsyncStorage from '@react-native-async-storage/async-storage'

const CLE = 'viniz.booking_intent'

/**
 * Plafond absolu. L'intention est d'abord bornée PAR LE CRÉNEAU (voir `estValide`) ; ce
 * plafond ne mord que sur un cours réservé très à l'avance, pour qu'une intention oubliée
 * ne ressurgisse pas une semaine plus tard comme un fantôme.
 *
 * ⚠️ C'EST LA SEULE PART ARBITRAIRE DE LA RÈGLE, et c'est voulu qu'elle soit la seule.
 * Une durée fixe seule se tromperait DANS LES DEUX SENS :
 *   · réservé à 8 h pour un cours de 19 h, retour à midi → « quelques heures » jetterait
 *     une intention parfaitement valide ;
 *   · réservé pour un cours de 9 h, paiement à 8 h 55, retour à 9 h 10 → trois heures de
 *     validité proposeraient un cours déjà commencé, que le serveur refuse (SLOT_PAST).
 * Le créneau porte sa propre date de péremption : c'est elle qui fait foi.
 */
const PLAFOND_MS = 24 * 60 * 60 * 1000

export interface BookingIntent {
  /** Le créneau que le membre voulait réserver. */
  slotId: string
  /** La salle du créneau — l'intention ne vaut que pour elle. */
  gymId: string
  /** Début du créneau, ISO. C'est la borne de validité qui fait foi. */
  startsAt: string
  /** Horodatage de pose, pour le plafond absolu. */
  createdAt: number
  /**
   * Paiement associé, quand il est connu (id Mollie rendu par create-payment).
   *
   * ⚠️ IL SERT À EFFACER L'INTENTION SUR UN ÉCHEC TERMINAL. Un paiement abandonné,
   * refusé ou expiré ne doit pas laisser derrière lui une proposition de réservation qui
   * ressurgirait plus tard sans que le membre comprenne d'où elle sort.
   */
  paymentId?: string
}

/** Une intention est-elle encore bonne à proposer ? */
export function estValide(intent: BookingIntent, maintenant = Date.now()): boolean {
  // Le créneau d'abord : un cours commencé ne se réserve plus, le serveur le refuse
  // (create-booking → SLOT_PAST). Proposer « Confirmer » mènerait droit à une erreur.
  const debut = new Date(intent.startsAt).getTime()
  if (!Number.isFinite(debut) || debut <= maintenant) return false
  // Puis le plafond absolu.
  return maintenant - intent.createdAt < PLAFOND_MS
}

/**
 * Pose l'intention. Écrase la précédente : IL N'Y EN A QU'UNE, jamais une liste.
 *
 * ⚠️ C'EST CE QUI RÈGLE LE CAS « le membre en choisit un autre avant de confirmer » : la
 * nouvelle intention prend la place, il n'y a rien à arbitrer. Une liste obligerait à
 * décider laquelle proposer, question à laquelle aucune réponse n'est évidente.
 */
export async function poserBookingIntent(intent: Omit<BookingIntent, 'createdAt'>): Promise<void> {
  try {
    const complet: BookingIntent = { ...intent, createdAt: Date.now() }
    await AsyncStorage.setItem(CLE, JSON.stringify(complet))
  } catch {
    // Best-effort : l'achat doit pouvoir se poursuivre même si le disque refuse d'écrire.
    // Le `slot_id` de l'URL de retour reste alors le second signal — voir lib/gymUrls.ts.
  }
}

/**
 * Lit l'intention SANS la consommer — pour décider quoi AFFICHER.
 *
 * Rend `null` si elle est absente, illisible ou périmée. Une intention périmée est
 * effacée au passage : la laisser traîner ferait relire un objet mort à chaque écran.
 */
export async function lireBookingIntent(): Promise<BookingIntent | null> {
  try {
    const brut = await AsyncStorage.getItem(CLE)
    if (!brut) return null
    const intent = JSON.parse(brut) as BookingIntent
    if (!intent?.slotId || !intent?.gymId || !intent?.startsAt) {
      await AsyncStorage.removeItem(CLE)
      return null
    }
    if (!estValide(intent)) {
      await AsyncStorage.removeItem(CLE)
      return null
    }
    return intent
  } catch {
    return null
  }
}

/**
 * Lit ET EFFACE — pour le moment où l'intention est HONORÉE.
 *
 * La lecture destructrice est la même règle que `takeSignupIntent` : une intention
 * consommée ne revient pas. C'est ce qui évite qu'une réservation déjà faite reste
 * proposée au lancement suivant.
 */
export async function consommerBookingIntent(): Promise<BookingIntent | null> {
  const intent = await lireBookingIntent()
  if (intent) await effacerBookingIntent()
  return intent
}

/**
 * Efface l'intention.
 *
 * Appelée dans QUATRE situations, et il faut les quatre :
 *   · la réservation est confirmée — quel qu'en soit le créneau : le membre a obtenu ce
 *     qu'il voulait, la proposition n'a plus d'objet ;
 *   · le paiement finit en échec terminal (failed / canceled / expired) ;
 *   · le membre décline explicitement la proposition ;
 *   · le créneau est passé (traité par `estValide`, sans appel).
 */
export async function effacerBookingIntent(): Promise<void> {
  try { await AsyncStorage.removeItem(CLE) } catch { /* best-effort */ }
}

/** L'intention en cours porte-t-elle SUR CE créneau ? */
export function porteSurCeCreneau(intent: BookingIntent | null, slotId: string | undefined): boolean {
  return !!intent && !!slotId && intent.slotId === slotId
}

/** Remise à zéro — tests uniquement. */
export async function __resetBookingIntent(): Promise<void> {
  try { await AsyncStorage.removeItem(CLE) } catch { /* best-effort */ }
}
