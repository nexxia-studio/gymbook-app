import { type ReactNode } from 'react'
import { View, Text } from 'react-native'
import { useTheme } from '../../lib/theme/ThemeProvider'

interface ProfileSectionProps {
  title: string
  children: ReactNode
}

export function ProfileSection({ title, children }: ProfileSectionProps) {
  const { tokens } = useTheme()

  return (
    <View className="mt-4">
      <Text className="mb-1 px-5 font-dmsans-bold text-[11px] uppercase tracking-wider" style={{ color: tokens.onBackgroundMuted }}>
        {title}
      </Text>
      <View className="mx-4 overflow-hidden rounded-2xl" style={{ backgroundColor: tokens.surface }}>
        {children}
      </View>
    </View>
  )
}
