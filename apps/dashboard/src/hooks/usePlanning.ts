import { useState, useEffect, useMemo, useCallback } from 'react'
import { toZonedTime, fromZonedTime } from 'date-fns-tz'
import { supabase } from '@/lib/supabase'
import { extractErrorBody, extractErrorCode, EdgeError } from '@/lib/edgeErrors'
import type { SeriesImpact, SeriesScope } from '@/components/planning/SeriesScopeModal'
import { useAuthStore } from '@/stores/useAuthStore'
import { useGymTimezone } from '@/hooks/useGymTimezone'
import {
  buildRRuleString, clampHorizon, generateLocalDates, localToUtc,
  addMinutesToTime, maxHorizonDate, type RecurrenceInput,
} from '@/lib/recurrence'
import { getDisplayStatus, type TimeSlot, type Activity, type Coach, type SlotStatus, type AttendanceStatus } from '@/types/planning'
import { invokeEdge } from '@/lib/edgeInvoke'

// GYM-174 — statuts d'une réservation "inscrite" (pointable), hors cancelled/waitlisted.
const ATTENDANCE_STATUSES = ['confirmed', 'attended', 'no_show', 'excused']

function getMonday(d: Date, tz: string): Date {
  const zoned = toZonedTime(d, tz)
  const day = zoned.getDay()
  const diff = day === 0 ? -6 : 1 - day
  zoned.setDate(zoned.getDate() + diff)
  zoned.setHours(0, 0, 0, 0)
  return fromZonedTime(zoned, tz)
}

function formatDateTz(d: Date, tz: string): string {
  const z = toZonedTime(d, tz)
  return `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, '0')}-${String(z.getDate()).padStart(2, '0')}`
}

function toHHMM(iso: string, tz: string): string {
  const z = toZonedTime(new Date(iso), tz)
  return `${String(z.getHours()).padStart(2, '0')}:${String(z.getMinutes()).padStart(2, '0')}`
}

function toDateStr(iso: string, tz: string): string {
  return formatDateTz(new Date(iso), tz)
}

interface DbMember {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  noshow_count: number | null
  avatar_url: string | null
  deleted_at: string | null
}

interface DbBooking {
  id: string
  member_id: string
  status: string | null
  member: DbMember | null
}

interface DbSlot {
  id: string
  starts_at: string
  ends_at: string
  capacity: number
  bookings_count: number | null
  status: string | null
  notes: string | null
  series_id: string | null
  is_series_exception: boolean | null
  activities: { id: string; name: string; color: string | null; duration_min: number; icon: string | null; active: boolean | null; requires_coach: boolean | null } | null
  coaches: { id: string; name: string; active: boolean | null } | null
  bookings: DbBooking[] | null
}

function mapSlot(row: DbSlot, tz: string): TimeSlot {
  return {
    id: row.id,
    date: toDateStr(row.starts_at, tz),
    startTime: toHHMM(row.starts_at, tz),
    endTime: toHHMM(row.ends_at, tz),
    activity: {
      id: row.activities?.id ?? '',
      name: row.activities?.name ?? '',
      color: row.activities?.color ?? '#4ECDC4',
      durationMin: row.activities?.duration_min ?? 60,
      active: row.activities?.active ?? true,
      // GYM-229 — repli sur `true` : un build antérieur à la migration doit conserver le
      // comportement historique (coach obligatoire).
      requiresCoach: row.activities?.requires_coach ?? true,
    },
    coach: {
      id: row.coaches?.id ?? '',
      name: row.coaches?.name ?? '',
      active: row.coaches?.active ?? true,
    },
    booked: row.bookings_count ?? row.bookings?.filter((b) => b.status === 'confirmed').length ?? 0,
    waitlisted: row.bookings?.filter((b) => b.status === 'waitlisted').length ?? 0,
    capacity: row.capacity,
    status: (row.status as SlotStatus) ?? 'scheduled',
    seriesId: row.series_id ?? null,
    isSeriesException: row.is_series_exception ?? false,
    // GYM-146 — ne pas afficher un inscrit dont le compte est supprimé (soft-delete).
    // Filtrage JS (PostgREST ne filtre pas proprement une relation imbriquée via .is()).
    // GYM-174 — on inclut désormais confirmed/attended/no_show/excused (les inscrits
    // pointables), plus seulement 'confirmed', pour permettre le pointage des présences.
    members: (row.bookings ?? [])
      .filter((b) => ATTENDANCE_STATUSES.includes(b.status ?? '') && !b.member?.deleted_at)
      .map((b) => ({
        id: b.member?.id ?? b.member_id,
        bookingId: b.id,
        firstName: b.member?.first_name ?? '',
        lastName: b.member?.last_name ?? '',
        email: b.member?.email ?? '',
        noshowCount: b.member?.noshow_count ?? 0,
        avatarUrl: b.member?.avatar_url ?? undefined,
        status: (b.status as AttendanceStatus) ?? 'confirmed',
      })),
  }
}

