import { useCallback, useEffect, useState } from 'react'
import { getISOWeek, subWeeks } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useActiveGymId } from '../lib/activeGym'

export interface ProfileStats {
  completedSessions: number
  activeWeeks: number
}

function isoWeekKey(date: Date): string {
  return `${date.getFullYear()}-${getISOWeek(date)}`
}

function computeStreak(starts: Date[]): number {
  if (starts.length === 0) return 0
  const weekSet = new Set(starts.map(isoWeekKey))
  const today = new Date()
  let streak = 0
  for (let i = 0; i < 52; i++) {
    const ref = subWeeks(today, i)
    if (weekSet.has(isoWeekKey(ref))) {
      streak += 1
    } else if (i > 0) {
      break
    }
    // i === 0 (current week) without session: keep checking past weeks
  }
  return streak
}

export function useProfileStats() {
  const [stats, setStats] = useState<ProfileStats>({ completedSessions: 0, activeWeeks: 0 })
  const [isLoading, setIsLoading] = useState(false)
  const gymId = useActiveGymId()

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    // Salle non résolue : on s'abstient. Requêter sans filtre agrégerait les séances de
    // toutes les salles du membre — un total juste pour personne.
    if (!gymId) return
    setIsLoading(true)
    try {
      const nowIso = new Date().toISOString()

      const { data: rows } = await supabase
        .from('bookings')
        .select('time_slots!inner(starts_at)')
        .eq('member_id', user.id)
        .eq('gym_id', gymId)
        .eq('status', 'confirmed')
        .lt('time_slots.starts_at', nowIso)

      const starts: Date[] = (rows ?? [])
        .map((r) => {
          const ts = (r as { time_slots: { starts_at: string } | { starts_at: string }[] }).time_slots
          const arr = Array.isArray(ts) ? ts : [ts]
          return arr[0]?.starts_at ? new Date(arr[0].starts_at) : null
        })
        .filter((d): d is Date => d !== null)

      setStats({
        completedSessions: starts.length,
        activeWeeks: computeStreak(starts),
      })
    } finally {
      setIsLoading(false)
    }
  // 🔴 GYM-292 — FILTRÉ PAR SALLE, ET IL NE L'ÉTAIT PAS. `.eq('member_id', …)` seul rend
  // les lignes de TOUTES les salles du membre : un membre de trois salles voyait les
  // trois, additionnées, sous la marque d'une seule. La colonne `gym_id` existe et est
  // NOT NULL sur cette table — le filtre manquait, pas la donnée.
  }, [gymId])

  useEffect(() => { load() }, [load])

  return { stats, isLoading, refresh: load }
}
