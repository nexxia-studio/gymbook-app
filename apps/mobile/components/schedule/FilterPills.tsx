import { View, ScrollView, TouchableOpacity, Text } from 'react-native'
import { useTranslation } from 'react-i18next'

interface FilterPillsProps {
  activityFilter: string | null
  weekFilter: 'current' | 'next' | null
  coachFilter: string | null
  coaches: string[]
  /** GYM-216 — activités réelles de la salle, dérivées du planning. Plus de liste en dur. */
  activities: string[]
  onActivityChange: (v: string | null) => void
  onWeekChange: (v: 'current' | 'next' | null) => void
  onCoachChange: (v: string | null) => void
}

function Pill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      className={`rounded-xl px-3.5 py-2 ${
        active ? 'bg-move-accent' : 'border border-move-border bg-transparent'
      }`}
    >
      <Text
        className={`font-dmsans-medium text-xs ${
          active ? 'text-[#111111]' : 'text-move-text-secondary'
        }`}
      >
        {label}
      </Text>
    </TouchableOpacity>
  )
}

export function FilterPills({
  activityFilter, weekFilter, coachFilter, coaches, activities,
  onActivityChange, onWeekChange, onCoachChange,
}: FilterPillsProps) {
  const { t } = useTranslation()

  return (
    <View className="gap-2 py-3">
      {/* Row 1: Activity */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}
      >
        <Pill
          label={t('schedule.all_classes')}
          active={activityFilter === null}
          onPress={() => onActivityChange(null)}
        />
        {activities.map((name) => (
          <Pill
            key={name}
            label={name}
            active={activityFilter === name}
            onPress={() => onActivityChange(activityFilter === name ? null : name)}
          />
        ))}
      </ScrollView>

      {/* Row 2: Week + Coach */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}
      >
        <Pill
          label={t('schedule.this_week')}
          active={weekFilter === 'current'}
          onPress={() => onWeekChange(weekFilter === 'current' ? null : 'current')}
        />
        <Pill
          label={t('schedule.next_week')}
          active={weekFilter === 'next'}
          onPress={() => onWeekChange(weekFilter === 'next' ? null : 'next')}
        />
        {coaches.map((c) => (
          <Pill
            key={c}
            label={c}
            active={coachFilter === c}
            onPress={() => onCoachChange(coachFilter === c ? null : c)}
          />
        ))}
      </ScrollView>
    </View>
  )
}
