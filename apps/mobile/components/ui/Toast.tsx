import { useEffect } from 'react'
import { Text } from 'react-native'
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withDelay, runOnJS } from 'react-native-reanimated'
import { AlertCircle } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

interface ToastProps {
  message: string
  visible: boolean
  onHide: () => void
  variant?: 'error' | 'success'
}

export function Toast({ message, visible, onHide, variant = 'error' }: ToastProps) {
  const insets = useSafeAreaInsets()
  const translateY = useSharedValue(-100)

  useEffect(() => {
    if (visible) {
      translateY.value = withTiming(0, { duration: 300 })
      translateY.value = withDelay(3000, withTiming(-100, { duration: 300 }, () => runOnJS(onHide)()))
    } else {
      translateY.value = -100
    }
  }, [visible, translateY, onHide])

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }))

  if (!visible) return null

  const bg = variant === 'error' ? 'bg-red-500' : 'bg-move-dark'

  return (
    <Animated.View
      style={[style, { top: insets.top + 8 }]}
      className={`absolute left-4 right-4 z-50 flex-row items-center gap-3 rounded-2xl px-4 py-3 ${bg}`}
    >
      <AlertCircle size={20} color="#FFFFFF" />
      <Text className="flex-1 font-dmsans text-sm text-white">{message}</Text>
    </Animated.View>
  )
}
