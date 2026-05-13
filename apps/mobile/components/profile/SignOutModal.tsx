import { View, Text, TouchableOpacity, Modal } from 'react-native'
import { useTranslation } from 'react-i18next'
import { LogOut } from 'lucide-react-native'

interface SignOutModalProps {
  visible: boolean
  onConfirm: () => void
  onClose: () => void
}

export function SignOutModal({ visible, onConfirm, onClose }: SignOutModalProps) {
  const { t } = useTranslation()

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View className="flex-1 justify-end bg-black/40">
        <View className="rounded-t-3xl bg-move-card px-6 pb-10 pt-8">
          <View className="items-center">
            <View className="mb-3 h-14 w-14 items-center justify-center rounded-2xl bg-red-50">
              <LogOut size={24} color="#EF4444" />
            </View>
            <Text className="font-barlow text-xl uppercase text-move-dark">
              {t('profile.logout_title')}
            </Text>
          </View>

          <View className="mt-6 gap-3">
            <TouchableOpacity
              onPress={onConfirm}
              activeOpacity={0.8}
              className="items-center rounded-2xl bg-red-500 py-4"
            >
              <Text className="font-dmsans-bold text-sm text-white">
                {t('profile.logout_confirm')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} activeOpacity={0.7} className="items-center py-3">
              <Text className="font-dmsans text-sm text-move-text-secondary">
                {t('profile.logout_cancel')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}
