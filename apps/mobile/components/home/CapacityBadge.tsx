import { View, Text } from 'react-native'
import { useTranslation } from 'react-i18next'
import { SEMANTIC } from '../../lib/theme/semantic'

interface CapacityBadgeProps {
  booked: number
  capacity: number
}

export function CapacityBadge({ booked, capacity }: CapacityBadgeProps) {
  const { t } = useTranslation()
  const remaining = capacity - booked
  const pct = remaining / capacity

  // ⚠️ LES FONDS RESTENT DES CLASSES : `bg-red-500/10` est un lavis à 10 %, qu'aucun
  // jeton ne nomme. Seules les ENCRES, opaques, valent exactement un jeton.
  // GYM-286 — A-2, EN ATTENTE pour le vert : `text-green-600` vaut #16A34A, pas
  // `SEMANTIC.success` #22C55E.
  let bg: string
  let textColor: string
  if (remaining <= 0) {
    bg = 'bg-red-500/10'
    textColor = SEMANTIC.danger
  } else if (pct < 0.3) {
    bg = 'bg-orange-500/10'
    textColor = SEMANTIC.warning
  } else {
    bg = 'bg-green-500/10'
    textColor = '#16A34A'
  }

  const label =
    remaining <= 0
      ? t('home.full')
      : remaining === 1
        ? t('home.spots_one')
        : t('home.spots_left', { count: remaining })

  return (
    <View className={`rounded-lg px-2.5 py-1 ${bg}`}>
      <Text className="font-dmsans-bold text-xs" style={{ color: textColor }}>{label}</Text>
    </View>
  )
}
