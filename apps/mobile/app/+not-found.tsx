import { View, Text } from 'react-native'
import { Link } from 'expo-router'

export default function NotFound() {
  return (
    <View className="flex-1 items-center justify-center bg-move-bg">
      <Text className="font-barlow text-2xl uppercase text-move-dark">404</Text>
      <Link href="/" className="mt-4">
        <Text className="font-dmsans text-sm text-move-accent-dim">
          Retour
        </Text>
      </Link>
    </View>
  )
}
