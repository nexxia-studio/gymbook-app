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
      </View>

      {/* 🔴 GYM-346 — CE QU'ON ACHÈTE, D'ABORD ET EN GRAND.
          La formule et le prix étaient une ligne grise centrée sous le titre, de la même
          taille que la clause juridique qui suit : le membre ouvrait la feuille sur un mur
          de texte sans y trouver ce qu'il est en train de payer. Ils deviennent le premier
          bloc, à l'encre pleine — la case vient APRÈS, une fois l'achat identifié.
          ⚠️ AUCUNE COULEUR NOUVELLE, ET AUCUN FOND : la hiérarchie est faite par la
          TYPOGRAPHIE seule (gras/base contre régulier/sm), avec `onSurface` et
          `onSurfaceSecondary` — les deux encres déjà employées sur cette feuille. Le
          garde-fou de contraste n'a donc rien de neuf à trancher.
          🔴 `tokens.field` AVAIT ÉTÉ ESSAYÉ ICI, ET C'ÉTAIT LE PIÈGE DÉJÀ DOCUMENTÉ DANS
          ui/Checkbox.tsx ET EN GYM-337 : en single il vaut #FFFFFF, soit exactement la
          couleur de la feuille (`surface`). Le bloc aurait été invisible sur son propre
          fond chez Dopamine. Pas de fond du tout : rien à faire disparaître. */}
      <View className="mt-5">
        <Text className="font-dmsans-bold text-base leading-6" style={{ color: tokens.onSurface }}>
          {plan.name}
        </Text>
        <Text className="mt-1 font-dmsans text-sm leading-6" style={{ color: tokens.onSurfaceSecondary }}>
          {isRecurring
            ? t('early_performance.summary_recurring', { plan: plan.name, price })
            : t('early_performance.summary_one_time', { plan: plan.name, price })}
        </Text>
      </View>

      <View className="mt-4 rounded-2xl border p-4" style={{ borderColor: tokens.border, backgroundColor: tokens.surface }}>
        {/* 🔴 LE LIBELLÉ EST RACCOURCI, PAS AFFAIBLI (GYM-336b). Il faisait quatre lignes à
            l'écran d'achat. L'art. VI.53, 1° CDE exige DEUX éléments, et les deux y sont
            toujours, en une seule phrase :
              a. la DEMANDE EXPRESSE → « je demande à commencer maintenant » ;
              b. la RECONNAISSANCE de la perte du droit → « renonce à mon droit de
                 rétractation de 14 jours pour la part déjà utilisée ».
            ⚠️ TOUT RACCOURCISSEMENT SUPPLÉMENTAIRE TOUCHERAIT L'UN DES DEUX. Ce n'est pas
            une marge de style, c'est le plancher légal.
            ⚠️ ET CE LIBELLÉ EST VERSIONNÉ : le modifier sans incrémenter
            EARLY_PERFORMANCE_CONSENT_VERSION ferait porter le même numéro à deux textes
            différents, et la preuve ne dirait plus QUOI a été accepté. */}
        <Checkbox checked={consent} onToggle={() => setConsent((v) => !v)}>
          <Text className="font-dmsans text-sm leading-6" style={{ color: tokens.onSurfaceSecondary }}>
            {t(EARLY_PERFORMANCE_CONSENT_I18N_KEY)}
          </Text>
        </Checkbox>

        {/* La phrase « Cette demande est enregistrée avec votre achat… » est SUPPRIMÉE :
            aucune valeur juridique, c'était du confort de lecture.
            🔴 LE LIEN, LUI, RESTE — ÉCART ASSUMÉ AVEC LE CADRAGE, qui le supposait
            « accessible ailleurs dans l'écran ». Il ne l'est pas : ce `router.push` était le
            SEUL accès aux CGV de cette feuille, et la feuille est une MODALE — en sortir
            demande d'annuler l'achat. Le retirer aurait coupé l'accès au contrat au moment
            précis où on le fait accepter. Il ne reste donc que le lien, sans phrase autour :
            deux mots au lieu de deux phrases.
            Le <Text onPress> capture le tap sans déclencher le toggle de la case — même
            motif que la case des CGU à l'inscription. */}
        <Text
          className="mt-3 font-dmsans text-xs underline"
          style={{ color: tokens.onBackgroundMuted }}
          accessibilityRole="link"
          onPress={() => router.push('/profile/legal/cgu')}
        >
          {t('early_performance.legal_link')}
        </Text>
      </View>

      <TouchableOpacity
        onPress={onConfirm}
        activeOpacity={0.8}
        disabled={!canConfirm}
        accessibilityState={{ disabled: !canConfirm }}
        style={{ backgroundColor: tokens.actionBg }}
        // ⚠️ `mt-7` ET NON `mt-5` : le bouton touchait presque la clause. Un CTA collé au
        // texte qu'il valide invite à taper avant d'avoir lu — c'est de la mise en forme,
        // mais elle porte sur le geste qu'on demande.
        className={`mt-7 flex-row items-center justify-center gap-3 rounded-2xl px-4 py-4 ${canConfirm ? '' : 'opacity-60'}`}
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
  /**
   * 🔴 23/09 — APPELÉ QUAND LA FEUILLE EST RÉELLEMENT PARTIE DE L'ÉCRAN (iOS).
   *
   * C'est `Modal.onDismiss` de React Native, transmis tel quel : il se déclenche APRÈS que
   * UIKit a terminé le dismiss, pas au changement d'état React. C'est la seule façon de
   * savoir que plus rien ne va disparaître — et donc le seul moment où l'on peut présenter
   * Safari sans qu'un démontage l'emporte avec lui.
   *
   * ⚠️ iOS UNIQUEMENT. React Native n'appelle pas `onDismiss` sur Android : l'appelant doit
   * prévoir son propre chemin (cf. `subscription.tsx`). Ce n'est pas une lacune à
   * contourner — sur Android le navigateur est une ACTIVITÉ séparée, pas un contrôleur
   * présenté par une vue : il n'y a rien à faire disparaître sous lui.
   */
  onDismissed?: () => void
}

/**
 * Mise en modale du Body, pour les écrans qui n'ont pas déjà une feuille ouverte.
 *
 * 🔴 CE COMPOSANT DOIT RESTER MONTÉ PENDANT SA FERMETURE. L'appelant pilote `visible`, il
 * ne doit PAS le démonter conditionnellement : un démontage supprime la `Modal` sans que
 * UIKit joue le dismiss — `onDismiss` ne part jamais, et un contrôleur présenté par cette
 * vue (Safari) disparaît avec elle, sans prévenir personne. C'est exactement le défaut du
 * 23/09.
 */
export function PurchaseConsentSheet({ visible, onDismissed, ...body }: SheetProps) {
  const { tokens } = useTheme()
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={body.onCancel}
      onDismiss={onDismissed}
    >
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
