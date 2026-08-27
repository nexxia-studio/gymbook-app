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
import { GYM_MODE } from '../lib/gymResolver'
import {
  takeActiveGymNotice,
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
    const dejaLa = takeActiveGymNotice()
    if (dejaLa) setAvis(dejaLa)
    return subscribeActiveGymNotice(() => {
      const suivant = takeActiveGymNotice()
      if (suivant) setAvis(suivant)
    })
  }, [])

  const dismiss = useCallback(() => setAvis(null), [])

  if (!avis) return { message: null, dismiss }

  if (avis.kind === 'unreachable') {
    return { message: t('active_gym.unreachable'), dismiss }
  }

  // ⚠️ DEUX FORMULATIONS, PARCE QU'ON NE PEUT PAS TOUJOURS NOMMER LA SALLE DEMANDÉE.
  // Quand le choix ne figure pas dans les adhésions, on n'a que son SLUG — et afficher
  // « Tu n'es pas membre de studio-test-staging » donnerait au membre un identifiant
  // technique qu'il n'a jamais vu. Mieux vaut une phrase sans nom qu'un nom faux.
  return {
    message: avis.requested
      ? t('active_gym.not_member', { requested: avis.requested, landed: avis.landed })
      : t('active_gym.not_member_unnamed', { landed: avis.landed }),
    dismiss,
  }
}
