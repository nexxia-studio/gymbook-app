import { useGymProfile } from './useGymProfile'
import { CLUB_IDENTITY } from '../constants/club'
import { GYM_MODE } from '../lib/gymResolver'

/**
 * GYM-387 — le pays de la salle active (code ISO), pour l'indicatif téléphonique par défaut.
 *
 * ⚠️ `null` EST UNE RÉPONSE : sans pays connu, aucun préfixe n'est deviné et le formulaire
 * demande l'indicatif. C'est le cas d'une inscription en mode `multi` — `nexxia_gyms` n'est
 * lisible que par un membre de la salle, et le candidat ne l'est pas encore.
 *
 * En `single`, la salle du build est connue à la compilation : son pays sert de repli tant
 * que la lecture n'a pas répondu (ou ne peut pas répondre, avant la connexion).
 */
export function usePaysSalle(): string | null {
  const pays = useGymProfile()?.country ?? null
  return pays ?? (GYM_MODE === 'single' ? CLUB_IDENTITY.country : null)
}
