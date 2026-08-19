import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { GYM_ID } from '../constants/dopamine'
import { groupDayEntries, type DayEntry } from '../lib/openGymGroup'
import { getBookingHorizonDays, DEFAULT_HORIZON_DAYS } from '../lib/gymProfile'

/**
 * GYM-242 — les trois périodes proposées au membre.
 *
 * ⚠️ « PLUS TARD » EST NÉ DE L'ÉLARGISSEMENT DE L'HORIZON. Sur 14 jours, « cette semaine »
 * et « semaine prochaine » couvraient TOUT le planning. Sur 30, elles n'en couvrent plus
 * que la moitié, et rien ne permettait d'atteindre le reste : le filtre serait devenu un
 * piège — l'activer aurait CACHÉ des cours sans dire qu'il en existe d'autres.
 */
export type PeriodFilter = 'current' | 'next' | 'later'

export interface ScheduleSlot {
  id: string
  activityId: string
  startsAt: string
  date: string
  dayOfWeek: number
  time: string
  endTime: string
  activity: string
  coach: string
  duration: number
  capacity: number
  booked: number
  color: string
  /** GYM-220 — activities.icon (nom de composant lucide). Vide/inconnu → icône par défaut. */
  icon: string | null
  /**
   * GYM-228 — activité en ACCÈS LIBRE (pas de coach, GYM-229). Critère de regroupement.
   *
   * ⚠️ Repli sur `true` : une activité lue avant la migration GYM-229 garde le
   * comportement historique (une carte par créneau). Replier sur `false` agrégerait des
   * cours collectifs sous une carte « Open Gym ».
   */
  requiresCoach: boolean
}

export interface DaySection {
  date: Date
  dateStr: string
  /**
   * GYM-228 — entrées de la journée : un cours normal, ou UNE carte agrégée pour tous les
   * créneaux d'une même activité en accès libre. La SectionList rend donc un type
   * discriminé, pas des créneaux bruts : sans cela, les 14 créneaux Open Gym générés
   * chaque jour repousseraient le premier vrai cours hors de l'écran.
   */
  data: DayEntry<ScheduleSlot>[]
}

// GYM-241 / GYM-93 — `getGymMonday` remplace le `getMonday` local, qui lisait le fuseau
// du TÉLÉPHONE. Les frontières de semaine se calculent sur l'horloge de la SALLE.
import { formatTime, formatDateStr as formatDateStrTz, toLocalTime, getGymMonday } from '../utils/timezone'

function toDateStr(d: Date): string {
  return formatDateStrTz(d)
}

