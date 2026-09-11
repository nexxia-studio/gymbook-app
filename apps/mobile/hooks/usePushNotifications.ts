import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import Constants from 'expo-constants'
import { useRouter } from 'expo-router'
import * as Sentry from '@sentry/react-native'
import { supabase } from '../lib/supabase'
import i18n from '../lib/i18n'

// GYM-337 — L'IDENTIFIANT DU CANAL ANDROID, PARTAGÉ AVEC LE SERVEUR.
// `send-notification` envoie `channelId: 'default'` dans le message Expo : les deux valeurs
// doivent rester égales, sinon les notifications retombent dans le canal de repli
// d'expo-notifications et tout ce qui est réglé ci-dessous ne sert à rien.
// ⚠️ Le repli est SÛR : si le canal n'existe pas (binaire antérieur à ce lot),
// expo-notifications journalise et utilise le sien — rien n'est perdu.
const ANDROID_CHANNEL_ID = 'default'

// Detect Expo Go (push not supported there since SDK 53)
const isExpoGo = Constants.appOwnership === 'expo'

// Configure foreground notifications (safe even in Expo Go)
if (!isExpoGo) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  })
}

async function registerForPushNotifications(): Promise<string | null> {
  if (Platform.OS === 'web') return null
  if (!Device.isDevice) return null
  if (isExpoGo) return null

  try {
    // ── GYM-337 — LE CANAL ANDROID ────────────────────────────────────────────────────
    // Posé AVANT la demande de permission : sur Android 13+, l'alerte système arrive alors
    // sur une app qui sait déjà dire de quoi elle va parler.
    //
    // ⚠️ CE QUE CE CANAL CORRIGE N'EST PAS CE QU'ON CROIT — vérifié dans le code natif de la
    // version installée (expo-notifications 0.32.17,
    // BaseNotificationBuilder.kt:101-137) : quand un message n'indique aucun canal,
    // expo-notifications en CRÉE un à la volée
    // (`expo_notifications_fallback_notification_channel`, IMPORTANCE_HIGH, badge et
    // vibration actifs). Les notifications s'AFFICHAIENT donc — dans un canal générique,
    // nommé par une ressource Android (« Miscellaneous » / « Divers »), que le membre ne
    // peut ni identifier ni régler, et dont l'app ne choisissait ni le nom ni l'importance.
    //
    // 🔴 IMPORTANCE ET COULEUR SONT IMMUABLES APRÈS CRÉATION. Android laisse le CONTRÔLE de
    // ces comportements au membre : une fois le canal créé sur un appareil, `importance`,
    // les lumières et le son n'y changent plus, quoi que rappelle l'app à chaque démarrage.
    // Seuls le nom et la description restent modifiables — c'est pourquoi ils sont traduits
    // ici : un changement de langue les met à jour au redémarrage suivant.
    //
    // 🔴 AUCUNE `lightColor`, ET C'EST UN CHOIX MOTIVÉ. Reprendre le #C8F000 des `plugins[]`
    // (le lime Dopamine, faux pour Viniz — c'est GYM-324, hors lot) le GRAVERAIT dans chaque
    // installation : GYM-324 aurait alors deux endroits à corriger, dont un que le correctif
    // ne pourrait PAS atteindre sans changer l'identifiant du canal. La teinte de l'icône
    // reste où elle est, dans le plugin — une seule source, corrigible en une fois.
    //
    // IMPORTANCE `MAX` (heads-up) : une place de liste d'attente se confirme en 30 minutes
    // (art. B6.2 des CGV). Une notification qui n'apparaît pas à l'écran fait perdre la
    // place. C'est aussi ce que pose le canal de repli d'Expo — le membre ne subit donc
    // aucune régression de comportement.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
        name: i18n.t('notifications.channel_default_name'),
        description: i18n.t('notifications.channel_default_description'),
        importance: Notifications.AndroidImportance.MAX,
        showBadge: true,
      })
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync()
    let finalStatus = existingStatus

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync()
      finalStatus = status
    }

    // ⚠️ UN REFUS N'EST PAS UNE ANOMALIE. C'est un choix légitime du membre : il ne doit
    // rien remonter à Sentry, sinon l'alerte utile se noierait dans le bruit.
    if (finalStatus !== 'granted') return null

    const projectId = Constants.expoConfig?.extra?.eas?.projectId
    const tokenData = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    )

    // 🔴 GYM-337 — PERMISSION ACCORDÉE ET AUCUN JETON : VOILÀ L'ANOMALIE.
    // `getExpoPushTokenAsync` peut rendre une valeur vide sans lever. Sans ce contrôle, le
    // cas se confondait avec le refus de permission, et personne ne pouvait les distinguer.
    if (!tokenData?.data) {
      Sentry.captureMessage('[Push] permission accordée, aucun jeton obtenu', {
        level: 'error',
        tags: { area: 'gym337_push_token' },
        extra: { platform: Platform.OS, hasProjectId: Boolean(projectId) },
      })
      return null
    }

    return tokenData.data
  } catch (e) {
    // 🔴 CE `console.log` EST CE QUI A LAISSÉ LE DÉFAUT VIVRE DEPUIS LE PREMIER JOUR.
    // Firebase n'était configuré nulle part : sur Android, l'obtention du jeton échouait à
    // chaque lancement, et l'échec partait dans un log que personne ne lit sur un téléphone
    // de membre. Permission accordée, aucun jeton, aucune alerte, aucune trace.
    //
    // On ne remonte QUE le cas « permission accordée » : le refus est traité plus haut et
    // n'atteint jamais ce bloc, sauf panne réelle de l'API de permissions — auquel cas
    // l'alerte est justifiée.
    console.error('[Push] Registration failed (non-blocking):', e)
    Sentry.captureException(e, {
      tags: { area: 'gym337_push_token' },
      extra: { platform: Platform.OS },
    })
    return null
  }
}

