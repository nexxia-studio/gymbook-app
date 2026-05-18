import { View, Text } from 'react-native'
import { useTranslation } from 'react-i18next'

interface ProfileHeaderProps {
  firstName: string
  lastName: string
  memberSince: string
  levelKey?: string
}

function nameToColor(name: string): string {
  const colors = ['#4ECDC4', '#FF6B6B', '#6C5CE7', '#FF8E53', '#A8E6CF', '#B8B8FF']
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return colors[Math.abs(hash) % colors.length]
}

export function ProfileHeader({ firstName, lastName, memberSince, levelKey }: ProfileHeaderProps) {
  const { t } = useTranslation()
  const initials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase()
  const bgColor = nameToColor(`${firstName} ${lastName}`)

  return (
    <View className="mx-4 mt-4 items-center rounded-3xl bg-move-card px-6 py-6 shadow-sm">
      {/* Avatar */}
      <View
        className="mb-3 h-20 w-20 items-center justify-center rounded-full"
        style={{ backgroundColor: bgColor, borderWidth: 3, borderColor: '#C8F000' }}
      >
        <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 28, color: '#FFFFFF' }}>
          {initials}
        </Text>
      </View>

      <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 22, color: '#111111' }}>
        {firstName} {lastName}
      </Text>

      {levelKey && (
        <View className="mt-1 rounded-lg bg-move-accent/15 px-3 py-1">
          <Text className="font-dmsans-bold text-xs text-move-dark">
            {t(`profile.level.${levelKey}`)}
          </Text>
        </View>
      )}

      <Text className="mt-1 font-dmsans text-[13px] text-move-text-secondary">
        {t('profile.member_since', { date: memberSince })}
      </Text>

      <View className="mt-2 rounded-lg bg-move-bg px-3 py-1">
        <Text className="font-dmsans-medium text-[10px] text-move-text-muted">
          {t('profile.badge_gym')}
        </Text>
      </View>
    </View>
  )
}
