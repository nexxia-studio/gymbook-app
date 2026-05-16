import { useEffect, useState } from 'react'
import { View, Text } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withDelay, withSequence, Easing,
} from 'react-native-reanimated'
import { Button } from '../components/ui/Button'
import { useAuthStore } from '../stores/useAuthStore'

const SPLASH_DURATION = 2500

export default function Welcome() {
  const { t } = useTranslation()
  const router = useRouter()
  const session = useAuthStore((s) => s.session)
  const [splashDone, setSplashDone] = useState(false)

  // Logo animation — Netflix style
  const logoOpacity = useSharedValue(0)
  const logoScale = useSharedValue(0.8)
  const lineWidth = useSharedValue(0)

  useEffect(() => {
    // Phase 1: fade in + scale (800ms)
    logoOpacity.value = withTiming(1, { duration: 800, easing: Easing.out(Easing.cubic) })
    logoScale.value = withSequence(
      withTiming(1, { duration: 800, easing: Easing.out(Easing.cubic) }),
      // Phase 2: pulse after 900ms
      withDelay(100, withSequence(
        withTiming(1.05, { duration: 300 }),
        withTiming(1.0, { duration: 300 }),
      )),
    )

    // Accent line slides in after 600ms
    lineWidth.value = withDelay(600, withTiming(40, { duration: 400 }))

    // Navigate after splash duration
    const timer = setTimeout(() => {
      setSplashDone(true)
    }, SPLASH_DURATION)

    return () => clearTimeout(timer)
  }, [logoOpacity, logoScale, lineWidth])

  // Handle navigation after splash
  useEffect(() => {
    if (!splashDone) return
    if (session) {
      router.replace('/(tabs)' as never)
    }
    // If no session, show buttons (don't auto-redirect to login)
  }, [splashDone, session, router])

  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ scale: logoScale.value }],
  }))

  const lineStyle = useAnimatedStyle(() => ({
    width: lineWidth.value,
  }))

  // Buttons animation (only after splash)
  const buttonsOpacity = useSharedValue(0)
  const buttonsTranslateY = useSharedValue(30)

  useEffect(() => {
    if (splashDone && !session) {
      buttonsOpacity.value = withTiming(1, { duration: 400 })
      buttonsTranslateY.value = withTiming(0, { duration: 400 })
    }
  }, [splashDone, session, buttonsOpacity, buttonsTranslateY])

  const buttonsStyle = useAnimatedStyle(() => ({
    opacity: buttonsOpacity.value,
    transform: [{ translateY: buttonsTranslateY.value }],
  }))

  return (
    <View className="flex-1 bg-move-dark">
      {/* Logo area */}
      <Animated.View style={logoStyle} className="flex-1 items-center justify-center">
        <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 56, color: '#FFFFFF', letterSpacing: 4 }}>
          DOPAMINE
        </Text>
        <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 14, color: '#9A9890', letterSpacing: 6, textAlign: 'center', marginTop: 4 }}>
          PERFORMANCE CLUB
        </Text>

        {/* Accent line */}
        <Animated.View
          style={[lineStyle, { height: 2, backgroundColor: '#C8F000', borderRadius: 1, marginTop: 24 }]}
        />
      </Animated.View>

      {/* Buttons — only visible after splash if not logged in */}
      {splashDone && !session && (
        <Animated.View style={buttonsStyle} className="gap-3 px-6 pb-12">
          <Button
            title={t('welcome.login')}
            onPress={() => router.push('/(auth)/login')}
            variant="primary"
          />
          <Button
            title={t('welcome.signup')}
            onPress={() => router.push('/(auth)/signup')}
            variant="secondary"
          />
          <Text className="mt-2 text-center font-dmsans text-xs text-white/30">
            {t('welcome.skip')}
          </Text>
        </Animated.View>
      )}
    </View>
  )
}
