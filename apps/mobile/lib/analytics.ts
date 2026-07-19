// PostHog — analytics produit mobile (best-effort, minimisation RGPD).
//
// Un seul client singleton, partagé par :
//  - le PostHogProvider du _layout racine (autocapture des écrans / navigation) ;
//  - les stores et lib hors-React (events custom : booking_created, etc.).
//
// Si EXPO_PUBLIC_POSTHOG_KEY est absent → client null et TOUT devient no-op :
// le provider n'est pas monté et les helpers ne font rien. Le code doit tourner
// sans la variable (fournie par Antoine via variable d'env EAS).
import PostHog from 'posthog-react-native'

const apiKey = process.env.EXPO_PUBLIC_POSTHOG_KEY

export const posthog: PostHog | null = apiKey
  ? new PostHog(apiKey, { host: 'https://eu.i.posthog.com' })
  : null

/** Event custom best-effort — jamais bloquant, no-op si PostHog absent. */
export function captureEvent(
  event: string,
  properties?: Record<string, string | number | boolean | null>,
): void {
  try {
    posthog?.capture(event, properties)
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
