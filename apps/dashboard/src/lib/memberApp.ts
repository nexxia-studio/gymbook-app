/**
 * ╔═══════════════════════════════════════════════════════════════════════════════════════╗
 * ║  OÙ ENVOYER UN MEMBRE — et la règle GYM-303, qui n'est pas négociable                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════════════════╝
 *
 * 🔴 UN MEMBRE NE VA JAMAIS SUR L'APP D'UNE AUTRE SALLE. Leçon de GYM-303, payée une fois :
 * `ResetPassword.tsx` proposait à TOUT LE MONDE l'app Dopamine — « envoyer un membre de
 * Studio Kama sur la fiche App Store de Dopamine, c'est l'envoyer télécharger une app où il
 * n'a pas de compte ».
 *
 * ⚠️ LE NEUTRE EST LE DÉFAUT. Sans slug reconnu : viniz.app. Jamais Dopamine « au cas où ».
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * TROIS DESTINATIONS, ET L'ORDRE COMPTE
 * ─────────────────────────────────────────────────────────────────────────────────────
 *   · `universal` — le LIEN UNIVERSEL de la salle. Si l'app est installée, le système
 *     l'ouvre SANS passer par le navigateur : c'est la meilleure issue, et la seule qui
 *     marche aussi sur un téléphone déjà équipé. Sinon, il rend une page Viniz qui dit
 *     d'ouvrir l'application — jamais une erreur nue (GYM-287).
 *   · `ios` / `android` — les fiches de magasin, pour qui n'a pas encore l'app.
 *
 * 🔴 UN MAGASIN NON PUBLIÉ VAUT `null`, ET ON NE LE LIE PAS. Mesuré le 22/09 :
 * `play.google.com/store/apps/details?id=be.dopamineclub.app` rend **HTTP 404** — la fiche
 * attend encore la validation de Google. Un bouton « Play Store » y enverrait le membre sur
 * une page d'erreur, c'est-à-dire exactement le défaut qu'on vient de corriger ailleurs.
 * Le jour où elle est publique, `android` reçoit son URL ICI, et l'écran l'affiche sans
 * autre changement.
 */

/**
 * Fiche App Store de l'app Dopamine.
 *
 * ⚠️ LE SEGMENT `/be/` EST OBLIGATOIRE, NE PAS LE RETIRER en le croyant superflu : la
 * distribution est limitée aux 42 pays européens. Sans code pays, Apple retombe sur la
 * boutique US — où l'app n'existe pas — et rend une 404. Invisible sur iPhone (la boutique
 * du compte est utilisée), mais frappe tout membre qui ouvre le lien depuis un ordinateur.
 */
const APP_STORE_DOPAMINE = 'https://apps.apple.com/be/app/dopamine-performance-club/id6781670485'

/** Le site du produit — la destination NEUTRE, et le défaut. */
const VINIZ = 'https://viniz.app'

/** Domaine des liens universels (le même que `_shared/gym-branding.ts` côté serveur). */
const LINKS_BASE = 'https://links.viniz.app'

/**
 * ⚠️ `/<slug>/bookings` ET NON `/<slug>` : l'AASA réclame `/dopamine/*` et `/*`, donc un
 * SOUS-CHEMIN. Un slug nu n'est revendiqué par aucune app et n'est servi par aucune
 * réécriture — il rendrait le 404 brut de l'hébergeur. `bookings` est en revanche réécrit
 * vers la page Viniz de repli (GYM-287), qui dit d'ouvrir l'application.
 */
function universalFor(slug: string): string {
  return `${LINKS_BASE}/${slug}/bookings`
}

export interface AppDeLaSalle {
  /** Lien universel : ouvre l'app si elle est installée. Toujours présent. */
  universal: string
  /** Fiche App Store, ou `null` si la salle n'a pas d'app iOS publiée. */
  ios: string | null
  /** Fiche Play Store, ou `null` si elle n'est pas publique — cf. l'en-tête. */
  android: string | null
  /** La salle a-t-elle sa propre app ? Faux = on parle de Viniz, pas d'une app. */
  own: boolean
}

/**
 * Les salles qui ont leur propre application.
 *
 * ⚠️ UNE SEULE ENTRÉE, ET C'EST UN FAIT, PAS UN OUBLI : Dopamine est la seule app publiée.
 * Le jour où une deuxième l'est, elle s'ajoute ICI — et nulle part ailleurs.
 */
const APPS: Record<string, { ios: string | null; android: string | null }> = {
  dopamine: {
    ios: APP_STORE_DOPAMINE,
    // 🔴 404 MESURÉ LE 22/09. Voir l'en-tête. Ne pas remplir avant publication.
    android: null,
  },
}

export function appDeLaSalle(slug: string | null | undefined): AppDeLaSalle {
  const cle = (slug ?? '').trim().toLowerCase()
  const fiche = APPS[cle]
  if (!cle || !fiche) {
    // Salle sans app : le lien universel n'a pas de sens, on rend le site du produit.
    return { universal: VINIZ, ios: null, android: null, own: false }
  }
  return { universal: universalFor(cle), ios: fiche.ios, android: fiche.android, own: true }
}

export type Plateforme = 'ios' | 'android' | 'desktop'

/**
 * Plateforme du visiteur, pour ne proposer QUE le magasin qui le concerne.
 *
 * ⚠️ LECTURE DE L'`userAgent`, ASSUMÉE COMME APPROXIMATIVE. Elle ne décide d'aucun droit :
 * au pire, un membre voit un bouton de trop — jamais un bouton de moins, puisque le lien
 * universel est proposé à tout le monde. Une détection parfaite ne vaudrait pas la
 * dépendance qu'elle coûterait.
 *
 * ⚠️ L'iPAD MODERNE S'ANNONCE `Macintosh` : on le rattrape sur la présence d'un écran
 * tactile, sans quoi tous les iPad seraient classés « ordinateur ».
 */
export function plateforme(): Plateforme {
  if (typeof navigator === 'undefined') return 'desktop'
  const ua = navigator.userAgent || ''
  if (/android/i.test(ua)) return 'android'
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios'
  if (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1) return 'ios'
  return 'desktop'
}