export interface CancelSlotSummary {
  bookingsCancelled: number
  creditsRefunded: number
  waitlistCleared: number
  notified: number
}

export interface MemberSearchResult {
  id: string
  firstName: string
  lastName: string
  email: string
}

// GYM-226 — résultat d'une inscription à un cours futur. Volontairement PLUS RICHE qu'un
// booléen : chaque champ porte ce que le gérant doit savoir pour son geste suivant.
export interface BookMemberResult {
  ok: boolean
  /** Code métier du refus (SUSPENDED, FULL, PAYMENT_REQUIRED, MAX_BOOKINGS_REACHED…). */
  code?: string
  /** Succès : place acquise, ou promise en liste d'attente. */
  status?: 'confirmed' | 'waitlisted'
  /** Position en liste d'attente — proposée avant (refus FULL), confirmée après. */
  waitlistPosition?: number
  /** Plafond de la salle, pour nommer le nombre dans MAX_BOOKINGS_REACHED. */
  limit?: number
  /** Échéance de la suspension, pour la dater avant de proposer sa levée. */
  suspendedUntil?: string
  /** Un crédit a-t-il été débité (vs abonnement) — à dire au gérant, pas à deviner. */
  creditDebited?: boolean
  // ── GYM-231 — de quoi rendre DEUX issues sur un cours complet, et pas une. ──
  /** Refus FULL : l'activité autorise-t-elle « inscrire quand même » (marge > 0) ? */
  overbookAllowed?: boolean
  /** Refus FULL : la marge paramétrée sur l'activité, pour la nommer. */
  overbookMargin?: number
  /**
   * Refus FULL : combien de membres attendent DÉJÀ une place. LE POINT D'ÉQUITÉ — forcer
   * l'inscription d'un tiers pendant que d'autres patientent depuis plus longtemps est un
   * choix, et le gérant doit le faire en connaissance de cause.
   */
  waitlistCount?: number
  /** Succès : la place accordée était-elle au-delà de la capacité ? */
  overbooked?: boolean
  /** Succès en dépassement : la trace en journal a échoué — décision sans justification. */
  logFailed?: boolean
}

/**
 * GYM-231 — options d'une inscription par le gérant.
 *
 * Objet plutôt qu'un troisième booléen positionnel : `bookMember(id, id, false, true, '…')`
 * serait illisible sur l'appel, et chaque ajout futur déplacerait les suivants.
 */
export interface BookMemberOptions {
  /** Le gérant accepte la liste d'attente (second appel après un refus FULL). */
  allowWaitlist?: boolean
  /** Le gérant force l'inscription au-delà de la capacité (second appel après FULL). */
  allowOverbook?: boolean
  /** Motif du dépassement — OBLIGATOIRE dès que `allowOverbook` est vrai. */
  overbookReason?: string
}

/** GYM-230 — retour d'une opération de série. `failed` > 0 = série à moitié traitée. */
export interface SeriesOpResult {
  ok: boolean
  slots: number
  failed: number
  skippedExceptions: number
  /** GYM-230 — membres réellement prévenus du changement. 0 est une information, pas une
   *  erreur : personne n'était inscrit, ou le changement n'était pas visible pour eux. */
  notified: number
  summary?: CancelSlotSummary
}

export interface MarkAttendanceResult {
  status: string
  penalty: { action?: string; type?: string; expires_at?: string | null } | null
}

export interface CreateSlotInput {
  activityId: string
  coachId: string
  date: string
  startTime: string
  duration: number
  capacity: number
  level: string
  notes: string
  /**
   * GYM-230 — récurrence. `undefined` = créneau PONCTUEL, qui reste le geste le plus
   * fréquent et ne crée aucune série (time_slots.series_id reste NULL, comme les 126
   * créneaux antérieurs au lot).
   */
  recurrence?: RecurrenceInput
}


function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + days)
  return ymd(d)
}

