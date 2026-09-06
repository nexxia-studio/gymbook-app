import { useEffect, useRef, useState } from 'react'
import { AppState, Platform } from 'react-native'
import * as Sentry from '@sentry/react-native'
import { Slot, useRouter, useSegments } from 'expo-router'
import { useFonts, BarlowCondensed_900Black } from '@expo-google-fonts/barlow-condensed'
import { DMSans_400Regular, DMSans_500Medium, DMSans_700Bold } from '@expo-google-fonts/dm-sans'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { PostHogProvider } from 'posthog-react-native'
import { posthog, captureScreen, screenNameFromSegments } from '../lib/analytics'
import { isExpectedEdgeError } from '../lib/edgeInvoke'
import { useAuthStore } from '../stores/useAuthStore'
import { useBookingStore } from '../stores/useBookingStore'
import { usePushNotifications } from '../hooks/usePushNotifications'
import { GYM_MODE, readSelectedGymSlug, subscribeSelectedGymSlug } from '../lib/gymResolver'
import { reconcileActiveGym, activeGymNeedsRetry } from '../lib/activeGymSession'
import { activeGymWriteInFlight } from '../lib/activeGymWrites'
import { BrandThemeProvider } from '../lib/theme/ThemeProvider'
import '../lib/i18n'
import '../global.css'

SplashScreen.preventAutoHideAsync()

// GYM-153 — Monitoring erreurs (init minimale, erreurs uniquement).
// DSN fourni par Antoine via variable d'env EAS ; no-op si absent (le build/dev
// doit tourner sans). tracesSampleRate: 0 → pas de performance/tracing.
const sentryDsn = process.env.EXPO_PUBLIC_SENTRY_DSN
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    tracesSampleRate: 0,
    // ── 🔴 GYM-276 — SÉPARER LES DEUX APPS ─────────────────────────────────────────
    // « Viniz Staging » (GYM-258) tourne sur le même code et, désormais, sur le même
    // projet Sentry. Sans cette étiquette, TOUS les événements arrivaient en
    // `production` (constaté dans les tags) : les essais d'Antoine se seraient mêlés
    // aux erreurs réelles des membres de Nico, et le premier vrai incident aurait été
    // indiscernable d'un test.
    //
    // ⚠️ CONTRAIREMENT À POSTHOG, UN SEUL PROJET SUFFIT ICI, et c'est délibéré :
    // `environment` est un filtre de PREMIER RANG dans Sentry (sélecteur global,
    // alertes, taux de régression), là où une propriété PostHog doit être filtrée à la
    // main dans chaque analyse. Le risque de contamination silencieuse n'est pas le même.
    //
    // Deuxième séparation, gratuite celle-là : la RELEASE porte l'identifiant natif du
    // bundle — `be.dopamineclub.app@…` contre `app.viniz.staging@…` (GYM-258 change
    // bundleIdentifier et package). Les deux apps ne peuvent donc pas se confondre, même
    // à environnement égal.
    environment: process.env.EXPO_PUBLIC_APP_VARIANT === 'staging' ? 'staging' : 'production',
    // ── GYM-270 — LA DEUXIÈME BARRIÈRE ─────────────────────────────────────────────
    // `lib/edgeInvoke.ts` n'appelle déjà pas `captureException` sur un refus métier
    // attendu (créneau complet, crédit requis, abonnement déjà actif…). Ce filtre
    // rattrape le MÊME cas arrivé par un autre chemin : une `EdgeError` relancée par un
    // écran et non rattrapée, qui atteindrait Sentry par le handler global de rejets.
    //
    // ⚠️ ON FILTRE SUR LE TYPE, PAS SUR LE TEXTE. Un test sur le message
    // (« non-2xx status code ») masquerait aussi de VRAIES pannes portant le même
    // libellé — c'est précisément ce qui rend ces erreurs indiscernables aujourd'hui.
    // `isExpectedEdgeError` interroge l'objet : statut 4xx ET code métier connu.
    //
    // Partent toujours : 5xx, erreurs réseau, et tout code INCONNU — y compris un code
    // qu'on aurait oublié de déclarer, ce qui est exactement l'information utile.
    beforeSend: (event, hint) => (isExpectedEdgeError(hint?.originalException) ? null : event),
  })
}

