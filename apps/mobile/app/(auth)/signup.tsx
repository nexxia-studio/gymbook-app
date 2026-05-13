import { View, Text } from 'react-native'
import { useTranslation } from 'react-i18next'

export default function Signup() {
  const { t } = useTranslation()

  return (
    <View className="flex-1 items-center justify-center bg-move-bg px-6">
      <Text className="font-barlow text-4xl uppercase text-move-dark">
        Move95
      </Text>
      <Text className="mt-4 font-dmsans text-base text-move-text-secondary">
        {t('auth.signup')}
      </Text>
    </View>
  )
}
