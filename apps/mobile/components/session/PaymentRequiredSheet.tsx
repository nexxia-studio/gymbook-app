// GYM-63 — Bottom sheet quand un membre tente de réserver sans abonnement ni crédit.
// GYM-76 — Migré sur gym_plans : plus de prix/codes en dur, create-payment v24 (plan_id UUID).
// L'auto-retry après paiement drop-in est géré par app/payment/success.tsx (GYM-63b)
// via le deep link dopamine://payment/success?slot_id=...&source=drop_in.
import { useState, useEffect, useRef } from 'react'
import { View, Text, TouchableOpacity, Modal, Alert, ActivityIndicator } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { CreditCard, Calendar, Ticket } from 'lucide-react-native'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { SEMANTIC } from '../../lib/theme/semantic'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/useAuthStore'
// GYM-352 — MÊME prédicat que le résumé du profil : un abonnement « actif » se juge sur le
// statut ET sur le terme. Le redéfinir ici en ferait une seconde vérité.
import { ACTIVE_SUBSCRIPTION_STATUSES, isSubscriptionActive } from '../../lib/subscription'
import { useGymPlans } from '../../hooks/useGymPlans'
import { PurchaseConsentBody } from '../payments/PurchaseConsentSheet'
import {
  formatPrice,
  mapPaymentError,
  openCheckout,
  startOneTimeCheckout,
  buildRedirectUrl,
} from '../../lib/payments'

interface PaymentRequiredSheetProps {
  visible: boolean
  slotId: string | null
  onClose: () => void
  // GYM-108 — 'waitlist' quand le créneau est plein : le 402 vient d'une tentative de
  // « rejoindre la liste d'attente » sans crédit/abo. Adapte le titre/sous-titre, mêmes CTA.
  context?: 'book' | 'waitlist'
}

