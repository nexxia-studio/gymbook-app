// GYM-301 (2) — 🔴 « TU N'ES PAS ENCORE MEMBRE » : UN ÉCRAN, PLUS UN BANDEAU.
//
// ═════════════════════════════════════════════════════════════════════════════════════
// CE QUE LE BANDEAU NE POUVAIT PAS FAIRE
// ═════════════════════════════════════════════════════════════════════════════════════
// GYM-300 avait déjà rompu le silence : un bandeau de trois secondes annonçait « tu n'es
// pas membre de X — te voilà chez Y ». C'était mieux que rien, et insuffisant. Le membre
// apprenait le fait au moment où il disparaissait, et il lui restait une app aux couleurs
// d'une salle qu'il n'avait pas demandée, sans aucune porte : ni pour réessayer, ni pour
// comprendre ce qu'il devait faire pour entrer dans la salle qu'il visait.
//
// Cet écran remplace le bandeau pour cette issue-là, et lui seul. Il DIT ce qui manque
// (l'accès, qui s'obtient auprès du gérant) et propose les deux seules suites possibles.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// 🔴 IL EST PEINT AUX COULEURS DE LA SALLE DEMANDÉE, PAS DE CELLE OÙ ON A ATTERRI
// ─────────────────────────────────────────────────────────────────────────────────────
// C'est le point le plus contre-intuitif du lot, et c'est délibéré : au moment où l'écran
// s'affiche, la réconciliation a DÉJÀ basculé le thème ambiant sur la salle du serveur.
// Utiliser `useTheme()` habillerait donc l'écran aux couleurs de la salle où le membre
// n'a jamais voulu aller, pour lui parler de celle qu'il visait. Il résout donc SES
// propres jetons, à partir de la marque capturée dans l'avis.
//
// ⚠️ ET IL PASSE PAR `resolveTheme`, JAMAIS PAR LES COULEURS BRUTES. Une salle peut avoir
// choisi deux couleurs illisibles ensemble ; le garde-fou les écarte et rend la palette
// Viniz. Peindre `brand.primaryColor` en direct ferait de cet écran le seul de l'app à
// pouvoir devenir illisible — et ce serait celui qui annonce une mauvaise nouvelle.
//
// ⚠️ `memberships_unavailable` N'ARRIVE JAMAIS ICI. Une lecture d'adhésions ratée n'est
// pas un refus : rien n'a été décidé, la reprise est armée (GYM-298), et il n'y a aucune
// décision à demander au membre. Elle garde son bandeau. C'est la consigne du lot, et
// c'est aussi la seule lecture juste des deux issues.
import { useEffect, useState } from 'react'
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useRouter, Redirect } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { GYM_MODE, writeSelectedGymSlug } from '../../lib/gymResolver'
import { takeActiveGymNotice, type ActiveGymNotice } from '../../lib/activeGymSession'
import { resolveTheme, VINIZ_THEME } from '../../lib/theme/resolveTheme'
import { useAuthStore } from '../../stores/useAuthStore'
import { PoweredByViniz } from '../../components/viniz/PoweredByViniz'

type Refus = Extract<ActiveGymNotice, { kind: 'not_member' }>

