import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useBookingStore } from '../stores/useBookingStore'
import { useActiveGymId } from '../lib/activeGym'
import { groupDayEntries } from '../lib/openGymGroup'

export interface HomeSlot {
  id: string
  activityId: string
  startsAt: string
  date: string
  time: string
  endTime: string
  activity: string
  activityColor: string
  coach: string
  duration: number
  capacity: number
  booked: number
  /** GYM-216 — activities.image_url. Vide → repli neutre (cas nominal aujourd'hui). */
  imageUrl: string | null
  /** GYM-220 — activities.icon (nom de composant lucide). Vide/inconnu → icône par défaut. */
  icon: string | null
  /**
   * GYM-228 — activité en ACCÈS LIBRE (pas de coach, GYM-229). C'est le critère de
   * regroupement en carte unique.
   *
   * ⚠️ Repli sur `true` : une activité lue avant la migration GYM-229 garde le
   * comportement historique (cours encadré, une carte par créneau). Ne JAMAIS replier sur
   * `false` — cela agrégerait des cours collectifs en une carte « Open Gym ».
   */
  requiresCoach: boolean
}

import { formatTime, formatDateStr, toLocalTime } from '../utils/timezone'

function diffMin(start: string, end: string): number {
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000)
}

export function useHomeSchedule() {
  // GYM-289 — la salle vient de la source unique, plus de la constante de build.
  // ⚠️ `null` = pas encore résolue : on NE REQUÊTE PAS. Une requête sans filtre
  // `gym_id` rendrait les créneaux de TOUTES les salles.
  const gymId = useActiveGymId()
  const [slots, setSlots] = useState<HomeSlot[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [confirmedSlotIds, setConfirmedSlotIds] = useState<Set<string>>(new Set())
  const [waitlistedSlotIds, setWaitlistedSlotIds] = useState<Set<string>>(new Set())
  const { favorites, addFavorite, removeFavorite, isFavorite: storeIsFavorite } = useBookingStore()

  const days = (() => {
    const today = new Date()
    return [0, 1, 2].map((offset) => {
      const d = new Date(today)
      d.setDate(d.getDate() + offset)
      d.setHours(0, 0, 0, 0)
      return d
    })
  })()

  const fetchSlots = useCallback(async () => {
    // ⚠️ SANS SALLE, ON NE REQUÊTE PAS (cf. lib/activeGym). N'arrive qu'en mode `multi`,
    // entre l'ouverture de session et l'arrivée du profil.
    if (!gymId) { setIsLoading(false); return }
    setIsLoading(true)
    try {
      const start = new Date()
      start.setHours(0, 0, 0, 0)
      const end = new Date(start)
      end.setDate(end.getDate() + 3)

      const { data, error } = await supabase
        .from('time_slots')
        .select(`
          id, activity_id, starts_at, ends_at, capacity, bookings_count,
          activities(name, color, duration_min, image_url, icon, requires_coach),
          coaches(name)
        `)
        .eq('gym_id', gymId)
        .gte('starts_at', start.toISOString())
        .lt('starts_at', end.toISOString())
        .neq('status', 'cancelled')
        .order('starts_at')

      if (error) throw error

      setSlots((data ?? []).map((row: Record<string, unknown>) => {
        const act = row.activities as Record<string, unknown> | null
        const coach = row.coaches as Record<string, unknown> | null
        const actName = (act?.name as string) ?? 'Open Gym'
        return {
          id: row.id as string,
          activityId: row.activity_id as string,
          startsAt: row.starts_at as string,
          date: formatDateStr(row.starts_at as string),
          time: formatTime(row.starts_at as string),
          endTime: formatTime(row.ends_at as string),
          activity: actName,
          activityColor: (act?.color as string) ?? '#4ECDC4',
          coach: (coach?.name as string) ?? '',
          duration: diffMin(row.starts_at as string, row.ends_at as string),
          capacity: row.capacity as number,
          booked: (row.bookings_count as number) ?? 0,
          imageUrl: (act?.image_url as string | null) ?? null,
          icon: (act?.icon as string | null) ?? null,
          requiresCoach: (act?.requires_coach as boolean | undefined) ?? true,
        }
      }))
    } catch (e) {
      console.error('Failed to fetch home schedule', e)
    } finally {
      setIsLoading(false)
    }
    // `gymId` EN DÉPENDANCE : c'est ce qui fait rejouer la requête ET refermer le canal
    // temps réel quand la salle change (cf. la note dans l'effet ci-dessous).
  }, [gymId])

  useEffect(() => { fetchSlots() }, [fetchSlots])

  // Realtime: refresh on time_slots + bookings changes for this gym
  // Fallback polling every 30s in case Realtime fails (network drop, missed event)
  useEffect(() => {
    // 🔴 GYM-289 — LE TEMPS RÉEL EST LE POINT LE PLUS DÉLICAT DU LOT.
    //
    // Un canal Supabase ne se « purge » pas : son filtre est figé à la souscription,
    // côté serveur. Laisser ouvert un canal filtré sur l'ancienne salle, c'est continuer
    // de POUSSER À CE MEMBRE LES ÉVÉNEMENTS D'UN AUTRE CLIENT — les réservations des
    // membres d'une salle où il n'a rien à voir. Il faut donc FERMER et ROUVRIR.
    //
    // C'est exactement ce que fait cet effet, et la chaîne qui le garantit tient en trois
    // maillons qu'il ne faut pas casser :
    //   1. `fetchSlots` dépend de `gymId` ;
    //   2. cet effet dépend de `fetchSlots` ;
    //   3. son `return` appelle `supabase.removeChannel`.
    // Changement de salle → nouvelle `fetchSlots` → nettoyage (canal fermé, polling
    // arrêté) → nouvelle souscription sur la nouvelle salle. Montage et démontage passent
    // par le même chemin.
    //
    // ⚠️ ET LE NOM DU CANAL PORTE LA SALLE. Deux canaux de même nom seraient fusionnés
    // par le client Supabase : l'ancien survivrait au changement, et le filtre serveur
    // resterait celui de la salle quittée. Le nom doit varier pour que la fermeture soit
    // réelle.
    if (!gymId) return
    const channel = supabase
      .channel(`home-schedule-${gymId}`)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'time_slots', filter: `gym_id=eq.${gymId}` }, (payload) => {
        const deletedId = (payload.old as { id?: string } | null)?.id
        console.log('[Realtime] Home time_slots DELETE:', deletedId)
        if (deletedId) {
          setSlots((prev) => prev.filter((s) => s.id !== deletedId))
        }
        fetchSlots()
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'time_slots', filter: `gym_id=eq.${gymId}` }, (payload) => {
        console.log('[Realtime] Home time_slots INSERT:', payload.new)
        fetchSlots()
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'time_slots', filter: `gym_id=eq.${gymId}` }, (payload) => {
        console.log('[Realtime] Home time_slots UPDATE:', payload.new)
        fetchSlots()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: `gym_id=eq.${gymId}` }, (payload) => {
        console.log('[Realtime] Home bookings:', payload.eventType)
        fetchSlots()
      })
      .subscribe((status) => {
        console.log('[Realtime] Home subscription:', status)
      })

    const pollingInterval = setInterval(() => {
      fetchSlots()
    }, 30000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(pollingInterval)
    }
  }, [fetchSlots])

  // Fetch member's active bookings (confirmed + waitlisted) as separate sets
  useEffect(() => {
    async function fetchBooked() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('bookings')
        .select('slot_id, status')
        .eq('member_id', user.id)
        .in('status', ['confirmed', 'waitlisted'])
      const confirmed = new Set<string>()
      const waitlisted = new Set<string>()
      for (const b of data ?? []) {
        if (b.status === 'confirmed') confirmed.add(b.slot_id)
        else if (b.status === 'waitlisted') waitlisted.add(b.slot_id)
      }
      setConfirmedSlotIds(confirmed)
      setWaitlistedSlotIds(waitlisted)
    }
    fetchBooked()
  }, [slots]) // re-check when slots change

  const scheduleByDay = days.map((d, i) => {
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    let daySlots = slots.filter((s) => s.date === dateStr)
    // For today (index 0), hide past slots (using Brussels time)
    if (i === 0) {
      const nowLocal = toLocalTime(new Date())
      daySlots = daySlots.filter((s) => {
        const [h, m] = s.endTime.split(':').map(Number)
        const end = new Date(nowLocal)
        end.setHours(h, m, 0, 0)
        return end > nowLocal
      })
    }
    // GYM-228 — `entries` est ce qu'on REND (cours normaux + cartes agrégées d'accès
    // libre) ; `slots` reste exposé pour l'état vide, qui doit continuer de raisonner sur
    // les créneaux réels et non sur des entrées de liste.
    //
    // ⚠️ Regroupement APRÈS le filtrage des créneaux passés : à 18 h, la carte du jour doit
    // annoncer « de 18h à 22h » et non l'amplitude du matin, déjà écoulée.
    return { date: d, slots: daySlots, entries: groupDayEntries(daySlots) }
  })

  const isFavorite = useCallback(
    // `favorites` in deps so cards re-evaluate membership after any change
    (slot: HomeSlot) => storeIsFavorite({ activityId: slot.activityId, startsAt: slot.startsAt }),
    [favorites, storeIsFavorite],
  )

  const toggleFavorite = useCallback(
    (slot: HomeSlot) => {
      const input = { activityId: slot.activityId, startsAt: slot.startsAt }
      if (storeIsFavorite(input)) removeFavorite(input)
      else addFavorite(input)
    },
    [storeIsFavorite, addFavorite, removeFavorite],
  )

  const isSlotBooked = useCallback((slotId: string) => confirmedSlotIds.has(slotId), [confirmedSlotIds])
  const isSlotWaitlisted = useCallback((slotId: string) => waitlistedSlotIds.has(slotId), [waitlistedSlotIds])

  return { days, scheduleByDay, isFavorite, toggleFavorite, isSlotBooked, isSlotWaitlisted, refresh: fetchSlots, isLoading }
}