export function PaymentRequiredSheet({ visible, slotId, onClose, context = 'book' }: PaymentRequiredSheetProps) {
  const { t } = useTranslation()
  const { tokens } = useTheme()
  const router = useRouter()
  const gymId = useAuthStore((s) => s.gym_id)
  const memberId = useAuthStore((s) => s.user?.id)
  const { creditPlans, unlimitedPlans, loading: plansLoading, refetch } = useGymPlans()
  const [isLoadingDropIn, setIsLoadingDropIn] = useState(false)
  const [dropInError, setDropInError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // GYM-336 — la feuille a désormais DEUX ÉTAPES. Le drop-in est un achat à distance : il
  // doit recueillir la demande d'exécution anticipée comme n'importe quel autre.
  //
  // ⚠️ UNE ÉTAPE, PAS UNE SECONDE MODALE. Ce composant EST déjà un `Modal` ; en empiler un
  // second n'est pratiqué nulle part dans l'app et ses défauts de dismiss sur iOS ne se
  // voient qu'à l'exécution — or l'app est gelée pour la QA. Le CONSENTEMENT, lui, reste
  // partagé : `PurchaseConsentBody` est le même composant que celui de la feuille montée
  // par profile/subscription.tsx, donc la même phrase, le même verrou, la même version.
  const [step, setStep] = useState<'options' | 'consent'>('options')

  // Plans dérivés de gym_plans (fini les prix en dur)
  const dropInPlan = creditPlans
    .filter((p) => p.creditCount === 1)
    .sort((a, b) => a.priceCents - b.priceCents)[0] ?? null
  const packPlan = creditPlans
    .filter((p) => (p.creditCount ?? 0) > 1)
    .sort((a, b) => a.priceCents - b.priceCents)[0] ?? null
  // GYM-189 — le libellé associé est « À partir de {prix}/mois » : on ne retient donc que
  // les abonnements réellement PRÉLEVÉS MENSUELLEMENT. Un « Illimité 12 mois — paiement
  // unique » (1000 € au total) est bien un plan unlimited, mais annoncer « à partir de
  // 1000 €/mois » serait faux. Filtre sur le mode de paiement, à dessein.
  const monthlyPlans = unlimitedPlans.filter((p) => p.billingType !== 'one_time')
  const cheapestRecurring = monthlyPlans.length
    ? [...monthlyPlans].sort((a, b) => a.priceCents - b.priceCents)[0]
    : null

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  // ⚠️ RETOUR À L'ÉTAPE DES OPTIONS À CHAQUE OUVERTURE. Sans cela, un membre qui ferme la
  // feuille sur l'étape de consentement la rouvrirait dessus, sans avoir rechoisi son
  // achat. (La case elle-même se remet à zéro dans PurchaseConsentBody, qui est démonté
  // avec l'étape — les deux garanties sont indépendantes, et c'est voulu.)
  useEffect(() => {
    if (visible) {
      setStep('options')
      setDropInError(null)
    }
  }, [visible])

  // GYM-94 QA — les CTA abonnement/carnet ouvrent la page des FORMULES, pas l'historique.
  const goToSubscription = () => {
    onClose()
    router.push('/profile/subscription')
  }

  // GYM-336 — les gardes restent AVANT la case : faire cocher un consentement pour un
  // achat qui échouerait de toute façon serait lui faire signer dans le vide.
  const handleDropIn = () => {
    if (!gymId || !slotId || !memberId) {
      Alert.alert(t('common.error'), t('payment_required.errors.no_gym'))
      return
    }
    if (!dropInPlan) {
      Alert.alert(t('common.error'), t('payment_required.errors.no_plan'))
      return
    }
    setDropInError(null)
    setStep('consent')
  }

  // Appelé UNIQUEMENT depuis PurchaseConsentBody, dont le CTA est verrouillé tant que la
  // case est vide : `earlyPerformanceConsent: true` transcrit un geste réel du membre.
  const runDropIn = async () => {
    if (!gymId || !slotId || !memberId || !dropInPlan) return
    setIsLoadingDropIn(true)
    setDropInError(null)
    try {
      const result = await startOneTimeCheckout(dropInPlan.id, {
        gymId,
        // GYM-352 — `slotId` voyage dans l'URL de retour : second signal, indépendant de
        // l'intention sur disque. Sans lui, `app/payment/success.tsx` ne montait jamais son
        // écran de reprise, dont la condition exige `slot_id`.
        redirectUrl: await buildRedirectUrl('drop_in', slotId),
        earlyPerformanceConsent: true,
      })

      if (!result.ok) {
        const info = mapPaymentError(result.code)
        if (info.refetch) refetch()
        setIsLoadingDropIn(false)
        // Retour aux options : l'échec porte sur l'achat, pas sur le consentement, et
        // laisser le membre sur une case déjà cochée lui ferait croire qu'il doit la
        // recocher pour réessayer.
        setStep('options')
        Alert.alert(t('common.error'), t(info.messageKey))
        return
      }

      // ╔═══════════════════════════════════════════════════════════════════════════════╗
      // ║  🔴 GYM-352 — CE POLL DURAIT 60 s POUR UN CRÉDIT QUI MET 2 min 33 s          ║
      // ╚═══════════════════════════════════════════════════════════════════════════════╝
      //
      // `30` tentatives × `2000 ms` = 60 secondes. Or la latence réelle du webhook de
      // crédit est mesurée dans ce dépôt à 2 min 33 s (GYM-207, constat prod du 04/08 —
      // c'est la raison du plafond à 5 min de l'écran de vérification). La continuation
      // était donc 2,5 fois plus courte que le délai qu'elle devait couvrir : tout paiement
      // crédité après une minute perdait le cours. C'est l'explication quantitative des
      // 25 achats sur 70 sans réservation.
      //
      // Nouveau plafond : 5 minutes, ALIGNÉ SUR CELUI DE `app/payment/success.tsx`. Ce
      // n'est pas un chiffre choisi ici — c'est le précédent du dépôt, établi sur une
      // mesure de production, avec sa marge. Deux plafonds différents pour la même attente
      // finiraient par diverger.
      //
      // ⚠️ ET SURTOUT : CE POLL N'EST PLUS CRITIQUE. L'intention est sur le disque
      // (lib/bookingIntent.ts) depuis `session/[id].tsx`. S'il expire, le membre retrouve
      // son cours à la reprise de l'écran ou au prochain lancement. Le poll est devenu un
      // confort — il évite d'attendre — et non plus la condition de tout le parcours.
      const MAX_TENTATIVES = 150 // 150 × 2 s = 5 min
      let pollAttempts = 0
      pollRef.current = setInterval(async () => {
        pollAttempts++
        // GYM-352 — ON INTERROGE LE DROIT, PAS LE CRÉDIT. Cette requête ne regardait que
        // `member_credits` : un ABONNEMENT acheté depuis cette feuille n'y apparaît jamais,
        // et le membre restait devant un spinner jusqu'au bout. Le serveur, lui, autorise
        // les deux à l'identique (`create-booking` : `!activeSubscription && !creditsAvailable`).
        const { data: credits } = await supabase
          .from('member_credits')
          .select('credits_remaining')
          .eq('member_id', memberId)
          .eq('gym_id', gymId)
          .gt('credits_remaining', 0)
        const { data: sub } = await supabase
          .from('member_subscriptions')
          .select('status, ends_at')
          .eq('member_id', memberId)
          .eq('gym_id', gymId)
          .in('status', ACTIVE_SUBSCRIPTION_STATUSES)
          .order('starts_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        const aDesCredits = !!credits && credits.length > 0
        const aUnAbonnement = !!sub && isSubscriptionActive(sub.status, sub.ends_at)

        if (aDesCredits || aUnAbonnement) {
          clearInterval(pollRef.current!)
          pollRef.current = null
          setIsLoadingDropIn(false)
          // 🔴 GYM-352 — PLUS DE RÉSERVATION SILENCIEUSE. Cette branche appelait
          // `createBooking(slotId)` puis fermait la feuille : le membre se retrouvait
          // réservé sans l'avoir confirmé. La décision produit est un geste EXPLICITE.
          // On rend donc la main à la fiche du cours, où l'intention arme le bouton
          // « Confirmer ma réservation ». Un seul endroit décide, quel que soit le chemin
          // de retour — poll, deep link ou retour manuel.
          onClose()
          return
        }
        if (pollAttempts >= MAX_TENTATIVES) {
          clearInterval(pollRef.current!)
          pollRef.current = null
          setIsLoadingDropIn(false)
          // L'intention survit : le message dit d'attendre, pas que c'est perdu.
          setDropInError(t('payment_required.errors.not_confirmed'))
        }
      }, 2000)

      // GYM-352 — LE RÉSULTAT EST LU. Ce chemin échoue à l'identique de celui de
      // profile/subscription.tsx (constaté le 17/09 à 16h03) alors qu'il ne démonte aucune
      // modale et ne navigue pas : la cause est en aval, commune aux deux.
      //
      // ⚠️ TOUJOURS PAS `await` — volontairement. Sur iOS, `openBrowserAsync` ne résout
      // qu'à la FERMETURE du navigateur : attendre ici suspendrait la fonction pendant tout
      // le paiement, alors que le poll des crédits doit tourner PENDANT. On lit le résultat
      // à part, quand il arrive.
      // ⚠️ CET ÉCRAN EST CELUI QUI MARCHE, ET ON N'Y TOUCHE PAS À L'ORDRE. Les deux achats
      // qui ont RÉUSSI les 21–22/09 (Séance d'essai 15 €, One-Shot 20 €) viennent d'ici :
      // la feuille reste montée, rien ne navigue, rien ne se démonte avant la présentation.
      // Il reçoit seulement le contexte de journalisation et les deux défenses internes
      // (désarmement du verrou, réessai unique) — aucune inversion n'est nécessaire.
      void openCheckout(result.checkoutUrl, {
        screen: 'payment_required_sheet',
        paymentId: result.paymentId,
        planId: dropInPlan.id,
      }).then((outcome) => {
        if (outcome.presented) return
        // Le navigateur ne s'est pas affiché : inutile de faire patienter le membre soixante
        // secondes devant un poll de crédits qui ne verra jamais rien.
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
        setIsLoadingDropIn(false)
        setStep('options')
        setDropInError(t('payment_required.errors.checkout_not_opened'))
      })
    } catch (e) {
      console.error('[PaymentRequiredSheet] drop-in uncaught:', e)
      setStep('options')
      Alert.alert(t('common.error'), t('payments.errors.FALLBACK'))
      setIsLoadingDropIn(false)
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/50">
        {/* `bg-black/50` reste : un voile à 50 % n'est nommé par aucun jeton. */}
        <View className="rounded-t-3xl px-6 pb-10 pt-8" style={{ backgroundColor: tokens.surface }}>
          {step === 'consent' && dropInPlan ? (
            <PurchaseConsentBody
              plan={{
                name: dropInPlan.name,
                priceCents: dropInPlan.priceCents,
                currency: dropInPlan.currency,
                billingType: dropInPlan.billingType,
              }}
              busy={isLoadingDropIn}
              onCancel={() => setStep('options')}
              onConfirm={runDropIn}
            />
          ) : (
          <>
          <View className="items-center">
            <View className="h-12 w-12 items-center justify-center rounded-2xl bg-move-accent/10">
              {/* 🔴 GYM-290 (A-1) — TRANCHÉ : un moyen de paiement n'est pas un succès,
                  c'est de la marque. Il rejoint `accentDim`. */}
              <CreditCard size={24} color={tokens.accentDim} />
            </View>
            <Text className="mt-4 text-center font-barlow text-2xl uppercase" style={{ color: tokens.onSurface }}>
              {context === 'waitlist' ? t('payment_required.waitlist_title') : t('payment_required.title')}
            </Text>
            <Text className="mt-2 text-center font-dmsans text-sm leading-relaxed text-move-text-secondary">
              {context === 'waitlist' ? t('payment_required.waitlist_subtitle') : t('payment_required.subtitle')}
            </Text>
          </View>

          <View className="mt-6 gap-3">
            {/* Option 1 — Abonnement */}
            <TouchableOpacity
              onPress={goToSubscription}
              activeOpacity={0.8}
              className="flex-row items-center gap-3 rounded-2xl border px-4 py-4"
              style={{ borderColor: tokens.border, backgroundColor: tokens.surface }}
            >
              <Calendar size={20} color={tokens.onSurface} />
              <View className="flex-1">
                <Text className="font-dmsans-bold text-sm" style={{ color: tokens.onSurface }}>
                  {t('payment_required.option_subscribe.label')}
                </Text>
                <Text className="font-dmsans text-xs" style={{ color: tokens.onBackgroundMuted }}>
                  {cheapestRecurring
                    ? t('payment_required.option_subscribe.sub_from', {
                        price: formatPrice(cheapestRecurring.priceCents, cheapestRecurring.currency),
                      })
                    : t('payment_required.option_subscribe.sub_generic')}
                </Text>
              </View>
            </TouchableOpacity>

            {/* Option 2 — Carnet de séances */}
            <TouchableOpacity
              onPress={goToSubscription}
              activeOpacity={0.8}
              className="flex-row items-center gap-3 rounded-2xl border px-4 py-4"
              style={{ borderColor: tokens.border, backgroundColor: tokens.surface }}
            >
              <Ticket size={20} color={tokens.onSurface} />
              <View className="flex-1">
                <Text className="font-dmsans-bold text-sm" style={{ color: tokens.onSurface }}>
                  {t('payment_required.option_pack.label')}
                </Text>
                <Text className="font-dmsans text-xs" style={{ color: tokens.onBackgroundMuted }}>
                  {packPlan
                    ? t('payment_required.option_pack.sub_priced', {
                        price: formatPrice(packPlan.priceCents, packPlan.currency),
                        count: packPlan.creditCount ?? 0,
                      })
                    : t('payment_required.option_pack.sub_generic')}
                </Text>
              </View>
            </TouchableOpacity>

            {/* Option 3 — Paiement à la séance (drop-in) */}
            <TouchableOpacity
              onPress={handleDropIn}
              activeOpacity={0.8}
              disabled={isLoadingDropIn || plansLoading || !dropInPlan}
              style={{ backgroundColor: tokens.actionBg }}
              className={`flex-row items-center gap-3 rounded-2xl px-4 py-4 ${isLoadingDropIn || plansLoading || !dropInPlan ? 'opacity-60' : ''}`}
            >
              {isLoadingDropIn || plansLoading ? (
                <ActivityIndicator color={tokens.onAction} />
              ) : (
                <CreditCard size={20} color={tokens.onAction} />
              )}
              <View className="flex-1">
                <Text style={{ color: tokens.onAction }} className="font-dmsans-bold text-sm">
                  {dropInPlan
                    ? t('payment_required.option_drop_in.label_priced', {
                        price: formatPrice(dropInPlan.priceCents, dropInPlan.currency),
                      })
                    : t('payment_required.option_drop_in.label_generic')}
                </Text>
                {/* 🔴 GYM-307 — ENCRE RÉSOLUE SUR LE FOND D'ACTION, seuil TEXTE. */}
                <Text className="font-dmsans text-xs" style={{ color: tokens.onActionMuted }}>
                  {t('payment_required.option_drop_in.sub')}
                </Text>
              </View>
            </TouchableOpacity>
          </View>

          {dropInError && (
            <Text className="mt-3 text-center font-dmsans text-sm" style={{ color: SEMANTIC.danger }}>{dropInError}</Text>
          )}

          <TouchableOpacity onPress={onClose} activeOpacity={0.7} className="mt-4 items-center py-3">
            <Text className="font-dmsans text-sm" style={{ color: tokens.onBackgroundMuted }}>{t('common.close')}</Text>
          </TouchableOpacity>
          </>
          )}
        </View>
      </View>
    </Modal>
  )
}
