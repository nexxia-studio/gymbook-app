import { useEffect } from 'react'
import { View, ActivityIndicator } from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { supabase } from '../lib/supabase'

/**
 * Route Universal Link : cible de https://links.viniz.app/dopamine/confirm-waitlist?booking=...
 * (lien du mail waitlist — GYM-45 moitié B). Ouvre l'app au lieu du fallback web.
 *
 * Comportement minimal correct (validé par la consigne) : amener l'utilisateur
 * à l'onglet Réservations, en passant par le login s'il n'est pas authentifié.
 *
 * ⚠️ RESTE À CÂBLER (POINTS D'ATTENTION) :
 *  1. Mapping de path : l'AASA expose les paths `/dopamine/*`, donc l'URL entrante
 *     est `/dopamine/confirm-waitlist`. expo-router mappe cette route sur
 *     `/confirm-waitlist`. Vérifier au build EAS que le Universal Link atterrit bien
 *     ici — sinon ajouter un `linking` prefix (ou déplacer le fichier sous
 *     `app/dopamine/confirm-waitlist.tsx`) pour absorber le préfixe `/dopamine`.
 *  2. Confirmation auto : cette route N'appelle PAS `confirmWaitlist(booking)` du
 *     useBookingStore (la logique métier + les bannières promotion/expiré vivent dans
 *     `app/(tabs)/bookings.tsx`). Pour honorer pleinement l'intention du lien, câbler
 *     le déclenchement de la confirmation pour `booking` (ex. param consommé au focus
 *     de l'écran Réservations, ou appel direct au store). On route ici vers l'existant.
 *  3. Retour post-login : après un login déclenché par ce lien, l'utilisateur n'est
 *     pas ramené automatiquement ici — il atterrit sur /(tabs). À améliorer si besoin
 *     (deep-link différé / redirect param).
 */
export default function ConfirmWaitlist() {
  const router = useRouter()
  const { booking } = useLocalSearchParams<{ booking?: string }>()

  useEffect(() => {
    let cancelled = false

    async function resolve() {
      // Décision d'auth autoritative (indépendante du timing du store).
      const { data } = await supabase.auth.getSession()
      if (cancelled) return

      if (!data.session) {
        // Non authentifié → login. (Retour vers ce lien = point à câbler #3.)
        router.replace('/(auth)/login')
        return
      }

      // Authentifié → onglet Réservations (comportement minimal correct).
      // `booking` est disponible ici pour un câblage ultérieur de la confirmation (#2).
      console.log('[confirm-waitlist] booking param:', booking ?? '(none)')
      router.replace('/(tabs)/bookings')
    }

    resolve()
    return () => { cancelled = true }
  }, [router, booking])

  return (
    <View className="flex-1 items-center justify-center bg-move-bg">
      <ActivityIndicator size="large" color="#C8F000" />
    </View>
  )
}
