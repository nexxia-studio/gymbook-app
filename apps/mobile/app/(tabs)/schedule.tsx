import { useCallback, useMemo, useState } from 'react'
import { View, Text, SectionList, RefreshControl } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useSchedule, type DaySection, type ScheduleSlot } from '../../hooks/useSchedule'
import type { DayEntry } from '../../lib/openGymGroup'
import { useBookingStore } from '../../stores/useBookingStore'
// GYM-242 — les deux rangées de pastilles deviennent une ligne + une feuille modale.
import { FilterBar } from '../../components/schedule/FilterBar'
import { FilterSheet } from '../../components/schedule/FilterSheet'
import { SlotListCard } from '../../components/schedule/SlotListCard'
import { OpenGymListCard } from '../../components/schedule/OpenGymListCard'
import { SectionHeader } from '../../components/schedule/SectionHeader'
import { EmptySchedule } from '../../components/schedule/EmptySchedule'
import { Skeleton } from '../../components/schedule/Skeleton'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { useGymHeaderName } from '../../hooks/useGymName'

export default function Schedule() {
  // GYM-299 — en-tête : le nom COURT s'il existe, sinon le complet.
  const nomSalle = useGymHeaderName()
  const { tokens } = useTheme()
  const { t } = useTranslation()
  const router = useRouter()
  const {
    groupedByDay, filteredSlots, isLoading,
    activityFilters, toggleActivity,
    coachFilters, toggleCoach,
    periodFilter, setPeriodFilter,
    laterAvailable,
    resetFilters, hasActiveFilters, activeFilterCount,
    coaches, activities, refetch,
  } = useSchedule()
  const [filtersOpen, setFiltersOpen] = useState(false)

  // Ce que le bouton de la feuille annonce : des COURS, pas des entrées de liste — une
  // carte Open Gym agrégée en représente plusieurs, l'annoncer comme un seul mentirait.
  const resultCount = useMemo(() => filteredSlots.length, [filteredSlots])
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
    <SafeAreaView className="flex-1" style={{ backgroundColor: tokens.background }} edges={['top']}>
      {/* Header */}
      <View className="px-5 pb-4 pt-3" style={{ backgroundColor: tokens.background }}>
        <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 32, color: tokens.onBackground }}>
          {t('schedule.title').toUpperCase()}
        </Text>
        {/* GYM-297 — le nom de la salle ACTIVE. Il venait de `schedule.subtitle`,
            c'est-à-dire d'un fichier de TRADUCTION : l'endroit le plus improbable où
            chercher le nom d'un client, et celui où personne ne pense à le corriger. */}
        {/* 🔴 GYM-300 (3c) — ENCRE RÉSOLUE, OPACITÉ CONSERVÉE. `text-white/40` était un
            BLANC EN DUR : illisible dès que la salle a un fond clair, et l'en-tête de
            Studio Test le montrait — le nom de la salle disparaissait purement et
            simplement de sa propre bande.

            ⚠️ ET `onBackgroundMuted` N'AURAIT PAS FAIT L'AFFAIRE. Chez Dopamine il vaut
            #9A9890, alors qu'un blanc à 40 % sur #111111 rend #707070 : le
            remplacement direct aurait déplacé un pixel en single, ce que le cadrage
            interdit. `tokens.onBackground + '66'` rend EXACTEMENT le blanc à 40 % chez
            Dopamine (0x66 = 102, soit 102/255 = 0,40 pile), et l'encre de la salle
            ailleurs. C'est le motif A-10 de GYM-286 : on migre la teinte, on ne touche
            pas à l'alpha.

            ⚠️ ALPHA SUR LA COULEUR, PAS `opacity` SUR L'ÉLÉMENT — les deux rendent
            pareil ICI, mais `opacity` s'applique à toute la descendance : le jour où ce
            `Text` accueille une icône ou un second fragment, elle les délaverait aussi.
            L'alpha dans la couleur ne teinte que ce qu'elle colore. */}
        <Text
          className="font-dmsans text-[13px]"
          style={{ color: tokens.onBackground + '66' }}
        >
          {nomSalle}
        </Text>
      </View>

      <View className="flex-1" style={{ backgroundColor: tokens.page }}>
        {/* GYM-242 — une seule ligne dans l'écran ; tout le reste vit dans la feuille. */}
        <FilterBar
          activeCount={activeFilterCount}
          resultCount={resultCount}
          onPress={() => setFiltersOpen(true)}
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
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={tokens.accent} />
            }
          />
        )}
      </View>

      <FilterSheet
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        activities={activities}
        coaches={coaches}
        activityFilters={activityFilters}
        coachFilters={coachFilters}
        periodFilter={periodFilter}
        laterAvailable={laterAvailable}
        resultCount={resultCount}
        onToggleActivity={toggleActivity}
        onToggleCoach={toggleCoach}
        onPeriodChange={setPeriodFilter}
        onReset={resetFilters}
        hasActiveFilters={hasActiveFilters}
      />
    </SafeAreaView>
  )
}
