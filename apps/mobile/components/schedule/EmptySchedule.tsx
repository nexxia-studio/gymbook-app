import { View, Text, TouchableOpacity } from 'react-native'
import { useTranslation } from 'react-i18next'
import { SearchX } from 'lucide-react-native'
import { useTheme } from '../../lib/theme/ThemeProvider'

interface EmptyScheduleProps {
  onReset: () => void
}

export function EmptySchedule({ onReset }: EmptyScheduleProps) {
  const { t } = useTranslation()
  const { tokens } = useTheme()

  return (
    <View className="flex-1 items-center justify-center py-20">
      {/* `bg-move-border/50` reste : un lavis à 50 % n'est pas `tokens.border`. */}
      <View className="mb-4 h-16 w-16 items-center justify-center rounded-2xl bg-move-border/50">
        <SearchX size={28} color={tokens.onBackgroundMuted} />
      </View>
      <Text className="font-dmsans-bold text-sm" style={{ color: tokens.onSurface }}>
        {t('schedule.no_results')}
      </Text>
      <Text className="mt-1 font-dmsans text-xs" style={{ color: tokens.onBackgroundMuted }}>
        {t('schedule.no_results_hint')}
      </Text>
      {/* ── 🔴 GYM-286 — A-3/A-4, EN ATTENTE. NE PAS MIGRER CETTE PAIRE. ─────────────
          `bg-move-dark` + `text-move-accent` est le bouton primaire de Dopamine : fond
          SOMBRE, libellé LIME. Le cockpit a retenu l'option (b) — fond `background`,
          encre `accent` — exacte au pixel chez Dopamine. Mais en mode multi
          `resolveTheme` pose `page === background` (A-4 refusé) : un bouton rempli de
          `background` posé sur une page `page` est un rectangle de la couleur exacte de
          son fond, 1,00:1, invisible. Mesuré sur six salles, repli Viniz compris.
          Et le garde-fou ne valide `accent` sur `background` qu'à 3:1 (seuil des FORMES),
          alors qu'un libellé demande 4,5:1.
          Décision du cockpit : A-3 fusionne avec A-4, reporté au lot charte post-286b.
          La paire reste en dur dans les douze fichiers où elle apparaît. */}
      <TouchableOpacity
        onPress={onReset}
        activeOpacity={0.7}
        // GYM-286 — A-3/A-4, EN ATTENTE : paire `bg-move-dark` + `text-move-accent`.
        className="mt-4 rounded-xl bg-move-dark px-5 py-2.5"
      >
        <Text className="font-dmsans-bold text-xs text-move-accent">
          {t('schedule.reset_filters')}
        </Text>
      </TouchableOpacity>
    </View>
  )
}
