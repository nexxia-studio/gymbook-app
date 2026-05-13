import { View, Text, TouchableOpacity, Modal } from 'react-native'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react-native'

interface CancelModalProps {
  visible: boolean
  isLate: boolean
  onConfirm: () => void
  onClose: () => void
}

export function CancelModal({ visible, isLate, onConfirm, onClose }: CancelModalProps) {
  const { t } = useTranslation()

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View className="flex-1 justify-end bg-black/40">
        <View className="rounded-t-3xl bg-move-card px-6 pb-10 pt-8">
          <View className="items-center">
            <View className="mb-3 h-14 w-14 items-center justify-center rounded-2xl bg-red-50">
              <AlertTriangle size={28} color="#EF4444" />
            </View>
            <Text className="font-barlow text-xl uppercase text-move-dark">
              {t('session.cancel_title')}
            </Text>
          </View>

          {isLate && (
            <View className="mt-4 rounded-xl bg-orange-50 px-4 py-3">
              <Text className="text-center font-dmsans-bold text-xs text-orange-600">
                {t('session.cancel_late_warning')}
              </Text>
            </View>
          )}

          <View className="mt-6 gap-3">
            <TouchableOpacity
              onPress={onConfirm}
              activeOpacity={0.8}
              className="items-center rounded-2xl bg-red-500 py-4"
            >
              <Text className="font-dmsans-bold text-sm text-white">
                {t('session.cancel_confirm')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={onClose} activeOpacity={0.7} className="items-center py-3">
              <Text className="font-dmsans text-sm text-move-text-secondary">
                {t('session.cancel_keep')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}
