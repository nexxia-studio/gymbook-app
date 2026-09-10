// GYM-336 — Demande expresse d'exécution anticipée, à l'achat.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// POURQUOI CET ÉCRAN EXISTE
// ─────────────────────────────────────────────────────────────────────────────────────
// GYM-333b a supprimé des CGV la présomption d'exécution anticipée : l'ancien art. 5.2
// affirmait « en achetant, le membre demande expressément que la prestation commence »,
// alors que rien, nulle part, ne recueillait cette demande — taper une formule ouvrait
// Mollie directement. L'art. B4 dit donc aujourd'hui la vérité : à défaut de demande
// expresse, le remboursement est INTÉGRAL. Cette case est ce qui répare le défaut.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// DEUX EXPORTS, UNE SEULE SOURCE DE CONSENTEMENT
// ─────────────────────────────────────────────────────────────────────────────────────
// `PurchaseConsentBody` porte TOUT ce qui engage : la case, son libellé, le verrou du CTA.
// `PurchaseConsentSheet` n'est que sa mise en modale, pour les écrans qui n'en ont pas
// déjà une. C'est le Body qui garantit que le consentement ne dépend pas du chemin —
// subscription.tsx et PaymentRequiredSheet.tsx affichent la MÊME phrase, sous le MÊME
// verrou, et envoient la MÊME version.
//
// ⚠️ POURQUOI PAS UNE SEULE MODALE POUR LES DEUX. PaymentRequiredSheet EST déjà un
// `Modal`. Empiler deux `Modal` RN transparents en `animationType="slide"` est un montage
// que l'app ne pratique nulle part ailleurs, et dont les défauts de dismiss sur iOS ne se
// voient qu'à l'exécution — or l'app est gelée pour la QA. La feuille existante change
// donc d'ÉTAPE plutôt que d'empiler une seconde modale. Le consentement, lui, reste unique.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// LES DEUX RÈGLES QUI NE SE NÉGOCIENT PAS
// ─────────────────────────────────────────────────────────────────────────────────────
// 1. CASE NON PRÉ-COCHÉE. `useState(false)`, et remise à `false` à chaque ouverture. Une
//    case pré-cochée n'est PAS une demande expresse (art. VI.45 § 3 CDE) : elle enregistre
//    l'inertie du membre, pas sa décision. Une preuve obtenue ainsi ne vaut rien.
// 2. CTA VERROUILLÉ TANT QUE LA CASE EST VIDE. Sans quoi le membre pourrait payer sans
//    avoir rien demandé, et l'écran ne servirait qu'à décorer.
import { useState, useEffect } from 'react'
import { View, Text, Modal, TouchableOpacity, ActivityIndicator } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { ShieldCheck } from 'lucide-react-native'
import { Checkbox } from '../ui/Checkbox'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { formatPrice } from '../../lib/payments'
import { EARLY_PERFORMANCE_CONSENT_I18N_KEY } from '../../constants/earlyPerformance'

export interface PurchaseConsentPlan {
  name: string
  priceCents: number
  currency: string
  /** 'one_time' | 'recurring_fixed' | 'recurring_infinite' — pilote la mention « /mois ». */
  billingType: string
}

