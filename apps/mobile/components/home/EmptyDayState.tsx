import { View, Text } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Calendar } from 'lucide-react-native'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { GYM_MODE } from '../../lib/gymResolver'

interface EmptyDayStateProps {
  isSunday: boolean
}

export function EmptyDayState({ isSunday }: EmptyDayStateProps) {
  const { t } = useTranslation()
  const { tokens } = useTheme()

  return (
    <View className="items-center py-16">
      {/* `bg-move-border/50` reste : un lavis à 50 % n'est pas `tokens.border`. */}
      <View className="mb-4 h-16 w-16 items-center justify-center rounded-2xl bg-move-border/50">
        <Calendar size={28} color={tokens.onBackgroundMuted} />
      </View>
      <Text className="font-dmsans-bold text-sm" style={{ color: tokens.onSurface }}>
        {t('home.empty_title')}
      </Text>
      <Text className="mt-1 font-dmsans text-xs" style={{ color: tokens.onBackgroundMuted }}>
        {/* ═══════════════════════════════════════════════════════════════════════════
            🔴 GYM-299 — ON N'AFFIRME PAS LA RÈGLE MÉTIER D'UNE SALLE QU'ON NE CONNAÎT PAS
            ═══════════════════════════════════════════════════════════════════════════
            « Dopamine est fermé le dimanche » est VRAI chez Dopamine — c'est sa règle, et
            elle reste. Mais en multi, cette phrase se retrouvait au-dessus du planning de
            n'importe quelle salle : un studio de yoga ouvert le dimanche annonçait à ses
            propres membres qu'il était fermé. L'app inventait une règle d'exploitation à
            la place du gérant, et elle se trompait.

            ⚠️ ET LE VIDE NE PROUVE RIEN. Un dimanche sans créneau peut vouloir dire
            « fermé », « pas encore programmé », ou « tout est complet et retiré ». L'app ne
            sait pas laquelle : elle dit donc CE QU'ELLE VOIT — aucun cours ce jour — et
            laisse la cause à qui la connaît. Les horaires d'ouverture existent en base
            (GYM-228, table dédiée) ; le jour où l'app les lira, elle pourra affirmer
            « fermé » sans le déduire d'une absence. */}
        {isSunday && GYM_MODE === 'single' ? t('home.empty_closed') : t('home.empty_none')}
      </Text>
    </View>
  )
}
