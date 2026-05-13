import { type ReactNode } from 'react'
import { View, Text } from 'react-native'

interface ProfileSectionProps {
  title: string
  children: ReactNode
}

export function ProfileSection({ title, children }: ProfileSectionProps) {
  return (
    <View className="mt-4">
      <Text className="mb-1 px-5 font-dmsans-bold text-[11px] uppercase tracking-wider text-move-text-muted">
        {title}
      </Text>
      <View className="mx-4 overflow-hidden rounded-2xl bg-move-card">
        {children}
      </View>
    </View>
  )
}