export function usePushNotifications(userId: string | null) {
  const router = useRouter()
  const responseSubscription = useRef<Notifications.EventSubscription | null>(null)

  // Register and store token
  useEffect(() => {
    if (!userId || isExpoGo) return

    registerForPushNotifications().then(async (token) => {
      if (!token) return
      try {
        // 🔴 L'ERREUR N'ÉTAIT PAS AVALÉE PAR LE `catch` — ELLE N'ÉTAIT MÊME PAS LUE.
        // `supabase.from().update()` ne LÈVE PAS sur erreur : il rend `{ error }`. Le
        // `try/catch` d'origine ne pouvait donc rien attraper, et la valeur de retour était
        // jetée. Un jeton obtenu mais jamais stocké est aussi muet qu'un jeton absent —
        // même défaut que celui de ce lot, un cran plus loin dans la chaîne.
        const { error } = await supabase
          .from('profiles')
          .update({ push_token: token })
          .eq('id', userId)
        if (error) {
          console.error('[Push] push_token not stored:', error)
          Sentry.captureException(error, { tags: { area: 'gym337_push_token_store' } })
        }
      } catch (e) {
        console.error('[Push] push_token store threw:', e)
        Sentry.captureException(e, { tags: { area: 'gym337_push_token_store' } })
      }
    })
  }, [userId])

  // Handle notification tap (deep link) — skip in Expo Go
  useEffect(() => {
    if (isExpoGo) return

    try {
      responseSubscription.current = Notifications.addNotificationResponseReceivedListener(
        (response) => {
          const data = response.notification.request.content.data as Record<string, string>
          handleNotificationTap(data)
        },
      )
    } catch {
      // Non-blocking
    }

    return () => {
      if (responseSubscription.current) {
        responseSubscription.current.remove()
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleNotificationTap(data: Record<string, string>) {
    switch (data.type) {
      case 'booking_confirmed':
      case 'booking_cancelled':
        router.push('/(tabs)/bookings')
        break
      case 'waitlist_promotion':
        router.push(`/session/${data.slot_id}` as never)
        break
      case 'noshow_warning':
      case 'noshow_suspension_48h':
      case 'noshow_suspension_2w':
        router.push('/(tabs)/profile')
        break
      case 'slot_cancelled':
        router.push('/(tabs)/schedule')
        break
      case 'reminder_24h':
      case 'reminder_2h':
        router.push(`/session/${data.slot_id}` as never)
        break
    }
  }
}
