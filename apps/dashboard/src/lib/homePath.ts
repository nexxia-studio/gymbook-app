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
export function homePathForRole(role: string | null): string {
  return role === 'super_admin' ? '/cockpit' : '/dashboard'
}
