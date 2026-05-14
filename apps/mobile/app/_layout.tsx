import { useEffect } from 'react'
import { Platform } from 'react-native'
import { Slot } from 'expo-router'
import { useFonts, BarlowCondensed_900Black } from '@expo-google-fonts/barlow-condensed'
import { DMSans_400Regular, DMSans_500Medium, DMSans_700Bold } from '@expo-google-fonts/dm-sans'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useAuthStore } from '../stores/useAuthStore'
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

  useEffect(() => {
    initialize()
  }, [initialize])

  // Push notifications (mobile only)
  usePushNotifications(userId)

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
