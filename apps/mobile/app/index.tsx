import { useEffect } from 'react'
import { View, Text } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withDelay } from 'react-native-reanimated'
import { Button } from '../components/ui/Button'
import { useAuthStore } from '../stores/useAuthStore'

export default function Welcome() {
  const { t } = useTranslation()
  const router = useRouter()
  const session = useAuthStore((s) => s.session)

  // Redirect if already logged in
  useEffect(() => {
    if (session) router.replace('/(tabs)')
  }, [session, router])

  // Animations
  const logoOpacity = useSharedValue(0)
  const logoScale = useSharedValue(0.8)
  const buttonsTranslateY = useSharedValue(40)
  const buttonsOpacity = useSharedValue(0)

  useEffect(() => {
    logoOpacity.value = withTiming(1, { duration: 600 })
    logoScale.value = withTiming(1, { duration: 600 })
    buttonsTranslateY.value = withDelay(300, withTiming(0, { duration: 400 }))
    buttonsOpacity.value = withDelay(300, withTiming(1, { duration: 400 }))
  }, [logoOpacity, logoScale, buttonsTranslateY, buttonsOpacity])

  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ scale: logoScale.value }],
  }))

  const buttonsStyle = useAnimatedStyle(() => ({
    opacity: buttonsOpacity.value,
    transform: [{ translateY: buttonsTranslateY.value }],
  }))

  return (
    <View className="flex-1 bg-move-dark">
      {/* Logo area */}
      <Animated.View style={logoStyle} className="flex-1 items-center justify-center">
        <View className="flex-row">
          <Text className="font-barlow text-5xl text-white">MOVE</Text>
          <Text className="font-barlow text-5xl text-move-accent">95</Text>
        </View>
        <Text className="mt-3 font-dmsans text-base text-white/70">
          {t('welcome.tagline')}
        </Text>
        <Text className="mt-1 font-dmsans text-xs text-white/30">
          {t('welcome.address')}
        </Text>
        <View className="mt-6 h-0.5 w-10 rounded-full bg-move-accent" />
      </Animated.View>

      {/* Buttons */}
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
    </View>
  )
}
