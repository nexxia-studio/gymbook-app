import { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, Pressable, ActivityIndicator, AppState, Modal } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { X } from 'lucide-react-native'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/useAuthStore'

interface Payment {
  id: string
  status: string
  plan_name: string
  amount: number | string
  credits_granted: number
}

type DropInStatus = 'polling' | 'booking' | 'success' | 'error'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// ── GYM-96 (QA-06) — poll robuste de la page « paiement en cours ».
// Contrat serveur (create-payment v26+) : la redirectUrl porte ?id=<payments.id>.
// On poll la table `payments` par cet id jusqu'à un état TERMINAL.
const POLL_INTERVAL_MS = 2500
const GLOBAL_TIMEOUT_MS = 120_000 // ~2 min
// Statuts terminaux d'échec (Mollie → colonne payments.status via webhook).
const TERMINAL_FAILURE = new Set(['failed', 'canceled', 'cancelled', 'expired'])

type ClassicStatus = 'polling' | 'success' | 'failed' | 'timeout'

const titleStyle = {
  fontFamily: 'BarlowCondensed_900Black',
  fontSize: 24,
  color: '#111111',
  textAlign: 'center' as const,
  letterSpacing: 2,
}
const ctaLabel = { fontFamily: 'DMSans_700Bold', fontSize: 16, color: '#C8F000' }

export default function PaymentSuccess() {
  const { t } = useTranslation()
  const router = useRouter()
  const params = useLocalSearchParams<{ id?: string; mollie_id?: string; slot_id?: string; source?: string; returnTo?: string }>()
  const isDropInRetry = params.source === 'drop_in' && !!params.slot_id

  // ============================================================
  // GYM-63b — Mode drop-in auto-retry
  // ============================================================
  if (isDropInRetry) {
    return <DropInRetryScreen slotId={params.slot_id!} />
  }

  // ============================================================
  // Mode classique — poll du paiement par payment.id
  // ============================================================
  return <ClassicPaymentScreen rowId={params.id} mollieId={params.mollie_id} returnTo={params.returnTo} router={router} t={t} />
}

function DropInRetryScreen({ slotId }: { slotId: string }) {
  const { t } = useTranslation()
  const router = useRouter()
  const user = useAuthStore((s) => s.user)
  const gymId = useAuthStore((s) => s.gym_id)
  const [status, setStatus] = useState<DropInStatus>('polling')
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true

    const run = async () => {
      if (!user || !gymId) {
        setStatus('error')
        return
      }

      const maxAttempts = 15
      for (let i = 0; i < maxAttempts; i++) {
        await sleep(1000)
        const { data: credits } = await supabase
          .from('member_credits')
          .select('credits_total, credits_used')
          .eq('member_id', user.id)
          .eq('gym_id', gymId)
          .maybeSingle()

        const hasCredits = credits && (credits.credits_total - credits.credits_used) > 0
        if (!hasCredits) continue

        setStatus('booking')
        const { data, error } = await supabase.functions.invoke('create-booking', {
          body: { slot_id: slotId },
        })

        if (error || data?.error) {
          setStatus('error')
          return
        }

        setStatus('success')
        await sleep(2000)
        router.replace('/(tabs)/bookings')
        return
      }

      // Timeout — webhook trop lent, fallback manuel
      setStatus('error')
    }

    run()
  }, [user, gymId, slotId, router])

  return (
    <SafeAreaView className="flex-1 bg-move-dark" edges={['top', 'bottom']}>
      <View className="flex-1 items-center justify-center gap-4 px-8">
        {status === 'polling' && (
          <>
            <ActivityIndicator size="large" color="#C8F000" />
            <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 22, color: '#FFFFFF', textAlign: 'center', letterSpacing: 1 }}>
              {t('payment_drop_in_retry.polling_title')}
            </Text>
            <Text className="font-dmsans text-sm text-white/60 text-center">
              {t('payment_drop_in_retry.polling_sub')}
            </Text>
          </>
        )}

        {status === 'booking' && (
          <>
            <ActivityIndicator size="large" color="#C8F000" />
            <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 22, color: '#FFFFFF', textAlign: 'center', letterSpacing: 1 }}>
              {t('payment_drop_in_retry.booking_title')}
            </Text>
          </>
        )}

        {status === 'success' && (
          <>
            <Text style={{ fontSize: 64 }}>✅</Text>
            <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 24, color: '#C8F000', textAlign: 'center', letterSpacing: 2 }}>
              {t('payment_drop_in_retry.success_title')}
            </Text>
            <Text className="font-dmsans text-sm text-white/60 text-center">
              {t('payment_drop_in_retry.success_sub')}
            </Text>
          </>
        )}

        {status === 'error' && (
          <>
            <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 22, color: '#FFFFFF', textAlign: 'center', letterSpacing: 1 }}>
              {t('payment_drop_in_retry.error_title')}
            </Text>
            <Text className="font-dmsans text-sm text-white/60 text-center">
              {t('payment_drop_in_retry.error_sub')}
            </Text>
            <Pressable
              onPress={() => router.replace('/(tabs)/schedule')}
              className="mt-4 w-full items-center rounded-xl bg-move-accent py-4"
            >
              <Text style={{ fontFamily: 'DMSans_700Bold', fontSize: 16, color: '#111111' }}>
                {t('payment_drop_in_retry.back_to_schedule')}
              </Text>
            </Pressable>
          </>
        )}
      </View>
    </SafeAreaView>
  )
}

