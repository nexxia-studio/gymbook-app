import { View, Text, TouchableOpacity, Modal } from 'react-native'
import { useTranslation } from 'react-i18next'
import { AlertCircle } from 'lucide-react-native'

interface MaxBookingsModalProps {
  visible: boolean
  onViewBookings: () => void
  onClose: () => void
}

export function MaxBookingsModal({ visible, onViewBookings, onClose }: MaxBookingsModalProps) {
  const { t } = useTranslation()

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View className="flex-1 justify-end bg-black/40">
        <View className="rounded-t-3xl bg-move-card px-6 pb-10 pt-8">
          <View className="items-center">
            <AlertCircle size={48} color="#F97316" />

            <Text className="mt-4 font-barlow text-2xl uppercase text-move-dark">
              {t('session.max_bookings_title')}
            </Text>

            <Text className="mt-3 text-center font-dmsans text-sm leading-relaxed text-move-text-secondary">
              {t('session.max_bookings_message')}
            </Text>
          </View>

          <View className="mt-8 gap-3">
            <TouchableOpacity
              onPress={onViewBookings}
              activeOpacity={0.8}
              className="items-center rounded-2xl bg-move-dark py-4"
            >
              <Text className="font-dmsans-bold text-sm text-move-accent">
                {t('session.view_bookings')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={onClose} activeOpacity={0.7} className="items-center py-3">
              <Text className="font-dmsans text-sm text-move-text-muted">
                {t('planning.close')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}