export function usePlanning() {
  const tz = useGymTimezone()
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date(), tz))
  // Date range actually fetched. Defaults to the week of weekStart but can be widened
  // by view changes (month/day) via setVisibleRange.
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>(() => {
    const start = ymd(getMonday(new Date(), tz))
    return { start, end: addDaysIso(start, 7) }
  })
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null)
  // GYM-128 — SÉLECTION MULTIPLE. Le filtre passe de `string | null` à `string[]` :
  // tableau VIDE = aucun filtre, donc « tout » (ce que portait `null` auparavant).
  //
  // ⚠️ Le PRÉDICAT ne change pas — mêmes champs comparés, même filtrage CLIENT sur les
  // créneaux déjà chargés, aucune requête modifiée. Seule la cardinalité change : on
  // teste une APPARTENANCE au lieu d'une égalité. « Marie ou Julie » était impossible à
  // exprimer avec une valeur unique, alors que c'est la question qu'un gérant à six
  // coachs se pose en premier.
  const [filterCoach, setFilterCoach] = useState<string[]>([])
  const [filterActivity, setFilterActivity] = useState<string[]>([])
  const [filterStatus, setFilterStatus] = useState<string[]>([])

  /**
   * GYM-228 — activités masquées PAR DÉFAUT (hidden_in_planning), typiquement l'Open Gym.
   *
   * ⚠️ EXCLUSION, ET NON INCLUSION — c'est une notion distincte, pas l'inverse de l'autre.
   * Le filtre Activités de GYM-128 est inclusif (liste vide = tout) : masquer l'Open Gym
   * par un état initial aurait demandé de pré-cocher toutes les AUTRES activités, ce qui
   * afficherait un filtre « actif » à tort et masquerait automatiquement toute activité
   * créée ensuite. Les deux mécanismes cohabitent donc, chacun sur sa question.
   *
   * `null` = pas encore chargé, à distinguer de « rien à masquer » : sans cette nuance, le
   * planning afficherait brièvement l'Open Gym au premier rendu, puis le retirerait.
   */
  const [hiddenActivityIds, setHiddenActivityIds] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [slots, setSlots] = useState<TimeSlot[]>([])
  const [activitiesList, setActivitiesList] = useState<Activity[]>([])
  const [coachesList, setCoachesList] = useState<Coach[]>([])

  const gymId = useAuthStore((s) => s.gym_id)

  const weekEnd = useMemo(() => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + 6)
    d.setHours(23, 59, 59, 999)
    return d
  }, [weekStart])

  // Keep dateRange aligned with weekStart when the page navigates via prev/today/next.
  // View-change-driven range updates (setVisibleRange) leave weekStart untouched.
  useEffect(() => {
    const start = ymd(weekStart)
    const end = addDaysIso(start, 7)
    setDateRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
  }, [weekStart])

  // Fetch slots for the visible date range
  const fetchSlots = useCallback(async () => {
    if (!gymId) return
    setLoading(true)
    try {
      const startIso = new Date(`${dateRange.start}T00:00:00`).toISOString()
      const endIso = new Date(`${dateRange.end}T23:59:59`).toISOString()
      const { data, error } = await supabase
        .from('time_slots')
        .select(`
          id, starts_at, ends_at, capacity, bookings_count, status, notes, series_id, is_series_exception,
          activities(id, name, color, duration_min, icon, active, requires_coach),
          coaches(id, name, active),
          bookings(
            id, member_id, status,
            member:profiles(id, first_name, last_name, email, noshow_count, avatar_url, deleted_at)
          )
        `)
        .eq('gym_id', gymId)
        .gte('starts_at', startIso)
        .lte('starts_at', endIso)
        .neq('status', 'deleted')
        .order('starts_at')

      if (error) throw error
      setSlots((data as unknown as DbSlot[] ?? []).map((row) => mapSlot(row, tz)))
    } catch (e) {
      console.error('Failed to fetch slots', e)
    } finally {
      setLoading(false)
    }
  }, [gymId, dateRange.start, dateRange.end, tz])

  // Fetch activities + coaches for filters and modals
  const fetchMeta = useCallback(async () => {
    if (!gymId) return
    const [actRes, coachRes] = await Promise.all([
      supabase.from('activities').select('id, name, color, duration_min, requires_coach, hidden_in_planning').eq('gym_id', gymId).order('sort_order'),
      supabase.from('coaches').select('id, name').eq('gym_id', gymId).order('sort_order'),
    ])
    setActivitiesList((actRes.data ?? []).map((a) => ({
      id: a.id, name: a.name, color: a.color ?? '#4ECDC4', durationMin: a.duration_min,
      requiresCoach: a.requires_coach ?? true,
      hiddenInPlanning: a.hidden_in_planning ?? false,
    })))
    // Masquées par défaut. Le gérant peut les réafficher — son choix n'écrase pas le
    // réglage, il ne vaut que pour la session en cours.
    setHiddenActivityIds((prev) => prev ?? (actRes.data ?? []).filter((a) => a.hidden_in_planning).map((a) => a.id))
    setCoachesList((coachRes.data ?? []).map((c) => ({ id: c.id, name: c.name })))
  }, [gymId])

  useEffect(() => { fetchSlots() }, [fetchSlots])
  useEffect(() => { fetchMeta() }, [fetchMeta])

  // Realtime subscription (gym-scoped channel) + 30s polling fallback
  useEffect(() => {
    if (!gymId) return
    const channel = supabase
      .channel(`planning-${gymId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'time_slots', filter: `gym_id=eq.${gymId}` }, (payload) => {
        console.log('[Realtime Dashboard] time_slots:', payload.eventType)
        fetchSlots()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: `gym_id=eq.${gymId}` }, (payload) => {
        console.log('[Realtime Dashboard] bookings:', payload.eventType)
        fetchSlots()
      })
      .subscribe((status) => {
        console.log('[Realtime Dashboard] Planning subscription:', status)
      })

    const pollingInterval = setInterval(() => {
      fetchSlots()
    }, 30000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(pollingInterval)
    }
  }, [gymId, fetchSlots])

  const filteredSlots = useMemo(() => {
    return slots.filter((s) => {
      // Liste vide = pas de filtre. Sinon : appartenance, là où c'était une égalité.
      if (filterCoach.length > 0 && !filterCoach.includes(s.coach.id)) return false
      // GYM-228 — exclusion des activités masquées par défaut. Contournée dès que le
      // gérant DEMANDE explicitement cette activité dans le filtre : demander à voir
      // l'Open Gym doit le montrer, sans avoir à décocher un réglage ailleurs.
      if ((hiddenActivityIds ?? []).includes(s.activity.id) && !filterActivity.includes(s.activity.id)) return false
      if (filterActivity.length > 0 && !filterActivity.includes(s.activity.id)) return false
      if (filterStatus.length > 0 && !filterStatus.includes(getDisplayStatus(s))) return false
      return true
    })
  }, [slots, filterCoach, filterActivity, filterStatus, hiddenActivityIds])

  // GYM-128 — au moins un filtre actif ? Sert au bouton « Réinitialiser », qui n'apparaît
  // que dans ce cas : un bouton toujours présent mais le plus souvent inutile encombrerait
  // autant que les pastilles qu'on retire.
  const hasActiveFilters =
    filterCoach.length > 0 || filterActivity.length > 0 || filterStatus.length > 0

  const resetFilters = useCallback(() => {
    setFilterCoach([])
    setFilterActivity([])
    setFilterStatus([])
  }, [])

  const getSlotsByDay = useCallback(
    (dateStr: string) => filteredSlots.filter((s) => s.date === dateStr),
    [filteredSlots],
  )

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart)
      d.setDate(d.getDate() + i)
      return d
    })
  }, [weekStart])

  function navigate(dir: 'prev' | 'next' | 'today') {
    setSelectedSlot(null)
    if (dir === 'today') {
      setWeekStart(getMonday(new Date(), tz))
    } else {
      setWeekStart((prev) => {
        const d = new Date(prev)
        d.setDate(d.getDate() + (dir === 'next' ? 7 : -7))
        return d
      })
    }
  }

  // Snap any date (Date or YYYY-MM-DD) to the Monday of that week and update the active week.
  function goToDate(date: Date | string) {
    setSelectedSlot(null)
    const d = typeof date === 'string' ? new Date(`${date}T00:00:00`) : new Date(date)
    setWeekStart(getMonday(d, tz))
  }

  // Set the visible date range. In day/week views (≤ 8 days), also realign weekStart
  // to the Monday of the displayed range so the page header label updates. In month
  // view (~35-42 days), leave weekStart untouched — the header keeps the last week label.
  function setVisibleRange(start: string, end: string) {
    setDateRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
    const startDate = new Date(`${start}T00:00:00`)
    const endDate = new Date(`${end}T00:00:00`)
    const daysSpan = Math.round((endDate.getTime() - startDate.getTime()) / 86400000)
    if (daysSpan > 0 && daysSpan <= 8) {
      const monday = getMonday(startDate, tz)
      setWeekStart((prev) => (ymd(prev) === ymd(monday) ? prev : monday))
    }
  }

  function checkOverlap(coachId: string, date: string, startTime: string, duration: number, excludeId?: string): boolean {
    const newStart = timeToMin(startTime)
    const newEnd = newStart + duration
    return slots.some((s) => {
      if (s.id === excludeId) return false
      if (s.coach.id !== coachId || s.date !== date || s.status === 'cancelled') return false
      const sStart = timeToMin(s.startTime)
      const sEnd = timeToMin(s.endTime)
      return newStart < sEnd && newEnd > sStart
    })
  }

  /**
   * GYM-230 — création d'un créneau, ponctuel ou récurrent.
   *
   * SANS `recurrence` : comportement strictement inchangé — un insert, series_id NULL.
   * Le cas simple ne paie rien pour le cas complexe.
   *
   * AVEC : on crée d'abord la SÉRIE (elle porte la règle, l'heure locale et le fuseau),
   * puis on génère les créneaux qui en découlent. Les deux gestes sont liés par
   * series_id — c'est lui qui permettra plus tard de dire « ce cours et tous les suivants ».
   *
   * ⚠️ CHAQUE OCCURRENCE EST CONVERTIE SÉPARÉMENT en UTC (localToUtc), jamais par décalage
   * depuis la première. C'est ce qui absorbe le changement d'heure du 25 octobre : le
   * 18/10 09:00 donne 07:00Z, le 01/11 09:00 donne 08:00Z, et les deux valent 9 h à
   * l'horloge de la salle.
   */
  async function createSlot(input: CreateSlotInput): Promise<number> {
    if (!gymId) return 0

    const endTime = addMinutesToTime(input.startTime, input.duration)

    // ── Cas ponctuel ──────────────────────────────────────────────────────────
    if (!input.recurrence) {
      const { error } = await supabase.from('time_slots').insert({
        gym_id: gymId,
        activity_id: input.activityId,
        // GYM-229 — activité sans encadrement : le formulaire renvoie une chaîne vide,
        // qui n'est PAS un uuid valide. NULL est la valeur que porte « pas de coach ».
        coach_id: input.coachId || null,
        starts_at: localToUtc(input.date, input.startTime, tz).toISOString(),
        ends_at: localToUtc(input.date, endTime, tz).toISOString(),
        capacity: input.capacity,
        level: input.level,
        notes: input.notes || null,
        status: 'scheduled',
      })
      // GYM-230 — l'erreur était AVALÉE ici (insert sans test) : le gérant voyait le
      // planning se rafraîchir sans son cours et ne comprenait pas. Motif GYM-204/219.
      if (error) throw new EdgeError('SLOT_CREATE_FAILED')
      await fetchSlots()
      return 1
    }

    // ── Cas récurrent ─────────────────────────────────────────────────────────
    const rec = input.recurrence
    const rrule = buildRRuleString(rec)

    // Horizon effectif : la fin voulue, rabotée à un an. Pour une fin « après N
    // occurrences », c'est le plafond qui borne, la règle s'arrêtant d'elle-même avant.
    const wantedEnd = rec.endMode === 'until' && rec.until ? rec.until : maxHorizonDate(rec.startsOn)
    const horizon = clampHorizon(rec.startsOn, wantedEnd)

    const dates = generateLocalDates(rrule, rec.startsOn, horizon)
    if (dates.length === 0) throw new EdgeError('SERIES_EMPTY')

    // `generated_until` = DERNIÈRE date réellement produite, pas l'horizon demandé : c'est
    // elle qui rend une prolongation ultérieure reprenable sans doublon.
    const { data: series, error: seriesError } = await supabase
      .from('slot_series')
      .insert({
        gym_id: gymId,
        activity_id: input.activityId,
        coach_id: input.coachId || null,
        capacity: input.capacity,
        level: input.level,
        notes: input.notes || null,
        starts_local_time: input.startTime,
        duration_min: input.duration,
        // Fuseau CAPTURÉ ici : une salle qui changerait de fuseau ne doit pas voir ses
        // séries existantes se décaler rétroactivement.
        timezone: tz,
        rrule,
        starts_on: rec.startsOn,
        generated_until: dates[dates.length - 1],
      })
      .select('id')
      .single()

    if (seriesError || !series) throw new EdgeError('SERIES_CREATE_FAILED')

    const { error: slotsError } = await supabase.from('time_slots').insert(
      dates.map((d) => ({
        gym_id: gymId,
        series_id: series.id,
        activity_id: input.activityId,
        coach_id: input.coachId || null,
        starts_at: localToUtc(d, input.startTime, tz).toISOString(),
        ends_at: localToUtc(d, endTime, tz).toISOString(),
        capacity: input.capacity,
        level: input.level,
        notes: input.notes || null,
        status: 'scheduled',
      })),
    )

    if (slotsError) {
      // La série sans ses créneaux serait une coquille invisible dans /planning : on la
      // retire plutôt que de la laisser orpheline. Best-effort — si ce nettoyage échoue
      // aussi, l'erreur remontée reste la bonne, et la série vide ne casse rien.
      await supabase.from('slot_series').delete().eq('id', series.id)
      throw new EdgeError('SLOT_CREATE_FAILED')
    }

    await fetchSlots()
    return dates.length
  }

  /**
   * Modification d'UN créneau — ponctuel comme membre d'une série.
   *
   * 🔴 GYM-236. Cette fonction écrivait en PostgREST DIRECT, et ne notifiait donc
   * personne : Nico décalait le HIIT de jeudi de 18 h à 19 h, dix inscrits, et personne
   * n'était prévenu. Le défaut était invisible — la modification réussissait, le créneau
   * était correct, rien ne signalait le manque.
   *
   * C'est le MÊME geste que la correction de GYM-230 ce matin : router vers
   * slot-series-op plutôt que d'extraire la notification ailleurs. Cela SUPPRIME un chemin
   * d'écriture au lieu d'en ajouter un — deux implémentations de la notification
   * divergeraient, comme ont divergé les prédicats d'abonnement (GYM-191/195) et les
   * moteurs de sanction (GYM-218).
   *
   * `scope: 'single'` : la fonction traite un lot d'un seul créneau. Elle accepte
   * désormais un créneau sans série et retombe alors sur le fuseau du gym.
   */
  async function updateSlot(id: string, input: CreateSlotInput): Promise<SeriesOpResult> {
    const { data, error } = await invokeEdge('slot-series-op', {
      body: {
        op: 'update',
        slot_id: id,
        scope: 'single',
        patch: {
          activity_id: input.activityId,
          coach_id: input.coachId || null,
          capacity: input.capacity,
          level: input.level,
          notes: input.notes || null,
          // ⚠️ Date et heure LOCALES, jamais un instant UTC : c'est le serveur qui
          // recompose avec le fuseau, seule façon d'absorber le changement d'heure.
          starts_local_time: input.startTime,
          starts_local_date: input.date,
          duration_min: input.duration,
        },
      },
    })
    if (error) return { ok: false, slots: 0, failed: 0, skippedExceptions: 0, notified: 0 }
    await fetchSlots()
    return {
      ok: true,
      slots: (data?.slots_updated as number) ?? 0,
      // ⚠️ COMPTE RÉEL, jamais codé en dur : c'est précisément un `notified: 0` figé qui a
      // masqué le défaut de ce matin (GYM-230).
      notified: (data?.members_notified as number) ?? 0,
      failed: ((data?.failed_slot_ids as string[]) ?? []).length,
      skippedExceptions: 0,
    }
  }

  // GYM-143 — l'annulation passe par l'Edge Function cancel-slot (annulation atomique
  // + recrédit exact des membres + purge waitlist + notifications), JAMAIS par un simple
  // UPDATE de statut (qui n'aurait ni recrédité ni notifié). Retourne le résumé pour le toast.
  async function cancelSlot(id: string, reason?: string): Promise<CancelSlotSummary> {
    const { data, error } = await invokeEdge('cancel-slot', {
      body: { slot_id: id, reason: reason?.trim() || undefined },
    })
    // GYM-219 — SLOT_STARTED (« déjà commencé ») et SLOT_NOT_FOUND appellent deux
    // réactions différentes : l'exception opaque les confondait.
    if (error) throw new EdgeError(await extractErrorCode(error))
    await fetchSlots()
    return {
      bookingsCancelled: (data?.bookings_cancelled as number) ?? 0,
      creditsRefunded: (data?.credits_refunded as number) ?? 0,
      waitlistCleared: (data?.waitlist_cleared as number) ?? 0,
      notified: (data?.notified as number) ?? 0,
    }
  }

  // GYM-174 — pointage d'une réservation via l'Edge Function mark-attendance
  // (mark_attendance_atomic : crédit + pénalités atomiques ; notification de sanction).
  // JAMAIS un simple UPDATE de statut (qui ne gérerait ni crédit ni pénalité ni notif).
  async function markAttendance(bookingId: string, status: AttendanceStatus): Promise<MarkAttendanceResult> {
    const { data, error } = await invokeEdge('mark-attendance', {
      body: { action: 'mark', booking_id: bookingId, status },
    })
    if (error) throw new EdgeError(await extractErrorCode(error))
    await fetchSlots()
    return {
      status: (data?.status as string) ?? 'updated',
      penalty: (data?.penalty ?? null) as MarkAttendanceResult['penalty'],
    }
  }

  // GYM-174 — inscription à la volée d'un membre présent au comptoir puis pointé présent.
  //
  // GYM-219 — le code de refus est REMONTÉ à l'appelant au lieu d'être noyé dans une
  // exception opaque. mark-attendance distingue NO_CREDIT, FULL, ALREADY_BOOKED et
  // SLOT_CANCELLED : ce sont quatre gestes différents au comptoir (vendre une séance,
  // libérer une place, ne rien faire, changer de cours).
  async function walkIn(slotId: string, memberId: string): Promise<{ ok: boolean; code?: string }> {
    const { error } = await invokeEdge('mark-attendance', {
      body: { action: 'walkin', slot_id: slotId, member_id: memberId },
    })
    if (error) return { ok: false, code: await extractErrorCode(error) }
    await fetchSlots()
    return { ok: true }
  }

  // GYM-226 — inscription d'un membre à un cours FUTUR (réservation seule, AUCUN pointage).
  //
  // ⚠️ Ce n'est PAS walkIn ci-dessus. Le walk-in inscrit ET marque présent, pour quelqu'un
  // debout au comptoir ; l'employer sur un cours de la semaine prochaine marquerait
  // « présent » à un cours qui n'a pas eu lieu. Ici on passe par admin-book-member, qui
  // rejoue les gardes de create-booking (plafond GYM-196 inclus) puis create_booking_atomic.
  //
  // `allowWaitlist` matérialise le second appel : le premier revient en 409 FULL avec la
  // position qu'occuperait le membre, le gérant tranche, et seulement alors on inscrit en
  // liste d'attente. On ne force jamais quelqu'un sur une place qu'il n'a pas.
  //
  // Le corps du refus est lu UNE fois (la Response de supabase-js n'est pas rejouable) et
  // remonté ENTIER : `limit`, `suspended_until` et `waitlist_position` sont ce qui permet à
  // la modale de nommer le refus au lieu de le déplorer.
  async function bookMember(
    slotId: string,
    memberId: string,
    options: BookMemberOptions = {},
  ): Promise<BookMemberResult> {
    const { data, error } = await invokeEdge('admin-book-member', {
      body: {
        slot_id: slotId,
        member_id: memberId,
        allow_waitlist: options.allowWaitlist ?? false,
        // GYM-231 — envoyés seulement quand le gérant a tranché. Le serveur exige le motif
        // dès que le drapeau est vrai (400 OVERBOOK_REASON_REQUIRED) : c'est lui l'autorité,
        // le contrôle côté écran ne fait qu'éviter un aller-retour perdu.
        allow_overbook: options.allowOverbook ?? false,
        overbook_reason: options.overbookReason,
      },
    })

    if (error) {
      const body = await extractErrorBody(error)
      return {
        ok: false,
        code: body.code,
        limit: body.limit,
        suspendedUntil: body.suspended_until,
        waitlistPosition: body.waitlist_position,
        overbookAllowed: body.overbook_allowed,
        overbookMargin: body.overbook_margin,
        waitlistCount: body.waitlist_count,
      }
    }

    await fetchSlots()
    return {
      ok: true,
      status: (data?.status as 'confirmed' | 'waitlisted') ?? 'confirmed',
      waitlistPosition: data?.position as number | undefined,
      creditDebited: (data?.credit_debited as boolean | undefined) ?? false,
      overbooked: (data?.overbooked as boolean | undefined) ?? false,
      logFailed: (data?.log_failed as boolean | undefined) ?? false,
    }
  }

  // GYM-174 / GYM-179 (fix 3) — recherche de membres de la salle pour le walk-in.
  // Multi-mots : « QA Train3 » doit matcher (prénom "QA", nom "Train3"). On découpe la saisie
  // en mots et on exige que CHAQUE mot matche l'une des colonnes → AND entre les mots (des
  // .or() successifs se combinent en AND côté PostgREST), OR entre first_name/last_name/email.
  // « QA Train3 », « Train3 QA » et « Train3 » fonctionnent alors indifféremment.
  async function searchGymMembers(query: string, excludeIds: string[]): Promise<MemberSearchResult[]> {
    if (!gymId) return []
    const trimmed = query.trim()
    if (trimmed.length < 2) return []
    // Neutraliser les métacaractères qui casseraient la syntaxe du filtre .or() de PostgREST.
    const words = trimmed.split(/\s+/).map((w) => w.replace(/[,()*]/g, '')).filter(Boolean)
    if (words.length === 0) return []

    let q = supabase
      .from('profiles')
      .select('id, first_name, last_name, email')
      .eq('gym_id', gymId)
      .eq('role', 'member')
      .is('deleted_at', null)
    for (const w of words) {
      q = q.or(`first_name.ilike.%${w}%,last_name.ilike.%${w}%,email.ilike.%${w}%`)
    }

    const { data, error } = await q.limit(8)
    if (error) {
      console.error('searchGymMembers failed', error)
      return []
    }
    return (data ?? [])
      .filter((m) => !excludeIds.includes(m.id))
      .map((m) => ({
        id: m.id,
        firstName: m.first_name ?? '',
        lastName: m.last_name ?? '',
        email: m.email ?? '',
      }))
  }

  // ── GYM-230 — opérations de SÉRIE ────────────────────────────────────────────
  //
  // Les trois passent par l'Edge slot-series-op, jamais par une boucle côté navigateur :
  // une série peut compter 52 créneaux avec des inscrits, et un onglet fermé au milieu
  // laisserait la moitié traitée sans que personne ne l'apprenne.

  /**
   * Compte les créneaux et les membres qu'une action « et tous les suivants » toucherait.
   * N'ÉCRIT RIEN — c'est ce qui permet d'annoncer l'impact avant que le gérant tranche.
   */
  async function countSeriesImpact(slotId: string): Promise<SeriesImpact | null> {
    const { data, error } = await invokeEdge('slot-series-op', {
      body: { op: 'count', slot_id: slotId },
    })
    if (error) return null
    return {
      slots: (data?.slots as number) ?? 0,
      members: (data?.members as number) ?? 0,
      skippedExceptions: (data?.skipped_exceptions as number) ?? 0,
    }
  }

  /**
   * Modification de série — LES DEUX PORTÉES passent par l'Edge.
   *
   * 🔴 CORRECTIF QA STAGING (17/08). 'single' court-circuitait slot-series-op : il faisait
   * un updateSlot en PostgREST direct, posait is_series_exception côté client, et
   * retournait `notified: 0` EN DUR. La notification vivant dans l'Edge, elle n'était donc
   * jamais exécutée — aucun email, aucun push, et pas même une ligne de journal puisque
   * l'Edge ne tournait pas. Deux créneaux modifiés en staging avec un inscrit confirmé :
   * personne n'a rien reçu.
   *
   * La suppression, elle, fonctionnait — parce que ses DEUX portées passent par une Edge
   * (cancel-slot). C'est cette asymétrie qui a créé le trou : une portée notifiait, l'autre
   * non, et rien ne le signalait.
   *
   * Une seule voie d'écriture, donc un seul endroit qui notifie.
   */
  async function updateSeries(
    slotId: string,
    scope: SeriesScope,
    input: CreateSlotInput,
  ): Promise<SeriesOpResult> {
    const { data, error } = await invokeEdge('slot-series-op', {
      body: {
        op: 'update',
        slot_id: slotId,
        scope,
        patch: {
          activity_id: input.activityId,
          coach_id: input.coachId || null,
          capacity: input.capacity,
          level: input.level,
          notes: input.notes || null,
          // ⚠️ HEURE LOCALE transmise, jamais un instant UTC : c'est le serveur qui
          // recompose chaque créneau avec le fuseau de la série, sinon le changement
          // d'heure décalerait les occurrences d'après le 25 octobre.
          starts_local_time: input.startTime,
          // Portée 'single' uniquement : déplacer un cours isolé à une autre date est un
          // geste légitime, et c'est le seul champ que le chemin client gérait en plus.
          // L'Edge l'ignore en portée 'following'.
          starts_local_date: input.date,
          duration_min: input.duration,
        },
      },
    })
    if (error) return { ok: false, slots: 0, failed: 0, skippedExceptions: 0, notified: 0 }
    await fetchSlots()
    return {
      ok: true,
      slots: (data?.slots_updated as number) ?? 0,
      notified: (data?.members_notified as number) ?? 0,
      failed: ((data?.failed_slot_ids as string[]) ?? []).length,
      skippedExceptions: (data?.skipped_exceptions as number) ?? 0,
    }
  }

  /**
   * Suppression de série. Chaque créneau passe par cancel_slot_atomic — donc RECRÉDIT et
   * purge de liste d'attente pour chacun.
   *
   * ⚠️ L'ÉCHEC PARTIEL EST REMONTÉ, PAS AVALÉ. `failed` > 0 signifie que la série est
   * à moitié annulée : l'appelant doit le dire. La fonction serveur étant idempotente
   * (cancel_slot_atomic renvoie 'already_cancelled'), relancer est sans danger.
   */
  async function deleteSeries(
    slotId: string,
    scope: SeriesScope,
    reason?: string,
  ): Promise<SeriesOpResult> {
    if (scope === 'single') {
      const summary = await cancelSlot(slotId, reason)
      return { ok: true, slots: 1, failed: 0, skippedExceptions: 0, notified: summary.notified, summary }
    }

    const { data, error } = await invokeEdge('slot-series-op', {
      body: { op: 'delete', slot_id: slotId, reason: reason?.trim() || undefined },
    })
    if (error) return { ok: false, slots: 0, failed: 0, skippedExceptions: 0, notified: 0 }
    await fetchSlots()
    return {
      ok: true,
      slots: (data?.slots_cancelled as number) ?? 0,
      notified: (data?.notified as number) ?? 0,
      failed: ((data?.failed_slot_ids as string[]) ?? []).length,
      skippedExceptions: (data?.skipped_exceptions as number) ?? 0,
    }
  }

  async function removeSlot(id: string) {
    await supabase.from('time_slots').delete().eq('id', id)
    fetchSlots()
  }

  return {
    weekStart,
    weekEnd,
    weekDays,
    loading,
    filteredSlots,
    getSlotsByDay,
    navigate,
    goToDate,
    setVisibleRange,
    selectedSlot,
    setSelectedSlot,
    filterCoach,
    setFilterCoach,
    filterActivity,
    setFilterActivity,
    filterStatus,
    setFilterStatus,
    hasActiveFilters,
    resetFilters,
    hiddenActivityIds: hiddenActivityIds ?? [],
    showHiddenActivities: () => setHiddenActivityIds([]),
    coaches: coachesList,
    activities: activitiesList,
    createSlot,
    updateSlot,
    cancelSlot,
    removeSlot,
    checkOverlap,
    markAttendance,
    countSeriesImpact,
    updateSeries,
    deleteSeries,
    walkIn,
    bookMember,
    searchGymMembers,
  }
}

function timeToMin(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}
