import { useCallback, useState } from 'react'
import { View, Text, SectionList, RefreshControl } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useSchedule, type DaySection, type ScheduleSlot } from '../../hooks/useSchedule'
import { useBookingStore } from '../../stores/useBookingStore'
import { FilterPills } from '../../components/schedule/FilterPills'
import { SlotListCard } from '../../components/schedule/SlotListCard'
import { SectionHeader } from '../../components/schedule/SectionHeader'
import { EmptySchedule } from '../../components/schedule/EmptySchedule'
import { Skeleton } from '../../components/schedule/Skeleton'

export default function Schedule() {
  const { t } = useTranslation()
  const router = useRouter()
  const {
    groupedByDay, isLoading,
    activityFilter, setActivityFilter,
    weekFilter, setWeekFilter,
    coachFilter, setCoachFilter,
    resetFilters, hasActiveFilters, coaches, refetch,
  } = useSchedule()
  const { favorites, addFavorite, removeFavorite, isFavorite } = useBookingStore()
  const [refreshing, setRefreshing] = useState(false)

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await refetch()
    setRefreshing(false)
  }, [refetch])

  const toggleFav = useCallback(
    (slot: ScheduleSlot) => {
      const input = { activityId: slot.activityId, startsAt: slot.startsAt }
      if (isFavorite(input)) removeFavorite(input)
      else addFavorite(input)
    },
    [isFavorite, addFavorite, removeFavorite],
  )

  const renderItem = useCallback(
    ({ item }: { item: ScheduleSlot }) => (
      <SlotListCard
        slot={item}
        isFavorite={isFavorite({ activityId: item.activityId, startsAt: item.startsAt })}
        onToggleFavorite={() => toggleFav(item)}
        onPress={() => {
          router.push({
            pathname: '/session/[id]',
            params: {
              id: item.id,
              activity: item.activity,
              date: item.date,
              time: item.time,
              endTime: item.endTime,
              coach: item.coach,
              duration: String(item.duration),
              capacity: String(item.capacity),
              booked: String(item.booked),
            },
          })
        }}
      />
    ),
    [favorites, toggleFav],
  )

  const renderSectionHeader = useCallback(
    ({ section }: { section: DaySection }) => <SectionHeader date={section.date} />,
    [],
  )

  const keyExtractor = useCallback((item: ScheduleSlot) => item.id, [])

  return (
    <SafeAreaView className="flex-1 bg-move-dark" edges={['top']}>
      {/* Header */}
      <View className="bg-move-dark px-5 pb-4 pt-3">
        <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 32, color: '#FFFFFF' }}>
          {t('schedule.title').toUpperCase()}
        </Text>
        <Text className="font-dmsans text-[13px] text-white/40">
          {t('schedule.subtitle')}
        </Text>
      </View>

      <View className="flex-1 bg-move-bg">
        {/* Filters */}
        <FilterPills
          activityFilter={activityFilter}
          weekFilter={weekFilter}
          coachFilter={coachFilter}
          coaches={coaches}
          onActivityChange={setActivityFilter}
          onWeekChange={setWeekFilter}
          onCoachChange={setCoachFilter}
        />

        {/* List */}
        {isLoading ? (
          <Skeleton />
        ) : groupedByDay.length === 0 && hasActiveFilters ? (
          <EmptySchedule onReset={resetFilters} />
        ) : (
          <SectionList
            sections={groupedByDay}
            renderItem={renderItem}
            renderSectionHeader={renderSectionHeader}
            keyExtractor={keyExtractor}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
            stickySectionHeadersEnabled
            windowSize={5}
            maxToRenderPerBatch={10}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#C8F000" />
            }
          />
        )}
      </View>
    </SafeAreaView>
  )
}
