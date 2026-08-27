import { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, Pressable, ActivityIndicator, AppState, Modal } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { X } from 'lucide-react-native'
import { supabase } from '../../lib/supabase'
import { tryEdgeInvoke } from '../../lib/edgeInvoke'
import { captureEvent } from '../../lib/analytics'
import { useAuthStore } from '../../stores/useAuthStore'
// GYM-240 — coupure réseau vs refus serveur : deux issues distinctes.
import { runNetworkSafe } from '../../lib/networkError'
import { useTheme } from '../../lib/theme/ThemeProvider'
import type { ThemeTokens } from '../../lib/theme/resolveTheme'

interface Payment {
  id: string
  status: string
  plan_name: string
  amount: number | string
  currency: string | null
  credits_granted: number
}

type DropInStatus = 'polling' | 'booking' | 'success' | 'error'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// ── GYM-96 (QA-06) — poll robuste de la page « paiement en cours ».
// Contrat serveur (create-payment v26+) : la redirectUrl porte ?id=<payments.id>.
// On poll la table `payments` par cet id jusqu'à un état TERMINAL.
const POLL_INTERVAL_MS = 2500
// GYM-207 — 5 min, et non 2. Constat prod du 04/08 : le webhook Mollie a crédité en
// 2 min 33 s, DÉPASSANT l'ancien plafond de 2 min. L'écran basculait donc en « paiement
// en cours de traitement » alors que le crédit était déjà accordé — le membre croyait son
// paiement échoué sur son tout premier achat. Le plafond doit couvrir la latence réelle
// observée, avec de la marge.
const GLOBAL_TIMEOUT_MS = 300_000 // 5 min
// Statuts terminaux d'échec (Mollie → colonne payments.status via webhook).
const TERMINAL_FAILURE = new Set(['failed', 'canceled', 'cancelled', 'expired'])

type ClassicStatus = 'polling' | 'success' | 'failed' | 'timeout'

