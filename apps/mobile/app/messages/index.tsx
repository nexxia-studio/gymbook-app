import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, Pressable, FlatList, RefreshControl, ActivityIndicator } from 'react-native'
import { useRouter, useFocusEffect } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { AlertCircle, BellOff, CheckCheck, ChevronLeft } from 'lucide-react-native'
import { InScreenBanner } from '../../components/ui/InScreenBanner'
import { MessageIcon, useMessageDateLabel, useMessageScope } from '../../components/messages/shared'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { SEMANTIC } from '../../lib/theme/semantic'
import {
  currentMessageScope, fetchMessagesPage, fetchSlotStartsAt, markAllMessagesRead, markMessageRead,
} from '../../lib/messages/api'
import {
  createLatestGuard, isUnread, sameScope, type MessageRow, type MessageScope,
} from '../../lib/messages/data'
import { hasMorePages, mergePages, withRead, withReadStateOf } from '../../lib/messages/list'
import { messageDestination, messageSlotId } from '../../lib/messages/routing'
import { useMessagesStore } from '../../stores/useMessagesStore'

// GYM-391 — l'écran Messages : la boîte du membre dans la salle active, du plus récent au
// plus ancien, par pages de 30.
//
// ⚠️ Aucune requête sans périmètre (membre ET salle) : la RLS ne filtre pas la salle.
// ⚠️ Une réponse ne s'applique que si elle est la dernière demandée, que l'écran est encore
// là et que le périmètre n'a pas changé entre-temps (`guard`, `alive`).
// ⚠️ La racine rend un `<Slot />`, pas une pile : ouvrir un message DÉMONTE cet écran. Il
// n'y a donc ni « retour sur la liste » à gérer, ni position de défilement à préserver.

type Status = 'loading' | 'error' | 'ready'

