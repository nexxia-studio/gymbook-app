// GYM-293 — L'INSCRIPTION A ABOUTI, LE RATTACHEMENT NON.
//
// ═════════════════════════════════════════════════════════════════════════════════════
// L'ÉTAT QUE CET ÉCRAN NOMME
// ═════════════════════════════════════════════════════════════════════════════════════
// Le compte EXISTE — l'email est confirmé, la session est ouverte — mais la salle a refusé
// le rattachement : elle est pleine, ou le quota horaire est atteint, ou son plan n'a pas pu
// être résolu.
//
// ⚠️ CE N'EST PAS UN ÉTAT MI-CRÉÉ, et la distinction n'est pas rhétorique. Rien n'a été
// écrit à moitié : la RPC est une transaction, elle rattache ou elle ne rattache pas. Ce qui
// est incomplet, c'est le PARCOURS — et c'est réparable, par le gérant ou plus tard.
//
// ⚠️ SANS CET ÉCRAN, LE MEMBRE TOMBAIT DANS UNE APP VIDE. C'est ce que la mitigation #230
// cherchait à éviter en masquant l'inscription : un compte sans salle, aucune requête qui
// matche, et rien pour l'expliquer. Rouvrir la porte imposait d'écrire cette sortie-là.
//
// ⚠️ AUX COULEURS DE LA SALLE DEMANDÉE, via le garde-fou — comme l'écran de refus de
// GYM-301, et pour la même raison : l'écran parle d'ELLE. Faute de marque en cache, palette
// Viniz plutôt qu'une couleur devinée.
import { useEffect, useState } from 'react'
import { View, Text, TouchableOpacity } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useRouter, Redirect } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { GYM_MODE } from '../../lib/gymResolver'
import { takeActiveGymNotice, type ActiveGymNotice } from '../../lib/activeGymSession'
import { resolveTheme, VINIZ_THEME } from '../../lib/theme/resolveTheme'
import { readCachedBrand, type GymBrand } from '../../lib/theme/brand'
import { useAuthStore } from '../../stores/useAuthStore'
import { PoweredByViniz } from '../../components/viniz/PoweredByViniz'

type Echec = Extract<ActiveGymNotice, { kind: 'join_failed' }>

/**
 * ⚠️ LE MESSAGE EST CHOISI PAR LE CODE SERVEUR, JAMAIS DEVINÉ. Un code inconnu retombe sur
 * une formulation générique : inventer une cause serait pire que de n'en donner aucune —
 * « salle complète » affiché à qui a simplement perdu le réseau enverrait le membre demander
 * une place qui l'attend.
 */
const MESSAGES: Record<string, string> = {
  GYM_FULL: 'join_failed.full',
  GYM_RATE_LIMITED: 'join_failed.rate_limited',
  GYM_NOT_FOUND: 'join_failed.not_found',
  GYM_EMAIL_NOT_CONFIRMED: 'join_failed.email',
  PLAN_RESOLUTION_FAILED: 'join_failed.unavailable',
  OFFLINE: 'join_failed.unavailable',
}

export default function JoinFailed() {
  const { t } = useTranslation()
  const router = useRouter()
  const signOut = useAuthStore((s) => s.signOut)
  const [echec, setEchec] = useState<Echec | null>(null)
  const [marque, setMarque] = useState<GymBrand | null>(null)

  useEffect(() => {
    const avis = takeActiveGymNotice()
    if (avis?.kind === 'join_failed') {
      setEchec(avis)
      void readCachedBrand(avis.requestedSlug).then(setMarque)
    }
  }, [])

  if (GYM_MODE === 'single') return <Redirect href="/+not-found" />
  // Avis déjà consommé (rechargement à chaud, retour arrière) : il n'y a plus rien à dire.
  if (!echec) return <Redirect href="/(tabs)" />

  const tokens = marque
    ? resolveTheme(marque.primaryColor, marque.secondaryColor).tokens
    : VINIZ_THEME
  const cle = MESSAGES[echec.code] ?? 'join_failed.generic'

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: tokens.background }}>
      <View className="flex-1 justify-center gap-3 px-6">
        <Text className="font-dmsans-bold text-2xl leading-8" style={{ color: tokens.onBackground }}>
          {t('join_failed.title')}
        </Text>
        <Text className="font-dmsans text-sm leading-6" style={{ color: tokens.onBackgroundMuted }}>
          {t(cle, { gym: marque?.name ?? '' })}
        </Text>
        {/* ⚠️ ON DIT QUE LE COMPTE EXISTE. Sans cette phrase, le membre recommencerait une
            inscription qui échouerait sur « email déjà utilisé » — un second cul-de-sac. */}
        <Text className="font-dmsans text-sm leading-6" style={{ color: tokens.onBackgroundMuted }}>
          {t('join_failed.account_exists')}
        </Text>

        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => router.replace('/gym/select' as never)}
          className="mt-6 items-center rounded-2xl py-4"
          style={{ backgroundColor: tokens.actionBg }}
        >
          <Text className="font-dmsans-bold text-base" style={{ color: tokens.onAction }}>
            {t('join_failed.choose_another')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          accessibilityRole="button"
          onPress={async () => { await signOut(); router.replace('/(auth)/login' as never) }}
          className="mt-1 py-3"
        >
          <Text className="text-center font-dmsans text-sm underline" style={{ color: tokens.onBackgroundMuted }}>
            {t('join_failed.sign_out')}
          </Text>
        </TouchableOpacity>
      </View>
      <PoweredByViniz tokens={tokens} />
    </SafeAreaView>
  )
}
