// GYM-312b — L'AIGUILLAGE D'AVANT LA CONNEXION BRANDÉE.
//
// ⚠️ IL VIT ICI, ET PAS DANS `app/(auth)/login.tsx`, POUR UNE RAISON MESURABLE. Cette
// route-là est « l'aiguillage, et rien d'autre » : tout jeton de thème écrit dedans est
// compté par `verify-screen-parity`, qui compare la suite de couleurs de l'écran de
// Dopamine à celle d'avant. Un jeton posé dans une branche que `single` ne rend JAMAIS
// décalait toute la suite et signalait sept faux écarts sur un écran intact. Le code du
// multi vit avec le multi.
import { useState, useEffect } from 'react'
import { View } from 'react-native'
import { Redirect } from 'expo-router'
import { readSelectedGymSlug, subscribeSelectedGymSlug } from '../../lib/gymResolver'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { BrandedLogin } from './BrandedLogin'
import { destinationConnexion } from '../../lib/destinationConnexion'

/**
 * 🔴 GYM-312b — SANS SALLE, ON DEMANDE LA SALLE. ON NE MONTRE PAS UN ÉCRAN ANONYME.
 *
 * `BrandedLogin` porte le logo, les couleurs et le nom d'une salle. Sans slug mémorisé, il
 * n'a rien de tout cela : il rendait un écran noir, au nom vide, sous le thème Viniz par
 * défaut — précisément l'écran générique que GYM-291 avait supprimé du parcours de
 * lancement pour cette raison.
 *
 * ⚠️ LA RÈGLE EXISTE DÉJÀ, ELLE N'ÉTAIT PAS APPLIQUÉE ICI. `VinizLaunch` la tient depuis
 * GYM-291 : session → l'app ; salle connue → la connexion brandée ; pas de salle → la
 * recherche. Mais on n'arrive pas toujours par le lancement — une déconnexion redirige
 * DIRECTEMENT vers cette route, et court-circuitait donc l'aiguillage.
 *
 * ⚠️ ON TRANCHE SUR LE SLUG, PAS SUR LA MARQUE. `brand` est aussi `null` quand la salle est
 * connue mais injoignable (réseau coupé, premier lancement sans cache) : renvoyer alors
 * vers la recherche enverrait le membre chercher une salle qu'il a déjà choisie — et l'y
 * enverrait hors ligne, où la recherche ne peut rien rendre. Le slug, lui, est une lecture
 * LOCALE et ne ment pas sur ce que le membre a choisi.
 */
export function MultiLogin() {
  const { tokens } = useTheme()
  // `undefined` = pas encore lu, et c'est un TROISIÈME état, pas un détail. Le confondre
  // avec « pas de salle » ferait clignoter la recherche devant tout membre branché.
  const [slug, setSlug] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    let alive = true
    readSelectedGymSlug().then((s) => { if (alive) setSlug(s) })
    // Le choix peut changer PENDANT que cet écran est monté — « Ce n'est pas ma salle »
    // efface le slug depuis `BrandedLogin` lui-même. Sans abonnement, l'écran resterait
    // branché sur une salle qu'on vient de quitter.
    const unsubscribe = subscribeSelectedGymSlug((s) => { if (alive) setSlug(s) })
    return () => { alive = false; unsubscribe() }
  }, [])

  switch (destinationConnexion(slug)) {
    // Le temps d'une lecture de stockage local : le fond de la salle, pas un écran blanc.
    case 'attente': return <View className="flex-1" style={{ backgroundColor: tokens.background }} />
    case 'recherche': return <Redirect href={'/gym/select' as never} />
    default: return <BrandedLogin />
  }
}
