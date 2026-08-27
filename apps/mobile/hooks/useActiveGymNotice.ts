// GYM-300 — L'AVIS DE RÉCONCILIATION, TRADUIT ET PRÊT À AFFICHER.
//
// ═════════════════════════════════════════════════════════════════════════════════════
// POURQUOI UN HOOK PLUTÔT QUE TROIS LIGNES DANS L'ÉCRAN
// ═════════════════════════════════════════════════════════════════════════════════════
// L'avis arrive de façon ASYNCHRONE et TARDIVE : la réconciliation part à l'ouverture de
// session et dure deux allers-retours, alors que l'accueil est monté bien avant qu'elle
// ne tranche. Le brancher correctement demande donc un abonnement, une lecture initiale
// (l'avis peut être DÉJÀ posé quand l'écran monte), et un désabonnement propre. Recopier
// cela dans chaque écran qui voudra le message, c'est se garantir qu'un des exemplaires
// oubliera la lecture initiale — et n'affichera rien, une fois sur deux, sans que
// personne ne sache pourquoi.
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'expo-router'
import { GYM_MODE } from '../lib/gymResolver'
import {
  takeActiveGymNotice,
  peekActiveGymNotice,
  subscribeActiveGymNotice,
  type ActiveGymNotice,
} from '../lib/activeGymSession'

/**
 * Le message à afficher, ou `null`. `dismiss` referme le bandeau.
 *
 * ⚠️ EN MODE `single`, REND TOUJOURS `null` ET NE MONTE AUCUN EFFET. La réconciliation
 * sort à sa première ligne en single : il n'y a pas d'avis, il ne peut pas y en avoir, et
 * l'écran d'accueil de Dopamine ne doit rien monter de plus qu'aujourd'hui.
 */
export function useActiveGymNotice(): { message: string | null; dismiss: () => void } {
  const { t } = useTranslation()
  const [avis, setAvis] = useState<ActiveGymNotice | null>(null)

  useEffect(() => {
    if (GYM_MODE === 'single') return
    // ⚠️ LA LECTURE INITIALE N'EST PAS REDONDANTE AVEC L'ABONNEMENT. La réconciliation a
    // pu trancher AVANT que cet écran ne monte — au retour de veille, par exemple, ou si
    // le membre a traîné sur un autre onglet. Sans elle, l'avis resterait en attente
    // indéfiniment, consommé par personne.
    // ⚠️ ON NE CONSOMME QUE CE QU'ON SAIT AFFICHER. Prendre un `not_member` ici le
    // retirerait à l'écran dédié, qui arriverait sans nom de salle ni couleurs.
    const prendreSiPourNous = () => {
      if (peekActiveGymNotice()?.kind !== 'unreachable') return
      const a = takeActiveGymNotice()
      if (a) setAvis(a)
    }
    prendreSiPourNous()
    return subscribeActiveGymNotice(prendreSiPourNous)
  }, [])

  const dismiss = useCallback(() => setAvis(null), [])

  // 🔴 GYM-301 (2) — CE BANDEAU NE PARLE PLUS QUE DE L'INDISPONIBILITÉ.
  //
  // `not_member` avait un bandeau de trois secondes, et c'était trop peu pour ce qu'il
  // avait à dire : le membre apprenait qu'il n'était pas membre de la salle qu'il venait
  // de choisir, et le message disparaissait avant qu'il ait pu décider quoi faire. Il lui
  // restait une app aux couleurs d'une salle qu'il n'avait pas demandée, et aucune porte.
  // Cette issue a désormais son écran (`app/gym/not-member.tsx`), avec deux actions.
  //
  // ⚠️ ET `unreachable` NE L'A PAS SUIVIE, DÉLIBÉRÉMENT. Une lecture d'adhésions ratée
  // n'est pas un refus : rien n'a été décidé, la reprise est déjà armée (GYM-298), et il
  // n'y a AUCUNE décision à demander au membre. Lui barrer l'écran pour une coupure de
  // deux secondes serait hors de proportion. Un bandeau suffit, et c'est la consigne.
  if (avis?.kind === 'unreachable') return { message: t('active_gym.unreachable'), dismiss }
  return { message: null, dismiss }
}

/**
 * GYM-301 (2) — ouvre l'écran dédié quand la réconciliation a refusé le choix.
 *
 * ⚠️ IL REGARDE, IL NE PREND PAS. L'avis porte le nom, les couleurs et la salle
 * d'atterrissage : c'est l'ÉCRAN qui doit le consommer. Le prendre ici pour décider de
 * naviguer le lui retirerait, et il s'ouvrirait sans rien à afficher.
 *
 * ⚠️ POURQUOI DEPUIS L'ACCUEIL, ET NON DEPUIS LA RACINE. La réconciliation est déclenchée
 * par l'arrivée de la session, bien avant que le routeur ne soit prêt : naviguer de là
 * viserait un navigateur qui n'existe pas encore. L'accueil est l'écran où le membre
 * atterrit — au moment où il est monté, il y a forcément quelque part où aller.
 *
 * En mode `single` il ne monte aucun effet : il n'y a pas d'avis, il ne peut pas y en
 * avoir, et l'accueil de Dopamine ne doit rien faire de plus qu'aujourd'hui.
 */
export function useNotMemberRedirect(): void {
  const router = useRouter()
  useEffect(() => {
    if (GYM_MODE === 'single') return
    const ouvrirSiRefus = () => {
      if (peekActiveGymNotice()?.kind !== 'not_member') return
      router.replace('/gym/not-member' as never)
    }
    ouvrirSiRefus()
    return subscribeActiveGymNotice(ouvrirSiRefus)
  }, [router])
}
