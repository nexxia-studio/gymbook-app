import { useState, useMemo, useCallback } from 'react'
import { View, Text, ScrollView, TouchableOpacity } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useRouter, useFocusEffect } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  Settings, CreditCard, Receipt, Bell, Globe,
  User, Shield, FileText, Download, Trash2, LogOut, Pencil,
} from 'lucide-react-native'
import { ProfileHeader } from '../../components/profile/ProfileHeader'
import { GamificationCard } from '../../components/profile/GamificationCard'
import { StatsRow } from '../../components/profile/StatsRow'
import { ProfileSection } from '../../components/profile/ProfileSection'
import { ProfileListItem } from '../../components/profile/ProfileListItem'
import { SignOutModal } from '../../components/profile/SignOutModal'
import { useAuthStore, type MemberProfile } from '../../stores/useAuthStore'
import { useProfileStats } from '../../hooks/useProfileStats'
import { getLevel } from '../../utils/level'

interface GamificationItem {
  key: string
  labelKey: string
  points: number
  completed: boolean
  onPress?: () => void
}

function buildGamification(p: MemberProfile | null, navigate: (path: string) => void): { items: GamificationItem[]; percentage: number } {
  const items: GamificationItem[] = [
    { key: 'account', labelKey: 'account_created', points: 10, completed: true },
    { key: 'avatar', labelKey: 'has_avatar', points: 15, completed: !!p?.avatarUrl, onPress: () => navigate('/profile/edit?focus=photo') },
    { key: 'phone', labelKey: 'has_phone', points: 10, completed: !!p?.phone, onPress: () => navigate('/profile/edit?focus=phone') },
    { key: 'birth', labelKey: 'has_birthdate', points: 10, completed: !!p?.dateOfBirth, onPress: () => navigate('/profile/edit?focus=birth_date') },
    { key: 'address', labelKey: 'has_address', points: 10, completed: !!p?.addressLine, onPress: () => navigate('/profile/edit?focus=address') },
    { key: 'emergency', labelKey: 'has_emergency', points: 15, completed: !!p?.emergencyContactName, onPress: () => navigate('/profile/edit?focus=emergency') },
    { key: 'payment', labelKey: 'has_payment', points: 20, completed: true },
    { key: 'marketing', labelKey: 'marketing', points: 10, completed: p?.marketingConsent ?? false },
  ]
  const earned = items.reduce((s, i) => s + (i.completed ? i.points : 0), 0)
  return { items, percentage: earned }
}

export default function Profile() {
  const { t } = useTranslation()
  const router = useRouter()
  const signOut = useAuthStore((s) => s.signOut)
  const profile = useAuthStore((s) => s.profile)
  const refreshProfile = useAuthStore((s) => s.refreshProfile)
  const { stats, refresh: refreshStats } = useProfileStats()
  const [signOutVisible, setSignOutVisible] = useState(false)

  // Refresh profile + stats on tab focus
  useFocusEffect(
    useCallback(() => {
      refreshProfile()
      refreshStats()
    }, [refreshProfile, refreshStats])
  )

  const { items, percentage } = useMemo(
    () => buildGamification(profile, (path) => router.push(path as never)),
    [profile, router],
  )

  const firstName = profile?.firstName ?? ''
  const lastName = profile?.lastName ?? ''
  const memberSince = profile?.memberSince
    ? new Date(profile.memberSince).toLocaleDateString('fr-BE', { month: 'long', year: 'numeric' })
    : ''

  const handleSignOut = useCallback(async () => {
    setSignOutVisible(false)
    await signOut()
    router.replace('/(auth)/login' as never)
  }, [signOut, router])

  return (
    <SafeAreaView className="flex-1 bg-move-dark" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center justify-between bg-move-dark px-5 pb-6 pt-3">
        <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 32, color: '#FFFFFF' }}>
          {t('profile.title').toUpperCase()}
        </Text>
        <View className="flex-row items-center gap-4">
          <TouchableOpacity activeOpacity={0.7} onPress={() => router.push('/profile/edit')}>
            <Pencil size={20} color="#FFFFFF" />
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.7}>
            <Settings size={22} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView className="flex-1 bg-move-bg" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Profile card */}
        <ProfileHeader
          firstName={firstName}
          lastName={lastName}
          memberSince={memberSince}
          levelKey={getLevel(stats.completedSessions)}
          avatarUrl={profile?.avatarUrl}
        />

        {/* Gamification */}
        <GamificationCard items={items} percentage={percentage} />

        {/* Stats */}
        <StatsRow
          sessions={stats.completedSessions}
          noshows={profile?.noshowCount ?? 0}
          weeks={stats.activeWeeks}
        />

        {/* Subscription */}
        <ProfileSection title={t('profile.section_subscription')}>
          <ProfileListItem
            icon={CreditCard}
            label={t('profile.my_subscription')}
            detail={t('profile.subscription_detail')}
            badge={t('profile.subscription_active')}
            onPress={() => router.push('/profile/subscription')}
          />
          <View className="mx-5 h-px bg-move-border" />
          <ProfileListItem
            icon={Receipt}
            label={t('profile.payment_history')}
            onPress={() => router.push('/profile/payments')}
          />
        </ProfileSection>

        {/* Preferences */}
        <ProfileSection title={t('profile.section_preferences')}>
          <ProfileListItem
            icon={Bell}
            label={t('profile.notifications')}
            detail={t('profile.notifications_detail')}
            onPress={() => router.push('/profile/preferences')}
          />
          <View className="mx-5 h-px bg-move-border" />
          <ProfileListItem
            icon={Globe}
            label={t('profile.language')}
            detail={t('profile.language_detail')}
            onPress={() => router.push('/profile/preferences')}
          />
        </ProfileSection>

        {/* Account */}
        <ProfileSection title={t('profile.section_account')}>
          <ProfileListItem icon={User} label={t('profile.edit_profile')} />
          <View className="mx-5 h-px bg-move-border" />
          <ProfileListItem
            icon={Shield}
            label={t('profile.security')}
            detail={t('profile.security_detail')}
            onPress={() => router.push('/profile/security')}
          />
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