// ⚠️ UNE FABRIQUE PLUTÔT QUE DEUX CONSTANTES, ET C'EST LA POSITION QUI L'IMPOSE.
// Ces deux styles étaient des constantes de module ; elles ne pouvaient donc pas lire le
// thème. Les descendre dans le composant marche — mais déplace leurs couleurs DANS LA
// SUITE du fichier, et `verify-screen-parity` compare les suites : quatre écarts
// apparaissaient sur une migration pourtant exacte. La fabrique reste ici, à la place
// exacte des constantes qu'elle remplace, et reçoit les jetons en argument.
//
// GYM-286 — A-3/A-4, EN ATTENTE pour `cta` : ce lime est l'encre des boutons
// `bg-move-dark` de cet écran, donc la paire bloquée.
const makeStyles = (tokens: ThemeTokens) => ({
  title: {
    fontFamily: 'BarlowCondensed_900Black',
    fontSize: 24,
    color: tokens.onSurface,
    textAlign: 'center' as const,
    letterSpacing: 2,
  },
  cta: { fontFamily: 'DMSans_700Bold', fontSize: 16, color: tokens.onAction },
})

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
  const { tokens } = useTheme()
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
        // GYM-270 — même helper que le store de réservation : un refus métier (créneau
        // devenu complet, crédit consommé entre-temps) n'a pas à alerter Sentry ici non
        // plus. L'écran affiche son état d'erreur, identique à avant.
        const res = await tryEdgeInvoke('create-booking', { slot_id: slotId })
        if (!res.ok) {
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
    <SafeAreaView className="flex-1" style={{ backgroundColor: tokens.background }} edges={['top', 'bottom']}>
      <View className="flex-1 items-center justify-center gap-4 px-8">
        {status === 'polling' && (
          <>
            <ActivityIndicator size="large" color={tokens.accent} />
            <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 22, color: tokens.onBackground, textAlign: 'center', letterSpacing: 1 }}>
              {t('payment_drop_in_retry.polling_title')}
            </Text>
            {/* 🔴 GYM-304 — ENCRE RÉSOLUE, OPACITÉ CONSERVÉE. `text-white/60` était un BLANC EN
                DUR posé sur `tokens.background` : illisible dès que la salle a un fond clair.
                Mesuré sur le fond constaté #E9E8E8 — un blanc à 60 % y disparaît.
                
                ⚠️ `tokens.onBackground`, PAS `onBackgroundMuted` — c'est toute la leçon de la PR
                #235. `onBackgroundMuted` est choisi par le MODE (`hslLightness > 80`), un critère
                qui classe « sombre » un fond vif : il descend sous 3:1 sur 7 000 salles sur
                19 600. `onBackground`, lui, est choisi par `bestInkOn`, c'est-à-dire par le
                CONTRASTE RÉEL. Le critère est la luminance, jamais la teinte.
                
                ⚠️ L'ALPHA EST CONSERVÉ : 0x99 = 153, soit 153/255 = 0,60 pile. Chez Dopamine
                `onBackground` vaut #FFFFFF — le rendu est donc le blanc à 60 % d'aujourd'hui, au
                pixel. C'est le motif A-10, comme les en-têtes de #232 (3c). */}
            <Text className="font-dmsans text-sm text-center" style={{ color: tokens.onBackground + '99' }}>
              {t('payment_drop_in_retry.polling_sub')}
            </Text>
          </>
        )}

        {status === 'booking' && (
          <>
            <ActivityIndicator size="large" color={tokens.accent} />
            <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 22, color: tokens.onBackground, textAlign: 'center', letterSpacing: 1 }}>
              {t('payment_drop_in_retry.booking_title')}
            </Text>
          </>
        )}

        {status === 'success' && (
          <>
            <Text style={{ fontSize: 64 }}>✅</Text>
            <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 24, color: tokens.accent, textAlign: 'center', letterSpacing: 2 }}>
              {t('payment_drop_in_retry.success_title')}
            </Text>
            <Text className="font-dmsans text-sm text-center" style={{ color: tokens.onBackground + '99' }}>
              {t('payment_drop_in_retry.success_sub')}
            </Text>
          </>
        )}

        {status === 'error' && (
          <>
            <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 22, color: tokens.onBackground, textAlign: 'center', letterSpacing: 1 }}>
              {t('payment_drop_in_retry.error_title')}
            </Text>
            <Text className="font-dmsans text-sm text-center" style={{ color: tokens.onBackground + '99' }}>
              {t('payment_drop_in_retry.error_sub')}
            </Text>
            <Pressable
              onPress={() => router.replace('/(tabs)/schedule')}
              className="mt-4 w-full items-center rounded-xl py-4"
              style={{ backgroundColor: tokens.accent }}
            >
              <Text style={{ fontFamily: 'DMSans_700Bold', fontSize: 16, color: tokens.onAccent }}>
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
  const { tokens } = useTheme()
  const { title: titleStyle, cta: ctaLabel } = makeStyles(tokens)
  const [payment, setPayment] = useState<Payment | null>(null)
  const [status, setStatus] = useState<ClassicStatus>('polling')
  // GYM-240 — la connexion est-elle tombée pendant le poll ? État d'AFFICHAGE seulement :
  // il ne change ni le cycle de poll, ni l'issue du paiement.
  const [offline, setOffline] = useState(false)
  const [successVisible, setSuccessVisible] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Verrou d'état terminal : une fois SUCCÈS/ÉCHEC/TIMEOUT atteint, on ne re-poll plus.
  const settledRef = useRef(false)
  // GYM-207 — miroir de `status` lisible depuis le listener AppState sans le réabonner
  // à chaque changement d'état (le listener ne doit pas se recréer à chaque poll).
  const statusRef = useRef<ClassicStatus>('polling')
  statusRef.current = status

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

  // GYM-240 — 🔴 C'EST ICI QUE LE REJET PARTAIT EN ERREUR NON GÉRÉE. Cette fonction est
  // `async` et passée à `setInterval` : la promesse qu'elle renvoie n'est attendue par
  // personne. Une coupure réseau pendant les 5 minutes de poll rejetait donc dans le vide,
  // et Sentry la recevait en `onunhandledrejection` sous le message trompeur
  // « Edge Function returned a non-2xx status code » — alors qu'aucune Edge n'était
  // appelée. Le poll est un cas d'école : il tourne en arrière-plan, longtemps, sur un
  // écran que le membre laisse ouvert pendant qu'il bascule d'application.
  // ⚠️ GYM-292 — SONDAGE D'UNE LIGNE DE PAIEMENT PAR SON IDENTIFIANT (`rowId` /
  // `mollieId`). La salle n'entre pas dans la question : on suit UN paiement, celui que
  // l'app vient de créer. Y ajouter un filtre de salle ne changerait rien et ferait
  // croire que la clé en dépend.
  const poll = useCallback(async () => {
    if (settledRef.current) return
    // rowId prioritaire (plus précis) ; sinon on retombe sur le mollie_payment_id.
    let query = supabase
      .from('payments')
      .select('id, status, plan_name, amount, currency, credits_granted')
    if (rowId) query = query.eq('id', rowId)
    else if (mollieId) query = query.eq('mollie_payment_id', mollieId)
    else return
    // ⚠️ UNE COUPURE N'INTERROMPT PAS LE POLL : on repassera au tick suivant, et le
    // timeout global reste le seul juge de l'abandon. Un refus SERVEUR, lui, est relancé
    // par `runNetworkSafe` et remonte comme avant — le taire masquerait un vrai problème.
    // `query.maybeSingle()` renvoie un PostgrestBuilder (thenable, pas une vraie Promise) :
    // on l'enveloppe pour que `runNetworkSafe` reçoive bien une promesse.
    const res = await runNetworkSafe(async () => await query.maybeSingle())
    if (res.offline) {
      setOffline(true)
      return
    }
    setOffline(false)
    const { data } = res.data
    if (!data || settledRef.current) return
    setPayment(data as Payment)
    const s = data.status as string
    if (s === 'paid') {
      settledRef.current = true
      stopPolling()
      // GYM-273 — montant en CENTIMES et devise séparée (convention du lot) : un nombre à
      // virgule flottante en euros s'additionne mal, et `amount` arrive tantôt en nombre,
      // tantôt en chaîne selon le pilote Postgres.
      const row = data as Payment
      const amountCents = Math.round(Number(row.amount) * 100)
      // `credits_granted === 0` = abonnement : c'est la convention déjà employée côté
      // serveur (mollie-subscription-webhook, /revenus) — on ne l'invente pas ici.
      const isSubscription = (row.credits_granted ?? 0) === 0
      captureEvent('payment_completed', {
        amount_cents: Number.isFinite(amountCents) ? amountCents : null,
        currency: row.currency ?? 'EUR',
        kind: isSubscription ? 'subscription' : 'credits',
        credits_granted: row.credits_granted ?? 0,
      })
      // ⚠️ ÉMIS ICI ET PAS À L'INITIATION DU CHECKOUT : `payment_initiated` dit qu'un
      // membre a cliqué, `subscription_started` dit qu'un abonnement EXISTE. Les confondre
      // gonflerait le nombre d'abonnés de tous les paniers abandonnés.
      if (isSubscription) {
        captureEvent('subscription_started', {
          amount_cents: Number.isFinite(amountCents) ? amountCents : null,
          currency: row.currency ?? 'EUR',
        })
      }
      setStatus('success')
      setSuccessVisible(true)
    } else if (TERMINAL_FAILURE.has(s)) {
      settledRef.current = true
      stopPolling()
      // `status` porte la raison telle que Mollie l'a rendue (failed / canceled / expired) :
      // un abandon volontaire et un refus bancaire n'appellent pas la même réaction.
      captureEvent('payment_failed', { status: s })
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

  // GYM-207 — Relance manuelle après timeout. Le membre disposait auparavant d'un message
  // « Tire pour rafraîchir » sur un écran SANS pull-to-refresh (l'instruction visait un
  // autre écran) : le geste ne déclenchait rien. On lui donne un bouton qui, lui, relance
  // réellement le poll pour un nouveau cycle borné.
  const retryPolling = useCallback(() => {
    if (!rowId && !mollieId) return
    settledRef.current = false
    setStatus('polling')
    poll()
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS)
    timeoutRef.current = setTimeout(() => {
      if (!settledRef.current) {
        settledRef.current = true
        stopPolling()
        setStatus('timeout')
      }
    }, GLOBAL_TIMEOUT_MS)
  }, [rowId, mollieId, poll, stopPolling])

  // Filet QA-06 : le deep link auto depuis l'app bancaire n'est pas fiable. Quand l'app
  // repasse au premier plan (retour manuel), on re-poll IMMÉDIATEMENT.
  //
  // GYM-207 — y compris APRÈS un timeout : c'est le cas vécu en production (webhook plus
  // lent que le plafond). Un simple retour dans l'app doit suffire à voir la confirmation,
  // sans que le membre ait quoi que ce soit à faire.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return
      if (!settledRef.current) { poll(); return }
      if (statusRef.current === 'timeout') retryPolling()
    })
    return () => sub.remove()
  }, [poll, retryPolling])

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
    <SafeAreaView className="flex-1" style={{ backgroundColor: tokens.page }} edges={['top', 'bottom']}>
      {/* Fermer (QA-06) — sauf pendant la modale succès qui a son propre CTA */}
      <View className="flex-row justify-end px-5 pt-2">
        <Pressable onPress={handleClose} hitSlop={12} accessibilityLabel={t('payment.close')}>
          <X size={26} color={tokens.onSurface} />
        </Pressable>
      </View>

      <View className="flex-1 items-center justify-center px-8">
        {status === 'polling' && (
          <>
            <ActivityIndicator size="large" color={tokens.onSurface} />
            <Text style={titleStyle} className="mt-4">{t('payment.verifying')}</Text>
            <Text className="mt-3 font-dmsans text-sm text-center" style={{ color: tokens.onBackgroundMuted }}>
              {t('payment.waiting_confirmation')}
            </Text>
            {/* GYM-240 — la connexion est tombée pendant la vérification. On le DIT plutôt
                que de laisser tourner un indicateur qui ne progressera pas, et on rassure :
                le paiement n'est pas perdu, c'est la lecture de son état qui l'est. Le poll
                continue tout seul — le message disparaît au premier tick qui aboutit. */}
            {offline && (
              <View className="mt-6 rounded-xl bg-orange-50 px-4 py-3">
                <Text className="text-center font-dmsans-bold text-sm text-orange-800">
                  {t('payment.offline_title')}
                </Text>
                <Text className="mt-1 text-center font-dmsans text-xs text-orange-700">
                  {t('payment.offline_hint')}
                </Text>
              </View>
            )}
          </>
        )}

        {status === 'success' && (
          <>
            <Text style={{ fontSize: 64, marginBottom: 16 }}>✅</Text>
            <Text style={titleStyle}>{t('payment.success_title')}</Text>
            {payment && (
              <>
                <Text className="mt-3 font-dmsans text-base text-center" style={{ color: tokens.onSurfaceSecondary }}>
                  {payment.plan_name} — {payment.amount}€
                </Text>
                <Text className="mt-1 font-dmsans-bold text-sm text-green-600 text-center">
                  {t('payment.credits_added', { count: payment.credits_granted })}
                </Text>
              </>
            )}
            // 🔴 GYM-286 — A-3/A-4, EN ATTENTE : fond `bg-move-dark` sur un BOUTON.
            <Pressable onPress={goToBookings} style={{ backgroundColor: tokens.actionBg }} className="mt-10 w-full items-center rounded-xl py-4">
              <Text style={ctaLabel}>{t('payment.go_to_bookings')}</Text>
            </Pressable>
          </>
        )}

        {status === 'failed' && (
          <>
            <Text style={{ fontSize: 64, marginBottom: 16 }}>❌</Text>
            <Text style={titleStyle}>{t('payment.failed_title')}</Text>
            <Text className="mt-3 font-dmsans text-sm text-center" style={{ color: tokens.onBackgroundMuted }}>
              {t('payment.failed_message')}
            </Text>
            {/* 🔴 GYM-286 — A-3/A-4, EN ATTENTE : fond `bg-move-dark` sur un BOUTON. */}
            <Pressable onPress={() => router.replace('/profile/subscription')} style={{ backgroundColor: tokens.actionBg }} className="mt-10 w-full items-center rounded-xl py-4">
              <Text style={ctaLabel}>{t('payment.back_to_plans')}</Text>
            </Pressable>
          </>
        )}

        {status === 'timeout' && (
          <>
            <Text style={{ fontSize: 64, marginBottom: 16 }}>⏳</Text>
            <Text style={titleStyle}>{t('payment.timeout_title')}</Text>
            <Text className="mt-3 font-dmsans text-sm text-center" style={{ color: tokens.onBackgroundMuted }}>
              {t('payment.timeout_message')}
            </Text>
            {/* GYM-207 — relance RÉELLE, en remplacement de l'ancienne consigne
                « Tire pour rafraîchir » qui ne correspondait à aucun geste sur cet écran.
                Masquée s'il n'y a aucune clé de paiement à interroger. */}
            {(rowId || mollieId) && (
              // 🔴 GYM-286 — A-3/A-4, EN ATTENTE : fond `bg-move-dark` sur un BOUTON.
              <Pressable onPress={retryPolling} style={{ backgroundColor: tokens.actionBg }} className="mt-10 w-full items-center rounded-xl py-4">
                <Text style={ctaLabel}>{t('payment.check_again')}</Text>
              </Pressable>
            )}
            <Pressable
              onPress={goToBookings}
              className={`w-full items-center rounded-xl border py-4 ${rowId || mollieId ? 'mt-3' : 'mt-10'}`}
              style={{ borderColor: tokens.border }}
            >
              <Text style={{ fontFamily: 'DMSans_700Bold', fontSize: 16, color: tokens.onSurface }}>
                {t('payment.go_to_bookings')}
              </Text>
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
          {/* `bg-black/60` reste : un voile à 60 % n'est nommé par aucun jeton. */}
          <View className="w-full items-center rounded-3xl p-8" style={{ backgroundColor: tokens.surface }}>
            <Text style={{ fontSize: 56, marginBottom: 12 }}>🎉</Text>
            <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 24, color: tokens.onSurface, textAlign: 'center', letterSpacing: 1 }}>
              {t('payment.modal_success_title')}
            </Text>
            <Text className="mt-3 font-dmsans text-sm text-center" style={{ color: tokens.onSurfaceSecondary }}>
              {t('payment.modal_success_body')}
            </Text>
            <Pressable
              onPress={() => { setSuccessVisible(false); goToSuccessDestination() }}
              // 🔴 GYM-286 — A-3/A-4, EN ATTENTE : fond `bg-move-dark` sur un BOUTON.
              style={{ backgroundColor: tokens.actionBg }} className="mt-8 w-full items-center rounded-xl py-4"
            >
              <Text style={ctaLabel}>{t('payment.go_to_bookings')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}
