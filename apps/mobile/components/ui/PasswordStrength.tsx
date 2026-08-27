import { View, Text } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { SEMANTIC } from '../../lib/theme/semantic'

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

// ⚠️ DEUX TABLES QUI DISENT LA MÊME CHOSE DANS DEUX LANGAGES — c'est ce que la migration
// fait disparaître : la barre portait des littéraux, le libellé des classes, et rien
// n'obligeait les deux à rester d'accord.
//
// GYM-286 — A-2 ET A-1, EN ATTENTE, pour deux des trois niveaux :
//   `medium` #F59E0B est l'ambre 500, PAS `SEMANTIC.warning` #F97316 — une autre couleur ;
//   `strong` #9DB800 dit un succès mais reste un lime de marque (A-1).
// Les approcher par le jeton voisin serait la régression d'un pixel que ce lot interdit.
const barColors = { weak: SEMANTIC.danger, medium: '#F59E0B', strong: '#9DB800' }
const textColors = { weak: SEMANTIC.danger, medium: '#F59E0B', strong: '#9DB800' }

export function PasswordStrength({ password }: PasswordStrengthProps) {
  const { t } = useTranslation()
  const { tokens } = useTheme()
  if (!password) return null

  const { score, label } = getStrength(password)

  return (
    <View className="gap-1">
      <View className="flex-row gap-1">
        {[1, 2, 3].map((i) => (
          <View
            key={i}
            className="h-1 flex-1 rounded-full"
            style={{ backgroundColor: i <= score ? barColors[label] : tokens.border }}
          />
        ))}
      </View>
      <Text className="font-dmsans text-xs" style={{ color: textColors[label] }}>
        {t(`auth.password_strength.${label}`)}
      </Text>
    </View>
  )
}