interface BodyProps {
  plan: PurchaseConsentPlan
  /** Le paiement est en cours de lancement : verrouille les deux boutons. */
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function PurchaseConsentBody({ plan, busy = false, onCancel, onConfirm }: BodyProps) {
  const { t } = useTranslation()
  const { tokens } = useTheme()
  const router = useRouter()
  const [consent, setConsent] = useState(false)

  // ⚠️ REMISE À ZÉRO AU CHANGEMENT DE FORMULE. Sans cela, un membre qui coche, revient en
  // arrière et choisit une AUTRE formule verrait la case déjà cochée : la demande porterait
  // alors sur un achat qu'il n'a pas encore regardé. Le consentement vaut pour UN achat.
  useEffect(() => {
    setConsent(false)
  }, [plan.name, plan.priceCents, plan.billingType])

  const isRecurring = plan.billingType !== 'one_time'
  const price = formatPrice(plan.priceCents, plan.currency)
  const canConfirm = consent && !busy

  return (
    <View>
      <View className="items-center">
        {/* ⚠️ `bg-move-accent/10`, PAS `tokens.field`. Le lavis à 10 % est le motif de
            pastille d'icône de l'app (PaymentRequiredSheet, verify-email, forgot-password)
            et il n'est nommé par aucun jeton. `field` aurait été le piège exact décrit dans
            ui/Checkbox.tsx : en single il vaut #FFFFFF, soit la couleur de la feuille —
            une pastille invisible sur son propre fond. */}
        <View className="h-12 w-12 items-center justify-center rounded-2xl bg-move-accent/10">
          <ShieldCheck size={24} color={tokens.accentDim} />
        </View>
        <Text className="mt-4 text-center font-barlow text-2xl uppercase" style={{ color: tokens.onSurface }}>
          {t('early_performance.title')}
        </Text>
        <Text className="mt-2 text-center font-dmsans text-sm leading-relaxed" style={{ color: tokens.onSurfaceSecondary }}>
          {isRecurring
            ? t('early_performance.summary_recurring', { plan: plan.name, price })
            : t('early_performance.summary_one_time', { plan: plan.name, price })}
        </Text>
      </View>

      <View className="mt-6 rounded-2xl border p-4" style={{ borderColor: tokens.border, backgroundColor: tokens.surface }}>
        <Checkbox checked={consent} onToggle={() => setConsent((v) => !v)}>
          <Text className="font-dmsans text-sm leading-relaxed" style={{ color: tokens.onSurfaceSecondary }}>
            {t(EARLY_PERFORMANCE_CONSENT_I18N_KEY)}
          </Text>
        </Checkbox>

        {/* Lien tapable vers les CGV — même motif que la case des CGU à l'inscription : le
            <Text onPress> imbriqué capture le tap sans déclencher le toggle de la case. */}
        <Text className="mt-3 font-dmsans text-xs leading-relaxed" style={{ color: tokens.onBackgroundMuted }}>
          {t('early_performance.legal_hint')}{' '}
          <Text
            className="font-dmsans-bold underline"
            style={{ color: tokens.onSurface }}
            accessibilityRole="link"
            onPress={() => router.push('/profile/legal/cgu')}
          >
            {t('early_performance.legal_link')}
          </Text>
        </Text>
      </View>

      <TouchableOpacity
        onPress={onConfirm}
        activeOpacity={0.8}
        disabled={!canConfirm}
        accessibilityState={{ disabled: !canConfirm }}
        style={{ backgroundColor: tokens.actionBg }}
        className={`mt-5 flex-row items-center justify-center gap-3 rounded-2xl px-4 py-4 ${canConfirm ? '' : 'opacity-60'}`}
      >
        {busy && <ActivityIndicator color={tokens.onAction} />}
        <Text className="font-dmsans-bold text-sm" style={{ color: tokens.onAction }}>
          {t('early_performance.confirm')}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={onCancel} activeOpacity={0.7} disabled={busy} className="mt-2 items-center py-3">
        <Text className="font-dmsans text-sm" style={{ color: tokens.onBackgroundMuted }}>
          {t('common.cancel')}
        </Text>
      </TouchableOpacity>
    </View>
  )
}

interface SheetProps extends BodyProps {
  visible: boolean
}

/** Mise en modale du Body, pour les écrans qui n'ont pas déjà une feuille ouverte. */
export function PurchaseConsentSheet({ visible, ...body }: SheetProps) {
  const { tokens } = useTheme()
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={body.onCancel}>
      <View className="flex-1 justify-end bg-black/50">
        {/* `bg-black/50` : un voile à 50 % n'est nommé par aucun jeton — même choix que
            PaymentRequiredSheet, dont cette feuille est le pendant. */}
        <View className="rounded-t-3xl px-6 pb-10 pt-8" style={{ backgroundColor: tokens.surface }}>
          <PurchaseConsentBody {...body} />
        </View>
      </View>
    </Modal>
  )
}
