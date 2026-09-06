import { useEffect } from 'react'
import { View, ActivityIndicator } from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { useTheme } from '../../lib/theme/ThemeProvider'

/**
 * GYM-207 — Route Universal Link : cible de
 * https://links.viniz.app/dopamine/payment-success?source=…&id=<payments.id>
 * (URL de retour Mollie, construite par lib/gymUrls.ts).
 *
 * POURQUOI un Universal Link et pas `dopamine://` : le checkout Mollie est ouvert dans un
 * navigateur in-app (WebBrowser → SFSafariViewController), qui BLOQUE les liens à schéma
 * custom. C'est la raison du bouton « Retourner dans l'app » resté inerte en production :
 * ce n'était pas un bug de la page, mais une restriction du navigateur. Un lien https
 * couvert par l'AASA (paths /dopamine/*) est lui honoré et rouvre l'app directement.
 *
 * Fichier sous `app/dopamine/` comme confirm-waitlist et reset-password : expo-router
 * mappe par path, et l'AASA n'expose que /dopamine/*.
 *
 * Rôle volontairement minimal : transférer les paramètres à l'écran de vérification
 * existant (app/payment/success.tsx), qui porte tout le poll. `id` est ajouté par
 * create-payment à la redirectUrl — c'est la clé qui arme le poll.
 */
export default function PaymentSuccessUniversalLink() {
  const { tokens } = useTheme()
  const router = useRouter()
  const { id, source, slot_id } = useLocalSearchParams<{
    id?: string
    source?: string
    slot_id?: string
  }>()

  useEffect(() => {
    router.replace({
      pathname: '/payment/success',
      params: {
        ...(id ? { id } : {}),
        ...(source ? { source } : {}),
        ...(slot_id ? { slot_id } : {}),
      },
    })
  }, [id, source, slot_id, router])

  return (
    <View className="flex-1 items-center justify-center" style={{ backgroundColor: tokens.page }}>
      <ActivityIndicator size="large" color={tokens.onSurface} />
    </View>
  )
}
