// GYM-102 (4/5) — L'ARRIVÉE D'UN LIEN PROFOND MULTI-SALLES.
//
// Cible de https://links.viniz.app/{slug}/{écran} pour TOUTE salle qui n'est pas Dopamine.
// L'AASA exclut explicitement /dopamine/* de l'app Viniz (cf. apps/links/README.md) : ces
// liens-là n'arrivent jamais ici, ils vont à l'app de Nico.
//
// ═════════════════════════════════════════════════════════════════════════════════════
// 🔴 EN MODE `single`, CETTE ROUTE SE COMPORTE COMME SI ELLE N'EXISTAIT PAS.
// ═════════════════════════════════════════════════════════════════════════════════════
// Le routeur d'Expo enregistre le fichier dans TOUS les builds — y compris celui de
// Dopamine. Or un segment dynamique attrape ce qui, aujourd'hui, tombe en « page
// introuvable » : `/dopamine/bookings` et `/dopamine/delete-account` sont couverts par
// l'AASA de Dopamine mais n'ont AUCUNE route dans l'app (constaté, cf. PR). Sans le garde
// ci-dessous, ces deux liens changeraient de comportement sur l'app de production —
// exactement ce que le chantier interdit.
//
// ⚠️ Les chemins /dopamine/* qui ONT une route (reset-password, payment-success,
// confirm-waitlist) ne passent de toute façon pas par ici : un segment STATIQUE l'emporte
// toujours sur un segment dynamique dans expo-router.
import { useEffect, useState } from 'react'
import { View, Text, ActivityIndicator, TouchableOpacity } from 'react-native'
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { GYM_MODE, readSelectedGymSlug, writeSelectedGymSlug } from '../../lib/gymResolver'
import { fetchBrand, readCachedBrand, type GymBrand } from '../../lib/theme/brand'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { supabase } from '../../lib/supabase'

/**
 * Les écrans qu'un lien peut viser, et leur destination dans l'app.
 *
 * ⚠️ LISTE BLANCHE, PAS UNE CONSTRUCTION DE CHEMIN. Router sur `/${screen}` laisserait une
 * URL entrante décider d'une navigation interne : un lien forgé pourrait ouvrir n'importe
 * quel écran de l'app avec les paramètres de son choix.
 *
 * ⚠️ `reset-password` VISE `/dopamine/reset-password`, ET C'EST UN EMPRUNT ASSUMÉ. Toute
 * la logique de récupération de session vit dans cet écran ; le déplacer casserait le lien
 * de Dopamine, que ce lot n'a pas le droit de toucher. Le chemin n'est jamais visible sur
 * mobile (pas de barre d'adresse), mais l'écran porte encore les couleurs Dopamine — la
 * limite connue du lot 3, à lever quand les 441 classes `move-*` seront migrées.
 */
const DESTINATIONS: Record<string, string> = {
  'reset-password': '/dopamine/reset-password',
  'payment-success': '/payment/success',
  'confirm-waitlist': '/(tabs)/bookings',
  'bookings': '/(tabs)/bookings',
  'delete-account': '/profile/delete-account',
}

type Phase =
  | { step: 'resolving' }
  /** Le lien vise une AUTRE salle que celle où le membre est connecté. */
  | { step: 'confirm'; incoming: GymBrand; currentSlug: string }
  | { step: 'go'; to: string }
  | { step: 'unknown' }

