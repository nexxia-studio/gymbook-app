import { View, Text, TouchableOpacity, Modal } from 'react-native'
import { useTranslation } from 'react-i18next'
import { AlertCircle } from 'lucide-react-native'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { SEMANTIC } from '../../lib/theme/semantic'

interface MaxBookingsModalProps {
  visible: boolean
  /**
   * GYM-196 — limite communiquée par le serveur avec l'erreur MAX_BOOKINGS_REACHED.
   * Elle est configurable par salle : ne JAMAIS la coder en dur ici. Absente (ancienne
   * version du serveur), on retombe sur un message sans chiffre plutôt que d'en inventer un.
   */
  limit?: number
  onViewBookings: () => void
  onClose: () => void
}

export function MaxBookingsModal({ visible, limit, onViewBookings, onClose }: MaxBookingsModalProps) {
  const { t } = useTranslation()
  const { tokens } = useTheme()

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View className="flex-1 justify-end bg-black/40">
        <View className="rounded-t-3xl px-6 pb-10 pt-8" style={{ backgroundColor: tokens.surface }}>
          <View className="items-center">
            <AlertCircle size={48} color={SEMANTIC.warning} />

            <Text className="mt-4 font-barlow text-2xl uppercase" style={{ color: tokens.onSurface }}>
              {t('session.max_bookings_title')}
            </Text>

            <Text className="mt-3 text-center font-dmsans text-sm leading-relaxed" style={{ color: tokens.onSurfaceSecondary }}>
              {limit
                ? t('session.max_bookings_message', { count: limit })
                : t('session.max_bookings_message_generic')}
            </Text>
          </View>

          <View className="mt-8 gap-3">
            {/* 🔴 GYM-286 — A-3/A-4, EN ATTENTE. Le bouton primaire de Dopamine
                (`bg-move-dark` + `text-move-accent`) reste en dur : en mode multi son
                fond vaudrait celui de la page, 1,00:1, invisible. Voir Button.tsx. */}
            <TouchableOpacity
              onPress={onViewBookings}
              activeOpacity={0.8}
              style={{ backgroundColor: tokens.actionBg }} className="items-center rounded-2xl py-4"
            >
              <Text style={{ color: tokens.onAction }} className="font-dmsans-bold text-sm">
                {t('session.view_bookings')}
              </Text>
            </TouchableOpacity>

            {/* GYM-220 — pointait vers la clé « planning.close », INEXISTANTE : la
                section `planning` ne porte que des statuts. i18next rendait la clé brute,
                « planning.close », sur le bouton — visible par tout membre atteignant
                sa limite de réservations (GYM-196). `common.close` existe dans les deux
                locales et sert déjà ce rôle exact dans PaymentRequiredSheet. */}
            <TouchableOpacity onPress={onClose} activeOpacity={0.7} className="items-center py-3">
              <Text className="font-dmsans text-sm" style={{ color: tokens.onBackgroundMuted }}>
                {t('common.close')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}
