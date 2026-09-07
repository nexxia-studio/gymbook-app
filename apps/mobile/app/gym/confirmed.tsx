// GYM-320b — 🔴 L'ARRIVÉE D'UNE CONFIRMATION D'INSCRIPTION, DANS L'APP.
//
// ═════════════════════════════════════════════════════════════════════════════════════
// POURQUOI CET ÉCRAN EXISTE
// ═════════════════════════════════════════════════════════════════════════════════════
// GYM-320 (volet web) a écrit la page `links.viniz.app/<slug>/confirm`. Elle ne suffit
// pas : sur un iPhone où l'app est installée, l'Universal Link est HONORÉ après le 302 de
// GoTrue — mesuré en GYM-313 sur le chemin jumeau /reset-password — et la page web n'est
// jamais rendue. Le lien arrivait donc dans `app/[gymSlug]/[screen].tsx`, dont la liste
// blanche `DESTINATIONS` ne connaissait pas `confirm` : le membre tombait sur l'écran
// « salle introuvable ». Et c'est le chemin PRINCIPAL du parcours, puisqu'on s'inscrit
// depuis l'app — elle est installée par construction.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// CE QUE CET ÉCRAN FAIT, ET SURTOUT CE QU'IL NE FAIT PAS
// ─────────────────────────────────────────────────────────────────────────────────────
// Il ANNONCE un fait déjà acquis, puis il ouvre la porte suivante. Rien d'autre.
//
// 🔴 AUCUNE LOGIQUE DE RATTACHEMENT ICI, ET CE N'EST PAS UN OUBLI. `join_gym_self_serve`
// est appelée par la réconciliation d'ouverture de session (`lib/activeGymSession.ts`)
// quand le choix vient d'un SIGNUP et que le compte n'a aucune adhésion — le mécanisme de
// GYM-293, déjà éprouvé. La refaire ici créerait une SECONDE porte vers la même décision,
// avec sa propre gestion d'erreurs et ses propres refus à traduire, pour un membre qui
// n'est même pas encore connecté. Le rattachement se fait tout seul à la connexion.
//
// 🔴 ET AUCUNE CONFIRMATION NON PLUS. GoTrue a consommé le jeton sur SON domaine avant de
// rediriger : le compte est confirmé quand cet écran s'affiche. Cet écran ne valide rien,
// n'appelle aucune Edge Function, et ne peut donc pas échouer.
//
// ⚠️ LE SLUG A DÉJÀ ÉTÉ MÉMORISÉ, PAR LE RÉSOLVEUR, AVANT D'ARRIVER ICI.
// `app/[gymSlug]/[screen].tsx` appelle `writeSelectedGymSlug(slug)` juste avant de nous
// router — c'est ce qui rend cet écran brandé (le fournisseur de thème est abonné aux
// changements de slug depuis GYM-288) ET ce qui fera reconnaître le contexte à la
// connexion. Il n'y a donc rien à réécrire ici : le faire une seconde fois masquerait le
// jour où le résolveur cesserait de le faire.
import { useEffect, useState } from 'react'
import { View, Text, TouchableOpacity } from 'react-native'
import { Redirect, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { GYM_MODE, readSelectedGymSlug, subscribeSelectedGymSlug } from '../../lib/gymResolver'
import { destinationConnexion } from '../../lib/destinationConnexion'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { useContextGymName } from '../../hooks/useGymName'
import { PoweredByViniz } from '../../components/viniz/PoweredByViniz'

export default function SignupConfirmed() {
  const { t } = useTranslation()
  const router = useRouter()
  const { tokens } = useTheme()

  // ⚠️ `useContextGymName` ET NON `useGymName`. Le second replie sur « Dopamine
  // Performance Club » le temps d'une requête — un repli conçu pour le mode single, qui
  // deviendrait ici un mensonge permanent : le membre n'est pas connecté, `useGymProfile`
  // ne rendra jamais rien, et un candidat de Studio Yoga lirait le nom d'un autre club sur
  // l'écran qui confirme SON compte. C'est exactement le défaut corrigé en GYM-293b sur
  // l'écran d'inscription.
  const nomSalle = useContextGymName()

  // `undefined` = pas encore lu. TROISIÈME état, pas un détail : voir destinationConnexion.
  const [slug, setSlug] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    let alive = true
    readSelectedGymSlug().then((s) => { if (alive) setSlug(s) })
    // Même abonnement que `MultiLogin` : le choix peut changer pendant que l'écran est
    // monté, et un écran branché sur une salle qu'on vient de quitter est un écran qui ment.
    const unsubscribe = subscribeSelectedGymSlug((s) => { if (alive) setSlug(s) })
    return () => { alive = false; unsubscribe() }
  }, [])

  // 🔴 LE GARDE DE MODE — RIEN NE CHANGE POUR DOPAMINE.
  // Identique à `gym/select.tsx` et `gym/not-member.tsx`. En `single` cet écran est
  // enregistré par le routeur mais rien ne peut l'ouvrir : `[gymSlug]/[screen].tsx` sort
  // sur `/+not-found` avant même de résoudre une destination. Le garde est ici par
  // symétrie, pour qu'une navigation directe (rechargement à chaud, lien forgé) ne puisse
  // pas faire apparaître chez Dopamine un écran qui n'existe pas dans son parcours.
  if (GYM_MODE === 'single') return <Redirect href="/+not-found" />

  // 🔴 LA RÈGLE DES TROIS ÉTATS EST RÉUTILISÉE, PAS RÉÉCRITE. `destinationConnexion` est
  // le module isolé de GYM-312b, éprouvé par son banc. L'appeler ici garantit que ce
  // bouton et `MultiLogin` prendront TOUJOURS la même décision — sans quoi on enverrait le
  // membre vers une connexion brandée qui rebondirait aussitôt vers la recherche, et il
  // verrait passer un écran qui n'était pas pour lui.
  const destination = destinationConnexion(slug)

  function continuer() {
    // ⚠️ `replace` ET NON `push` : cet écran est un point de passage. Le laisser dans la
    // pile permettrait de revenir, par le geste de retour, sur une confirmation déjà lue —
    // et depuis un écran de connexion, ce retour n'a aucun sens.
    //
    // ⚠️ SANS SLUG, ON VA À LA RECHERCHE — JAMAIS À `+not-found`. Le cas existe : le
    // stockage local peut être indisponible (`writeSelectedGymSlug` est best-effort et
    // avale son échec), ou le membre peut avoir effacé son choix depuis un autre écran. La
    // connexion brandée n'aurait alors aucune salle à porter.
    router.replace((destination === 'brandee' ? '/(auth)/login' : '/gym/select') as never)
  }

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: tokens.background }}>
      <View className="flex-1 justify-center gap-3 px-6">
        <Text className="font-dmsans-bold text-2xl leading-8" style={{ color: tokens.onBackground }}>
          {t('signup_confirmed.title')}
        </Text>

        {/* ⚠️ DEUX FORMULATIONS, PARCE QUE LE NOM PEUT MANQUER. La marque arrive par une
            requête ; tant qu'elle n'est pas là — ou si la salle est injoignable — écrire
            « chez  » avec un trou serait pire que la phrase neutre. */}
        <Text className="font-dmsans text-sm leading-6" style={{ color: tokens.onBackgroundMuted }}>
          {nomSalle
            ? t('signup_confirmed.body', { gym: nomSalle })
            : t('signup_confirmed.body_unnamed')}
        </Text>

        <TouchableOpacity
          accessibilityRole="button"
          // Le temps de lire le stockage local, le bouton ne peut pas encore savoir où il
          // mène. Il reste visible et à sa place — c'est une lecture locale, pas un aller-
          // retour réseau — mais il n'accepte pas encore d'être pressé.
          disabled={destination === 'attente'}
          onPress={continuer}
          className="mt-6 items-center rounded-2xl py-4"
          style={{ backgroundColor: tokens.accent, opacity: destination === 'attente' ? 0.6 : 1 }}
        >
          <Text className="font-dmsans-bold text-base" style={{ color: tokens.onAccent }}>
            {t('signup_confirmed.cta')}
          </Text>
        </TouchableOpacity>
      </View>

      <PoweredByViniz />
    </SafeAreaView>
  )
}
