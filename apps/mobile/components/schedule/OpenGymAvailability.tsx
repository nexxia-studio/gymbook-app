// GYM-242 — Le badge de la carte AGRÉGÉE : des créneaux, pas une somme de places.
//
// Il remplace `CapacityBadge` sur les seules cartes d'accès libre. CapacityBadge reste
// l'affichage des cartes de cours normales, où « 12 places » est l'information juste.
//
// TROIS ÉTATS, ET LE NOMBRE PLUTÔT QU'UN MOT : « Disponible » seul dirait qu'on peut
// venir, pas s'il reste huit fenêtres ou une seule — or c'est précisément ce qui fait
// décider un membre entre venir ce soir ou demain.
import { View, Text } from 'react-native'
import { useTranslation } from 'react-i18next'
import { SEMANTIC } from '../../lib/theme/semantic'

interface OpenGymAvailabilityProps {
  /** Créneaux du jour encore ouverts (cf. `availableSlotCount`). */
  available: number
}

/** Seuil du passage au ambre. En dessous, la journée se remplit et ça doit se voir. */
const TIGHT_THRESHOLD = 3

export function OpenGymAvailability({ available }: OpenGymAvailabilityProps) {
  const { t } = useTranslation()

  // ⚠️ MÊME CODE COULEUR QUE CapacityBadge (vert / ambre / rouge), pour que les deux
  // familles de cartes se lisent d'un même coup d'œil dans une liste qui les mélange.
  const full = available <= 0
  const tight = !full && available < TIGHT_THRESHOLD
  // Fonds : lavis à 10 %, aucun jeton ne les vaut — ils restent des classes.
  // GYM-286 — A-2, EN ATTENTE : `text-green-600` #16A34A n'est pas `SEMANTIC.success`.
  const bg = full ? 'bg-red-500/10' : tight ? 'bg-orange-500/10' : 'bg-green-500/10'
  // 🔴 GYM-290 (addendum, décision C) — le vert rejoint ses deux voisins du même ternaire,
  // qui étaient sémantiques depuis 286b. Un seul des trois restait en dur.
  const fg = full ? SEMANTIC.danger : tight ? SEMANTIC.warning : SEMANTIC.success

  return (
    <View className={`rounded-lg px-2.5 py-1 ${bg}`}>
      <Text className="font-dmsans-bold text-xs" style={{ color: fg }}>
        {full
          ? t('open_gym.full_day')
          : available === 1
            ? t('open_gym.slots_one')
            : t('open_gym.slots_left', { count: available })}
      </Text>
    </View>
  )
}
