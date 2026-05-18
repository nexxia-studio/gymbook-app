import { useState, useRef, useCallback } from 'react'
import { View, Text, ScrollView, RefreshControl } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Bell } from 'lucide-react-native'
import { DayTabs } from '../../components/home/DayTabs'
import { SessionCard } from '../../components/home/SessionCard'
import { EmptyDayState } from '../../components/home/EmptyDayState'
import { useHomeSchedule } from '../../hooks/useHomeSchedule'

export default function Home() {
  const { t } = useTranslation()
  const router = useRouter()
  const { days, scheduleByDay, isFavorite, toggleFavorite, isSlotBooked, isSlotWaitlisted, refresh } = useHomeSchedule()
  const [activeDay, setActiveDay] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const scrollRef = useRef<ScrollView>(null)

  const dayLabels = t('home.days', { returnObjects: true }) as string[]
  const months = t('home.months', { returnObjects: true }) as string[]

  const onRefresh = useCallback(() => {
    setRefreshing(true)
    refresh()
    setTimeout(() => setRefreshing(false), 500)
  }, [refresh])

  function handleDaySelect(index: number) {
    setActiveDay(index)
    // Scroll to section — simple approach: scroll to top of that section
    // Since sections are stacked vertically, we estimate position
  }

  function formatStickyLabel(date: Date): string {
    const dayName = dayLabels[date.getDay()] ?? ''
    const day = date.getDate()
    const month = months[date.getMonth()] ?? ''
    return `${dayName} ${day} ${month}`.toUpperCase()
  }

  return (
    <SafeAreaView className="flex-1 bg-move-bg" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center justify-between bg-move-dark px-5 pb-3 pt-2">
        <View>
          <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 24, color: '#FFFFFF' }}>
            DOPAMINE
          </Text>
          <Text className="font-dmsans text-[11px] text-white/40">
            Performance Club
          </Text>
        </View>
        <View className="relative">
          <Bell size={22} color="#FFFFFF" />
          <View className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-red-500" />
        </View>
      </View>

      {/* Day tabs */}
      <View className="bg-move-bg">
        <DayTabs days={days} activeIndex={activeDay} onSelect={handleDaySelect} />
      </View>

      {/* Content */}
      <ScrollView
        ref={scrollRef}
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#C8F000" />
        }
      >
        {scheduleByDay.map(({ date, slots }, dayIndex) => {
          const isSunday = date.getDay() === 0

          // Only show the active day and others below for scrolling
          if (dayIndex < activeDay) return null

          return (
            <View key={dayIndex} className="mb-2">
              {/* Day label */}
              <Text className="mb-3 mt-4 font-dmsans-bold text-[11px] uppercase tracking-wider text-move-text-muted">
                {formatStickyLabel(date)}
              </Text>

              {/* Slots or empty */}
              {slots.length === 0 ? (
                <EmptyDayState isSunday={isSunday} />
              ) : (
                slots.map((slot) => (
                  <SessionCard
                    key={slot.id}
                    slot={slot}
                    isFavorite={isFavorite(slot.id)}
                    isBooked={isSlotBooked(slot.id)}
                    isWaitlisted={isSlotWaitlisted(slot.id)}
                    onToggleFavorite={() => toggleFavorite(slot.id)}
                    onPress={() => {
                      router.push({
                        pathname: '/session/[id]',
                        params: {
                          id: slot.id,
                          activity: slot.activity,
                          date: slot.date,
                          time: slot.time,
                          endTime: slot.endTime,
                          coach: slot.coach,
                          duration: String(slot.duration),
                          capacity: String(slot.capacity),
                          booked: String(slot.booked),
                        },
                      })
                    }}
                  />
                ))
              )}
            </View>
          )
        })}
      </ScrollView>
    </SafeAreaView>
  )
}
