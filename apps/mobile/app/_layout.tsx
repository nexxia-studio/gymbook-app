import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'
import * as Sentry from '@sentry/react-native'
import { Slot, useRouter, useSegments } from 'expo-router'
import { useFonts, BarlowCondensed_900Black } from '@expo-google-fonts/barlow-condensed'
import { DMSans_400Regular, DMSans_500Medium, DMSans_700Bold } from '@expo-google-fonts/dm-sans'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { PostHogProvider } from 'posthog-react-native'
import { posthog } from '../lib/analytics'
import { isExpectedEdgeError } from '../lib/edgeInvoke'
import { useAuthStore } from '../stores/useAuthStore'
import { useBookingStore } from '../stores/useBookingStore'
import { usePushNotifications } from '../hooks/usePushNotifications'
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
  const [fontsLoaded] = useFonts({
    BarlowCondensed_900Black,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
  })

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

  // PWA setup (web only)
  useRegisterServiceWorker()
  useInjectPwaHead()

  if (!fontsLoaded) return null

  const tree = (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Slot />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )

  // PostHog : provider monté seulement si la clé est présente (no-op total sinon).
  // autocapture des écrans activé (suivi de navigation Expo Router automatique).
  return posthog ? (
    <PostHogProvider client={posthog} autocapture={{ captureScreens: true }}>
      {tree}
    </PostHogProvider>
  ) : (
    tree
  )
}

// GYM-153 — wrap racine Sentry (capture des erreurs de rendu de l'arbre).
export default Sentry.wrap(RootLayout)
