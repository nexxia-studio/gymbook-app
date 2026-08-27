// GYM-242 — Feuille modale de filtres, façon Airbnb / Deliveroo.
//
// CE QU'ELLE REMPLACE. Les pastilles (FilterPills) occupaient DÉJÀ DEUX LIGNES et
// débordaient, avec six activités et six coachs — capture d'Antoine du 19/08. Avec un
// horizon porté de 14 à 30 jours et d'autres coachs à venir, c'était intenable : le membre
// scrollait horizontalement pour découvrir des filtres qu'il ne savait pas là.
//
// ⚠️ PAS DE MENU DÉROULANT. C'est le réflexe web, et une mauvaise pratique sur mobile :
// zone tactile étroite, liste tronquée, aucune vue d'ensemble. Antoine a validé la feuille
// modale qui monte du bas — un motif natif, où l'on voit TOUS les choix d'un coup.
//
// ⚠️ MULTI-SÉLECTION PARTOUT SAUF LA PÉRIODE. Nico veut voir « Marie ET Julie », pas
// basculer de l'une à l'autre (acquis de GYM-128 côté dashboard). La période, elle, reste
// exclusive : « cette semaine ET plus tard » n'a pas de sens comme intervalle.
import { useMemo } from 'react'
import { View, Text, Modal, Pressable, ScrollView, TouchableOpacity } from 'react-native'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react-native'
import { useTheme } from '../../lib/theme/ThemeProvider'
import type { PeriodFilter } from '../../hooks/useSchedule'

interface FilterSheetProps {
  visible: boolean
  onClose: () => void
  activities: string[]
  coaches: string[]
  activityFilters: string[]
  coachFilters: string[]
  periodFilter: PeriodFilter | null
  /** GYM-242 — « Plus tard » est masqué quand aucun créneau ne s'y trouve. */
  laterAvailable: boolean
  /** Nombre de cours que le filtrage courant laisse voir — annoncé sur le bouton. */
  resultCount: number
  onToggleActivity: (name: string) => void
  onToggleCoach: (name: string) => void
  onPeriodChange: (p: PeriodFilter | null) => void
  onReset: () => void
  hasActiveFilters: boolean
}

/**
 * Une option sélectionnable. Hauteur minimale de 44 px : c'est la cible tactile
 * recommandée par Apple, et les pastilles précédentes (py-2, ~32 px) passaient dessous.
 */
function Option({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { tokens } = useTheme()

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: active }}
      className={`min-h-[44px] justify-center rounded-xl px-4 py-2.5 ${active ? '' : 'border bg-transparent'}`}
      style={active ? { backgroundColor: tokens.accent } : { borderColor: tokens.border }}
    >
      {/* ⚠️ `onAccent`, PAS `onSurface` — l'étiquette active est posée SUR `accent`. */}
      <Text
        className="font-dmsans-medium text-sm"
        style={{ color: active ? tokens.onAccent : tokens.onSurfaceSecondary }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { tokens } = useTheme()

  return (
    <View className="mb-6">
      <Text className="mb-3 font-dmsans-bold text-[11px] uppercase tracking-wider" style={{ color: tokens.onBackgroundMuted }}>
        {title}
      </Text>
      <View className="flex-row flex-wrap gap-2">{children}</View>
    </View>
  )
}

export function FilterSheet({
  visible, onClose, activities, coaches,
  activityFilters, coachFilters, periodFilter, laterAvailable, resultCount,
  onToggleActivity, onToggleCoach, onPeriodChange, onReset, hasActiveFilters,
}: FilterSheetProps) {
  const { t } = useTranslation()
  const { tokens } = useTheme()

  // Les trois périodes, « plus tard » retirée quand elle ne peut rien contenir.
  const periods = useMemo(() => {
    const all: { key: PeriodFilter; label: string }[] = [
      { key: 'current', label: t('schedule.filters.this_week') },
      { key: 'next', label: t('schedule.filters.next_week') },
      { key: 'later', label: t('schedule.filters.later') },
    ]
    return laterAvailable ? all : all.filter((p) => p.key !== 'later')
  }, [laterAvailable, t])

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Fermeture PAR LE FOND, en plus de la croix : c'est le geste attendu d'une feuille
          modale, et le seul disponible au pouce sur un grand écran. */}
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('common.close')}
        className="flex-1 bg-black/40"
      />
      {/* `bg-black/40` reste : un voile à 40 % n'est nommé par aucun jeton. */}
      <View className="max-h-[80%] rounded-t-3xl pb-8" style={{ backgroundColor: tokens.page }}>
        {/* Poignée + en-tête */}
        <View className="items-center pt-3">
          <View className="h-1 w-10 rounded-full" style={{ backgroundColor: tokens.border }} />
        </View>
        <View className="flex-row items-center justify-between px-5 pb-2 pt-4">
          <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 22, color: tokens.onSurface }}>
            {t('schedule.filters.title').toUpperCase()}
          </Text>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
          >
            <X size={22} color={tokens.onBackgroundMuted} />
          </TouchableOpacity>
        </View>

        <ScrollView className="px-5" contentContainerStyle={{ paddingTop: 12 }}>
          <Section title={t('schedule.filters.period')}>
            {periods.map((p) => (
              <Option
                key={p.key}
                label={p.label}
                active={periodFilter === p.key}
                // Période EXCLUSIVE : retaper l'option active la retire.
                onPress={() => onPeriodChange(periodFilter === p.key ? null : p.key)}
              />
            ))}
          </Section>

          {/* Activités et coachs DÉRIVÉS DES CRÉNEAUX, jamais écrits en dur — c'est
              l'acquis de GYM-216, où les pastilles ne connaissaient que deux activités
              sur six et rendaient les quatre autres impossibles à filtrer. */}
          {activities.length > 0 && (
            <Section title={t('schedule.filters.classes')}>
              {activities.map((a) => (
                <Option key={a} label={a} active={activityFilters.includes(a)} onPress={() => onToggleActivity(a)} />
              ))}
            </Section>
          )}

          {coaches.length > 0 && (
            <Section title={t('schedule.filters.coach')}>
              {coaches.map((c) => (
                <Option key={c} label={c} active={coachFilters.includes(c)} onPress={() => onToggleCoach(c)} />
              ))}
            </Section>
          )}
        </ScrollView>

        {/* Pied — le bouton ANNONCE LE RÉSULTAT. Le membre sait ce qu'il obtient avant de
            fermer, au lieu de valider puis découvrir un écran vide. */}
        <View className="border-t px-5 pt-4" style={{ borderColor: tokens.border }}>
          {hasActiveFilters && (
            <TouchableOpacity onPress={onReset} hitSlop={8} className="mb-3 self-start" accessibilityRole="button">
              <Text className="font-dmsans-medium text-sm underline" style={{ color: tokens.onSurfaceSecondary }}>
                {t('schedule.filters.clear_all')}
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={onClose}
            activeOpacity={0.8}
            accessibilityRole="button"
            // 🔴 GYM-286 — A-3/A-4, EN ATTENTE : `bg-move-dark` + `text-move-accent`.
            className="min-h-[48px] items-center justify-center rounded-xl bg-move-dark"
          >
            <Text className="font-dmsans-bold text-sm text-move-accent">
              {resultCount === 0
                ? t('schedule.filters.show_none')
                : t('schedule.filters.show_count', { count: resultCount })}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}
