import { useEffect, useRef } from 'react'
import { Animated, Easing, Text } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

// GYM-96 — bannière IN-SCREEN autonome, locale à l'écran Réservations. Remplace le host
// Toast partagé (composants/ui/Toast) dont l'animation s'auto-annulait (le withDelay écrasait
// le slide-in → la vue restait hors écran). Ici : RN Animated natif, zéro dépendance nouvelle,
// slide-in depuis le haut + auto-dismiss après 3 s. `message = null` → rien n'est monté.
export function InScreenBanner({ message, onHide }: { message: string | null; onHide: () => void }) {
  const insets = useSafeAreaInsets()
  const translateY = useRef(new Animated.Value(-120)).current
  const opacity = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!message) return
    let cancelled = false
    translateY.setValue(-120)
    opacity.setValue(0)

    Animated.parallel([
      Animated.timing(translateY, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 280, useNativeDriver: true }),
    ]).start()

    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(translateY, { toValue: -120, duration: 240, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 240, useNativeDriver: true }),
      ]).start(() => { if (!cancelled) onHide() })
    }, 3000)

    return () => { cancelled = true; clearTimeout(timer) }
  }, [message, translateY, opacity, onHide])

  if (!message) return null

  return (
    <Animated.View
      pointerEvents="none"
      style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, zIndex: 50, transform: [{ translateY }], opacity }}
      className="flex-row items-center rounded-2xl bg-move-dark px-4 py-3"
    >
      <Text className="flex-1 font-dmsans-bold text-sm text-white">{message}</Text>
    </Animated.View>
  )
}
