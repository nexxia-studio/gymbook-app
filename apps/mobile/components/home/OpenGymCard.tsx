// GYM-228 (volet 5) — Carte AGRÉGÉE d'une activité en accès libre, pour une journée.
//
// La génération produit 14 créneaux Open Gym par jour. Sans cette carte, /accueil
// afficherait quatorze cartes avant le premier vrai cours.
//
// ⚠️ VARIANTE DE SessionCard, PAS UN COMPOSANT ÉTRANGER. Même ActivityImage en h-44, même
// dégradé, même bloc titre en bas à gauche, même pied à trois colonnes (libellé / badge de
// places / bouton). Seul le CONTENU change : l'amplitude remplace l'horaire du créneau, et
// le bouton déplie les créneaux au lieu d'ouvrir une fiche. Un membre doit reconnaître la
// même famille de cartes en descendant sa journée.
//
// ⚠️ ON AFFICHE L'AMPLITUDE, PAS LE DÉCOMPTE (décision produit, 18/08). « 14 créneaux » ne
// dit rien à un membre : il se demande « à quelle heure puis-je venir ». D'où « de 7h à 22h ».
//
// ⚠️ PAS DE CŒUR SUR CETTE CARTE. Un favori porte sur (activité, horaire de début) : il n'a
// pas de sens sur une amplitude. Les favoris se posent créneau par créneau, depuis la fiche
// — inchangés, comme les réservations et l'historique. On agrège l'OFFRE, jamais le reste.
import { useState } from 'react'
import { View, Text, Pressable } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { ChevronDown } from 'lucide-react-native'
import { LinearGradient } from './Gradient'
import { OpenGymAvailability } from '../schedule/OpenGymAvailability'
import { ActivityImage } from '../shared/ActivityImage'
import { WeekSlots } from '../session/WeekSlots'
import { resolveActivityIcon } from '../../lib/activityIcons'
import { availableSlotCount, formatAmplitudeHour, type OpenGymGroup } from '../../lib/openGymGroup'
import type { HomeSlot } from '../../hooks/useHomeSchedule'

interface OpenGymCardProps {
  group: OpenGymGroup<HomeSlot>
  /** Ouvre la fiche du créneau choisi — c'est là que la réservation se fait. */
  onSelectSlot: (slot: HomeSlot) => void
}

export function OpenGymCard({ group, onSelectSlot }: OpenGymCardProps) {
  const { t } = useTranslation()
  const { tokens } = useTheme()
  const [expanded, setExpanded] = useState(false)

  // Les créneaux d'un groupe partagent la même activité : le premier porte donc l'image,
  // l'icône et la couleur de toute la carte (GYM-216 / GYM-220).
  const first = group.slots[0]
  const Icon = resolveActivityIcon(first.icon)

  // Places CUMULÉES sur la journée, dans le badge habituel des cartes. C'est la question du
  // membre — « est-ce qu'il reste de la place aujourd'hui ? » — là où un ratio par créneau
  // n'a plus de sens une fois agrégé.
  // GYM-242 — CRÉNEAUX DISPONIBLES, plus la somme des capacités. « 60 places » était le
  // total de créneaux INDÉPENDANTS : un membre ne peut en réserver qu'un, à 8 places.
  // Le calcul est partagé (lib/openGymGroup) et reprend le prédicat des cartes normales.
  const available = availableSlotCount(group.slots)

  return (
    <View className="mb-4 overflow-hidden rounded-2xl shadow-sm" style={{ backgroundColor: tokens.surface }}>
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${group.activity} — ${t('open_gym.range', {
          from: formatAmplitudeHour(group.from),
          to: formatAmplitudeHour(group.to),
        })}`}
        style={({ pressed }) => [{ opacity: pressed ? 0.92 : 1 }]}
      >
        <ActivityImage
          imageUrl={first.imageUrl}
          activity={group.activity}
          accentColor={first.activityColor}
          className="h-44"
          imageStyle={{ borderTopLeftRadius: 16, borderTopRightRadius: 16 }}
          initialsSize={120}
        >
          <LinearGradient />

          <View className="absolute bottom-3 left-4">
            <View className="flex-row items-center gap-2">
              <Icon size={18} color={tokens.onBackground} />
              <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 22, color: tokens.onBackground }}>
                {group.activity.toUpperCase()}
              </Text>
            </View>
            {/* Là où SessionCard écrit le nom du coach : une activité en accès libre n'en a
                pas (GYM-229). La ligne dit ce qui la remplace plutôt que de rester vide. */}
            <Text className="mt-0.5 font-dmsans text-[13px] text-white/60">
              {t('open_gym.free_access')}
            </Text>
          </View>
        </ActivityImage>

        {/* Pied — même structure que SessionCard : libellé, badge de places, bouton. */}
        <View className="flex-row items-center px-4 py-3">
          <View className="flex-1">
            {/* L'AMPLITUDE, calculée sur les créneaux réellement présents : si les cours du
                soir ont fait sauter l'Open Gym après 17 h, on annonce 17 h. Promettre une
                heure sans créneau enverrait le membre devant une porte fermée. */}
            <Text className="font-dmsans-bold text-sm" style={{ color: tokens.onSurface }}>
              {t('open_gym.range', {
                from: formatAmplitudeHour(group.from),
                to: formatAmplitudeHour(group.to),
              })}
            </Text>
            <Text className="font-dmsans text-xs" style={{ color: tokens.onBackgroundMuted }}>
              {t('open_gym.choose_slot')}
            </Text>
          </View>

          <View className="mx-3">
            <OpenGymAvailability available={available} />
          </View>

          {/* 🔴 GYM-286 — A-3/A-4, EN ATTENTE : `bg-move-dark` + `text-move-accent`,
              chevron lime compris — c'est la même paire. */}
          <View style={{ backgroundColor: tokens.actionBg }} className="flex-row items-center gap-1 rounded-lg px-3 py-2.5">
            <Text style={{ color: tokens.onAction }} className="font-dmsans-bold text-xs">
              {expanded ? t('open_gym.hide') : t('open_gym.show')}
            </Text>
            <View style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}>
              <ChevronDown size={14} color="#C8F000" />
            </View>
          </View>
        </View>
      </Pressable>

      {/* LES CRÉNEAUX, AU CLIC — via WeekSlots, le bloc « AUTRES CRÉNEAUX » de la fiche de
          cours. Motif réutilisé tel quel : même bande horizontale, même traitement du
          complet, même zone tactile. Choisir un créneau ouvre SA fiche, où la réservation
          se fait par le chemin habituel — on n'introduit aucun second parcours d'achat. */}
      {expanded && (
        <View className="border-t" style={{ borderColor: tokens.border }}>
          <WeekSlots
            slots={group.slots.map((s) => ({
              id: s.id,
              date: s.date,
              time: s.time,
              // Le jour est déjà celui de la carte : afficher la FIN plutôt que répéter la
              // date, c'est l'information qui manque pour choisir son créneau.
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
