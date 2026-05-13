import { ScrollView, TouchableOpacity, Text } from 'react-native'
import { useTranslation } from 'react-i18next'

interface DayTabsProps {
  days: Date[]
  activeIndex: number
  onSelect: (index: number) => void
}

function formatDayPill(date: Date, offset: number, t: (key: string) => string, months: string[]): string {
  const day = date.getDate()
  const month = months[date.getMonth()] ?? ''
  if (offset === 0) return `${t('home.today')} \u00B7 ${day} ${month}`
  if (offset === 1) return `${t('home.tomorrow')} \u00B7 ${day} ${month}`
  return `${t('home.in_2_days')} \u00B7 ${day} ${month}`
}

export function DayTabs({ days, activeIndex, onSelect }: DayTabsProps) {
  const { t } = useTranslation()
  const months = t('home.months', { returnObjects: true }) as string[]

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}
      className="py-3"
    >
      {days.map((date, i) => {
        const active = i === activeIndex
        return (
          <TouchableOpacity
            key={i}
            onPress={() => onSelect(i)}
            activeOpacity={0.7}
            className={`rounded-xl px-4 py-2.5 ${
              active ? 'bg-move-dark' : 'border border-move-border bg-transparent'
            }`}
          >
            <Text
              className={`font-dmsans-medium text-xs ${active ? 'text-white' : 'text-move-text-secondary'}`}
            >
              {formatDayPill(date, i, t, months)}
            </Text>
          </TouchableOpacity>
        )
      })}
    </ScrollView>
  )
}