export default function MessagesScreen() {
  const { tokens } = useTheme()
  const { t } = useTranslation()
  const router = useRouter()
  const { scope, pending } = useMessageScope()
  const unreadCount = useMessagesStore((s) => s.unreadCount)

  const [rows, setRows] = useState<MessageRow[]>([])
  const [status, setStatus] = useState<Status>('loading')
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreFailed, setMoreFailed] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [banner, setBanner] = useState<string | null>(null)
  const hideBanner = useCallback(() => setBanner(null), [])

  // Ce que les fonctions asynchrones lisent À LA RÉPONSE, pas au moment de l'appel.
  const guard = useRef(createLatestGuard()).current
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const mounted = useRef(true)
  const loadedScope = useRef<MessageScope | null>(null) // le périmètre des lignes affichées
  const nextPage = useRef(0)
  const hasMore = useRef(false)
  const loadingFirst = useRef(false)
  const loadingNext = useRef(false)
  const marking = useRef(false)
  const opening = useRef(false)

  useEffect(() => () => { mounted.current = false }, [])

  /** L'écran est-il encore là, pour le périmètre de la demande ? */
  const alive = useCallback(
    (target: MessageScope) => mounted.current && sameScope(target, currentMessageScope()),
    [],
  )

  /** Charge la page 1 et repart de zéro (premier chargement, tirer pour rafraîchir, nouvel essai). */
  const loadFirst = useCallback(async (target: MessageScope) => {
    const token = guard.begin() // périme aussi une page suivante en cours
    loadingFirst.current = true
    loadingNext.current = false
    setLoadingMore(false)
    try {
      const page = await fetchMessagesPage(target, 0)
      if (!guard.isCurrent(token) || !alive(target)) return
      setRows(page)
      nextPage.current = 1
      hasMore.current = hasMorePages(page.length)
      setMoreFailed(false)
      loadedScope.current = target
      setStatus('ready')
    } catch (e) {
      console.error('[messages] first page failed:', e)
      if (!guard.isCurrent(token) || !alive(target)) return
      // Une liste déjà affichée reste affichée : seul le premier chargement a un écran d'erreur.
      if (sameScope(loadedScope.current, target)) setBanner(t('messages.load_error'))
      else setStatus('error')
    } finally {
      if (guard.isCurrent(token)) loadingFirst.current = false
    }
  }, [guard, alive, t])

  const loadNext = useCallback(async () => {
    const target = scopeRef.current
    // `loadingNext` : `onEndReached` peut tirer deux fois avant le rendu suivant.
    if (!target || !hasMore.current || loadingFirst.current || loadingNext.current) return
    if (!sameScope(loadedScope.current, target)) return
    const token = guard.begin()
    const page = nextPage.current
    loadingNext.current = true
    setLoadingMore(true)
    setMoreFailed(false)
    try {
      const more = await fetchMessagesPage(target, page)
      if (!guard.isCurrent(token) || !alive(target)) return
      setRows((prev) => mergePages(prev, more))
      nextPage.current = page + 1
      hasMore.current = hasMorePages(more.length)
    } catch (e) {
      console.error('[messages] next page failed:', e)
      // Pas de nouvel essai automatique : le pied de liste propose « Réessayer ». Sans cela,
      // l'indicateur qui apparaît puis disparaît relancerait `onEndReached` en boucle hors ligne.
      if (guard.isCurrent(token) && alive(target)) setMoreFailed(true)
    } finally {
      if (guard.isCurrent(token)) {
        loadingNext.current = false
        setLoadingMore(false)
      }
    }
  }, [guard, alive])

  useFocusEffect(
    useCallback(() => {
      // Arrivée sur l'écran, ou autre membre / autre salle : rien de l'ancien périmètre ne reste.
      opening.current = false
      setOpeningId(null)
      loadedScope.current = null
      hasMore.current = false
      setRows([])
      if (scope) {
        setStatus('loading')
        void loadFirst(scope)
      } else {
        // Pas de périmètre : aucune requête. On attend s'il n'est pas encore résolu, sinon état vide.
        setStatus(pending ? 'loading' : 'ready')
      }
      return () => {
        guard.invalidate()
        loadingFirst.current = false
        loadingNext.current = false
        setLoadingMore(false)
        // Sortie de l'écran : la pastille de la cloche se remet à jour (critère 6).
        void useMessagesStore.getState().refresh()
      }
    }, [scope, pending, loadFirst, guard]),
  )

  const onRefresh = useCallback(async () => {
    const target = scopeRef.current
    if (!target) return
    setRefreshing(true)
    try {
      // Ni l'un ni l'autre ne lève.
      await Promise.all([loadFirst(target), useMessagesStore.getState().refresh()])
    } finally {
      setRefreshing(false)
    }
  }, [loadFirst])

  const retry = useCallback(() => {
    const target = scopeRef.current
    if (!target) return
    setStatus('loading')
    void loadFirst(target)
  }, [loadFirst])

  const markAll = useCallback(async () => {
    const target = scopeRef.current
    if (!target || marking.current) return
    marking.current = true
    setMarkingAll(true)
    const originals = rowsRef.current.filter(isUnread)
    setRows((prev) => withRead(prev))
    try {
      await markAllMessagesRead(target)
    } catch (e) {
      console.error('[messages] mark all read failed:', e)
      if (alive(target)) {
        setRows((prev) => withReadStateOf(prev, originals))
        setBanner(t('messages.mark_all_error'))
      }
    } finally {
      // Attendu avant de rendre le bouton : il disparaît d'un coup, sans redevenir actif.
      await useMessagesStore.getState().refresh()
      marking.current = false
      setMarkingAll(false)
    }
  }, [alive, t])

  const openMessage = useCallback(async (row: MessageRow) => {
    const target = scopeRef.current
    // `opening` protège du double appui. Il n'est pas relâché : la navigation démonte l'écran.
    if (!target || opening.current) return
    opening.current = true

    if (isUnread(row)) {
      setRows((prev) => withRead(prev, row.id))
      // Sans `await` : le marquage ne retarde pas la navigation, et son échec ne l'empêche pas.
      markMessageRead(target, row.id)
        .then(() => useMessagesStore.getState().refresh())
        .catch((e) => {
          console.error('[messages] mark read failed (non-blocking):', e)
          if (alive(target)) setRows((prev) => withReadStateOf(prev, [row]))
        })
    }

    // Message de cours : l'heure de début décide entre la fiche du cours et Mes réservations.
    // `starts_at` est un instant UTC, comparé à maintenant : le fuseau n'entre pas en jeu.
    let slotStartsAt: string | null = null
    const slotId = messageSlotId(row.type, row.data)
    if (slotId !== null) {
      setOpeningId(row.id)
      try {
        slotStartsAt = await fetchSlotStartsAt(target, slotId)
      } catch (e) {
        // Heure inconnue, donc Mes réservations.
        console.error('[messages] slot time failed:', e)
      }
      // Écran quitté ou périmètre changé pendant le chargement : on ne navigue plus.
      if (!alive(target)) return
    }

    const destination = messageDestination(row.type, row.data, { now: new Date(), slotStartsAt })
    switch (destination.kind) {
      case 'session':
        router.push({ pathname: '/session/[id]', params: { id: destination.slotId } })
        break
      case 'subscription':
        router.push('/profile/subscription')
        break
      case 'detail':
        router.push({ pathname: '/messages/[id]', params: { id: row.id } })
        break
      // Les onglets : `replace`, comme le retour des autres écrans vers un onglet.
      case 'bookings':
        router.replace('/(tabs)/bookings')
        break
      case 'profile':
        router.replace('/(tabs)/profile')
        break
    }
  }, [alive, router])

  // Des non lus peuvent rester sur des pages pas encore chargées : le compteur les voit.
  const showMarkAll = status === 'ready' && rows.length > 0 && (unreadCount > 0 || rows.some(isUnread))

  const renderItem = useCallback(
    ({ item }: { item: MessageRow }) => (
      <MessageItem row={item} opening={openingId === item.id} onPress={openMessage} />
    ),
    [openingId, openMessage],
  )

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: tokens.background }} edges={['top']}>
      {/* Même en-tête que app/profile/payments.tsx. `replace` et pas `back`, comme les autres
          écrans : la destination est connue. */}
      <View className="flex-row items-center justify-between px-5 pb-6 pt-3" style={{ backgroundColor: tokens.background }}>
        <Pressable
          onPress={() => router.replace('/(tabs)')}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <ChevronLeft size={24} color={tokens.onBackground} />
        </Pressable>
        <Text
          accessibilityRole="header"
          style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 24, color: tokens.onBackground, letterSpacing: 2 }}
        >
          {t('messages.title').toUpperCase()}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      {status === 'loading' ? (
        <View className="flex-1 items-center justify-center" style={{ backgroundColor: tokens.page }}>
          <ActivityIndicator color={tokens.onSurfaceSecondary} accessibilityLabel={t('common.loading')} />
        </View>
      ) : status === 'error' ? (
        <View className="flex-1 items-center justify-center gap-4 px-8" style={{ backgroundColor: tokens.page }}>
          <AlertCircle size={40} color={SEMANTIC.danger} />
          <Text className="text-center font-dmsans-bold text-sm" style={{ color: tokens.onSurface }}>
            {t('messages.load_error')}
          </Text>
          <Pressable
            onPress={retry}
            accessibilityRole="button"
            className="rounded-xl px-6 py-3"
            style={{ backgroundColor: tokens.actionBg }}
          >
            <Text className="font-dmsans-bold text-sm" style={{ color: tokens.onAction }}>
              {t('common.retry')}
            </Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          className="flex-1"
          style={{ backgroundColor: tokens.page }}
          contentContainerStyle={{ flexGrow: 1, padding: 16, gap: 8, paddingBottom: 40 }}
          data={rows}
          keyExtractor={(row) => row.id}
          renderItem={renderItem}
          onEndReached={moreFailed ? undefined : loadNext}
          onEndReachedThreshold={0.5}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={tokens.accent} colors={[tokens.accent]} />
          }
          ListHeaderComponent={showMarkAll ? (
            <Pressable
              onPress={markAll}
              disabled={markingAll}
              accessibilityRole="button"
              accessibilityState={{ disabled: markingAll, busy: markingAll }}
              className="flex-row items-center gap-2 self-end rounded-xl px-4"
              style={{ minHeight: 44, backgroundColor: tokens.actionBg, opacity: markingAll ? 0.5 : 1 }}
            >
              <CheckCheck size={16} color={tokens.onAction} />
              <Text className="font-dmsans-bold text-xs" style={{ color: tokens.onAction }}>
                {t('messages.mark_all_read')}
              </Text>
            </Pressable>
          ) : null}
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center gap-3 px-8">
              <BellOff size={40} color={tokens.onBackgroundMuted} />
              <Text className="text-center font-dmsans-bold text-sm" style={{ color: tokens.onSurface }}>
                {t('messages.empty')}
              </Text>
            </View>
          }
          ListFooterComponent={loadingMore ? (
            <View className="py-4">
              <ActivityIndicator color={tokens.onSurfaceSecondary} accessibilityLabel={t('common.loading')} />
            </View>
          ) : moreFailed ? (
            <View className="items-center gap-3 py-4">
              <Text className="text-center font-dmsans text-xs" style={{ color: tokens.onSurfaceSecondary }}>
                {t('messages.load_error')}
              </Text>
              <Pressable
                onPress={loadNext}
                accessibilityRole="button"
                className="justify-center rounded-xl px-5"
                style={{ minHeight: 44, backgroundColor: tokens.actionBg }}
              >
                <Text className="font-dmsans-bold text-xs" style={{ color: tokens.onAction }}>
                  {t('common.retry')}
                </Text>
              </Pressable>
            </View>
          ) : null}
        />
      )}

      <InScreenBanner message={banner} onHide={hideBanner} variant="error" />
    </SafeAreaView>
  )
}

