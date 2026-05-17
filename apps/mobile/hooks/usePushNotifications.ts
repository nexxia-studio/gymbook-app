import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import Constants from 'expo-constants'
import { useRouter } from 'expo-router'
import { supabase } from '../lib/supabase'

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
    const { status: existingStatus } = await Notifications.getPermissionsAsync()
    let finalStatus = existingStatus

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync()
      finalStatus = status
    }

    if (finalStatus !== 'granted') return null

    const projectId = Constants.expoConfig?.extra?.eas?.projectId
    const tokenData = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    )
    return tokenData.data
  } catch (e) {
    console.log('[Push] Registration failed (non-blocking):', e)
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
      if (token) {
        try {
          await supabase
            .from('profiles')
            .update({ push_token: token })
            .eq('id', userId)
        } catch {
          // Non-blocking
        }
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
