// GYM-227 — Rafraîchir la session AU RETOUR SUR L'ONGLET.
//
// C'EST LE CAS QUI A PIÉGÉ LA DÉMO du 12/08. `autoRefreshToken` renouvelle par MINUTEUR
// JavaScript, et un onglet en arrière-plan voit ses minuteurs fortement ralentis par le
// navigateur. Nico a laissé le dashboard ouvert en arrière-plan pendant sa présentation :
// le renouvellement n'a pas eu lieu à l'heure, le jeton (1 h) a expiré, et l'onglet est
// revenu au premier plan en affichant toujours un utilisateur connecté.
//
// `visibilitychange` ne dépend d'aucun minuteur : le navigateur l'émet AU MOMENT où
// l'onglet redevient visible, précisément l'instant où l'utilisateur va recliquer.
//
// `focus` complète la couverture : selon les navigateurs, revenir d'une autre FENÊTRE (ou
// du navigateur lui-même repassé au premier plan) n'émet pas toujours visibilitychange.
// ensureFreshSession() est idempotent et déduplique les appels concurrents — les deux
// événements peuvent donc tirer ensemble sans lancer deux renouvellements.
import { useEffect } from 'react'
import { ensureFreshSession } from '@/lib/session'

export function useSessionKeepAlive(enabled: boolean) {
  useEffect(() => {
    // Pas de session (écran de connexion, pages légales publiques) → rien à maintenir.
    if (!enabled) return

    function refreshIfVisible() {
      if (document.visibilityState === 'visible') void ensureFreshSession()
    }

    document.addEventListener('visibilitychange', refreshIfVisible)
    window.addEventListener('focus', refreshIfVisible)

    // Au montage aussi : un onglet restauré par le navigateur (« rouvrir les onglets »)
    // repart d'une session potentiellement périmée sans qu'aucun événement ne survienne.
    refreshIfVisible()

    return () => {
      document.removeEventListener('visibilitychange', refreshIfVisible)
      window.removeEventListener('focus', refreshIfVisible)
    }
  }, [enabled])
}
