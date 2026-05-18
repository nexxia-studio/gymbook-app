import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useGymStore } from '@/stores/useGymStore'

export interface GymSettings {
  waitlistConfirmationMinutes: number
}

export function useGymSettings() {
  const gym = useGymStore((s) => s.gym)
  const [settings, setSettings] = useState<GymSettings | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const load = useCallback(async () => {
    if (!gym?.id) return
    setIsLoading(true)
    const { data, error } = await supabase
      .from('nexxia_gyms')
      .select('waitlist_confirmation_minutes')
      .eq('id', gym.id)
      .single()
    setIsLoading(false)
    if (error || !data) return
    setSettings({ waitlistConfirmationMinutes: data.waitlist_confirmation_minutes ?? 30 })
  }, [gym?.id])

  useEffect(() => { load() }, [load])

  const updateWaitlistDelay = useCallback(async (minutes: number): Promise<{ error?: string }> => {
    if (!gym?.id) return { error: 'no_gym' }
    if (minutes < 10 || minutes > 120) return { error: 'range' }
    const { error } = await supabase
      .from('nexxia_gyms')
      .update({ waitlist_confirmation_minutes: minutes })
      .eq('id', gym.id)
    if (error) return { error: error.message }
    setSettings({ waitlistConfirmationMinutes: minutes })
    return {}
  }, [gym?.id])

  return { settings, isLoading, updateWaitlistDelay }
}