function ClassicPaymentScreen({
  rowId,
  mollieId,
  returnTo,
  router,
  t,
}: {
  // GYM-96 — deux clés possibles selon le mode d'arrivée :
  //  - rowId    : payments.id, porté par le deep link (?id=…) via la redirectUrl serveur.
  //  - mollieId : payment_id Mollie, connu par le client (réponse create-payment) → utilisé
  //               par la NAVIGATION PROPRIÉTAIRE (écran monté avant même d'ouvrir le navigateur).
  rowId: string | undefined
  mollieId: string | undefined
  // Destination post-succès contextuelle : renseignée par l'écran d'achat (ex. mon abonnement).
  // Absente (deep link pur) → défaut Réservations > À venir.
  returnTo: string | undefined
  router: ReturnType<typeof useRouter>
  t: (key: string, opts?: Record<string, unknown>) => string
}) {
  const [payment, setPayment] = useState<Payment | null>(null)
  const [status, setStatus] = useState<ClassicStatus>('polling')
  const [successVisible, setSuccessVisible] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Verrou d'état terminal : une fois SUCCÈS/ÉCHEC/TIMEOUT atteint, on ne re-poll plus.
  const settledRef = useRef(false)

  const stopPolling = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null }
  }, [])

  const goToBookings = useCallback(() => {
    router.replace('/(tabs)/bookings')
  }, [router])

  // Destination post-succès contextuelle : returnTo si l'achat vient d'un écran précis
  // (ex. mon abonnement → le membre voit ses crédits), sinon défaut Réservations > À venir.
  const goToSuccessDestination = useCallback(() => {
    router.replace((returnTo ?? '/(tabs)/bookings') as never)
  }, [router, returnTo])

  // QA-06 : bouton Fermer FONCTIONNEL. Coupe le poll résiduel puis revient à l'écran
  // précédent (ou, si ouvert par deep link sans historique, atterrit sur Réservations).
  const handleClose = useCallback(() => {
    stopPolling()
    if (router.canGoBack()) router.back()
    else goToBookings()
  }, [router, stopPolling, goToBookings])

  const poll = useCallback(async () => {
    if (settledRef.current) return
    // rowId prioritaire (plus précis) ; sinon on retombe sur le mollie_payment_id.
    let query = supabase
      .from('payments')
      .select('id, status, plan_name, amount, credits_granted')
    if (rowId) query = query.eq('id', rowId)
    else if (mollieId) query = query.eq('mollie_payment_id', mollieId)
    else return
    const { data } = await query.maybeSingle()
    if (!data || settledRef.current) return
    setPayment(data as Payment)
    const s = data.status as string
    if (s === 'paid') {
      settledRef.current = true
      stopPolling()
      setStatus('success')
      setSuccessVisible(true)
    } else if (TERMINAL_FAILURE.has(s)) {
      settledRef.current = true
      stopPolling()
      setStatus('failed')
    }
  }, [rowId, mollieId, stopPolling])

  // Cycle de poll : démarre AU MONTAGE (navigation propriétaire ou deep link), immédiat +
  // intervalle, borné par un timeout global ~2 min.
  useEffect(() => {
    if (!rowId && !mollieId) {
      // Aucune clé de paiement → on ne peut pas poller : état « en cours de traitement ».
      settledRef.current = true
      setStatus('timeout')
      return
    }
    poll()
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS)
    timeoutRef.current = setTimeout(() => {
      if (!settledRef.current) {
        settledRef.current = true
        stopPolling()
        setStatus('timeout')
      }
    }, GLOBAL_TIMEOUT_MS)
    return stopPolling
  }, [rowId, mollieId, poll, stopPolling])

  // Filet QA-06 : le deep link auto depuis l'app bancaire n'est pas fiable. Quand l'app
  // repasse au premier plan (retour manuel), on re-poll IMMÉDIATEMENT.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active' && !settledRef.current) poll()
    })
    return () => sub.remove()
  }, [poll])

  // Modale succès : auto-fermeture ~5 s → destination contextuelle (returnTo ou À venir).
  useEffect(() => {
    if (!successVisible) return
    const id = setTimeout(() => {
      setSuccessVisible(false)
      goToSuccessDestination()
    }, 5000)
    return () => clearTimeout(id)
  }, [successVisible, goToSuccessDestination])

  return (
    <SafeAreaView className="flex-1 bg-move-bg" edges={['top', 'bottom']}>
      {/* Fermer (QA-06) — sauf pendant la modale succès qui a son propre CTA */}
      <View className="flex-row justify-end px-5 pt-2">
        <Pressable onPress={handleClose} hitSlop={12} accessibilityLabel={t('payment.close')}>
          <X size={26} color="#111111" />
        </Pressable>
      </View>

      <View className="flex-1 items-center justify-center px-8">
        {status === 'polling' && (
          <>
            <ActivityIndicator size="large" color="#111111" />
            <Text style={titleStyle} className="mt-4">{t('payment.verifying')}</Text>
            <Text className="mt-3 font-dmsans text-sm text-move-text-muted text-center">
              {t('payment.waiting_confirmation')}
            </Text>
          </>
        )}

        {status === 'success' && (
          <>
            <Text style={{ fontSize: 64, marginBottom: 16 }}>✅</Text>
            <Text style={titleStyle}>{t('payment.success_title')}</Text>
            {payment && (
              <>
                <Text className="mt-3 font-dmsans text-base text-move-text-secondary text-center">
                  {payment.plan_name} — {payment.amount}€
                </Text>
                <Text className="mt-1 font-dmsans-bold text-sm text-green-600 text-center">
                  {t('payment.credits_added', { count: payment.credits_granted })}
                </Text>
              </>
            )}
            <Pressable onPress={goToBookings} className="mt-10 w-full items-center rounded-xl bg-move-dark py-4">
              <Text style={ctaLabel}>{t('payment.go_to_bookings')}</Text>
            </Pressable>
          </>
        )}

        {status === 'failed' && (
          <>
            <Text style={{ fontSize: 64, marginBottom: 16 }}>❌</Text>
            <Text style={titleStyle}>{t('payment.failed_title')}</Text>
            <Text className="mt-3 font-dmsans text-sm text-move-text-muted text-center">
              {t('payment.failed_message')}
            </Text>
            <Pressable onPress={() => router.replace('/profile/subscription')} className="mt-10 w-full items-center rounded-xl bg-move-dark py-4">
              <Text style={ctaLabel}>{t('payment.back_to_plans')}</Text>
            </Pressable>
          </>
        )}

        {status === 'timeout' && (
          <>
            <Text style={{ fontSize: 64, marginBottom: 16 }}>⏳</Text>
            <Text style={titleStyle}>{t('payment.timeout_title')}</Text>
            <Text className="mt-3 font-dmsans text-sm text-move-text-muted text-center">
              {t('payment.timeout_message')}
            </Text>
            <Pressable onPress={goToBookings} className="mt-10 w-full items-center rounded-xl bg-move-dark py-4">
              <Text style={ctaLabel}>{t('payment.go_to_bookings')}</Text>
            </Pressable>
          </>
        )}
      </View>

      {/* ÉTAPE 2 — modale succès auto-fermante (~5 s) + fermeture manuelle → Réservations */}
      <Modal
        visible={successVisible}
        transparent
        animationType="fade"
        onRequestClose={() => { setSuccessVisible(false); goToSuccessDestination() }}
      >
        <View className="flex-1 items-center justify-center bg-black/60 px-8">
          <View className="w-full items-center rounded-3xl bg-white p-8">
            <Text style={{ fontSize: 56, marginBottom: 12 }}>🎉</Text>
            <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 24, color: '#111111', textAlign: 'center', letterSpacing: 1 }}>
              {t('payment.modal_success_title')}
            </Text>
            <Text className="mt-3 font-dmsans text-sm text-move-text-secondary text-center">
              {t('payment.modal_success_body')}
            </Text>
            <Pressable
              onPress={() => { setSuccessVisible(false); goToSuccessDestination() }}
              className="mt-8 w-full items-center rounded-xl bg-move-dark py-4"
            >
              <Text style={ctaLabel}>{t('payment.go_to_bookings')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}