export default function DeepLinkEntry() {
  const { gymSlug, screen, ...rest } = useLocalSearchParams<Record<string, string>>()
  const { t } = useTranslation()
  const router = useRouter()
  const { tokens } = useTheme()
  const [phase, setPhase] = useState<Phase>({ step: 'resolving' })

  useEffect(() => {
    if (GYM_MODE === 'single') return
    let alive = true

    async function resolve() {
      const slug = (gymSlug ?? '').trim().toLowerCase()
      const target = DESTINATIONS[screen ?? '']
      if (!slug || !target) { if (alive) setPhase({ step: 'unknown' }); return }

      // 1. La salle existe-t-elle ? `public_gym_branding` est la seule source.
      const res = await fetchBrand(slug)
      if (!alive) return

      let brand: GymBrand | null = res.status === 'ok' ? res.brand : null
      if (!brand && res.status === 'error') {
        // ⚠️ HORS LIGNE N'EST PAS « SALLE INCONNUE ». Si on a déjà vu cette salle, on la
        // croit : renvoyer le membre vers la recherche parce que le réseau a coupé lui
        // ferait perdre son lien sans qu'aucun des deux faits ne soit vrai.
        brand = await readCachedBrand(slug)
        if (!alive) return
      }
      if (!brand) { setPhase({ step: 'unknown' }); return }

      // 2. Le membre est-il connecté ailleurs ?
      const { data } = await supabase.auth.getSession()
      if (!alive) return
      const currentSlug = await readSelectedGymSlug()
      if (!alive) return

      if (data.session && currentSlug && currentSlug !== slug) {
        // 🔴 ON NE BASCULE PAS EN SILENCE. Le membre a cliqué un lien, pas demandé à
        // changer de salle : le faire sans le dire lui retirerait son contexte — ses
        // réservations, sa marque, son planning — sans qu'il comprenne ce qui s'est passé,
        // ni comment revenir.
        setPhase({ step: 'confirm', incoming: brand, currentSlug })
        return
      }

      await writeSelectedGymSlug(slug)
      if (!alive) return
      setPhase({ step: 'go', to: target })
    }

    resolve()
    return () => { alive = false }
  }, [gymSlug, screen])

  // 🔴 Le garde de mode. Rend exactement ce que rendait l'app avant ce lot.
  if (GYM_MODE === 'single') return <Redirect href="/+not-found" />

  if (phase.step === 'go') {
    // Les paramètres de l'URL sont transmis tels quels : `?id=` arme le poll de paiement,
    // `?booking=` la confirmation de liste d'attente. Le fragment `#access_token`, lui, ne
    // passe pas par le routeur — l'écran de réinitialisation lit l'URL entrante d'origine
    // via `Linking.useURL()`, qui n'est pas affectée par cette navigation interne.
    return <Redirect href={{ pathname: phase.to as never, params: rest }} />
  }

  if (phase.step === 'unknown') {
    return (
      <Redirect href={{ pathname: '/gym/select' as never, params: { reason: 'unknown_gym' } }} />
    )
  }

  if (phase.step === 'confirm') {
    return (
      <SafeAreaView className="flex-1" style={{ backgroundColor: tokens.background }}>
        <View className="flex-1 justify-center gap-6 px-6">
          <Text className="font-dmsans-bold text-xl" style={{ color: tokens.onBackground }}>
            {t('deep_link.switch_title')}
          </Text>
          <Text className="font-dmsans text-sm leading-6" style={{ color: tokens.onBackgroundMuted }}>
            {t('deep_link.switch_message', {
              incoming: phase.incoming.name,
              current: phase.currentSlug,
            })}
          </Text>

          <TouchableOpacity
            accessibilityRole="button"
            className="items-center rounded-2xl py-4"
            style={{ backgroundColor: tokens.accent }}
            onPress={async () => {
              await writeSelectedGymSlug(phase.incoming.slug)
              setPhase({ step: 'go', to: DESTINATIONS[screen ?? ''] ?? '/' })
            }}
          >
            <Text className="font-dmsans-bold text-base" style={{ color: tokens.onAccent }}>
              {t('deep_link.switch_confirm', { gym: phase.incoming.name })}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity accessibilityRole="button" onPress={() => router.replace('/(tabs)' as never)}>
            <Text className="text-center font-dmsans text-sm" style={{ color: tokens.onBackgroundMuted }}>
              {t('deep_link.switch_cancel')}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <View className="flex-1 items-center justify-center" style={{ backgroundColor: tokens.background }}>
      <ActivityIndicator size="large" color={tokens.onBackground} />
    </View>
  )
}
