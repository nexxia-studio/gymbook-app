// GYM-289 — 🔴 « QUELLE SALLE ? », UNE SEULE AUTORITÉ POUR TOUTE L'APP.
//
// ═════════════════════════════════════════════════════════════════════════════════════
// CE QUE CE MODULE REMPLACE, ET POURQUOI C'ÉTAIT GRAVE
// ═════════════════════════════════════════════════════════════════════════════════════
// Chaque requête filtrait sur `GYM_ID`, la CONSTANTE DE BUILD (constants/dopamine.ts).
// Tant qu'une app = une salle, c'était juste. En white-label, c'était l'inverse d'un
// détail : un membre de Studio Yoga voyait sa marque — nom, logo, couleurs — et le
// planning, les réservations et les abonnements de DOPAMINE. Le serveur savait
// (`profiles.gym_id`, la salle active de GYM-283) ; l'app ne le lui a jamais demandé.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// L'AUTORITÉ EST `useAuthStore.gym_id`, ET ELLE EST UNIQUE
// ─────────────────────────────────────────────────────────────────────────────────────
// Ce module ne calcule rien : il NOMME et EXPOSE ce champ. La règle de remplissage vit à
// un seul endroit — le store — et nulle part ailleurs :
//
//   mode `single`  → la constante du build, posée dès l'ouverture de session.
//                    ⚠️ Le serveur n'est JAMAIS lu dans ce mode : le critère du chantier
//                    est que l'app de Dopamine se comporte exactement comme avant, et
//                    lire une valeur qu'on n'a jamais lue serait déjà un changement.
//   mode `multi`   → `profiles.gym_id`, chargé par `refreshProfile`.
//   avant connexion en `multi` → `null`. Il n'y a pas de bonne réponse : le slug local
//                    donne une MARQUE (public_gym_branding), pas un identifiant de salle.
//
// ⚠️ `null` N'EST PAS UNE ERREUR, C'EST « PAS ENCORE ». Un consommateur qui reçoit `null`
// doit S'ABSTENIR de requêter, pas requêter sans filtre : une requête sans `gym_id`
// rendrait les créneaux de TOUTES les salles. En mode `single` la valeur n'est jamais
// nulle une fois la session ouverte — le chemin de Dopamine ne rencontre pas ce cas.
import { useAuthStore } from '../stores/useAuthStore'

/** La salle active, pour un composant. `null` = pas encore résolue (voir ci-dessus). */
export function useActiveGymId(): string | null {
  return useAuthStore((s) => s.gym_id)
}

/**
 * La salle active, hors composant (modules utilitaires).
 *
 * ⚠️ LECTURE PONCTUELLE, SANS ABONNEMENT : l'appelant n'est pas notifié d'un changement.
 * Réservé au code qui lit une fois par appel — surtout pas à un cache de longue durée.
 */
export function getActiveGymId(): string | null {
  return useAuthStore.getState().gym_id
}
