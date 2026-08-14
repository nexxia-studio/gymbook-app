// GYM-227 — Garder la session valide TANT QUE LE GÉRANT EST SUR LE DASHBOARD.
//
// CONSTATÉ EN PRODUCTION (démo à Nico, 12/08). Connexion vers 07 h 00. À 07 h 55, tentative
// de connexion Mollie : l'interface l'affiche TOUJOURS connecté, la navigation répond
// normalement, et l'appel part en 401. Le dashboard annonce « Erreur lors de la connexion
// Mollie » — un message MÉTIER pour une panne d'AUTHENTIFICATION, ce qui a envoyé le
// diagnostic dans la mauvaise direction pendant une heure. Les logs montrent trois 401 sur
// mollie-connect-oauth (07:55:31, 07:55:57, 08:25:17) encadrés de 200 : le second essai
// passait toujours, parce qu'il arrivait après un renouvellement.
//
// LA CAUSE N'EST PAS UNE CONFIGURATION MANQUANTE. `autoRefreshToken: true` est bien posé
// (lib/supabase.ts). Mais son renouvellement repose sur un MINUTEUR JAVASCRIPT, et les
// navigateurs étranglent fortement les minuteurs d'un onglet en arrière-plan. Pendant la
// démo l'onglet est resté inactif : le minuteur n'a pas tiré à l'heure, le jeton (1 h) a
// expiré, et l'interface a continué d'afficher un profil chargé une heure plus tôt.
//
// D'où deux filets qui ne dépendent d'AUCUN minuteur :
//   · CE MODULE — au retour sur l'onglet, on redemande une session fraîche. C'est
//     exactement le cas qui a piégé la démo.
//   · lib/edgeInvoke.ts — un 401 en vol déclenche un renouvellement puis UN SEUL rejeu.
//
// EXIGENCE (Antoine) : « il faudrait impérativement que la session ne soit pas expirée
// tant qu'il est connecté au dashboard ».
import { supabase } from '@/lib/supabase'

/**
 * Marge avant échéance à partir de laquelle on renouvelle sans attendre.
 *
 * Un jeton valable encore 30 s est un jeton qui expirera PENDANT l'appel qu'on s'apprête à
 * faire. La marge transforme un 401 probable en renouvellement anticipé — c'est le point
 * de tout le lot : ne pas laisser l'expiration se manifester par une erreur métier fausse.
 */
const REFRESH_MARGIN_SECONDS = 60

/** Une seule opération de renouvellement à la fois : plusieurs onglets/appels concurrents
 *  partagent la même promesse plutôt que de lancer N refresh en parallèle (chacun
 *  invalidant le jeton de rotation du précédent). */
let inFlight: Promise<boolean> | null = null

/** `true` si la session est absente ou expire dans moins de REFRESH_MARGIN_SECONDS. */
function needsRefresh(expiresAt: number | undefined): boolean {
  if (!expiresAt) return true
  return expiresAt - Math.floor(Date.now() / 1000) <= REFRESH_MARGIN_SECONDS
}

/**
 * Garantit une session utilisable, ou signale qu'il n'y en a plus.
 *
 * `getSession()` relit le stockage et renouvelle DÉJÀ de lui-même un jeton expiré ; on
 * garde ce chemin en premier. Le test d'échéance qui suit est la CEINTURE : il couvre le
 * jeton pas encore expiré mais qui le sera dans quelques secondes — celui qui produit un
 * 401 en plein appel, et donc le message métier faux.
 *
 * @returns `true` si une session valide est disponible à la sortie.
 */
export async function ensureFreshSession(): Promise<boolean> {
  if (inFlight) return inFlight

  inFlight = (async () => {
    try {
      const { data, error } = await supabase.auth.getSession()
      if (error || !data.session) return false
      if (!needsRefresh(data.session.expires_at)) return true

      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession()
      return !refreshError && !!refreshed.session
    } catch {
      // Panne réseau : on ne conclut PAS à une session morte. Le jeton en mémoire vaut
      // peut-être encore ; c'est le prochain 401 qui tranchera, pas une coupure Wi-Fi.
      return true
    } finally {
      inFlight = null
    }
  })()

  return inFlight
}

/**
 * Force un renouvellement, sans regarder l'échéance.
 *
 * Appelé après un 401 AVÉRÉ : le serveur vient de dire que le jeton ne vaut plus rien,
 * son `expires_at` local n'a donc plus voix au chapitre.
 */
export async function forceRefreshSession(): Promise<boolean> {
  try {
    const { data, error } = await supabase.auth.refreshSession()
    return !error && !!data.session
  } catch {
    return false
  }
}

/**
 * Session irrécupérable → on DÉCONNECTE pour de bon.
 *
 * ⚠️ C'EST LA MOITIÉ DU DÉFAUT. Le 401 n'était que la moitié visible : l'autre, c'est une
 * interface qui continuait d'afficher un utilisateur connecté, son nom et sa salle, alors
 * que plus aucun appel ne pouvait aboutir. `signOut()` émet SIGNED_OUT, que useAuthStore
 * écoute pour vider TOUT l'état (session, profil, salle) — ProtectedRoute renvoie alors
 * vers /login. On ne laisse jamais une coquille connectée à l'écran.
 */
export async function endDeadSession(): Promise<void> {
  try {
    await supabase.auth.signOut()
  } catch {
    // Le serveur peut refuser la révocation d'un jeton déjà mort : sans importance, le
    // listener local a déjà vidé l'état et l'utilisateur est renvoyé vers la connexion.
  }
}
