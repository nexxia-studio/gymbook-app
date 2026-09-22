/**
 * ╔═══════════════════════════════════════════════════════════════════════════════════════╗
 * ║  OÙ ENVOYER UN MEMBRE — et la règle GYM-303, qui n'est pas négociable                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════════════════╝
 *
 * 🔴 UN MEMBRE NE VA JAMAIS SUR L'APP D'UNE AUTRE SALLE. C'est la leçon de GYM-303, payée
 * une fois : `ResetPassword.tsx` proposait à TOUT LE MONDE le téléchargement de l'app
 * Dopamine — « envoyer un membre de Studio Kama sur la fiche App Store de Dopamine, c'est
 * l'envoyer télécharger une app où il n'a pas de compte ».
 *
 * ⚠️ LE NEUTRE EST LE DÉFAUT, PAS L'EXCEPTION. Sans slug, avec un slug inconnu, sur une
 * salle qui n'a pas encore son app : viniz.app. Retomber sur Dopamine « au cas où »
 * reproduirait exactement le défaut d'origine.
 *
 * ⚠️ CE MODULE NE FAIT QUE NOMMER LA RÈGLE ; il ne la duplique pas. Les deux constantes
 * sont celles de `ResetPassword.tsx`, reprises à l'identique — le segment `/be/` inclus.
 */

/**
 * Fiche App Store de l'app Dopamine.
 *
 * ⚠️ LE SEGMENT `/be/` EST OBLIGATOIRE, NE PAS LE RETIRER en le croyant superflu : la
 * distribution est limitée aux 42 pays européens. Sans code pays, Apple retombe sur la
 * boutique US — où l'app n'existe pas — et rend une 404. L'erreur est invisible sur iPhone
 * (la boutique du compte est utilisée) mais frappe tout membre qui ouvre le lien depuis un
 * navigateur de bureau.
 */
const APP_DOPAMINE = 'https://apps.apple.com/be/app/dopamine-performance-club/id6781670485'

/** Le site du produit — la destination NEUTRE, et le défaut. */
const VINIZ = 'https://viniz.app'

/**
 * Les salles qui ont leur propre application publiée.
 *
 * ⚠️ UNE SEULE ENTRÉE AUJOURD'HUI, ET C'EST UN FAIT, PAS UN OUBLI : Dopamine est la seule
 * salle dont l'app est en ligne. Le jour où une deuxième l'est, elle s'ajoute ICI — et
 * nulle part ailleurs, pour qu'aucun écran n'ait à re-décider.
 */
const APPS_PUBLIEES: Record<string, string> = {
  dopamine: APP_DOPAMINE,
}

/** L'app de CETTE salle, ou le neutre Viniz si elle n'en a pas (ou si on ne sait pas). */
export function memberAppUrl(slug: string | null | undefined): string {
  const cle = (slug ?? '').trim().toLowerCase()
  return APPS_PUBLIEES[cle] ?? VINIZ
}

/** `true` si la salle a sa propre app — l'écran peut alors nommer le magasin. */
export function hasOwnApp(slug: string | null | undefined): boolean {
  return Boolean(APPS_PUBLIEES[(slug ?? '').trim().toLowerCase()])
}
