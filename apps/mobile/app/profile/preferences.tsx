import { useState, useEffect, useCallback } from 'react'
import { View, Text, ScrollView, Pressable, Switch, Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Localization from 'expo-localization'
import { ChevronLeft, CheckCircle, Clock, Users, AlertTriangle, MessageCircle, Info, Check } from 'lucide-react-native'
import i18n from '../../lib/i18n'
import { supabase } from '../../lib/supabase'

type NotifKey =
  | 'push_booking' | 'push_reminder' | 'push_waitlist' | 'push_noshow'
  | 'email_booking' | 'email_reminder' | 'email_waitlist' | 'email_noshow'

type NotificationPreferences = Record<NotifKey, boolean>

const DEFAULT_PREFS: NotificationPreferences = {
  push_booking: true, push_reminder: true, push_waitlist: true, push_noshow: true,
  email_booking: true, email_reminder: true, email_waitlist: true, email_noshow: true,
}

type CategoryKey = 'booking' | 'reminder' | 'waitlist' | 'noshow'

const CATEGORIES: Array<{ key: CategoryKey; Icon: typeof CheckCircle }> = [
  { key: 'booking', Icon: CheckCircle },
  { key: 'reminder', Icon: Clock },
  { key: 'waitlist', Icon: Users },
  { key: 'noshow', Icon: AlertTriangle },
]

type Language = 'fr' | 'en'

function detectDeviceLanguage(): Language {
  const code = Localization.getLocales()[0]?.languageCode ?? 'fr'
  return code.startsWith('fr') ? 'fr' : 'en'
}

export default function PreferencesScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  const [prefs, setPrefs] = useState<NotificationPreferences>(DEFAULT_PREFS)
  const [language, setLanguage] = useState<Language>('fr')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('profiles')
        .select('notification_preferences, preferred_language')
        .eq('id', user.id)
        .single()
      if (data) {
        setPrefs({ ...DEFAULT_PREFS, ...(data.notification_preferences as Partial<NotificationPreferences>) })
        const savedLang = data.preferred_language as Language | null
        if (savedLang === 'fr' || savedLang === 'en') {
          setLanguage(savedLang)
        } else {
          const detected = detectDeviceLanguage()
          setLanguage(detected)
          await supabase.from('profiles').update({ preferred_language: detected }).eq('id', user.id)
          i18n.changeLanguage(detected)
        }
      }
      setLoading(false)
    })()
  }, [])

  const updatePref = useCallback(async (key: NotifKey, value: boolean) => {
    const next = { ...prefs, [key]: value }
    setPrefs(next)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { error } = await supabase
      .from('profiles')
      .update({ notification_preferences: next })
      .eq('id', user.id)
    if (error) {
      setPrefs(prefs)
      Alert.alert(t('preferences.save_error'))
    }
  }, [prefs, t])

  const handleLanguageChange = useCallback(async (code: Language) => {
    if (code === language) return
    const previous = language
    setLanguage(code)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { error } = await supabase
      .from('profiles')
      .update({ preferred_language: code })
      .eq('id', user.id)
    if (error) {
      setLanguage(previous)
      Alert.alert(t('preferences.save_error'))
      return
    }
    i18n.changeLanguage(code)
  }, [language, t])

  return (
    <SafeAreaView className="flex-1 bg-move-dark" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center justify-between bg-move-dark px-5 pb-6 pt-3">
        <Pressable onPress={() => router.replace('/(tabs)/profile')} hitSlop={12}>
          <ChevronLeft size={24} color="#FFFFFF" />
        </Pressable>
        <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 24, color: '#FFFFFF', letterSpacing: 2 }}>
          {t('preferences.title').toUpperCase()}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView className="flex-1 bg-move-bg" contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}>
        {/* Notifications */}
        <View className="rounded-2xl bg-move-card p-4">
          <Text className="mb-3 font-dmsans-bold text-xs uppercase tracking-wider text-move-text-muted">
            {t('preferences.notifications_section')}
          </Text>

          {/* Column headers */}
          <View className="flex-row items-center pb-2">
            <View className="flex-1" />
            <Text className="w-14 text-center font-dmsans-medium text-[11px] uppercase tracking-wider text-move-text-muted">
              {t('preferences.push_col')}
            </Text>
            <Text className="w-14 text-center font-dmsans-medium text-[11px] uppercase tracking-wider text-move-text-muted">
              {t('preferences.email_col')}
            </Text>
          </View>

          {CATEGORIES.map((cat) => {
            const pushKey = `push_${cat.key}` as NotifKey
            const emailKey = `email_${cat.key}` as NotifKey
            return (
              <View key={cat.key} className="flex-row items-center border-t border-move-border py-2.5">
                <View className="flex-1 flex-row items-center gap-2">
                  <cat.Icon size={16} color="#111111" />
                  <Text className="font-dmsans text-sm text-move-dark">
                    {t(`preferences.category_${cat.key}`)}
                  </Text>
                </View>
                <View className="w-14 items-center">
                  <Switch
                    value={prefs[pushKey]}
                    onValueChange={(v) => updatePref(pushKey, v)}
                    disabled={loading}
                    trackColor={{ true: '#C8F000', false: '#E5E5E5' }}
                    thumbColor="#111111"
                  />
                </View>
                <View className="w-14 items-center">
                  <Switch
                    value={prefs[emailKey]}
                    onValueChange={(v) => updatePref(emailKey, v)}
                    disabled={loading}
                    trackColor={{ true: '#C8F000', false: '#E5E5E5' }}
                    thumbColor="#111111"
                  />
                </View>
              </View>
            )
          })}

          {/* WhatsApp placeholder */}
          <View className="flex-row items-center gap-2 border-t border-move-border py-3 opacity-60">
            <MessageCircle size={16} color="#25D366" />
            <Text className="flex-1 font-dmsans text-sm text-move-dark">
              {t('preferences.whatsapp_label')}
            </Text>
            <View className="rounded-full bg-move-bg px-2.5 py-1">
              <Text className="font-dmsans text-[11px] text-move-text-muted">
                {t('preferences.whatsapp_coming_soon')}
              </Text>
            </View>
          </View>
        </View>

        {/* Push info */}
        <View className="flex-row gap-2 rounded-xl border border-move-border bg-move-bg p-3">
          <Info size={14} color="#9A9890" />
          <Text className="flex-1 font-dmsans text-xs leading-5 text-move-text-secondary">
            {t('preferences.push_info')}
          </Text>
        </View>

        {/* Language */}
        <View className="rounded-2xl bg-move-card p-4">
          <Text className="mb-3 font-dmsans-bold text-xs uppercase tracking-wider text-move-text-muted">
            {t('preferences.language_section')}
          </Text>

          {([
            { code: 'fr' as const, label: 'Français', flag: '🇫🇷' },
            { code: 'en' as const, label: 'English', flag: '🇬🇧' },
          ]).map((lang) => {
            const active = language === lang.code
            return (
              <Pressable
                key={lang.code}
                onPress={() => handleLanguageChange(lang.code)}
                className={`mb-2 flex-row items-center gap-3 rounded-xl border p-3.5 ${active ? 'border-move-accent bg-move-accent/10' : 'border-move-border bg-move-card'}`}
              >
                <Text style={{ fontSize: 22 }}>{lang.flag}</Text>
                <Text className="flex-1 font-dmsans-medium text-base text-move-dark">
                  {lang.label}
                </Text>
                {active && <Check size={20} color="#111111" />}
              </Pressable>
            )
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
