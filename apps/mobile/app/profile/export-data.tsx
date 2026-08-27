import { useCallback } from 'react'
import { View, Text, ScrollView, Pressable, Linking, Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ChevronLeft, Mail, Clock, User, CalendarCheck, CreditCard, Activity } from 'lucide-react-native'
import { useAuthStore } from '../../stores/useAuthStore'
import { SUPPORT_EMAIL, buildMailto } from '../../constants/support'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { useGymName } from '../../hooks/useGymName'

const DATA_ITEMS: Array<{ key: string; Icon: typeof User }> = [
  { key: 'identity', Icon: User },
  { key: 'bookings', Icon: CalendarCheck },
  { key: 'payments', Icon: CreditCard },
  { key: 'activity', Icon: Activity },
]

export default function ExportDataScreen() {
  const nomSalle = useGymName()
  const { tokens } = useTheme()
  const { t } = useTranslation()
  const router = useRouter()
  const accountEmail = useAuthStore((s) => s.user?.email) ?? ''

  const handleRequest = useCallback(async () => {
    // GYM-297 — le nom de la salle ACTIVE dans l'objet du mail. Il valait « Dopamine » en
    // dur dans les deux locales : un membre d'une autre salle envoyait à son gérant une
    // demande d'export intitulée du nom d'un club concurrent.
    const subject = t('profile.export.mail_subject', { gym: nomSalle })
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
    <SafeAreaView className="flex-1" style={{ backgroundColor: tokens.background }} edges={['top']}>
      <View className="flex-row items-center justify-between px-5 pb-6 pt-3" style={{ backgroundColor: tokens.background }}>
        <Pressable onPress={() => router.replace('/(tabs)/profile')} hitSlop={12}>
          <ChevronLeft size={24} color={tokens.onBackground} />
        </Pressable>
        <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 24, color: tokens.onBackground, letterSpacing: 2 }}>
          {t('profile.export.title').toUpperCase()}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        className="flex-1"
        style={{ backgroundColor: tokens.page }}
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        <Text className="font-dmsans text-[13px] leading-6" style={{ color: tokens.onSurfaceSecondary }}>
          {t('profile.export.intro')}
        </Text>

        {/* Données incluses */}
        <View className="rounded-2xl p-4" style={{ backgroundColor: tokens.surface }}>
          <Text className="mb-3 font-dmsans-bold text-xs uppercase tracking-wider" style={{ color: tokens.onBackgroundMuted }}>
            {t('profile.export.what_title')}
          </Text>
          {DATA_ITEMS.map((item, i) => (
            <View
              key={item.key}
              className={`flex-row items-center gap-3 py-2.5 ${i > 0 ? 'border-t' : ''}`}
              style={i > 0 ? { borderColor: tokens.border } : undefined}
            >
              <item.Icon size={18} color={tokens.onSurfaceSecondary} />
              <Text className="flex-1 font-dmsans text-sm" style={{ color: tokens.onSurface }}>
                {t(`profile.export.what_${item.key}`)}
              </Text>
            </View>
          ))}
        </View>

        {/* Délai */}
        <View className="flex-row gap-2 rounded-xl border p-3" style={{ borderColor: tokens.border, backgroundColor: tokens.page }}>
          <Clock size={16} color={tokens.onBackgroundMuted} />
          <Text className="flex-1 font-dmsans text-xs leading-5" style={{ color: tokens.onSurfaceSecondary }}>
            {t('profile.export.delay')}
          </Text>
        </View>

        {/* CTA mailto */}
        {/* 🔴 GYM-286 — A-3/A-4, EN ATTENTE. Un fond `bg-move-dark` sur un BOUTON vaudrait
            celui de la page en mode multi (1,00:1) : le bouton disparaîtrait. Le motif
            nommé par le cockpit est `bg-move-dark` + `text-move-accent` ; celui-ci porte
            un libellé BLANC et subit pourtant le même effacement. Le blocage suit le
            PRINCIPE confirmé, pas la seule forme nommée. */}
        <Pressable
          onPress={handleRequest}
          style={{ backgroundColor: tokens.actionBg }} className="mt-2 flex-row items-center justify-center gap-2 rounded-xl py-4"
        >
          <Mail size={18} color="#C8F000" />
          <Text className="font-dmsans-bold text-sm text-white">
            {t('profile.export.button')}
          </Text>
        </Pressable>

        <Text className="text-center font-dmsans text-xs" style={{ color: tokens.onBackgroundMuted }}>
          {t('profile.export.recipient', { email: SUPPORT_EMAIL })}
        </Text>
      </ScrollView>
    </SafeAreaView>
  )
}
