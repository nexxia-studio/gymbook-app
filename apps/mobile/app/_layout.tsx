import { useEffect } from 'react'
import { Slot, useRouter, useSegments } from 'expo-router'
import { useFonts, BarlowCondensed_900Black } from '@expo-google-fonts/barlow-condensed'
import { DMSans_400Regular, DMSans_500Medium, DMSans_700Bold } from '@expo-google-fonts/dm-sans'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useAuthStore } from '../stores/useAuthStore'
import '../lib/i18n'
import '../global.css'

SplashScreen.preventAutoHideAsync()

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    BarlowCondensed_900Black,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
  })

  const initialize = useAuthStore((s) => s.initialize)
  const session = useAuthStore((s) => s.session)
  const router = useRouter()
  const segments = useSegments()

  useEffect(() => {
    initialize()
  }, [initialize])

  useEffect(() => {
    if (!fontsLoaded) return

    SplashScreen.hideAsync()

    const inAuthGroup = segments[0] === '(auth)'

    if (!session && !inAuthGroup) {
      router.replace('/(auth)/login')
    } else if (session && inAuthGroup) {
      router.replace('/(tabs)')
    }
  }, [fontsLoaded, session, segments, router])

  if (!fontsLoaded) return null

  return (
    <>
      <StatusBar style="dark" />
      <Slot />
    </>
  )
}
