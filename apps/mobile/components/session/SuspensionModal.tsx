import { View, Text, TouchableOpacity, Modal, Linking } from 'react-native'
import { useTranslation } from 'react-i18next'
import { ShieldAlert } from 'lucide-react-native'
import { toLocalTime } from '../../utils/timezone'
import { useGymProfile } from '../../hooks/useGymProfile'

interface SuspensionModalProps {
  visible: boolean
  suspendedUntil: string | null
  onClose: () => void
}

export function SuspensionModal({ visible, suspendedUntil, onClose }: SuspensionModalProps) {
  const { t } = useTranslation()
  // GYM-216 — nom et email de contact lus dans nexxia_gyms. L'email était écrit en dur
  // (contact@dopamineclub.be) : au white-label, un membre suspendu d'une autre salle
  // aurait écrit à Dopamine.
  const gym = useGymProfile()

  const deadline = suspendedUntil ? toLocalTime(suspendedUntil) : null
  const hoursLeft = deadline
    ? Math.max(0, Math.ceil((deadline.getTime() - Date.now()) / (1000 * 60 * 60)))
    : 0

  const message = deadline
    ? t('session.suspended_message', {
        date: `${deadline.toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' })} \u00e0 ${deadline.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}`,
        hours: hoursLeft,
      })
    : t('session.suspended_message_generic')

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View className="flex-1 justify-end bg-black/40">
        <View className="rounded-t-3xl bg-move-card px-6 pb-10 pt-8">
          <View className="items-center">
            <ShieldAlert size={48} color="#EF4444" />

            <Text className="mt-4 font-barlow text-2xl uppercase text-move-dark">
              {t('session.suspended_title')}
            </Text>

            <Text className="mt-3 text-center font-dmsans text-sm leading-relaxed text-move-text-secondary">
              {message}
            </Text>
          </View>

          <View className="mt-8 gap-3">
            <TouchableOpacity
              onPress={onClose}
              activeOpacity={0.8}
              className="items-center rounded-2xl bg-move-dark py-4"
            >
              <Text className="font-dmsans-bold text-sm text-move-accent">
                {t('common.back')}
              </Text>
            </TouchableOpacity>

            {/* Repli : sans email en base, le bouton est MASQUÉ plutôt que d'ouvrir un
                mailto vers une adresse qui n'est peut-être plus relevée. Le membre garde
                le bouton Retour, et le message lui dit déjà de contacter son coach. */}
            {gym?.email && (
              <TouchableOpacity
                onPress={() => Linking.openURL(`mailto:${gym.email}`)}
                activeOpacity={0.7}
                className="items-center py-3"
              >
                <Text className="font-dmsans text-sm text-move-text-muted">
                  {t('session.contact_gym', { gym: gym.name ?? '' }).trim()}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  )
}
