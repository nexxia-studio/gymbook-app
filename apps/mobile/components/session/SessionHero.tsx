import { View, Text, TouchableOpacity } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ChevronLeft, Heart, Dumbbell, Flame } from 'lucide-react-native'
import { ActivityImage } from '../shared/ActivityImage'

interface SessionHeroProps {
  activity: string
  /** GYM-216 — activities.image_url. Vide → repli neutre (cas nominal aujourd'hui). */
  imageUrl?: string | null
  /** activities.color, teinte du repli. */
  activityColor?: string | null
  onBack: () => void
  isFavorite: boolean
  onToggleFavorite: () => void
}

export function SessionHero({ activity, imageUrl, activityColor, onBack, isFavorite, onToggleFavorite }: SessionHeroProps) {
  const insets = useSafeAreaInsets()
  const Icon = activity === 'Open Gym' ? Dumbbell : Flame

  return (
    <ActivityImage
      imageUrl={imageUrl}
      activity={activity}
      accentColor={activityColor}
      className="h-72"
      initialsSize={160}
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
    </ActivityImage>
  )
}
