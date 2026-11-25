import { useEffect } from 'react'
import { AppState, Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import Constants from 'expo-constants'
import { useActiveGymId } from '../lib/activeGym'
import { useMessagesStore } from '../stores/useMessagesStore'

// Même garde que hooks/usePushNotifications.ts : pas de push dans Expo Go (SDK 53+).
const isExpoGo = Constants.appOwnership === 'expo'

/**
 * GYM-391 — les déclencheurs du compteur de messages non lus. À monter UNE fois, à la racine.
 *
 * Relit le compteur dès que l'utilisateur et la salle active sont connus, quand l'un des
 * deux change, au retour au premier plan et à la réception d'un push en premier plan. Le
 * remet à zéro à la déconnexion et au changement de salle, avant le nouveau chargement.
 *
 * ⚠️ BEST-EFFORT : rien n'est attendu ici, `refresh()` ne lève jamais, et aucun rendu n'en
 * dépend. Le démarrage, les portes et la navigation ne passent pas par ce hook.
 */
export function useUnreadMessages(userId: string | null): void {
  const gymId = useActiveGymId()

  useEffect(() => {
    const { refresh, reset } = useMessagesStore.getState()
    // Le compteur affiché appartenait à l'ancien couple membre/salle (ou à personne).
    reset()
    if (!userId || !gymId) return

    void refresh()

    const appState = AppState.addEventListener('change', (etat) => {
      if (etat === 'active') void refresh()
    })

    let push: Notifications.EventSubscription | null = null
    if (Platform.OS !== 'web' && !isExpoGo) {
      try {
        push = Notifications.addNotificationReceivedListener(() => { void refresh() })
      } catch {
        // Non bloquant : sans cet écouteur, le retour au premier plan rattrape le compteur.
      }
    }

    return () => {
      appState.remove()
      push?.remove()
    }
  }, [userId, gymId])
}
