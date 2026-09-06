// GYM-242 — La ligne unique qui remplace les deux rangées de pastilles.
//
// Un bouton « Filtrer » portant le NOMBRE de filtres actifs, et le nombre de cours
// affichés. Toute la surface horizontale est rendue à la lecture du planning, et le membre
// sait d'un coup d'œil s'il regarde un planning filtré — ce que les pastilles, à moitié
// hors écran, ne disaient plus.
import { View, Text, TouchableOpacity } from 'react-native'
import { useTranslation } from 'react-i18next'
import { SlidersHorizontal } from 'lucide-react-native'
import { useTheme } from '../../lib/theme/ThemeProvider'

interface FilterBarProps {
  activeCount: number
  resultCount: number
  onPress: () => void
}

export function FilterBar({ activeCount, resultCount, onPress }: FilterBarProps) {
  const { t } = useTranslation()
  const { tokens } = useTheme()
  const filtered = activeCount > 0

  return (
    <View className="flex-row items-center justify-between px-5 py-3">
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={t('schedule.filters.open_a11y', { count: activeCount })}
        // 44 px de haut : cible tactile recommandée, là où les pastilles tombaient à ~32.
        // 🔴 GYM-290 (décision A) — LA PAIRE EST DÉBLOQUÉE. Le bouton filtré portait
        // `bg-move-dark` + `text-move-accent` : chez une salle il devient son action
        // (`actionBg`) avec l'encre que le garde-fou a retenue pour elle (`onAction`).
        // `border-move-border` reste en classe : c'est la branche NON filtrée, elle n'a
        // rien à voir avec l'action.
        style={filtered ? { backgroundColor: tokens.actionBg } : undefined}
        className={`min-h-[44px] flex-row items-center gap-2 rounded-xl px-4 py-2.5 ${
          filtered ? '' : 'border border-move-border bg-transparent'
        }`}
      >
        <SlidersHorizontal size={16} color={filtered ? tokens.onAction : tokens.onSurfaceSecondary} />
        <Text
          className="font-dmsans-bold text-sm"
          style={{ color: filtered ? tokens.onAction : tokens.onSurface }}
        >
          {t('schedule.filters.button')}
        </Text>
        {/* Le compteur n'apparaît QUE s'il y a quelque chose à compter : un « 0 » collé au
            bouton se lit comme un défaut d'affichage. */}
        {filtered && (
          <View className="min-w-[20px] items-center justify-center rounded-full px-1.5 py-0.5" style={{ backgroundColor: tokens.accent }}>
            <Text className="font-dmsans-bold text-[11px]" style={{ color: tokens.onAccent }}>{activeCount}</Text>
          </View>
        )}
      </TouchableOpacity>

      <Text className="font-dmsans text-xs" style={{ color: tokens.onBackgroundMuted }}>
        {t('schedule.filters.result_count', { count: resultCount })}
      </Text>
    </View>
  )
}
