// PostHog — analytics produit mobile (best-effort, minimisation RGPD).
//
// Un seul client singleton, partagé par :
//  - le PostHogProvider du _layout racine (autocapture des écrans / navigation) ;
//  - les stores et lib hors-React (events custom : booking_created, etc.).
//
// Si la clé est absente → client null et TOUT devient no-op : le provider n'est pas
// monté et les helpers ne font rien. Le code doit tourner sans la variable.
//
// ═════════════════════════════════════════════════════════════════════════════════════
// 🔴 GYM-276 — DEUX APPS, ET SURTOUT PAS UN SEUL PROJET POSTHOG
// ═════════════════════════════════════════════════════════════════════════════════════
// « Viniz Staging » (GYM-258) tourne sur le même code que Dopamine. Si elle envoyait ses
// événements avec la clé de production, les essais d'Antoine se mélangeraient aux
// réservations réelles des membres de Nico — et FAUSSERAIENT SILENCIEUSEMENT tous les
// chiffres déjà calculés : taux de remplissage, conversions, rétention.
//
// ⚠️ POURQUOI PAS UNE SIMPLE PROPRIÉTÉ `environment` À FILTRER. Parce qu'il faudrait la
// filtrer PARTOUT, y compris dans les analyses déjà écrites, et qu'un oubli ne se voit
// pas : un chiffre légèrement faux se lit exactement comme un chiffre juste. C'est le
// raisonnement qui a fait séparer les bases Supabase plutôt que de préfixer les lignes.
// La propriété est quand même posée (voir `captureEvent`) — comme ceinture, pas comme
// mécanisme.
//
// LE MÉCANISME : une clé DÉDIÉE au staging. Tant qu'elle n'existe pas,
// `EXPO_PUBLIC_POSTHOG_KEY_STAGING` est absente et l'app staging n'envoie RIEN — le
// défaut sûr. Mieux vaut un banc d'essai muet côté analytics qu'une production polluée :
// le premier se corrige en posant une variable, la seconde en nettoyant un projet.
//
// 👉 GESTE RESTANT (Antoine) : créer un projet PostHog « GymBook Staging », puis ajouter
//    EXPO_PUBLIC_POSTHOG_KEY_STAGING au profil preview-staging d'eas.json. Rien d'autre
//    à toucher. Cf. docs/ops/mobile-observabilite.md.
import PostHog from 'posthog-react-native'

/** Variante d'app, posée par le profil EAS preview-staging (GYM-258). */
const isStaging = process.env.EXPO_PUBLIC_APP_VARIANT === 'staging'

/** Étiquette d'environnement, portée par TOUS les événements (cf. `captureEvent`). */
export const ANALYTICS_ENVIRONMENT = isStaging ? 'staging' : 'production'

// ⚠️ AUCUN REPLI VERS LA CLÉ DE PRODUCTION SUR LE STAGING. Un `?? apiKey` ici annulerait
// tout le raisonnement ci-dessus, et le ferait silencieusement.
const apiKey = isStaging
  ? process.env.EXPO_PUBLIC_POSTHOG_KEY_STAGING
  : process.env.EXPO_PUBLIC_POSTHOG_KEY

export const posthog: PostHog | null = apiKey
  ? new PostHog(apiKey, { host: 'https://eu.i.posthog.com' })
  : null

/**
 * Event custom best-effort — jamais bloquant, no-op si PostHog absent.
 *
 * GYM-276 — `environment` est ajouté à CHAQUE événement. C'est la ceinture : si un jour
 * les deux apps partagent malgré tout un projet, les données restent triables. Ce n'est
 * PAS le mécanisme de séparation (cf. entête) — juste ce qui évite que l'accident soit
 * irréparable.
 */
export function captureEvent(
  event: string,
  properties?: Record<string, string | number | boolean | null>,
): void {
  try {
    posthog?.capture(event, { ...properties, environment: ANALYTICS_ENVIRONMENT })
  } catch {
    /* analytics best-effort */
  }
}

/**
 * Associe les events à l'UUID interne Supabase — JAMAIS l'email (minimisation RGPD).
 * Appelé à l'établissement de session.
 */
export function identifyUser(userId: string): void {
  try {
    posthog?.identify(userId)
  } catch {
    /* analytics best-effort */
  }
}

/** Dissocie l'identité (déconnexion). */
export function resetAnalytics(): void {
  try {
    posthog?.reset()
  } catch {
    /* analytics best-effort */
  }
}
