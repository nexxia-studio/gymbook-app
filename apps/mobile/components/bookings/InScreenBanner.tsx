import { useEffect, useRef } from 'react'
import { Animated, Easing, Text } from 'react-native'

// GYM-96 — bannière IN-SCREEN autonome, locale à l'écran Réservations. Remplace le host
// Toast partagé (composants/ui/Toast) dont l'animation s'auto-annulait (le withDelay écrasait
// le slide-in → la vue restait hors écran). Ici : RN Animated natif, zéro dépendance nouvelle.
//
// Ancrage BAS (QA 09/07) : glisse depuis le bas et se cale au-dessus de la tab bar, pour ne
// plus disparaître derrière le header noir. L'écran est déjà posé au-dessus de la tab bar
// (celle-ci absorbe la safe-area) → un simple offset `bottom` suffit. `message = null` → rien.
const BOTTOM_OFFSET = 16
const OFFSCREEN = 120 // slide depuis / vers le bas

export function InScreenBanner({ message, onHide }: { message: string | null; onHide: () => void }) {
  const translateY = useRef(new Animated.Value(OFFSCREEN)).current
  const opacity = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!message) return
    let cancelled = false
    translateY.setValue(OFFSCREEN)
    opacity.setValue(0)

    Animated.parallel([
      Animated.timing(translateY, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 280, useNativeDriver: true }),
    ]).start()

    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(translateY, { toValue: OFFSCREEN, duration: 240, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 240, useNativeDriver: true }),
      ]).start(() => { if (!cancelled) onHide() })
    }, 3000)

    return () => { cancelled = true; clearTimeout(timer) }
  }, [message, translateY, opacity, onHide])

  if (!message) return null

  return (
    <Animated.View
      pointerEvents="none"
      style={{ position: 'absolute', bottom: BOTTOM_OFFSET, left: 16, right: 16, zIndex: 50, transform: [{ translateY }], opacity }}
      className="flex-row items-center rounded-2xl bg-move-dark px-4 py-3"
    >
      <Text className="flex-1 font-dmsans-bold text-sm text-white">{message}</Text>
    </Animated.View>
  )
}
