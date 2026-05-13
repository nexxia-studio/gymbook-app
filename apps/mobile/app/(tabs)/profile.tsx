import { useState, useMemo, useCallback } from 'react'
import { View, Text, ScrollView, TouchableOpacity } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  Settings, CreditCard, Receipt, Bell, Globe,
  User, Shield, FileText, Download, Trash2, LogOut,
} from 'lucide-react-native'
import { ProfileHeader } from '../../components/profile/ProfileHeader'
import { GamificationCard } from '../../components/profile/GamificationCard'
import { StatsRow } from '../../components/profile/StatsRow'
import { ProfileSection } from '../../components/profile/ProfileSection'
import { ProfileListItem } from '../../components/profile/ProfileListItem'
import { SignOutModal } from '../../components/profile/SignOutModal'
import { useAuthStore } from '../../stores/useAuthStore'

// Mock profile
const MOCK_PROFILE = {
  firstName: 'Antoine',
  lastName: 'M.',
  phone: '+32 470 XX XX XX',
  dateOfBirth: '1992-03-15',
  addressLine: null as string | null,
  emergencyContactName: null as string | null,
  marketingConsent: true,
  avatarUrl: null as string | null,
  memberSince: 'mai 2026',
  hasActiveSubscription: true,
}

interface GamificationItem {
  key: string
  labelKey: string
  points: number
  completed: boolean
}

function buildGamification(p: typeof MOCK_PROFILE): { items: GamificationItem[]; percentage: number } {
  const items: GamificationItem[] = [
    { key: 'account', labelKey: 'account_created', points: 10, completed: true },
    { key: 'avatar', labelKey: 'has_avatar', points: 15, completed: !!p.avatarUrl },
    { key: 'phone', labelKey: 'has_phone', points: 10, completed: !!p.phone },
    { key: 'birth', labelKey: 'has_birthdate', points: 10, completed: !!p.dateOfBirth },
    { key: 'address', labelKey: 'has_address', points: 10, completed: !!p.addressLine },
    { key: 'emergency', labelKey: 'has_emergency', points: 15, completed: !!p.emergencyContactName },
    { key: 'payment', labelKey: 'has_payment', points: 20, completed: p.hasActiveSubscription },
    { key: 'marketing', labelKey: 'marketing', points: 10, completed: p.marketingConsent },
  ]
  const earned = items.reduce((s, i) => s + (i.completed ? i.points : 0), 0)
  return { items, percentage: earned }
}

export default function Profile() {
  const { t } = useTranslation()
  const router = useRouter()
  const signOut = useAuthStore((s) => s.signOut)
  const [signOutVisible, setSignOutVisible] = useState(false)

  const { items, percentage } = useMemo(() => buildGamification(MOCK_PROFILE), [])

  const handleSignOut = useCallback(async () => {
    setSignOutVisible(false)
    await signOut()
    router.replace('/')
  }, [signOut, router])

  return (
    <SafeAreaView className="flex-1 bg-move-bg" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center justify-between bg-move-dark px-5 pb-10 pt-3">
        <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 32, color: '#FFFFFF' }}>
          {t('profile.title').toUpperCase()}
        </Text>
        <TouchableOpacity activeOpacity={0.7}>
          <Settings size={22} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Profile card */}
        <ProfileHeader
          firstName={MOCK_PROFILE.firstName}
          lastName={MOCK_PROFILE.lastName}
          memberSince={MOCK_PROFILE.memberSince}
        />

        {/* Gamification */}
        <GamificationCard items={items} percentage={percentage} />

        {/* Stats */}
        <StatsRow sessions={12} noshows={0} weeks={3} />

        {/* Subscription */}
        <ProfileSection title={t('profile.section_subscription')}>
          <ProfileListItem
            icon={CreditCard}
            label={t('profile.my_subscription')}
            detail={t('profile.subscription_detail')}
            badge={t('profile.subscription_active')}
          />
          <View className="mx-5 h-px bg-move-border" />
          <ProfileListItem icon={Receipt} label={t('profile.payment_history')} />
        </ProfileSection>

        {/* Preferences */}
        <ProfileSection title={t('profile.section_preferences')}>
          <ProfileListItem icon={Bell} label={t('profile.notifications')} detail={t('profile.notifications_detail')} />
          <View className="mx-5 h-px bg-move-border" />
          <ProfileListItem icon={Globe} label={t('profile.language')} detail={t('profile.language_detail')} />
        </ProfileSection>

        {/* Account */}
        <ProfileSection title={t('profile.section_account')}>
          <ProfileListItem icon={User} label={t('profile.edit_profile')} />
          <View className="mx-5 h-px bg-move-border" />
          <ProfileListItem icon={Shield} label={t('profile.security')} detail={t('profile.security_detail')} />
        </ProfileSection>

        {/* Privacy */}
        <ProfileSection title={t('profile.section_privacy')}>
          <ProfileListItem icon={FileText} label={t('profile.privacy_policy')} />
          <View className="mx-5 h-px bg-move-border" />
          <ProfileListItem icon={FileText} label={t('profile.terms')} />
          <View className="mx-5 h-px bg-move-border" />
          <ProfileListItem icon={Download} label={t('profile.export_data')} />
          <View className="mx-5 h-px bg-move-border" />
          <ProfileListItem icon={Trash2} label={t('profile.delete_account')} destructive />
        </ProfileSection>

        {/* Sign out */}
        <TouchableOpacity
          onPress={() => setSignOutVisible(true)}
          activeOpacity={0.7}
          className="mx-4 mt-6 flex-row items-center justify-center gap-2 py-3"
        >
          <LogOut size={18} color="#EF4444" />
          <Text className="font-dmsans-bold text-sm text-red-500">
            {t('profile.logout')}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Sign out modal */}
      <SignOutModal
        visible={signOutVisible}
        onConfirm={handleSignOut}
        onClose={() => setSignOutVisible(false)}
      />
    </SafeAreaView>
  )
}