export default function NotMember() {
  const { t } = useTranslation()
  const router = useRouter()
  const signOut = useAuthStore((s) => s.signOut)
  const [refus, setRefus] = useState<Refus | null>(null)
  const [busy, setBusy] = useState(false)

  // ⚠️ L'AVIS EST CONSOMMÉ ICI, ET C'EST POURQUOI L'ACCUEIL SE CONTENTE DE LE REGARDER.
  // S'il le consommait pour décider de nous ouvrir, cet écran arriverait les mains vides :
  // ni nom de salle, ni couleurs, ni salle d'atterrissage à proposer.
  useEffect(() => {
    const avis = takeActiveGymNotice()
    if (avis?.kind === 'not_member') setRefus(avis)
  }, [])

  if (GYM_MODE === 'single') return <Redirect href="/+not-found" />

  // Rechargement à chaud, retour arrière, avis déjà consommé : il n'y a rien à raconter.
  // On renvoie à l'app plutôt que d'afficher un écran de refus sans sujet.
  if (!refus) return <Redirect href="/(tabs)" />

  // Le garde-fou tranche ; sans marque connue, c'est la palette Viniz.
  const tokens = refus.requested
    ? resolveTheme(refus.requested.primaryColor, refus.requested.secondaryColor).tokens
    : VINIZ_THEME
  const nomDemandee = refus.requested?.name ?? null

  // ── Action principale : revenir à la connexion de la salle DEMANDÉE ────────────────
  // 🔴 LA SESSION EST FERMÉE D'ABORD, ET COMPLÈTEMENT. Renvoyer vers un écran de connexion
  // en gardant la session ouverte laisserait l'app dans un état mi-connecté : le membre
  // verrait un formulaire de login alors qu'un `gym_id` actif continue de piloter les
  // écrans derrière. `signOut` purge la session ET le slug local — le slug de la salle
  // demandée est donc réécrit APRÈS, sans quoi la purge l'effacerait aussitôt.
  async function retourConnexion() {
    if (busy) return
    setBusy(true)
    await signOut()
    // 🔴 GYM-294 — LE SLUG PEUT MANQUER, ET CE N'EST PAS UN BUG.
    // Cet écran est désormais aussi atteint depuis un lien profond vers un créneau (voir
    // `useCrossGymGuard`). Dans ce cas on ne connaît que l'IDENTIFIANT de la salle : son
    // slug est illisible, la RLS de `nexxia_gyms` n'exposant une salle qu'à ses membres —
    // et c'est précisément le cas où le membre n'en est pas un.
    //
    // ⚠️ ÉCRIRE UN SLUG VIDE SERAIT PIRE QUE DE NE RIEN ÉCRIRE : le membre repartirait vers
    // une connexion sans marque, sur une salle inexistante. Sans slug, on l'envoie donc à la
    // recherche de salle — le seul écran qui sache repartir de zéro.
    if (refus!.requestedSlug) {
      await writeSelectedGymSlug(refus!.requestedSlug)
      router.replace('/(auth)/login' as never)
      return
    }
    router.replace('/gym/select' as never)
  }

  // ── Action secondaire : aller dans sa salle, sans ressaisir son mot de passe ───────
  // ⚠️ IL N'Y A RIEN À BASCULER ICI, ET C'EST VOULU. La réconciliation a déjà posé la
  // salle du serveur par le chemin sanctionné (`setActiveGymConfirmed`, sur confirmation
  // serveur) et corrigé le slug. Refaire un `switch_active_gym` depuis cet écran
  // dupliquerait la décision hors du seul module qui a le droit de la prendre — et la
  // consigne du lot est de ne pas toucher à la logique de réconciliation. La session
  // reste ouverte : aucun mot de passe n'est redemandé.
  function allerDansMaSalle() {
    if (busy) return
    router.replace('/(tabs)' as never)
  }

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: tokens.background }}>
      <View className="flex-1 justify-center gap-3 px-6">
        <Text
          className="font-dmsans-bold text-2xl leading-8"
          style={{ color: tokens.onBackground }}
        >
          {nomDemandee
            ? t('not_member.title', { gym: nomDemandee })
            : t('not_member.title_unnamed')}
        </Text>
        <Text className="font-dmsans text-sm leading-6" style={{ color: tokens.onBackgroundMuted }}>
          {t('not_member.body')}
        </Text>

        <TouchableOpacity
          accessibilityRole="button"
          disabled={busy}
          onPress={retourConnexion}
          className="mt-6 items-center rounded-2xl py-4"
          style={{ backgroundColor: tokens.accent, opacity: busy ? 0.6 : 1 }}
        >
          {busy ? (
            <ActivityIndicator color={tokens.onAccent} />
          ) : (
            <Text className="font-dmsans-bold text-base" style={{ color: tokens.onAccent }}>
              {nomDemandee
                ? t('not_member.back_to_login', { gym: nomDemandee })
                : t('not_member.back_to_login_unnamed')}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={allerDansMaSalle} className="mt-1 py-3">
          <Text className="text-center font-dmsans text-sm underline" style={{ color: tokens.onBackgroundMuted }}>
            {t('not_member.go_to_mine', { gym: refus.landed })}
          </Text>
        </TouchableOpacity>
      </View>

      {/* La signature suit les couleurs de CET écran, pas celles du thème ambiant. */}
      <PoweredByViniz tokens={tokens} />
    </SafeAreaView>
  )
}
