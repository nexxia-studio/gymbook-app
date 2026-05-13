import { View, Text } from 'react-native'
import { useTranslation } from 'react-i18next'

interface PasswordStrengthProps {
  password: string
}

function getStrength(pw: string): { score: number; label: 'weak' | 'medium' | 'strong' } {
  let s = 0
  if (pw.length >= 12) s++
  if (/[A-Z]/.test(pw)) s++
  if (/[0-9]/.test(pw)) s++
  if (/[^A-Za-z0-9]/.test(pw)) s++
  if (s <= 1) return { score: 1, label: 'weak' }
  if (s <= 3) return { score: 2, label: 'medium' }
  return { score: 3, label: 'strong' }
}

const barColors = { weak: '#EF4444', medium: '#F59E0B', strong: '#9DB800' }
const textColors = { weak: 'text-red-500', medium: 'text-amber-500', strong: 'text-move-accent-dim' }

export function PasswordStrength({ password }: PasswordStrengthProps) {
  const { t } = useTranslation()
  if (!password) return null

  const { score, label } = getStrength(password)

  return (
    <View className="gap-1">
      <View className="flex-row gap-1">
        {[1, 2, 3].map((i) => (
          <View
            key={i}
            className="h-1 flex-1 rounded-full"
            style={{ backgroundColor: i <= score ? barColors[label] : '#E8E6E0' }}
          />
        ))}
      </View>
      <Text className={`font-dmsans text-xs ${textColors[label]}`}>
        {t(`auth.password_strength.${label}`)}
      </Text>
    </View>
  )
}
