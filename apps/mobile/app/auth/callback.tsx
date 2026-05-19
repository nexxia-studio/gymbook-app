import { useEffect } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { supabase } from '../../lib/supabase'
import { ensureProfile } from '../../lib/ensureProfile'

export default function AuthCallback() {
  const router = useRouter()

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        await ensureProfile(session.user)
        router.replace('/(tabs)')
      } else {
        router.replace('/(auth)/login')
      }
    })()
  }, [router])

  return <View />
}
