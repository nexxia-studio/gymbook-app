import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'
import { Slot, useRouter, useSegments } from 'expo-router'
import { useFonts, BarlowCondensed_900Black } from '@expo-google-fonts/barlow-condensed'
import { DMSans_400Regular, DMSans_500Medium, DMSans_700Bold } from '@expo-google-fonts/dm-sans'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useAuthStore } from '../stores/useAuthStore'
import { useBookingStore } from '../stores/useBookingStore'
import { usePushNotifications } from '../hooks/usePushNotifications'
import '../lib/i18n'
import '../global.css'

SplashScreen.preventAutoHideAsync()

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

export default function RootLayout() {
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

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Slot />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
