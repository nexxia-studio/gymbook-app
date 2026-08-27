import { View, Text } from 'react-native'
import { Link } from 'expo-router'
import { useTheme } from '../lib/theme/ThemeProvider'

export default function NotFound() {
  const { tokens } = useTheme()
  return (
    <View className="flex-1 items-center justify-center" style={{ backgroundColor: tokens.page }}>
      <Text className="font-barlow text-2xl uppercase" style={{ color: tokens.onSurface }}>404</Text>
      <Link href="/" className="mt-4">
        {/* 🔴 GYM-290 (A-1 + A-5) — de la MARQUE, donc `accentDim` — désormais une vraie
            dérivation, validée au seuil TEXTE puisqu'elle est posée comme texte. */}
        <Text className="font-dmsans text-sm" style={{ color: tokens.accentDim }}>
          Retour
        </Text>
      </Link>
    </View>
  )
}
