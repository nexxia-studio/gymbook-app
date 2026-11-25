import { create } from 'zustand'
import { currentMessageScope, fetchUnreadCount } from '../lib/messages/api'
import { createLatestGuard, sameScope } from '../lib/messages/data'

// GYM-391 — le compteur de messages non lus (pastille de la cloche).
//
// ⚠️ BEST-EFFORT : `refresh()` ne lève jamais et ne bloque rien. Ses déclencheurs sont
// montés une fois à la racine (hooks/useUnreadMessages.ts) ; un écran peut aussi l'appeler.
interface MessagesState {
  unreadCount: number
  /** Relit le compteur pour l'utilisateur et la salle courants. Ne lève jamais. */
  refresh: () => Promise<void>
  /** Remet à zéro (déconnexion, changement de salle) et périme toute lecture en cours. */
  reset: () => void
}

// Une réponse tardive ne doit ni écraser une plus récente, ni réafficher un compteur après
// une remise à zéro.
const guard = createLatestGuard()

export const useMessagesStore = create<MessagesState>((set) => ({
  unreadCount: 0,

  refresh: async () => {
    const scope = currentMessageScope()
    // Membre ou salle inconnu : on s'abstient (aucune requête sans les deux filtres).
    if (!scope) return
    const token = guard.begin()
    try {
      const unreadCount = await fetchUnreadCount(scope)
      // Le périmètre est relu à la réponse : même sans `reset()`, le compteur d'une salle
      // quittée ou d'un membre déconnecté ne s'affiche pas.
      if (guard.isCurrent(token) && sameScope(scope, currentMessageScope())) set({ unreadCount })
    } catch (e) {
      // On garde la dernière valeur connue : une pastille qui retombe à 0 sur une coupure
      // réseau puis revient clignoterait pour rien.
      console.error('[messages] unread count failed (non-blocking):', e)
    }
  },

  reset: () => {
    guard.invalidate()
    set({ unreadCount: 0 })
  },
}))
