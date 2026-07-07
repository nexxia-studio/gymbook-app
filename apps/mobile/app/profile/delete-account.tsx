import { useState, useCallback } from 'react'
import { View, Text, ScrollView, Pressable, Alert, ActivityIndicator } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ChevronLeft, AlertTriangle, Check, X } from 'lucide-react-native'
import { TextInput } from '../../components/ui/TextInput'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/useAuthStore'

/** Lit le `code` d'erreur d'une réponse Edge Function (corps JSON dans error.context). */
async function readErrorCode(data: { code?: string } | null, error: unknown): Promise<string | undefined> {
  const ctx = (error as { context?: Response } | null)?.context
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.json()
      if (body?.code) return body.code as string
    } catch {
      /* corps non-JSON */
    }
  }
  return data?.code
}

export default function DeleteAccountScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  const signOut = useAuthStore((s) => s.signOut)

  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  const confirmWord = t('profile.delete.confirm_word')
  const canDelete = confirmText.trim().toUpperCase() === confirmWord.toUpperCase() && !deleting

  const runDeletion = useCallback(async () => {
    setDeleting(true)
    try {
      const { data, error } = await supabase.functions.invoke('delete-account', { body: {} })
      if (error || !data?.success) {
        const code = await readErrorCode(data as { code?: string } | null, error)
        if (code === 'SUBSCRIPTION_CANCEL_FAILED') {
          Alert.alert(t('profile.delete.sub_failed_title'), t('profile.delete.sub_failed_message'))
        } else {
          Alert.alert(t('profile.delete.error_title'), t('profile.delete.error_message'))
        }
        setDeleting(false)
        return
      }
      // Succès → déconnexion + retour à l'authentification.
      await signOut()
      router.replace('/(auth)/login' as never)
    } catch {
      Alert.alert(t('profile.delete.error_title'), t('profile.delete.error_message'))
      setDeleting(false)
    }
  }, [signOut, router, t])

  // Double confirmation : mot "SUPPRIMER" saisi (ci-dessus) + alerte finale destructive.
  const confirmAndDelete = useCallback(() => {
    if (!canDelete) return
    Alert.alert(
      t('profile.delete.final_confirm_title'),
      t('profile.delete.final_confirm_message'),
      [
        { text: t('profile.delete.cancel'), style: 'cancel' },
        { text: t('profile.delete.final_confirm_cta'), style: 'destructive', onPress: runDeletion },
      ],
    )
  }, [canDelete, runDeletion, t])

  const RemovedRow = ({ label }: { label: string }) => (
    <View className="flex-row items-start gap-2 py-1">
      <X size={16} color="#EF4444" style={{ marginTop: 2 }} />
      <Text className="flex-1 font-dmsans text-sm text-move-dark">{label}</Text>
    </View>
  )
  const KeptRow = ({ label }: { label: string }) => (
    <View className="flex-row items-start gap-2 py-1">
      <Check size={16} color="#6B6861" style={{ marginTop: 2 }} />
      <Text className="flex-1 font-dmsans text-sm text-move-dark">{label}</Text>
    </View>
  )

  return (
    <SafeAreaView className="flex-1 bg-move-dark" edges={['top']}>
      <View className="flex-row items-center justify-between bg-move-dark px-5 pb-6 pt-3">
        <Pressable onPress={() => router.replace('/(tabs)/profile')} hitSlop={12}>
          <ChevronLeft size={24} color="#FFFFFF" />
        </Pressable>
        <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 24, color: '#FFFFFF', letterSpacing: 2 }}>
          {t('profile.delete.title').toUpperCase()}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        className="flex-1 bg-move-bg"
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Bandeau d'avertissement */}
        <View className="flex-row gap-2 rounded-2xl border border-red-200 bg-red-50 p-4">
          <AlertTriangle size={20} color="#EF4444" />
          <Text className="flex-1 font-dmsans-bold text-sm text-red-600">
            {t('profile.delete.warning')}
          </Text>
        </View>

        {/* Ce qui est supprimé */}
        <View className="rounded-2xl bg-move-card p-4">
          <Text className="mb-2 font-dmsans-bold text-xs uppercase tracking-wider text-move-text-muted">
            {t('profile.delete.removed_title')}
          </Text>
          <RemovedRow label={t('profile.delete.removed_profile')} />
          <RemovedRow label={t('profile.delete.removed_access')} />
          <RemovedRow label={t('profile.delete.removed_health')} />
          <RemovedRow label={t('profile.delete.removed_credits')} />
          <RemovedRow label={t('profile.delete.removed_subscription')} />
        </View>

        {/* Ce qui est conservé */}
        <View className="rounded-2xl bg-move-card p-4">
          <Text className="mb-2 font-dmsans-bold text-xs uppercase tracking-wider text-move-text-muted">
            {t('profile.delete.kept_title')}
          </Text>
          <KeptRow label={t('profile.delete.kept_payments')} />
          <Text className="mt-2 font-dmsans text-xs leading-5 text-move-text-muted">
            {t('profile.delete.kept_note')}
          </Text>
        </View>

        {/* Saisie de confirmation */}
        <View className="rounded-2xl bg-move-card p-4">
          <Text className="mb-2 font-dmsans text-sm text-move-dark">
            {t('profile.delete.type_to_confirm', { word: confirmWord })}
          </Text>
          <TextInput
            value={confirmText}
            onChangeText={setConfirmText}
            placeholder={confirmWord}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!deleting}
          />
        </View>

        {/* CTA destructif */}
        <Pressable
          onPress={confirmAndDelete}
          disabled={!canDelete}
          className={`flex-row items-center justify-center gap-2 rounded-2xl py-4 ${canDelete ? 'bg-red-600' : 'bg-red-200'}`}
        >
          {deleting ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text className="font-dmsans-bold text-base text-white">
              {t('profile.delete.cta')}
            </Text>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  )
}
