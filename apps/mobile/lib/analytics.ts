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
// 🔴 GYM-277 — UN SEUL PROJET POSTHOG, DONC UNE SUPER-PROPRIÉTÉ `environment`
// ═════════════════════════════════════════════════════════════════════════════════════
// « Viniz Staging » (GYM-258) tourne sur le même code que Dopamine et, faute de mieux,
// envoie dans le MÊME projet PostHog : le plan gratuit n'en autorise qu'un, et c'est
// l'unique projet de l'organisation (vérifié au cockpit).
//
// GYM-276 avait retenu un projet dédié — la séparation par construction. Elle n'est pas
// disponible. On bascule donc sur l'étiquetage, en connaissance de cause :
//
// ⚠️ CONTREPARTIE ASSUMÉE, ET ELLE EST RÉELLE : les deux apps partagent le même magasin.
// TOUTE analyse doit désormais filtrer `environment = production`, y compris celles déjà
// écrites. Un chiffre lu sans ce filtre inclut les tests d'Antoine — et un chiffre
// légèrement faux se lit exactement comme un chiffre juste. C'est écrit en toutes lettres
// dans docs/ops/mobile-observabilite.md, parce que c'est le genre de dette qui s'oublie.
//
// LE MÉCANISME : une SUPER-PROPRIÉTÉ PERSISTANTE, posée une fois via `register()`.
//
// ⚠️ POURQUOI `register()` ET PAS SEULEMENT UNE PROPRIÉTÉ PAR APPEL. Parce que nos
// `captureEvent` ne sont PAS les seuls événements envoyés : le PostHogProvider du _layout
// racine produit de l'autocapture (écrans, navigation) et des événements de cycle de vie
// (`$screen`, application ouverte/installée) que personne n'appelle à la main. Une
// propriété passée à `capture()` ne les couvrirait pas, et ce sont eux qui gonflent les
// volumes.
//
// Vérifié dans le code de la version installée (@posthog/core, `posthog-core.js`), pas
// supposé : `register()` écrit dans les propriétés persistées (`PostHogPersistedProperty
// .Props`), et `enrichProperties()` les étale EN PREMIER dans chaque événement —
//     { ...this.props, ...this.sessionProps, ...userProperties, ...common, $session_id }
// — et il est appelé par `capture()`, `autocapture()`, `alias()`, `screen()` et
// l'identification. Couverture complète.
import PostHog from 'posthog-react-native'

/** Variante d'app, posée par le profil EAS preview-staging (GYM-258). */
const isStaging = process.env.EXPO_PUBLIC_APP_VARIANT === 'staging'

/** Étiquette d'environnement, portée par TOUS les événements. LA clé de tri du projet. */
export const ANALYTICS_ENVIRONMENT = isStaging ? 'staging' : 'production'

// Une seule clé, la même pour les deux apps — cf. entête.
const apiKey = process.env.EXPO_PUBLIC_POSTHOG_KEY

export const posthog: PostHog | null = apiKey
  ? new PostHog(apiKey, { host: 'https://eu.i.posthog.com' })
  : null

// Posée immédiatement après la création du client, donc avant tout événement applicatif.
// `register()` est asynchrone : on ne l'attend pas (rien ici ne doit bloquer le démarrage)
// et on avale l'échec — l'analytics est best-effort de bout en bout dans ce module.
posthog?.register({ environment: ANALYTICS_ENVIRONMENT }).catch(() => {
  /* analytics best-effort */
})

/**
 * Event custom best-effort — jamais bloquant, no-op si PostHog absent.
 *
 * ⚠️ `environment` EST AUSSI POSÉ ICI, EN PLUS DE LA SUPER-PROPRIÉTÉ, et ce n'est pas une
 * redondance inutile : `register()` écrit dans un stockage persistant de façon
 * asynchrone, et les tout premiers événements d'un démarrage à froid peuvent partir avant
 * que l'écriture ne soit visible. Les événements MÉTIER — ceux dont on tire les chiffres —
 * portent donc l'étiquette de façon inconditionnelle. Même valeur, même constante : les
 * deux ne peuvent pas diverger.
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
