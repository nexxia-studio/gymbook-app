import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export interface ProgressionData {
  total_seances: number
  seances_this_month: number
  seances_last_month: number
  confirmed_count: number
  no_show_count: number
  streak_weeks: number
  streak_record: number
  histo_30j: { day: string; count: number }[]
  heatmap_52w: { week: string; count: number }[]
  cours_favori: { name: string; count: number } | null
  coach_favori: { name: string; count: number } | null
  membre_since: string | null
}

export function useProgression(gymId: string | null, memberId: string | undefined) {
  const [data, setData] = useState<ProgressionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!gymId || !memberId) return
    setLoading(true)
    setError(null)
    try {
      const { data: res, error: fnError } = await supabase.functions.invoke('get-progression', {
        body: { gym_id: gymId, member_id: memberId },
      })
      if (fnError || res?.error) {
        setError(res?.message ?? fnError?.message ?? 'Erreur')
        return
      }
      setData(res as ProgressionData)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [gymId, memberId])

  useEffect(() => { fetch() }, [fetch])

  return { data, loading, error, refetch: fetch }
}
