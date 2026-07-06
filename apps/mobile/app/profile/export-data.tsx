import { useCallback } from 'react'
import { View, Text, ScrollView, Pressable, Linking, Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ChevronLeft, Mail, Clock, User, CalendarCheck, CreditCard, Activity } from 'lucide-react-native'
import { useAuthStore } from '../../stores/useAuthStore'
import { SUPPORT_EMAIL, buildMailto } from '../../constants/support'

const DATA_ITEMS: Array<{ key: string; Icon: typeof User }> = [
  { key: 'identity', Icon: User },
  { key: 'bookings', Icon: CalendarCheck },
  { key: 'payments', Icon: CreditCard },
  { key: 'activity', Icon: Activity },
]

export default function ExportDataScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  const accountEmail = useAuthStore((s) => s.user?.email) ?? ''

  const handleRequest = useCallback(async () => {
    const subject = t('profile.export.mail_subject')
    const body = t('profile.export.mail_body', { email: accountEmail || '—' })
    const url = buildMailto(SUPPORT_EMAIL, subject, body)
    const canOpen = await Linking.canOpenURL(url)
    if (!canOpen) {
      Alert.alert(t('profile.export.no_mail_title'), t('profile.export.no_mail_message', { email: SUPPORT_EMAIL }))
      return
    }
    await Linking.openURL(url)
  }, [t, accountEmail])

  return (
    <SafeAreaView className="flex-1 bg-move-dark" edges={['top']}>
      <View className="flex-row items-center justify-between bg-move-dark px-5 pb-6 pt-3">
        <Pressable onPress={() => router.replace('/(tabs)/profile')} hitSlop={12}>
          <ChevronLeft size={24} color="#FFFFFF" />
        </Pressable>
        <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 24, color: '#FFFFFF', letterSpacing: 2 }}>
          {t('profile.export.title').toUpperCase()}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        className="flex-1 bg-move-bg"
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        <Text className="font-dmsans text-[13px] leading-6 text-move-text-secondary">
          {t('profile.export.intro')}
        </Text>

        {/* Données incluses */}
        <View className="rounded-2xl bg-move-card p-4">
          <Text className="mb-3 font-dmsans-bold text-xs uppercase tracking-wider text-move-text-muted">
            {t('profile.export.what_title')}
          </Text>
          {DATA_ITEMS.map((item, i) => (
            <View
              key={item.key}
              className={`flex-row items-center gap-3 py-2.5 ${i > 0 ? 'border-t border-move-border' : ''}`}
            >
              <item.Icon size={18} color="#6B6861" />
              <Text className="flex-1 font-dmsans text-sm text-move-dark">
                {t(`profile.export.what_${item.key}`)}
              </Text>
            </View>
          ))}
        </View>

        {/* Délai */}
        <View className="flex-row gap-2 rounded-xl border border-move-border bg-move-bg p-3">
          <Clock size={16} color="#9A9890" />
          <Text className="flex-1 font-dmsans text-xs leading-5 text-move-text-secondary">
            {t('profile.export.delay')}
          </Text>
        </View>

        {/* CTA mailto */}
        <Pressable
          onPress={handleRequest}
          className="mt-2 flex-row items-center justify-center gap-2 rounded-xl bg-move-dark py-4"
        >
          <Mail size={18} color="#C8F000" />
          <Text className="font-dmsans-bold text-sm text-white">
            {t('profile.export.button')}
          </Text>
        </Pressable>

        <Text className="text-center font-dmsans text-xs text-move-text-muted">
          {t('profile.export.recipient', { email: SUPPORT_EMAIL })}
        </Text>
      </ScrollView>
    </SafeAreaView>
  )
}