/**
 * GYM-272 — SUIVI DES ÉCRANS, SUR EXPO ROUTER.
 *
 * L'autocapture de posthog-react-native s'accroche à `@react-navigation/native` depuis un
 * hook monté AU-DESSUS du navigateur (cf. lib/analytics.ts) : elle n'a jamais rien envoyé.
 * Ici, on lit les segments d'Expo Router, dont le composant racine dispose déjà.
 *
 * ⚠️ DÉDUPLICATION PAR LE NOM, PAS PAR LA RÉFÉRENCE. `useSegments()` rend un nouveau
 * tableau à chaque rendu : dépendre de lui enverrait un `$screen` à chaque re-rendu de la
 * racine — sur une app qui re-rend à chaque changement de session, de police ou de store,
 * les volumes seraient faux et la facture avec. On ne remonte que les CHANGEMENTS de nom.
 */
function useScreenTracking(): void {
  const segments = useSegments()
  const lastScreen = useRef<string | null>(null)

  useEffect(() => {
    const name = screenNameFromSegments(segments)
    if (name === lastScreen.current) return
    lastScreen.current = name
    // ⚠️ AUCUNE PROPRIÉTÉ D'IDENTIFIANT ICI, VOLONTAIREMENT. Le `slot_id` de
    // `session_detail` serait lisible via `useGlobalSearchParams()`, mais ce hook
    // re-rend la RACINE à chaque changement de paramètre — un coût permanent pour une
    // analyse (« quels cours sont les plus consultés ») que personne n'a demandée. À
    // ajouter le jour où elle le sera, pas avant. Le nom, lui, reste anonyme par
    // construction : les segments portent `[id]`, jamais la valeur.
    captureScreen(name)
  }, [segments])
}

function useRegisterServiceWorker() {
  useEffect(() => {
    if (Platform.OS !== 'web') return
    if (!('serviceWorker' in navigator)) return

    navigator.serviceWorker
      .register('/sw.js')
      .catch(() => {
        // SW registration failed — non-blocking
      })
  }, [])
}

function useInjectPwaHead() {
  useEffect(() => {
    if (Platform.OS !== 'web') return

    const head = document.head

    // Manifest
    if (!head.querySelector('link[rel="manifest"]')) {
      const manifest = document.createElement('link')
      manifest.rel = 'manifest'
      manifest.href = '/manifest.json'
      head.appendChild(manifest)
    }

    // Theme color
    if (!head.querySelector('meta[name="theme-color"]')) {
      const theme = document.createElement('meta')
      theme.name = 'theme-color'
      // 🔴 GYM-286 — LAISSÉ EN DUR, ET CE N'EST PAS UN OUBLI. Ce `meta[theme-color]`
      // habille la barre du navigateur sur le web. Il est posé DEPUIS le composant qui
      // MONTE `BrandThemeProvider` : `useTheme()` appelé ici ne verrait pas le fournisseur
      // qu'il rend, mais le contexte par défaut — donc jamais les couleurs de la salle.
      // Le migrer donnerait l'illusion d'un thème dynamique là où il n'y en a pas.
      // À reprendre quand le provider remontera au-dessus de ce composant.
      theme.content = '#111111'
      head.appendChild(theme)
    }

    // Apple meta tags
    const appleMetas: Array<[string, string]> = [
      ['apple-mobile-web-app-capable', 'yes'],
      ['apple-mobile-web-app-status-bar-style', 'black-translucent'],
      ['apple-mobile-web-app-title', 'Dopamine'],
    ]
    for (const [name, content] of appleMetas) {
      if (!head.querySelector(`meta[name="${name}"]`)) {
        const meta = document.createElement('meta')
        meta.name = name
        meta.content = content
        head.appendChild(meta)
      }
    }

    // Apple touch icon
    if (!head.querySelector('link[rel="apple-touch-icon"]')) {
      const icon = document.createElement('link')
      icon.rel = 'apple-touch-icon'
      icon.href = '/icons/apple-touch-icon.svg'
      head.appendChild(icon)
    }
  }, [])
}

