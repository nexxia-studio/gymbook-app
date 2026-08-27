import { Stack } from 'expo-router'
import { useTheme } from '../../lib/theme/ThemeProvider'

export default function AuthLayout() {
  const { tokens } = useTheme()

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: tokens.page },
      }}
    />
  )
}
