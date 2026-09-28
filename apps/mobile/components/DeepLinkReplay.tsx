import { useEffect, useRef } from 'react'
import { useRouter, usePathname } from 'expo-router'
import * as Linking from 'expo-linking'
import * as Sentry from '@sentry/react-native'
import { ouvrirLaPorte, refermerLaPorte } from '../lib/pendingDeepLink'

/**
 * 🔴 GYM-371 — REJOUE LE LIEN D'ARRIVÉE, UNE FOIS LA PORTE OUVERTE.
 *
 * Monté comme FRÈRE de `<Slot />`, SOUS `LegalAcceptanceGate` : il n'existe donc qu'à
 * partir du moment où la porte s'ouvre. Il ne la contourne pas, il attend derrière elle.
 *
 * ⚠️ ET IL ATTEND AUSSI LA SESSION — `pret`, posé par le `_layout` quand `initialize()` a
 * rendu la main. Rejouer avant enverrait un membre sur un écran de paiement qui interroge
 * une ligne qu'il n'a pas encore le droit de lire. Le magasin d'auth mobile n'expose aucun
 * drapeau de démarrage : ce point d'arrivée est fabriqué là où l'appel a lieu.
 *
 * ⚠️ UNE SEULE FOIS PAR OUVERTURE, et le drapeau est un `ref` : un `useState` relancerait
 * l'effet à chaque rendu, c'est-à-dire à chaque changement de route.
 */
export function DeepLinkReplay({ pret }: { pret: boolean }) {
  const router = useRouter()
  const pathname = usePathname()
  const rejoue = useRef(false)
  const urlRef = useRef<string | null>(null)

  // La porte est ouverte tant que ce composant vit. Sa fermeture (déconnexion, nouvelle
  // version des conditions) remet la mémorisation en marche.
  //
  // ⚠️ LE LIEN EST PRÉLEVÉ ICI, PAS DANS L'EFFET QUI REJOUE. Celui-là attend `pret`
  // et peut donc tourner plusieurs fois ; le prélèvement, lui, doit avoir lieu UNE fois, à
  // l'ouverture — sans quoi un second passage trouverait la mémoire déjà vidée.
  useEffect(() => {
    urlRef.current = ouvrirLaPorte()
    return () => refermerLaPorte()
  }, [])

  useEffect(() => {
    if (!pret || rejoue.current) return
    const url = urlRef.current
    rejoue.current = true
    urlRef.current = null
    if (!url) return

    const cible = cibleDepuisUrl(url)
    if (!cible) {
      // Un lien qu'on ne sait pas router n'envoie PAS le membre sur `+not-found` : il ne
      // fait rien, et l'app s'ouvre sur l'accueil comme avant. On le dit à Sentry, parce
      // qu'un lien qu'on fabrique et qu'on ne sait pas lire est un défaut, pas une fatalité.
      Sentry.captureMessage('DeepLinkReplay: lien initial non routable', {
        level: 'warning',
        tags: { area: 'gym371_deep_link' },
        // ⚠️ PAS L'URL ENTIÈRE : un lien de réinitialisation de mot de passe porte un jeton
        // de session dans son fragment. On journalise sa FORME, pas son contenu.
        extra: { forme: formeDeLUrl(url) },
      })
      return
    }

    // expo-router a peut-être déjà fait le travail (démarrage à chaud, porte déjà ouverte
    // au moment du lien). Rejouer par-dessus remonterait l'écran et perdrait son état.
    if (cible.pathname === pathname) return

    router.push({ pathname: cible.pathname as never, params: cible.params })
  }, [pret, pathname, router])

  return null
}

/**
 * Traduit une URL entrante en route.
 *
 * ⚠️ AUCUNE TABLE DE ROUTES ICI, ET C'EST VOLONTAIRE. Les chemins de nos liens sont DÉJÀ
 * les chemins de l'app : `dopamine://payment/success` → `/payment/success`,
 * `https://links.viniz.app/dopamine/payment-success` → `/dopamine/payment-success` (le
 * fichier existe), `…/<autre-salle>/payment-success` → `/[gymSlug]/[screen]`, qui résout la
 * salle. En recopier une seconde table ici garantirait qu'un jour les deux divergent.
 */
function cibleDepuisUrl(url: string): { pathname: string; params: Record<string, string> } | null {
  let parsed: ReturnType<typeof Linking.parse>
  try {
    parsed = Linking.parse(url)
  } catch {
    return null
  }

  const chemin = (parsed.path ?? '').replace(/^\/+|\/+$/g, '')
  if (!chemin) return null

  // ⚠️ ON N'ACCEPTE QUE NOS PROPRES LIENS. Le système ne nous en livrera pas d'autres — nos
  // schémas et notre domaine sont les seuls déclarés — mais une garde qui ne coûte rien sur
  // le chemin de l'argent vaut mieux qu'une confiance qu'on ne peut pas vérifier.
  const schemeApp = parsed.scheme && !/^https?$/i.test(parsed.scheme)
  const hoteConnu = parsed.hostname === 'links.viniz.app'
  if (!schemeApp && !hoteConnu) return null

  const params: Record<string, string> = {}
  for (const [cle, valeur] of Object.entries(parsed.queryParams ?? {})) {
    if (typeof valeur === 'string') params[cle] = valeur
    else if (Array.isArray(valeur) && typeof valeur[0] === 'string') params[cle] = valeur[0]
  }

  return { pathname: `/${chemin}`, params }
}

/** La forme d'une URL, sans son contenu : schéma, hôte, chemin, et les NOMS des paramètres. */
function formeDeLUrl(url: string): string {
  try {
    const p = Linking.parse(url)
    const cles = Object.keys(p.queryParams ?? {}).sort().join(',')
    return `${p.scheme ?? '?'}://${p.hostname ?? ''}/${p.path ?? ''}${cles ? ` ?${cles}` : ''}`
  } catch {
    return '(illisible)'
  }
}
