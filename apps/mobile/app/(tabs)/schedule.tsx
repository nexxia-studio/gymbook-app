import { useCallback, useState } from 'react'
import { View, Text, SectionList, RefreshControl } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useSchedule, type DaySection, type ScheduleSlot } from '../../hooks/useSchedule'
import type { DayEntry } from '../../lib/openGymGroup'
import { useBookingStore } from '../../stores/useBookingStore'
import { FilterPills } from '../../components/schedule/FilterPills'
import { SlotListCard } from '../../components/schedule/SlotListCard'
import { OpenGymListCard } from '../../components/schedule/OpenGymListCard'
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
    resetFilters, hasActiveFilters, coaches, activities, refetch,
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

  // Un seul chemin vers la fiche de créneau, qu'on y arrive par une ligne de cours ou par
  // un créneau déplié d'une carte d'accès libre : la réservation ne doit avoir qu'un
  // parcours.
  const openSlot = useCallback(
    (slot: ScheduleSlot) => {
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
    },
    [router],
  )

  // GYM-228 — une entrée de liste est soit un cours, soit UNE carte pour tous les créneaux
  // d'accès libre du jour. Sans ce regroupement, les 14 créneaux Open Gym générés
  // quotidiennement repousseraient le premier vrai cours hors de l'écran.
  const renderItem = useCallback(
    ({ item }: { item: DayEntry<ScheduleSlot> }) =>
      item.kind === 'openGym' ? (
        <OpenGymListCard group={item.group} onSelectSlot={openSlot} />
      ) : (
        <SlotListCard
          slot={item.slot}
          isFavorite={isFavorite({ activityId: item.slot.activityId, startsAt: item.slot.startsAt })}
          onToggleFavorite={() => toggleFav(item.slot)}
          onPress={() => openSlot(item.slot)}
        />
      ),
    [favorites, toggleFav, openSlot, isFavorite],
  )

  const renderSectionHeader = useCallback(
    ({ section }: { section: DaySection }) => <SectionHeader date={section.date} />,
    [],
  )

  const keyExtractor = useCallback(
    (item: DayEntry<ScheduleSlot>) => (item.kind === 'openGym' ? item.group.key : item.slot.id),
    [],
  )

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
          activities={activities}
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
