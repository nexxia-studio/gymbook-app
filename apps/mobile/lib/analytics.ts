// PostHog — analytics produit mobile (best-effort, minimisation RGPD).
//
// Un seul client singleton, partagé par :
//  - le PostHogProvider du _layout racine (contexte `usePostHog`) ;
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
import { GYM_ID } from '../constants/dopamine'

/** Variante d'app, posée par le profil EAS preview-staging (GYM-258). */
const isStaging = process.env.EXPO_PUBLIC_APP_VARIANT === 'staging'

/** Étiquette d'environnement, portée par TOUS les événements. LA clé de tri du projet. */
export const ANALYTICS_ENVIRONMENT = isStaging ? 'staging' : 'production'

// Une seule clé, la même pour les deux apps — cf. entête.
const apiKey = process.env.EXPO_PUBLIC_POSTHOG_KEY

export const posthog: PostHog | null = apiKey
  ? new PostHog(apiKey, { host: 'https://eu.i.posthog.com' })
  : null

/**
 * Propriétés portées par TOUS les événements, sans intervention de l'appelant.
 *
 * 🔴 GYM-273 — `gym_id` EST ICI, ET PAS APPEL PAR APPEL. C'est ce qui rendra les analyses
 * PAR SALLE possibles au multi-tenant. Le poser plus tard ne rattrape RIEN : les
 * événements déjà envoyés resteront sans salle, à jamais. L'app ne sert aujourd'hui qu'une
 * salle — mais c'est précisément maintenant, avant l'ouverture, qu'il faut le poser pour
 * que l'historique soit exploitable le jour où il y en aura deux.
 *
 * ⚠️ AUCUNE DONNÉE PERSONNELLE ICI. `gym_id` et `environment` sont des identifiants
 * techniques. L'identité du membre passe par `identifyUser` (UUID Supabase, jamais
 * l'email) et par rien d'autre.
 */
const SUPER_PROPERTIES = {
  environment: ANALYTICS_ENVIRONMENT,
  gym_id: GYM_ID,
} as const

// Posées immédiatement après la création du client, donc avant tout événement applicatif.
// `register()` est asynchrone : on ne l'attend pas (rien ici ne doit bloquer le démarrage)
// et on avale l'échec — l'analytics est best-effort de bout en bout dans ce module.
posthog?.register({ ...SUPER_PROPERTIES }).catch(() => {
  /* analytics best-effort */
})

/**
 * Event custom best-effort — jamais bloquant, no-op si PostHog absent.
 *
 * ⚠️ LES SUPER-PROPRIÉTÉS SONT AUSSI POSÉES ICI, et ce n'est pas une redondance inutile :
 * `register()` écrit dans un stockage persistant de façon asynchrone, et les tout premiers
 * événements d'un démarrage à froid peuvent partir avant que l'écriture ne soit visible.
 * Les événements MÉTIER — ceux dont on tire les chiffres — les portent donc de façon
 * inconditionnelle. Même constante des deux côtés : aucune divergence possible.
 *
 * ⚠️ Elles sont étalées AVANT `properties` : un appelant qui passerait `gym_id` (cas d'une
 * action sur une autre salle, un jour) garde la main. Aujourd'hui personne ne le fait.
 */
export function captureEvent(
  event: string,
  properties?: Record<string, string | number | boolean | null>,
): void {
  try {
    posthog?.capture(event, { ...SUPER_PROPERTIES, ...properties })
  } catch {
    /* analytics best-effort */
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════
// GYM-272 — CAPTURE DES ÉCRANS
// ═════════════════════════════════════════════════════════════════════════════════════
// 🔴 POURQUOI CE CODE EXISTE, ALORS QUE `captureScreens: true` ÉTAIT DÉJÀ ACTIF.
// Zéro `$screen` reçu en 30 jours. Cause trouvée dans le paquet installé
// (posthog-react-native 4.57.0) :
//
//   · `PostHogProvider` rend `<PostHogNavigationHook>` en FRÈRE de `children` ;
//   · ce hook appelle `useNavigationState()` / `useNavigation()` de
//     `@react-navigation/native` ;
//   · or dans app/_layout.tsx le provider ENVELOPPE `<Slot />` : le hook est donc monté
//     AU-DESSUS du navigateur, hors de tout contexte de navigation ;
//   · `useNavigation()` lève, `useNavigationTracker` fait `console.error` puis `return`.
//
// Échec silencieux en production : aucune erreur visible, juste un écran d'analytics vide.
// L'autocapture d'écrans est donc DÉSACTIVÉE côté provider (sans quoi le jour où
// quelqu'un déplacerait le provider, chaque écran serait compté DEUX fois), et le suivi
// est fait ici, sur les segments d'Expo Router.

/**
 * Nom d'écran à partir des segments d'Expo Router.
 *
 * 🔴 ANONYME PAR CONSTRUCTION, PAS PAR ASSAINISSEMENT. `useSegments()` rend le MOTIF de
 * route, pas l'URL : `/session/3f2a…` donne `['session', '[id]']`. L'identifiant n'entre
 * donc jamais dans le nom — ce n'est pas une chaîne qu'on nettoie après coup, c'est une
 * valeur qui n'a jamais contenu l'id. (Un nom d'écran portant l'UUID deviendrait une
 * dimension à cardinalité infinie, inutilisable, et exposerait des identifiants.)
 *
 * Les règles, dans l'ordre :
 *   · les groupes `(auth)` / `(tabs)` sont RETIRÉS — ce sont des dossiers d'organisation,
 *     pas des écrans, et les faire apparaître lierait les noms à une refonte de dossiers ;
 *   · un segment dynamique `[id]` devient `detail` → `session_detail` ;
 *   · les tirets deviennent des underscores (convention snake_case du lot) ;
 *   · aucun segment → `index` (écran de lancement) ; `['(tabs)']` → `home` (accueil).
 */
export function screenNameFromSegments(segments: readonly string[]): string {
  // ⚠️ TESTÉ AVANT LE FILTRAGE DES GROUPES, ET C'EST INDISPENSABLE. `app/index.tsx`
  // (écran de lancement animé) rend `[]`, et `app/(tabs)/index.tsx` (l'accueil) rend
  // `['(tabs)']` : une fois les groupes retirés, les DEUX deviennent vides. Sans cette
  // sortie, les deux écrans porteraient le même nom et la première marche de l'entonnoir
  // — combien de lancements arrivent réellement sur l'accueil — serait indistincte.
  if (segments.length === 0) return 'index'

  const parts = segments
    .filter((s) => !(s.startsWith('(') && s.endsWith(')')))
    .map((s) => (s.startsWith('[') ? 'detail' : s))
    .map((s) => s.replace(/^\+/, '').replace(/-/g, '_'))
    .filter(Boolean)
  return parts.length > 0 ? parts.join('_') : 'home'
}

/**
 * Envoie un `$screen`. Best-effort, comme tout ce module.
 *
 * `posthog.screen()` et non `capture('$screen')` : c'est l'API dédiée, et elle passe par
 * le même `enrichProperties` que le reste — les super-propriétés y sont donc aussi.
 */
export function captureScreen(
  name: string,
  properties?: Record<string, string | number | boolean | null>,
): void {
  try {
    posthog?.screen(name, { ...SUPER_PROPERTIES, ...properties })
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
