// GYM-228 (volet 5) — Carte AGRÉGÉE d'une activité en accès libre, dans le planning.
//
// ⚠️ POURQUOI UN SECOND COMPOSANT, ET PAS OpenGymCard RÉUTILISÉE. Le planning ne rend pas
// les grandes cartes de l'accueil : il rend des LIGNES (SlotListCard) — bande de couleur,
// colonne d'heures, activité, badge de places. Y poser la carte à image de 176 px de haut
// romprait le rythme de la liste bien plus qu'elle ne l'unifierait. La cohérence demandée
// est celle de la carte VOISINE : ici, c'est SlotListCard qu'on décline, colonne par
// colonne. Le regroupement, lui, est partagé (lib/openGymGroup).
//
// ⚠️ PAS DE CŒUR. Un favori porte sur (activité, horaire de début) : il n'a pas de sens sur
// une amplitude. Il reste posable créneau par créneau depuis la fiche — favoris,
// réservations et historique sont inchangés. On agrège l'OFFRE, jamais le reste.
import { useState } from 'react'
import { View, Text, TouchableOpacity } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { ChevronDown } from 'lucide-react-native'
import { resolveActivityIcon } from '../../lib/activityIcons'
import { OpenGymAvailability } from './OpenGymAvailability'
import { WeekSlots } from '../session/WeekSlots'
import { availableSlotCount, formatAmplitudeHour, type OpenGymGroup } from '../../lib/openGymGroup'
import type { ScheduleSlot } from '../../hooks/useSchedule'

interface OpenGymListCardProps {
  group: OpenGymGroup<ScheduleSlot>
  /** Ouvre la fiche du créneau choisi — c'est là que la réservation se fait. */
  onSelectSlot: (slot: ScheduleSlot) => void
}

export function OpenGymListCard({ group, onSelectSlot }: OpenGymListCardProps) {
  const { t } = useTranslation()
  const { tokens } = useTheme()
  const [expanded, setExpanded] = useState(false)

  // Les créneaux d'un groupe partagent la même activité : le premier porte la couleur et
  // l'icône de toute la ligne (GYM-220).
  const first = group.slots[0]
  const Icon = resolveActivityIcon(first.icon)

  // Places CUMULÉES sur la journée — « reste-t-il de la place aujourd'hui ? ».
  // GYM-242 — CRÉNEAUX DISPONIBLES, plus la somme des capacités. « 60 places » était le
  // total de créneaux INDÉPENDANTS : un membre ne peut en réserver qu'un, à 8 places.
  // Le calcul est partagé (lib/openGymGroup) et reprend le prédicat des cartes normales.
  const available = availableSlotCount(group.slots)

  return (
    <View className="mb-2 overflow-hidden rounded-2xl" style={{ backgroundColor: tokens.surface }}>
      <TouchableOpacity
        onPress={() => setExpanded((v) => !v)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        className="flex-row items-center"
      >
        {/* Bande de couleur — comme SlotListCard */}
        <View className="w-1 self-stretch" style={{ backgroundColor: first.color }} />

        {/* Colonne d'heures : l'AMPLITUDE remplace l'horaire d'un créneau unique.
            Calculée sur les créneaux réellement présents — un jour dont tout est exclu
            après 17 h affiche 17 h, jamais l'heure de fermeture de la salle. */}
        <View className="w-16 items-center justify-center py-4">
          <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 20, color: tokens.onSurface }}>
            {formatAmplitudeHour(group.from)}
          </Text>
          <Text className="font-dmsans text-[11px]" style={{ color: tokens.onBackgroundMuted }}>
            {formatAmplitudeHour(group.to)}
          </Text>
        </View>

        {/* Activité + accès libre — là où SlotListCard écrit le coach, qu'une activité en
            accès libre n'a pas (GYM-229). */}
        <View className="flex-1 py-3">
          <View className="flex-row items-center gap-1.5">
            <Icon size={14} color={tokens.onSurface} />
            <Text className="font-dmsans-bold text-[15px]" style={{ color: tokens.onSurface }}>
              {group.activity}
            </Text>
          </View>
          <Text className="mt-0.5 font-dmsans text-[13px]" style={{ color: tokens.onSurfaceSecondary }}>
            {t('open_gym.free_access')}
          </Text>
        </View>

        <View className="flex-row items-center gap-2 pr-3">
          <OpenGymAvailability available={available} />
          <View style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}>
            <ChevronDown size={16} color={tokens.onBackgroundMuted} />
          </View>
        </View>
      </TouchableOpacity>

      {/* LES CRÉNEAUX, AU CLIC — WeekSlots, le bloc « AUTRES CRÉNEAUX » de la fiche de
          cours, réutilisé tel quel. Choisir un créneau ouvre SA fiche, où la réservation
          suit le chemin habituel. */}
      {expanded && (
        <View className="border-t" style={{ borderColor: tokens.border }}>
          <WeekSlots
            slots={group.slots.map((s) => ({
              id: s.id,
              date: s.date,
              time: s.time,
              dayLabel: `→ ${s.endTime}`,
              available: s.booked < s.capacity,
            }))}
            selectedId=""
            onSelect={(id) => {
              const slot = group.slots.find((s) => s.id === id)
              if (slot) onSelectSlot(slot)
            }}
          />
        </View>
      )}
    </View>
  )
}
