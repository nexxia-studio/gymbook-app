import { View, Text } from 'react-native'
import { Link } from 'expo-router'
import { useTheme } from '../lib/theme/ThemeProvider'

export default function NotFound() {
  const { tokens } = useTheme()
  return (
    <View className="flex-1 items-center justify-center" style={{ backgroundColor: tokens.page }}>
      <Text className="font-barlow text-2xl uppercase" style={{ color: tokens.onSurface }}>404</Text>
      <Link href="/" className="mt-4">
        {/* GYM-286 — A-1, EN ATTENTE : #9DB800 n'est tranché ni marque ni succès. */}
        <Text className="font-dmsans text-sm text-move-accent-dim">
          Retour
        </Text>
      </Link>
    </View>
  )
}
