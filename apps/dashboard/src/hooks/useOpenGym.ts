// GYM-228 — Génération des créneaux Open Gym, rattachés à des SÉRIES.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// SÉRIES PLUTÔT QUE GÉNÉRATION DIRECTE — arbitrage
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// Une génération directe aurait été plus simple à écrire, et c'est précisément son défaut :
// elle laisse 784 créneaux ORPHELINS sur huit semaines. Le jour où Nico veut arrêter
// l'Open Gym de 20 h, ou décaler celui de 7 h à 7 h 30, il n'a aucun geste de masse — il
// devrait ouvrir 56 créneaux un par un.
//
// Avec une SÉRIE PAR HEURE DE DÉPART (FREQ=DAILY), tout l'outillage de GYM-230 s'applique
// tel quel : « ce créneau et tous les suivants » modifie ou supprime une tranche horaire
// entière, les exceptions sont épargnées, les inscrits sont prévenus. Rien à réécrire.
//
// ⚠️ LA SÉRIE DÉCRIT L'INTENTION, PAS LE RÉSULTAT. « Tous les jours à 7 h » reste vrai même
// si le mardi saute pour cause de cours collectif : les occurrences réellement posées sont
// celles qui survivent aux exclusions. C'est la raison pour laquelle on n'utilise pas le
// générateur de GYM-230 (qui pose TOUTES les occurrences) mais qu'on insère nous-mêmes les
// créneaux retenus, en les rattachant à la série.
import { useCallback, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/useAuthStore'
import { useGymTimezone } from '@/hooks/useGymTimezone'
import { localToUtc, addMinutesToTime, clampHorizon } from '@/lib/recurrence'
import {
  datesBetween, planOpenGymSlots, startTimesForDay,
  OPEN_GYM_DURATION_MIN, type BusyInterval,
} from '@/lib/openGym'
import { DAY_KEYS, isUsableDay, type OpeningHours } from '@/lib/openingHours'

export interface OpenGymResult {
  ok: boolean
  created: number
  skippedOverlap: number
  skippedExisting: number
  /** Durée observée de la génération, annoncée au gérant sur les gros volumes. */
  elapsedMs: number
  error?: string
}

export function useOpenGym() {
  const gymId = useAuthStore((s) => s.gym_id)
  const tz = useGymTimezone()
  const [running, setRunning] = useState(false)

  /**
   * Génère les créneaux Open Gym de `from` à `to` (dates locales incluses).
   *
   * ⚠️ IDEMPOTENT. On lit les créneaux Open Gym DÉJÀ POSÉS sur la période et on écarte les
   * candidats qui existent. Relancer ne crée donc aucun doublon, et une génération
   * interrompue se reprend en relançant — sans trou ni doublon. On ne se fie pas à une
   * borne de progression, qui mentirait après une suppression manuelle : on compare à ce
   * qui existe RÉELLEMENT.
   */
  const generate = useCallback(async (
    activityId: string,
    hours: OpeningHours,
    from: string,
    to: string,
  ): Promise<OpenGymResult> => {
    if (!gymId) return { ok: false, created: 0, skippedOverlap: 0, skippedExisting: 0, elapsedMs: 0, error: 'no_gym' }

    const started = performance.now()
    setRunning(true)
    try {
      // Plafond d'un an, le même que GYM-230 — et pour la même raison : personne ne veut
      // découvrir 5 000 créneaux générés par inadvertance.
      const end = clampHorizon(from, to)
      const dates = datesBetween(from, end)
      if (dates.length === 0) {
        return { ok: false, created: 0, skippedOverlap: 0, skippedExisting: 0, elapsedMs: 0, error: 'empty_range' }
      }

      const fromIso = localToUtc(from, '00:00', tz).toISOString()
      const toIso = localToUtc(end, '23:59', tz).toISOString()

      // Une seule lecture pour toute la période : les cours collectifs ET les Open Gym déjà
      // posés. Filtrer par activité côté client évite une seconde requête.
      const { data: rows, error: readErr } = await supabase
        .from('time_slots')
        .select('id, activity_id, starts_at, ends_at')
        .eq('gym_id', gymId)
        .gte('starts_at', fromIso)
        .lte('starts_at', toIso)
        .neq('status', 'cancelled')

      if (readErr) {
        return { ok: false, created: 0, skippedOverlap: 0, skippedExisting: 0, elapsedMs: 0, error: readErr.message }
      }

      // Bascule en heures LOCALES : c'est dans ce repère que les règles s'expriment
      // (« pas d'Open Gym pendant un cours » se juge à l'horloge de la salle).
      const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
      })
      const localOf = (iso: string) => {
        const parts = fmt.formatToParts(new Date(iso))
        const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
        return {
          date: `${get('year')}-${get('month')}-${get('day')}`,
          minutes: Number(get('hour')) * 60 + Number(get('minute')),
        }
      }

      const busy: BusyInterval[] = []
      const existing = new Set<string>()
      for (const r of rows ?? []) {
        const s = localOf(r.starts_at as string)
        const e = localOf(r.ends_at as string)
        if (r.activity_id === activityId) {
          // Un Open Gym déjà posé : il sert l'idempotence, pas l'exclusion — sinon
          // chaque créneau bloquerait son voisin et le recouvrement voulu disparaîtrait.
          existing.add(`${s.date}T${String(Math.floor(s.minutes / 60)).padStart(2, '0')}:${String(s.minutes % 60).padStart(2, '0')}`)
        } else {
          // Un cours qui déborde sur le lendemain est tronqué à la journée : les créneaux
          // Open Gym ne franchissent jamais minuit, comparer au-delà n'aurait pas de sens.
          busy.push({ date: s.date, startMin: s.minutes, endMin: e.date === s.date ? e.minutes : 24 * 60 })
        }
      }

      const { planned, skippedOverlap, skippedExisting } = planOpenGymSlots({ dates, hours, busy, existing })
      if (planned.length === 0) {
        return { ok: true, created: 0, skippedOverlap, skippedExisting, elapsedMs: performance.now() - started }
      }

      // ── Les séries, une par heure de départ ────────────────────────────────
      // Retrouvées par (activité, heure de départ) : relancer la génération les réutilise
      // au lieu d'en empiler de nouvelles.
      const { data: existingSeries } = await supabase
        .from('slot_series')
        .select('id, starts_local_time')
        .eq('gym_id', gymId)
        .eq('activity_id', activityId)

      const seriesByTime = new Map<string, string>()
      for (const s of existingSeries ?? []) {
        // `starts_local_time` revient en 'HH:MM:SS' — on compare sur 'HH:MM'.
        seriesByTime.set(String(s.starts_local_time).slice(0, 5), s.id as string)
      }

      const neededTimes = new Set(planned.map((p) => p.startTime))
      const { data: activity } = await supabase
        .from('activities').select('default_capacity, default_level').eq('id', activityId).single()
      // La CAPACITÉ vient de l'activité (default_capacity), jamais d'une constante ici :
      // c'est un réglage de salle, il doit se modifier dans /settings sans toucher au code.
      const capacity = (activity?.default_capacity as number) ?? 8
      const level = (activity?.default_level as string) ?? 'all'

      for (const time of neededTimes) {
        if (seriesByTime.has(time)) continue
        const { data: created, error } = await supabase
          .from('slot_series')
          .insert({
            gym_id: gymId,
            activity_id: activityId,
            coach_id: null,             // Open Gym : accès libre, sans encadrement (GYM-229)
            capacity,
            level,
            starts_local_time: time,
            duration_min: OPEN_GYM_DURATION_MIN,
            timezone: tz,
            rrule: 'FREQ=DAILY;INTERVAL=1',
            starts_on: from,
            generated_until: end,
          })
          .select('id')
          .single()
        if (error || !created) {
          return { ok: false, created: 0, skippedOverlap, skippedExisting, elapsedMs: performance.now() - started, error: error?.message }
        }
        seriesByTime.set(time, created.id as string)
      }

      // ── Les créneaux ──────────────────────────────────────────────────────
      // ⚠️ Chaque occurrence est convertie SÉPARÉMENT en UTC : c'est ce qui absorbe le
      // changement d'heure du 25 octobre (GYM-230). 07:00 local reste 07:00 local des deux
      // côtés de la bascule, alors qu'un décalage uniforme l'aurait fait glisser.
      const inserts = planned.map((p) => ({
        gym_id: gymId,
        series_id: seriesByTime.get(p.startTime)!,
        activity_id: activityId,
        coach_id: null,
        starts_at: localToUtc(p.date, p.startTime, tz).toISOString(),
        ends_at: localToUtc(p.date, addMinutesToTime(p.startTime, OPEN_GYM_DURATION_MIN), tz).toISOString(),
        capacity,
        level,
        status: 'scheduled',
      }))

      // Insertion par paquets : 784 lignes en une requête passeraient, mais un paquet qui
      // échoue laisse les précédents en place — et la relance, idempotente, reprendra
      // exactement où elle en était.
      const CHUNK = 200
      let created = 0
      for (let i = 0; i < inserts.length; i += CHUNK) {
        const { error } = await supabase.from('time_slots').insert(inserts.slice(i, i + CHUNK))
        if (error) {
          return { ok: false, created, skippedOverlap, skippedExisting, elapsedMs: performance.now() - started, error: error.message }
        }
        created += inserts.slice(i, i + CHUNK).length
      }

      // `generated_until` suit, pour que GYM-230 sache jusqu'où la série est couverte.
      await supabase
        .from('slot_series')
        .update({ generated_until: end })
        .in('id', [...seriesByTime.values()])
        .lt('generated_until', end)

      return { ok: true, created, skippedOverlap, skippedExisting, elapsedMs: performance.now() - started }
    } finally {
      setRunning(false)
    }
  }, [gymId, tz])

  /** Estimation annoncée AVANT de lancer : le gérant doit savoir ce qu'il déclenche. */
  const estimate = useCallback((hours: OpeningHours, from: string, to: string): number => {
    const dates = datesBetween(from, clampHorizon(from, to))
    return dates.reduce((sum, d) => {
      const key = DAY_KEYS[(new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7]
      return sum + (isUsableDay(hours[key]) ? startTimesForDay(hours[key]).length : 0)
    }, 0)
  }, [])

  return { generate, estimate, running }
}