const MessageItem = memo(function MessageItem({
  row, opening, onPress,
}: {
  row: MessageRow
  opening: boolean
  onPress: (row: MessageRow) => void
}) {
  const { tokens } = useTheme()
  const { t } = useTranslation()
  const dateLabel = useMessageDateLabel()
  const unread = isUnread(row)
  const date = dateLabel(row.created_at)

  return (
    <Pressable
      onPress={() => onPress(row)}
      accessibilityRole="button"
      accessibilityState={{ busy: opening }}
      // L'état lu / non lu est DIT, pas seulement montré.
      accessibilityLabel={[t(unread ? 'messages.unread' : 'messages.read'), row.title, row.body, date].filter(Boolean).join(', ')}
      className="flex-row gap-3 rounded-xl p-4"
      style={{ backgroundColor: tokens.surface }}
    >
      <MessageIcon type={row.type} />
      <View className="flex-1 gap-1">
        <View className="flex-row items-start gap-2">
          {/* Non lu : titre gras ET pastille. Deux signes de forme, aucun ne repose sur la teinte. */}
          <Text
            className={`flex-1 text-sm ${unread ? 'font-dmsans-bold' : 'font-dmsans'}`}
            style={{ color: tokens.onSurface }}
            numberOfLines={2}
          >
            {row.title}
          </Text>
          {opening ? (
            <ActivityIndicator size="small" color={tokens.onSurfaceSecondary} />
          ) : unread ? (
            <View className="mt-1.5 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tokens.onSurface }} />
          ) : null}
        </View>
        {row.body ? (
          <Text className="font-dmsans text-xs leading-5" style={{ color: tokens.onSurfaceSecondary }} numberOfLines={3}>
            {row.body}
          </Text>
        ) : null}
        {date ? (
          <Text className="font-dmsans text-xs" style={{ color: tokens.onSurfaceSecondary }}>
            {date}
          </Text>
        ) : null}
      </View>
    </Pressable>
  )
})
