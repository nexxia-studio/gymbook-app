/**
 * ╔═══════════════════════════════════════════════════════════════════════════════════════╗
 * ║  OÙ ATTERRIT-ON APRÈS S'ÊTRE CONNECTÉ ?                                               ║
 * ╚═══════════════════════════════════════════════════════════════════════════════════════╝
 *
 * 🔴 `/dashboard` EXIGE UNE SALLE. Y envoyer un super-administrateur — qui a délibérément
 * `gym_id = NULL` — le renverrait aussitôt sur `/pending` : c'est-à-dire le défaut constaté
 * en staging le 21/09, simplement déplacé d'un cran plus loin.
 *
 * ⚠️ UNE SEULE SOURCE POUR CETTE DÉCISION. Trois endroits redirigent après connexion — la
 * route `/`, la route `/login`, et `Login.tsx` juste après `signIn`. Trois littéraux
 * `'/dashboard'` recopiés auraient divergé au premier oubli ; c'est le motif que GYM-191 a
 * payé côté serveur.
 *
 * ⚠️ ET CE N'EST PAS UNE PROTECTION. Rediriger n'interdit rien : `/cockpit` est gardé par
 * `cockpit_list_gyms()`, qui lève 42501 pour tout appelant non super-administrateur. Ceci
 * ne décide que du confort d'arrivée.
 */
/** Où atterrit un MEMBRE — un écran qui l'oriente, jamais le dashboard. */
export const MEMBER_PATH = '/member'

/**
 * 🔴 22/09 — UN MEMBRE NE VA PLUS SUR `/dashboard`.
 *
 * Il y était envoyé par défaut, et `ProtectedRoute` le refusait à l'arrivée : toute
 * connexion d'un membre finissait donc sur un écran qui lui dit non. Ce n'est pas
 * théorique — **110 comptes `member`** sont rattachés en production, et n'importe lequel
 * peut arriver ici par un lien, un favori ou une recherche.
 *
 * ⚠️ LE DÉFAUT RESTE `/dashboard`, y compris quand le rôle n'est pas encore résolu
 * (`null`) : `ProtectedRoute` sait attendre, et rediriger un rôle inconnu vers l'écran
 * membre afficherait « votre salle vit dans l'application » à un gérant dont le profil
 * met une seconde à charger.
 */
export function homePathForRole(role: string | null): string {
  if (role === 'super_admin') return '/cockpit'
  if (role === 'member') return MEMBER_PATH
  return '/dashboard'
}
