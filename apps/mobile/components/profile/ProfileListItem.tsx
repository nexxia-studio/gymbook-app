import { TouchableOpacity, View, Text } from 'react-native'
import { ChevronRight } from 'lucide-react-native'
import type { LucideIcon } from 'lucide-react-native'

interface ProfileListItemProps {
  icon: LucideIcon
  label: string
  detail?: string
  badge?: string
  badgeColor?: string
  destructive?: boolean
  onPress?: () => void
}

export function ProfileListItem({ icon: Icon, label, detail, badge, badgeColor, destructive, onPress }: ProfileListItemProps) {
  const textColor = destructive ? 'text-red-500' : 'text-move-dark'
  const iconColor = destructive ? '#EF4444' : '#6B6861'

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.6}
      className="flex-row items-center px-5 py-3.5"
    >
      <Icon size={20} color={iconColor} />
      <View className="ml-3 flex-1">
        <Text className={`font-dmsans-medium text-sm ${textColor}`}>{label}</Text>
        {detail && (
          <Text className="mt-0.5 font-dmsans text-xs text-move-text-muted">{detail}</Text>
        )}
      </View>
      {badge && (
        <View className="mr-2 rounded-md px-2 py-0.5" style={{ backgroundColor: badgeColor ?? '#22C55E20' }}>
          <Text className="font-dmsans-bold text-[10px]" style={{ color: badgeColor ? '#FFFFFF' : '#22C55E' }}>
            {badge}
          </Text>
        </View>
      )}
      <ChevronRight size={18} color="#9A9890" />
    </TouchableOpacity>
  )
}