export function useSchedule() {
  const [allSlots, setAllSlots] = useState<ScheduleSlot[]>([])
  const [isLoading, setIsLoading] = useState(true)
  // GYM-242 — MULTI-SÉLECTION. Un filtre unique obligeait à basculer d'un coach à l'autre ;
  // Nico veut voir « Marie ET Julie ». C'est l'acquis de GYM-128 côté dashboard, porté ici.
  // Liste VIDE = aucun filtre, jamais `null` : une seule forme à tester chez l'appelant.
  const [activityFilters, setActivityFilters] = useState<string[]>([])
  const [coachFilters, setCoachFilters] = useState<string[]>([])
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter | null>(null)
  // Horizon de la salle. Initialisé au défaut plutôt qu'à 0 : le premier rendu se fait
  // AVANT la lecture, et un horizon de 0 afficherait brièvement un planning vide.
  const [horizonDays, setHorizonDays] = useState(DEFAULT_HORIZON_DAYS)

  const fetchSlots = useCallback(async () => {
    setIsLoading(true)
    try {
      // 🔴 GYM-242 — C'ÉTAIT LA CAUSE. `end.setDate(end.getDate() + 14)` : quatorze jours
      // écrits en dur. Le 19 août + 14 = le 2 septembre, très exactement la limite que Nico
      // a constatée. La valeur vient désormais de nexxia_gyms.booking_horizon_days.
      //
      // ⚠️ REPLI PLUTÔT QUE PLANNING VIDE : `getBookingHorizonDays` ne renvoie jamais
      // `null` — hors ligne ou avant l'établissement de la session, elle rend le défaut.
      // Un membre dans le métro doit voir un planning, pas une app qui a l'air cassée.
      const days = await getBookingHorizonDays()
      setHorizonDays(days)

      const start = new Date()
      start.setHours(0, 0, 0, 0)
      const end = new Date(start)
      end.setDate(end.getDate() + days)

      const { data, error } = await supabase
        .from('time_slots')
        .select(`
          id, activity_id, starts_at, ends_at, capacity, bookings_count,
          activities(name, color, duration_min, icon, requires_coach),
          coaches(name)
        `)
        .eq('gym_id', GYM_ID)
        .gte('starts_at', start.toISOString())
        .lt('starts_at', end.toISOString())
        .neq('status', 'cancelled')
        .order('starts_at')

      if (error) throw error

      setAllSlots((data ?? []).map((row: Record<string, unknown>) => {
        const act = row.activities as Record<string, unknown> | null
        const coach = row.coaches as Record<string, unknown> | null
        const startsAt = row.starts_at as string
        const localD = toLocalTime(startsAt)
        return {
          id: row.id as string,
          activityId: row.activity_id as string,
          startsAt: startsAt,
          date: toDateStr(localD),
          dayOfWeek: localD.getDay(),
          time: formatTime(startsAt),
          endTime: formatTime(row.ends_at as string),
          activity: (act?.name as string) ?? 'Open Gym',
          coach: (coach?.name as string) ?? '',
          duration: (act?.duration_min as number) ?? 60,
          capacity: row.capacity as number,
          booked: (row.bookings_count as number) ?? 0,
          color: (act?.color as string) ?? '#4ECDC4',
          icon: (act?.icon as string | null) ?? null,
          requiresCoach: (act?.requires_coach as boolean | undefined) ?? true,
        }
      }))
    } catch (e) {
      console.error('Failed to fetch schedule', e)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { fetchSlots() }, [fetchSlots])

  // Realtime: refresh on time_slots + bookings changes for this gym
  // Fallback polling every 30s in case Realtime fails (network drop, missed event)
  useEffect(() => {
    const channel = supabase
      .channel(`schedule-${GYM_ID}`)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'time_slots', filter: `gym_id=eq.${GYM_ID}` }, (payload) => {
        const deletedId = (payload.old as { id?: string } | null)?.id
        console.log('[Realtime] Schedule time_slots DELETE:', deletedId)
        if (deletedId) {
          setAllSlots((prev) => prev.filter((s) => s.id !== deletedId))
        }
        fetchSlots()
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'time_slots', filter: `gym_id=eq.${GYM_ID}` }, (payload) => {
        console.log('[Realtime] Schedule time_slots INSERT:', payload.new)
        fetchSlots()
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'time_slots', filter: `gym_id=eq.${GYM_ID}` }, (payload) => {
        console.log('[Realtime] Schedule time_slots UPDATE:', payload.new)
        fetchSlots()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: `gym_id=eq.${GYM_ID}` }, (payload) => {
        console.log('[Realtime] Schedule bookings:', payload.eventType)
        fetchSlots()
      })
      .subscribe((status) => {
        console.log('[Realtime] Schedule subscription:', status)
      })

    const pollingInterval = setInterval(() => {
      fetchSlots()
    }, 30000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(pollingInterval)
    }
  }, [fetchSlots])

  const filteredSlots = useMemo(() => {
    let result = allSlots

    // Multi-sélection : une liste vide ne filtre RIEN (elle ne vide pas le planning).
    if (activityFilters.length > 0) result = result.filter((s) => activityFilters.includes(s.activity))
    if (coachFilters.length > 0) result = result.filter((s) => coachFilters.includes(s.coach))

    if (periodFilter) {
      const monday = getGymMonday()
      const nextMonday = new Date(monday)
      nextMonday.setDate(nextMonday.getDate() + 7)
      const afterNext = new Date(monday)
      afterNext.setDate(afterNext.getDate() + 14)

      if (periodFilter === 'current') {
        const endStr = toDateStr(new Date(nextMonday.getTime() - 86400000))
        result = result.filter((s) => s.date <= endStr)
      } else if (periodFilter === 'next') {
        const startStr = toDateStr(nextMonday)
        const endStr = toDateStr(new Date(afterNext.getTime() - 86400000))
        result = result.filter((s) => s.date >= startStr && s.date <= endStr)
      } else {
        // « Plus tard » = tout ce qui reste jusqu'au bout de l'horizon. BORNE OUVERTE côté
        // fin, volontairement : c'est déjà la requête qui borne à l'horizon de la salle.
        // Poser ici une seconde borne créerait deux sources de vérité pour la même limite.
        const startStr = toDateStr(afterNext)
        result = result.filter((s) => s.date >= startStr)
      }
    }

    return result
  }, [allSlots, activityFilters, coachFilters, periodFilter])

  const groupedByDay = useMemo<DaySection[]>(() => {
    const map = new Map<string, ScheduleSlot[]>()
    for (const slot of filteredSlots) {
      if (!map.has(slot.date)) map.set(slot.date, [])
      map.get(slot.date)!.push(slot)
    }
    return Array.from(map.entries()).map(([dateStr, daySlots]) => {
      const [y, mo, d] = dateStr.split('-').map(Number)
      // ⚠️ REGROUPEMENT APRÈS FILTRAGE : la carte agrégée ne doit annoncer que des
      // créneaux réellement affichés. Grouper avant, puis filtrer, laisserait une
      // amplitude « de 7h à 22h » au-dessus de deux créneaux survivants.
      return { date: new Date(y, mo - 1, d), dateStr, data: groupDayEntries(daySlots) }
    })
  }, [filteredSlots])

  const resetFilters = useCallback(() => {
    setActivityFilters([])
    setCoachFilters([])
    setPeriodFilter(null)
  }, [])

  /** Bascule une valeur dans une liste — même geste pour les activités et les coachs. */
  const toggleActivity = useCallback((name: string) => {
    setActivityFilters((prev) => (prev.includes(name) ? prev.filter((v) => v !== name) : [...prev, name]))
  }, [])
  const toggleCoach = useCallback((name: string) => {
    setCoachFilters((prev) => (prev.includes(name) ? prev.filter((v) => v !== name) : [...prev, name]))
  }, [])

  const hasActiveFilters = activityFilters.length > 0 || coachFilters.length > 0 || periodFilter !== null
  /** Nombre de filtres actifs, annoncé sur le bouton : la période compte pour un. */
  const activeFilterCount = activityFilters.length + coachFilters.length + (periodFilter ? 1 : 0)

  /**
   * GYM-242 — « Plus tard » a-t-il quelque chose à montrer ?
   *
   * ⚠️ MESURÉ SUR LES CRÉNEAUX RÉELS, pas déduit de l'horizon. Avec un horizon court (une
   * salle qui règle 7 jours), ou simplement un planning pas encore rempli au-delà de deux
   * semaines, l'option ne renverrait RIEN — un filtre qui vide l'écran sans expliquer
   * pourquoi. Elle est alors masquée : proposer un geste qui ne peut rien donner est le
   * défaut que ce lot corrige, pas un défaut qu'il installe ailleurs.
   */
  const laterAvailable = useMemo(() => {
    const monday = getGymMonday()
    const afterNext = new Date(monday)
    afterNext.setDate(afterNext.getDate() + 14)
    const startStr = toDateStr(afterNext)
    return allSlots.some((s) => s.date >= startStr)
  }, [allSlots])

  // Extract unique coaches from fetched data
  const coaches = useMemo(() => {
    const names = new Set(allSlots.map((s) => s.coach))
    return Array.from(names).filter(Boolean)
  }, [allSlots])

  // GYM-216 — activités du planning, dérivées des créneaux comme les coachs.
  // Les pastilles de filtre étaient écrites en dur (« Open Gym », « HIIT / Hyrox ») :
  // les 4 autres activités de la salle étaient donc impossibles à filtrer.
  const activities = useMemo(() => {
    const names = new Set(allSlots.map((s) => s.activity))
    return Array.from(names).filter(Boolean).sort((a, b) => a.localeCompare(b))
  }, [allSlots])

  return {
    allSlots, filteredSlots, groupedByDay, isLoading,
    activityFilters, toggleActivity,
    coachFilters, toggleCoach,
    periodFilter, setPeriodFilter,
    laterAvailable, horizonDays,
    resetFilters, hasActiveFilters, activeFilterCount,
    coaches, activities, refetch: fetchSlots,
  }
}
