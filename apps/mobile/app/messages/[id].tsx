import { useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, Pressable, ScrollView, ActivityIndicator } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { AlertCircle, BellOff, ChevronLeft } from 'lucide-react-native'
import { MessageIcon, useMessageDateLabel } from '../../components/messages/shared'
import { useActiveGymId } from '../../lib/activeGym'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { SEMANTIC } from '../../lib/theme/semantic'
import { currentMessageScope, fetchMessage } from '../../lib/messages/api'
import { createLatestGuard, messageScope, sameScope, type MessageRow } from '../../lib/messages/data'
import { messageIdFromParam } from '../../lib/messages/list'
import { useAuthStore } from '../../stores/useAuthStore'

// GYM-391 — un message en entier (`communication` et tout type sans écran lié).
//
// ⚠️ L'écran recharge la ligne par son `id`, dans le périmètre (membre ET salle) : il
// fonctionne en arrivant directement, et un message d'une autre salle reste introuvable.
// ⚠️ L'`id` vient de l'URL : ce qui n'a pas la forme d'un uuid ne part pas en requête.

type State =
  | { status: 'loading' }
  | { status: 'ready'; row: MessageRow }
  | { status: 'missing' }
  | { status: 'error' }

export default function MessageDetailScreen() {
  const { tokens } = useTheme()
  const { t } = useTranslation()
  const router = useRouter()
  const params = useLocalSearchParams<{ id: string }>()
  const id = messageIdFromParam(params.id)
  const userId = useAuthStore((s) => s.user?.id)
  const gymId = useActiveGymId()
  const scope = useMemo(() => messageScope(userId, gymId), [userId, gymId])
  const dateLabel = useMessageDateLabel()

  const [state, setState] = useState<State>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const guard = useRef(createLatestGuard()).current

  useEffect(() => {
    // Sans périmètre ou sans identifiant valable : introuvable, aucune requête.
    if (!scope || !id) {
      setState({ status: 'missing' })
      return
    }
    const token = guard.begin()
    const applies = () => guard.isCurrent(token) && sameScope(scope, currentMessageScope())
    setState({ status: 'loading' })
    fetchMessage(scope, id)
      .then((row) => {
        if (applies()) setState(row ? { status: 'ready', row } : { status: 'missing' })
      })
      .catch((e) => {
        console.error('[messages] message failed:', e)
        if (applies()) setState({ status: 'error' })
      })
    // Démontage ou changement de périmètre : la réponse en cours ne s'applique plus.
    return () => guard.invalidate()
  }, [scope, id, attempt, guard])

  const backToList = () => router.replace('/messages')
  const date = state.status === 'ready' ? dateLabel(state.row.created_at) : null

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: tokens.background }} edges={['top']}>
      <View className="flex-row items-center justify-between px-5 pb-6 pt-3" style={{ backgroundColor: tokens.background }}>
        <Pressable onPress={backToList} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('messages.back_to_list')}>
          <ChevronLeft size={24} color={tokens.onBackground} />
        </Pressable>
        <Text
          accessibilityRole="header"
          style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 24, color: tokens.onBackground, letterSpacing: 2 }}
        >
          {t('messages.detail_title').toUpperCase()}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      {state.status === 'loading' ? (
        <View className="flex-1 items-center justify-center" style={{ backgroundColor: tokens.page }}>
          <ActivityIndicator color={tokens.onSurfaceSecondary} accessibilityLabel={t('common.loading')} />
        </View>
      ) : state.status === 'ready' ? (
        <ScrollView className="flex-1" style={{ backgroundColor: tokens.page }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <View className="gap-4 rounded-xl p-4" style={{ backgroundColor: tokens.surface }}>
            <View className="flex-row items-center gap-3">
              <MessageIcon type={state.row.type} />
              <View className="flex-1 gap-1">
                <Text selectable className="font-dmsans-bold text-base" style={{ color: tokens.onSurface }}>
                  {state.row.title}
                </Text>
                {date ? (
                  <Text className="font-dmsans text-xs" style={{ color: tokens.onSurfaceSecondary }}>
                    {date}
                  </Text>
                ) : null}
              </View>
            </View>
            {state.row.body ? (
              <Text selectable className="font-dmsans text-sm leading-6" style={{ color: tokens.onSurface }}>
                {state.row.body}
              </Text>
            ) : null}
          </View>
        </ScrollView>
      ) : (
        <View className="flex-1 items-center justify-center gap-4 px-8" style={{ backgroundColor: tokens.page }}>
          {state.status === 'error' ? (
            <AlertCircle size={40} color={SEMANTIC.danger} />
          ) : (
            <BellOff size={40} color={tokens.onBackgroundMuted} />
          )}
          <Text className="text-center font-dmsans-bold text-sm" style={{ color: tokens.onSurface }}>
            {t(state.status === 'error' ? 'messages.detail_error' : 'messages.not_found')}
          </Text>
          {state.status === 'error' ? (
            <Pressable
              onPress={() => setAttempt((n) => n + 1)}
              accessibilityRole="button"
              className="rounded-xl px-6 py-3"
              style={{ backgroundColor: tokens.actionBg }}
            >
              <Text className="font-dmsans-bold text-sm" style={{ color: tokens.onAction }}>
                {t('common.retry')}
              </Text>
            </Pressable>
          ) : null}
          <Pressable onPress={backToList} accessibilityRole="button" hitSlop={8} className="rounded-xl border px-6 py-3" style={{ borderColor: tokens.border }}>
            <Text className="font-dmsans-bold text-sm" style={{ color: tokens.onSurface }}>
              {t('messages.back_to_list')}
            </Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  )
}
