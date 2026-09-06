import { useState, useRef, useCallback } from 'react'
import { View, Text, ScrollView, RefreshControl } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Bell } from 'lucide-react-native'
import { DayTabs } from '../../components/home/DayTabs'
import { SessionCard } from '../../components/home/SessionCard'
import { OpenGymCard } from '../../components/home/OpenGymCard'
import { EmptyDayState } from '../../components/home/EmptyDayState'
import { useHomeSchedule, type HomeSlot } from '../../hooks/useHomeSchedule'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { SEMANTIC } from '../../lib/theme/semantic'
import { useGymNameLines } from '../../hooks/useGymName'
// GYM-300 — l'avis de réconciliation. Rend `null` en single : rien n'est monté de plus.
import { useActiveGymNotice, useNotMemberRedirect } from '../../hooks/useActiveGymNotice'
import { InScreenBanner } from '../../components/ui/InScreenBanner'

export default function Home() {
  const { marque, descriptif } = useGymNameLines()
  const { message: avisSalle, dismiss: fermerAvisSalle } = useActiveGymNotice()
  // GYM-301 (2) — `not_member` a son écran ; l'accueil ne fait que l'ouvrir.
  useNotMemberRedirect()
  const { tokens } = useTheme()
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

  // Un seul chemin vers la fiche de créneau, qu'on y arrive par une carte de cours ou par
  // un créneau déplié d'une carte d'accès libre : la réservation ne doit avoir qu'un
  // parcours.
  const openSlot = useCallback(
    (slot: HomeSlot) => {
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

  function formatStickyLabel(date: Date): string {
    const dayName = dayLabels[date.getDay()] ?? ''
    const day = date.getDate()
    const month = months[date.getMonth()] ?? ''
    return `${dayName} ${day} ${month}`.toUpperCase()
  }

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: tokens.background }} edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 pb-3 pt-2" style={{ backgroundColor: tokens.background }}>
        {/* GYM-297 — LE NOM DE LA SALLE ACTIVE, PLUS « DOPAMINE » EN DUR. Le découpage en
            deux lignes reproduit la composition existante (voir hooks/useGymName.ts) : chez
            Dopamine le rendu est identique au pixel, chez une autre salle c'est son nom qui
            s'affiche. Un nom d'un seul mot ne rend pas de seconde ligne — pas de ligne vide
            (règle GYM-229). */}
        <View>
          <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 24, color: tokens.onBackground }}>
            {marque.toUpperCase()}
          </Text>
          {/* 🔴 GYM-300 (3c) — ENCRE RÉSOLUE, OPACITÉ CONSERVÉE. `text-white/40` était un
              BLANC EN DUR : illisible dès que la salle a un fond clair, et l'en-tête de
              Studio Test le montrait — le nom de la salle disparaissait purement et
              simplement de sa propre bande.

              ⚠️ ET `onBackgroundMuted` N'AURAIT PAS FAIT L'AFFAIRE. Chez Dopamine il vaut
              #9A9890, alors qu'un blanc à 40 % sur #111111 rend #707070 : le
              remplacement direct aurait déplacé un pixel en single, ce que le cadrage
              interdit. `tokens.onBackground` + la MÊME opacité 0,4 rend exactement le
              blanc à 40 % chez Dopamine, et l'encre de la salle ailleurs. C'est le motif
              A-10 de GYM-286 : on migre la teinte, on ne touche pas à l'alpha. */}
          {descriptif ? (
            <Text
              className="font-dmsans text-[11px]"
              style={{ color: tokens.onBackground + '66' }}
            >
              {descriptif}
            </Text>
          ) : null}
        </View>
        <View className="relative">
          <Bell size={22} color={tokens.onBackground} />
          <View className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: SEMANTIC.danger }} />
        </View>
      </View>

      {/* Day tabs */}
      <View style={{ backgroundColor: tokens.page }}>
        <DayTabs days={days} activeIndex={activeDay} onSelect={handleDaySelect} />
      </View>

      {/* Content */}
      <ScrollView
        ref={scrollRef}
        className="flex-1"
        style={{ backgroundColor: tokens.page }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={tokens.accent} />
        }
      >
        {scheduleByDay.map(({ date, slots, entries }, dayIndex) => {
          const isSunday = date.getDay() === 0

          // Only show the active day and others below for scrolling
          if (dayIndex < activeDay) return null

          return (
            <View key={dayIndex} className="mb-2">
              {/* Day label */}
              <Text className="mb-3 mt-4 font-dmsans-bold text-[11px] uppercase tracking-wider" style={{ color: tokens.onBackgroundMuted }}>
                {formatStickyLabel(date)}
              </Text>

              {/* Slots or empty */}
              {/* GYM-228 — on rend des ENTRÉES : soit un cours, soit UNE carte pour tous
                  les créneaux d'accès libre du jour. L'ordre chronologique est préservé
                  par le regroupement lui-même (le groupe prend la place de son premier
                  créneau), donc rien à retrier ici. L'état vide continue de raisonner sur
                  `slots` : une journée sans créneau reste une journée sans créneau. */}
              {slots.length === 0 ? (
                <EmptyDayState isSunday={isSunday} />
              ) : (
                entries.map((entry) =>
                  entry.kind === 'openGym' ? (
                    <OpenGymCard
                      key={entry.group.key}
                      group={entry.group}
                      onSelectSlot={openSlot}
                    />
                  ) : (
                    <SessionCard
                      key={entry.slot.id}
                      slot={entry.slot}
                      isFavorite={isFavorite(entry.slot)}
                      isBooked={isSlotBooked(entry.slot.id)}
                      isWaitlisted={isSlotWaitlisted(entry.slot.id)}
                      onToggleFavorite={() => toggleFavorite(entry.slot)}
                      onPress={() => openSlot(entry.slot)}
                    />
                  ),
                )
              )}
            </View>
          )
        })}
      </ScrollView>

      {/* ── 🔴 GYM-300 — L'ACCUEIL EST LE SEUL ENDROIT OÙ CE MESSAGE A UN SENS ─────────
          C'est ici que le membre atterrit après la réconciliation, et c'est ici qu'il
          constate le fait à expliquer : la marque et les données ne sont pas celles de la
          salle qu'il vient de choisir. Le dire sur l'écran de connexion serait trop tôt
          (rien n'est encore tranché), le dire dans le Profil trop tard.

          ⚠️ MONTÉ SEULEMENT S'IL Y A QUELQUE CHOSE À DIRE. `InScreenBanner` accepte bien
          `message={null}`, mais rend malgré tout une vue absolue invisible. En single il
          n'y a jamais d'avis : ne rien monter du tout est la seule façon de garantir que
          l'arbre de rendu de Dopamine est EXACTEMENT celui d'avant ce lot.

          Variante `success` — la sombre, pas la rouge. Ce n'est pas une erreur : le membre
          n'a rien raté, l'app a fait ce qu'il fallait. La rouge crierait à la panne. */}
      {avisSalle ? (
        <InScreenBanner message={avisSalle} onHide={fermerAvisSalle} anchor="bottom" />
      ) : null}
    </SafeAreaView>
  )
}