function RootLayout() {
  // GYM-102 (3/5) — ⚠️ LA CARTE DE POLICES EST STRICTEMENT LA MÊME EN MODE `single`.
  // MuseoModerno est la police de la marque Viniz : elle sert au repli « logo absent →
  // nom de la salle ». L'ajouter inconditionnellement ferait attendre 186 Ko de plus
  // AVANT `SplashScreen.hideAsync()` — sur l'app de Nico, pour une police qu'elle
  // n'affiche jamais. `GYM_MODE` étant figé à la compilation, l'objet ci-dessous est une
  // constante par build : l'ordre des hooks ne bouge pas.
  const [fontsLoaded] = useFonts(
    GYM_MODE === 'multi'
      ? {
          BarlowCondensed_900Black,
          DMSans_400Regular,
          DMSans_500Medium,
          DMSans_700Bold,
          MuseoModerno: require('../assets/fonts/MuseoModerno-Variable.ttf'),
        }
      : {
          BarlowCondensed_900Black,
          DMSans_400Regular,
          DMSans_500Medium,
          DMSans_700Bold,
        },
  )

  // GYM-102 (3/5) — la salle dont il faut charger la marque. En `single`, personne ne lit
  // jamais cet état : le fournisseur de thème rend la constante Dopamine sans effet.
  const [brandSlug, setBrandSlug] = useState<string | null>(null)
  useEffect(() => {
    if (GYM_MODE === 'single') return
    let alive = true
    readSelectedGymSlug().then((slug) => { if (alive) setBrandSlug(slug) })
    // GYM-288 — ⚠️ ET ON RESTE À L'ÉCOUTE. Cette racine n'est jamais démontée : sans
    // abonnement, elle garderait à jamais le slug lu au tout premier rendu — c'est-à-dire
    // `null` au premier lancement, et la salle QUITTÉE après un retour en arrière.
    const unsubscribe = subscribeSelectedGymSlug((slug) => { if (alive) setBrandSlug(slug) })
    return () => { alive = false; unsubscribe() }
  }, [])

  // ── GYM-292 — 🔴 LA RÉCONCILIATION, DÉCLENCHÉE PAR L'ARRIVÉE DE LA SESSION ──────────
  //
  // CE QUI ÉTAIT ICI AVANT, ET POURQUOI ÇA NE POUVAIT PAS MARCHER. Un effet corrigeait le
  // slug local depuis la salle active du serveur — la règle GYM-288, « le profil serveur
  // fait foi ». Mais il était déclenché par `gym_id`, et sortait sur `!sessionGymId` :
  // or `gym_id` restait `null` après la connexion en multi, faute d'un `refreshProfile`
  // au démarrage. L'effet ne s'exécutait donc JAMAIS… jusqu'à ce que le membre ouvre le
  // Profil, seul écran à rafraîchir le profil au montage. Le désaccord entre la salle
  // choisie et la salle du serveur éclatait à ce moment-là, thème et données d'un coup.
  //
  // La réconciliation est maintenant déclenchée par la SESSION, pas par la salle : elle
  // s'exécute dès qu'il y a quelqu'un à réconcilier. Et elle fait les deux sens — le choix
  // du membre est soumis au serveur, qui l'accepte ou garde la main.
  // Règle complète et arbitrage : lib/activeGymSession.ts.
  //
  // ⚠️ CLÉ SUR L'IDENTIFIANT DE L'UTILISATEUR, PAS SUR L'OBJET `session`. Supabase remplace
  // cet objet à chaque rafraîchissement de jeton : dépendre de lui relancerait la
  // réconciliation — donc `listMyGyms` et peut-être un `switch_active_gym` — toutes les
  // heures, sans que rien n'ait changé.
  const sessionUserId = useAuthStore((s) => s.user?.id ?? null)
  useEffect(() => {
    if (GYM_MODE === 'single' || !sessionUserId) return
    let alive = true
    void reconcileActiveGym().then(() => {
      if (!alive) return
      // Le résultat n'a pas de consommateur ici : chaque conséquence est déjà posée dans
      // le store ou dans le slug par le module lui-même. On l'ignore explicitement plutôt
      // que de laisser croire qu'il reste quelque chose à faire.
    })
    return () => { alive = false }
  }, [sessionUserId])

  // ── GYM-298 — 🔴 REJOUER LA RÉCONCILIATION AU RETOUR DE VEILLE, APRÈS UN ÉCHEC ──────
  //
  // CE QUE 292b AVAIT LAISSÉ. Une coupure réseau ne détruit plus le choix du membre : la
  // réconciliation rend `unavailable` et ne touche à rien. Mais elle n'était rejouée qu'à
  // l'ouverture de session SUIVANTE. Un membre hors ligne au lancement restait donc sans
  // salle — donc sans données — jusqu'à ce qu'il pense à relancer l'app, alors que son
  // réseau était peut-être revenu depuis longtemps. On avait remplacé une perte définitive
  // par une attente indéfinie.
  //
  // ⚠️ TROIS CONDITIONS, ET CHACUNE ÉCARTE UN CAS PRÉCIS :
  //   · `active`                      — un passage en arrière-plan ne réessaie rien ;
  //   · `activeGymNeedsRetry()`       — seul un `unavailable` arme la reprise. Les autres
  //     issues sont des DÉCISIONS : rejouer après un `server_wins` relancerait à chaque
  //     retour de veille un `switch_active_gym` que le serveur vient de refuser ;
  //   · `!activeGymWriteInFlight()`   — un membre peut revenir de veille PENDANT une
  //     bascule manuelle. La garde compteur de lib/activeGymWrites.ts existe exactement
  //     pour ça ; on la consulte plutôt que d'en inventer une seconde.
  //
  // 🔴 AUCUNE NOUVELLE SOURCE DE VÉRITÉ, AUCUN NOUVEL ÉCRIT. Ce bloc ne fait que RAPPELER
  // `reconcileActiveGym`, qui reste le seul chemin ; la télémétrie est la même
  // (`active_gym_reconciled`, ensemble fermé).
  useEffect(() => {
    if (GYM_MODE === 'single' || !sessionUserId) return
    const sub = AppState.addEventListener('change', (etat) => {
      if (etat !== 'active') return
      if (!activeGymNeedsRetry() || activeGymWriteInFlight()) return
      void reconcileActiveGym()
    })
    return () => sub.remove()
  }, [sessionUserId])

  const initialize = useAuthStore((s) => s.initialize)
  const userId = useAuthStore((s) => s.user?.id ?? null)
  const loadFavorites = useBookingStore((s) => s.loadFavorites)

  useEffect(() => {
    initialize()
  }, [initialize])

  // Hydrate recurring favorites on app mount and whenever the user changes
  // (login → load the member's motifs; logout → cleared by loadFavorites).
  useEffect(() => {
    loadFavorites()
  }, [userId, loadFavorites])

  // Push notifications (mobile only)
  usePushNotifications(userId)

  // Redirect to login on sign out
  const session = useAuthStore((s) => s.session)
  const router = useRouter()
  const segments = useSegments()
  const wasAuthenticated = useRef(false)

  useEffect(() => {
    if (session) {
      wasAuthenticated.current = true
    } else if (wasAuthenticated.current) {
      // Was logged in, now logged out → redirect to login
      wasAuthenticated.current = false
      router.replace('/(auth)/login' as never)
    }
  }, [session, segments, router])

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync()
    }
  }, [fontsLoaded])

  // GYM-272 — suivi des écrans (Expo Router ; l'autocapture PostHog ne fonctionnait pas).
  useScreenTracking()

  // PWA setup (web only)
  useRegisterServiceWorker()
  useInjectPwaHead()

  if (!fontsLoaded) return null

  const tree = (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        {/* GYM-102 (3/5) — en mode `single` ce fournisseur rend la constante Dopamine au
            premier rendu, sans effet, sans requête et sans re-rendu : il est inerte. */}
        <BrandThemeProvider slug={brandSlug}>
          <Slot />
        </BrandThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )

  // PostHog : provider monté seulement si la clé est présente (no-op total sinon).
  //
  // 🔴 GYM-272 — `captureScreens: false`. L'autocapture d'écrans n'a JAMAIS fonctionné ici
  // (le hook de navigation de PostHog est monté au-dessus du navigateur, cf.
  // lib/analytics.ts) et le suivi est désormais fait par `useScreenTracking`. La laisser à
  // `true` ne servirait à rien aujourd'hui, mais compterait chaque écran DEUX FOIS le jour
  // où quelqu'un déplacerait ce provider sous le `<Slot />` en croyant bien faire.
  return posthog ? (
    <PostHogProvider client={posthog} autocapture={{ captureScreens: false }}>
      {tree}
    </PostHogProvider>
  ) : (
    tree
  )
}

// GYM-153 — wrap racine Sentry (capture des erreurs de rendu de l'arbre).
export default Sentry.wrap(RootLayout)
