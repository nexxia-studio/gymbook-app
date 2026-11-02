// ╔═══════════════════════════════════════════════════════════════════════════════════════╗
// ║  GYM-373 — « J'AI ACHETÉ DEPUIS MON ABONNEMENT, JE REVIENS SUR RÉSERVATIONS »         ║
// ╚═══════════════════════════════════════════════════════════════════════════════════════╝
//
// LE DÉFAUT. Un membre achète une carte de 10 séances depuis Profil → Abonnement, paie,
// revient — et atterrit sur « Réservations », une liste vide. Rien ne lui confirme que ses
// 170 € ont alimenté son compte.
//
// Le mécanisme d'écran d'origine existait (`returnTo`, app/payment/success.tsx) et marchait
// — tant que les PARAMÈTRES DE NAVIGATION survivaient. Ils ne survivent pas :
//
//   ① le lien universel de retour (app/dopamine/payment-success.tsx) fait un `replace`
//      vers /payment/success avec `id`/`source`/`slot_id` SEULEMENT : l'écran déjà monté
//      est re-rendu, `params.returnTo` devient `undefined`, la destination retombe sur
//      Réservations ;
//   ② un abonnement n'armait rien : le `push` qui porte `returnTo` est réservé au one-time.
//
// C'est la conclusion de GYM-371 : ce qui doit survivre au retour de paiement vit HORS
// navigation. L'origine est donc persistée, comme l'intention de réservation (GYM-352).
//
// ⚠️ MOTIF REPRIS DE `lib/bookingIntent.ts`, DÉLIBÉRÉMENT : clé `viniz.*`, plafond partagé,
// `try/catch` best-effort qui ne lève JAMAIS — un échec de stockage ne doit pas casser un
// paiement. Au pire, le membre retombe sur Réservations, comme avant.
//
// ⚠️ PAS DE `consommer…` : l'origine est effacée à UN seul endroit, au moment de naviguer
// (goToSuccessDestination). Deux points d'effacement, c'est deux occasions de diverger.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { PLAFOND_MS } from './bookingIntent'

const CLE = 'viniz.payment_origin'

interface OriginePaiement {
  /** Route expo-router où ramener le membre après un paiement réussi. */
  route: string
  /** Horodatage de pose, pour le plafond. */
  createdAt: number
}

/**
 * Pose l'origine du checkout en cours. Écrase la précédente : il n'y en a qu'une.
 *
 * ⚠️ Appelée UNIQUEMENT par `openCheckout` (lib/payments.ts), point de passage unique des
 * deux chemins d'achat — c'est lui qui garantit l'invariant « chaque checkout définit
 * intégralement sa propre origine ».
 */
export async function poserOriginePaiement(route: string): Promise<void> {
  try {
    const complet: OriginePaiement = { route, createdAt: Date.now() }
    await AsyncStorage.setItem(CLE, JSON.stringify(complet))
  } catch {
    // Best-effort : le paiement part quand même. Sans origine, défaut Réservations.
  }
}

/** Efface l'origine. Best-effort, ne lève jamais. */
export async function effacerOriginePaiement(): Promise<void> {
  try { await AsyncStorage.removeItem(CLE) } catch { /* best-effort */ }
}

/**
 * Lit l'origine SANS l'effacer. `null` si absente, illisible ou périmée — une origine
 * périmée est effacée au passage, comme une intention périmée.
 */
export async function lireOriginePaiement(): Promise<string | null> {
  try {
    const brut = await AsyncStorage.getItem(CLE)
    if (!brut) return null
    const origine = JSON.parse(brut) as OriginePaiement
    if (
      typeof origine?.route !== 'string'
      || !origine.route.startsWith('/')
      || typeof origine.createdAt !== 'number'
      || Date.now() - origine.createdAt >= PLAFOND_MS
    ) {
      await AsyncStorage.removeItem(CLE)
      return null
    }
    return origine.route
  } catch {
    return null
  }
}
