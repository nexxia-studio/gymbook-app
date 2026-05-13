import { View, Text, ImageBackground, TouchableOpacity } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ChevronLeft, Heart, Dumbbell, Flame } from 'lucide-react-native'

interface SessionHeroProps {
  activity: string
  onBack: () => void
  isFavorite: boolean
  onToggleFavorite: () => void
}

const IMAGES: Record<string, string> = {
  'Open Gym': 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800&q=80',
  'HIIT / Hyrox': 'https://images.unsplash.com/photo-1517963879433-6ad2b056d712?w=800&q=80',
}

export function SessionHero({ activity, onBack, isFavorite, onToggleFavorite }: SessionHeroProps) {
  const insets = useSafeAreaInsets()
  const Icon = activity === 'Open Gym' ? Dumbbell : Flame

  return (
    <ImageBackground
      source={{ uri: IMAGES[activity] ?? IMAGES['Open Gym'] }}
      className="h-72"
    >
      {/* Gradient */}
      <View className="absolute inset-0" style={{ backgroundColor: 'rgba(0,0,0,0.3)' }} />
      <View className="absolute bottom-0 left-0 right-0 h-32" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} />

      {/* Top bar */}
      <View className="flex-row items-center justify-between px-4" style={{ paddingTop: insets.top + 8 }}>
        <TouchableOpacity
          onPress={onBack}
          activeOpacity={0.7}
          className="h-10 w-10 items-center justify-center rounded-full bg-white/20"
        >
          <ChevronLeft size={22} color="#FFFFFF" />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={onToggleFavorite}
          activeOpacity={0.7}
          className="h-10 w-10 items-center justify-center rounded-full bg-white/20"
        >
          <Heart size={20} color={isFavorite ? '#EF4444' : '#FFFFFF'} fill={isFavorite ? '#EF4444' : 'none'} />
        </TouchableOpacity>
      </View>

      {/* Activity name */}
      <View className="absolute bottom-5 left-5 flex-row items-center gap-2">
        <Icon size={22} color="#FFFFFF" />
        <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 30, color: '#FFFFFF' }}>
          {activity.toUpperCase()}
        </Text>
      </View>
    </ImageBackground>
  )
}
