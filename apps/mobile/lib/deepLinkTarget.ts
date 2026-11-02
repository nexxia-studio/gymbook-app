// ╔═══════════════════════════════════════════════════════════════════════════════════════╗
// ║  GYM-371 — UNE URL ENTRANTE → UNE ROUTE (ou rien)                                     ║
// ╚═══════════════════════════════════════════════════════════════════════════════════════╝
//
// ⚠️ ISOLÉE DE `components/DeepLinkReplay.tsx` POUR ÊTRE ÉPROUVÉE SANS REACT NATIVE. Elle
// reçoit le RÉSULTAT de `Linking.parse`, pas l'URL : `expo-linking` tire `react-native`
// et ne se charge pas sous `tsx`. Banc : `npx tsx tests/deepLinkTarget.test.ts`.
//
// 🔴 LE DÉFAUT CORRIGÉ (commentaire GYM-371 du 02/11). Pour un SCHÉMA PERSONNALISÉ,
// `Linking.parse` range le premier segment dans `hostname`, pas dans `path` — c'est la
// norme WHATWG que suit le `URL` installé par Expo (expo/src/winter/runtime.native.ts) :
//
//     dopamine://payment/success?id=x  →  hostname 'payment', path 'success'
//
// On ne lisait que `path` : la page de retour Mollie (apps/links/public/dopamine/
// payment-success/index.html) ouvrait `/success`, route inexistante — et la garde
// « déjà sur l'écran » de DeepLinkReplay comparait '/success' à '/payment/success', la
// laissait passer, et empilait `+not-found` PAR-DESSUS le bon écran.
//
// ⚠️ LE LIEN https `links.viniz.app` NE CHANGE PAS : là, `hostname` est le domaine, et le
// chemin est entièrement dans `path`.

/** Le sous-ensemble de `Linking.ParsedURL` dont la décision a besoin. */
export interface UrlAnalysee {
  scheme: string | null
  hostname: string | null
  path: string | null
  queryParams: Record<string, unknown> | null
}

const sansBarres = (s: string | null): string => (s ?? '').replace(/^\/+|\/+$/g, '')

/**
 * Traduit une URL analysée en route.
 *
 * ⚠️ AUCUNE TABLE DE ROUTES ICI, ET C'EST VOLONTAIRE. Les chemins de nos liens sont DÉJÀ
 * les chemins de l'app : `dopamine://payment/success` → `/payment/success`,
 * `https://links.viniz.app/dopamine/payment-success` → `/dopamine/payment-success` (le
 * fichier existe), `…/<autre-salle>/payment-success` → `/[gymSlug]/[screen]`, qui résout la
 * salle. En recopier une seconde table ici garantirait qu'un jour les deux divergent.
 */
export function cibleDepuisUrlAnalysee(
  parsed: UrlAnalysee,
): { pathname: string; params: Record<string, string> } | null {
  // ⚠️ ON N'ACCEPTE QUE NOS PROPRES LIENS. Le système ne nous en livrera pas d'autres — nos
  // schémas et notre domaine sont les seuls déclarés — mais une garde qui ne coûte rien sur
  // le chemin de l'argent vaut mieux qu'une confiance qu'on ne peut pas vérifier.
  const schemeApp = !!parsed.scheme && !/^https?$/i.test(parsed.scheme)
  const hoteConnu = parsed.hostname === 'links.viniz.app'
  if (!schemeApp && !hoteConnu) return null

  // Schéma personnalisé : le premier segment est l'hôte. Un hôte ou un chemin vide est
  // ignoré — `dopamine://` ne désigne aucun écran et ne rejoue rien.
  const chemin = schemeApp
    ? [sansBarres(parsed.hostname), sansBarres(parsed.path)].filter(Boolean).join('/')
    : sansBarres(parsed.path)
  if (!chemin) return null

  const params: Record<string, string> = {}
  for (const [cle, valeur] of Object.entries(parsed.queryParams ?? {})) {
    if (typeof valeur === 'string') params[cle] = valeur
    else if (Array.isArray(valeur) && typeof valeur[0] === 'string') params[cle] = valeur[0]
  }

  return { pathname: `/${chemin}`, params }
}
