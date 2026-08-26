import { View, Text, TouchableOpacity, Modal } from 'react-native'
import { useTranslation } from 'react-i18next'
import { LogOut } from 'lucide-react-native'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { SEMANTIC } from '../../lib/theme/semantic'

interface SignOutModalProps {
  visible: boolean
  onConfirm: () => void
  onClose: () => void
}

export function SignOutModal({ visible, onConfirm, onClose }: SignOutModalProps) {
  const { t } = useTranslation()
  const { tokens } = useTheme()

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View className="flex-1 justify-end bg-black/40">
        <View className="rounded-t-3xl px-6 pb-10 pt-8" style={{ backgroundColor: tokens.surface }}>
          <View className="items-center">
            <View className="mb-3 h-14 w-14 items-center justify-center rounded-2xl bg-red-50">
              <LogOut size={24} color={SEMANTIC.danger} />
            </View>
            <Text className="font-barlow text-xl uppercase" style={{ color: tokens.onSurface }}>
              {t('profile.logout_title')}
            </Text>
          </View>

          <View className="mt-6 gap-3">
            <TouchableOpacity
              onPress={onConfirm}
              activeOpacity={0.8}
              className="items-center rounded-2xl py-4"
              style={{ backgroundColor: SEMANTIC.danger }}
            >
              <Text className="font-dmsans-bold text-sm" style={{ color: SEMANTIC.onDanger }}>
                {t('profile.logout_confirm')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} activeOpacity={0.7} className="items-center py-3">
              <Text className="font-dmsans text-sm" style={{ color: tokens.onSurfaceSecondary }}>
                {t('profile.logout_cancel')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}
