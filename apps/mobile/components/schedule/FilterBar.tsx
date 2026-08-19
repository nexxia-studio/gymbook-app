// GYM-242 — La ligne unique qui remplace les deux rangées de pastilles.
//
// Un bouton « Filtrer » portant le NOMBRE de filtres actifs, et le nombre de cours
// affichés. Toute la surface horizontale est rendue à la lecture du planning, et le membre
// sait d'un coup d'œil s'il regarde un planning filtré — ce que les pastilles, à moitié
// hors écran, ne disaient plus.
import { View, Text, TouchableOpacity } from 'react-native'
import { useTranslation } from 'react-i18next'
import { SlidersHorizontal } from 'lucide-react-native'

interface FilterBarProps {
  activeCount: number
  resultCount: number
  onPress: () => void
}

export function FilterBar({ activeCount, resultCount, onPress }: FilterBarProps) {
  const { t } = useTranslation()
  const filtered = activeCount > 0

  return (
    <View className="flex-row items-center justify-between px-5 py-3">
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={t('schedule.filters.open_a11y', { count: activeCount })}
        // 44 px de haut : cible tactile recommandée, là où les pastilles tombaient à ~32.
        className={`min-h-[44px] flex-row items-center gap-2 rounded-xl px-4 py-2.5 ${
          filtered ? 'bg-move-dark' : 'border border-move-border bg-transparent'
        }`}
      >
        <SlidersHorizontal size={16} color={filtered ? '#C8F000' : '#6B6861'} />
        <Text className={`font-dmsans-bold text-sm ${filtered ? 'text-move-accent' : 'text-move-dark'}`}>
          {t('schedule.filters.button')}
        </Text>
        {/* Le compteur n'apparaît QUE s'il y a quelque chose à compter : un « 0 » collé au
            bouton se lit comme un défaut d'affichage. */}
        {filtered && (
          <View className="min-w-[20px] items-center justify-center rounded-full bg-move-accent px-1.5 py-0.5">
            <Text className="font-dmsans-bold text-[11px] text-[#111111]">{activeCount}</Text>
          </View>
        )}
      </TouchableOpacity>

      <Text className="font-dmsans text-xs text-move-text-muted">
        {t('schedule.filters.result_count', { count: resultCount })}
      </Text>
    </View>
  )
}
