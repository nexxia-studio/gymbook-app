// GYM-391 — CE QUI CHANGE VRAIMENT : la demande comparée à l'état lu EN BASE.
//
// Constaté en recette staging le 24/11 : le formulaire du dashboard envoie TOUS ses champs
// à chaque enregistrement (activité, coach, capacité, horaire...), qu'ils aient bougé ou
// non. `slot-series-op` lisait « champ présent dans la demande » comme « champ modifié » :
// les trois drapeaux partaient à true pour un simple décalage d'horaire, et une demande
// rejouée (double clic) renotifiait tout le monde.
//
// Ici, un champ ne compte que si sa valeur DIFFÈRE de celle du créneau en base. Un créneau
// sans différence ne s'écrit pas et ne prévient personne.
//
// ⚠️ AUCUN RÉSEAU, AUCUNE BASE : des fonctions pures, éprouvées par `changes_test.ts`.

export interface SlotPatch {
  activity_id?: string
  coach_id?: string | null
  capacity?: number
  level?: string
  notes?: string | null
  /** Heure LOCALE 'HH:mm', jamais un instant UTC. */
  starts_local_time?: string
  /** Date LOCALE 'YYYY-MM-DD', portée 'single' uniquement. */
  starts_local_date?: string
  duration_min?: number
}

/** Le créneau tel qu'il vient d'être lu en base. */
export interface SlotRow {
  id: string
  starts_at: string
  ends_at: string
  activity_id: string
  coach_id: string | null
  capacity: number
  level: string | null
  notes: string | null
  is_series_exception: boolean | null
  /** Sert de verrou optimiste à l'écriture : posé par le trigger à chaque UPDATE. */
  updated_at: string | null
}

export interface ChangeRequest {
  patch: SlotPatch
  scope: 'single' | 'following'
  timeZone: string
  /** Le créneau appartient à une série (sinon il ne peut pas en être une exception). */
  inSeries: boolean
}

export interface SlotChange {
  /** Les colonnes dont la valeur change, et elles seules. Vide : rien à écrire. */
  fields: Record<string, unknown>
  /** Début ou fin déplacés. */
  time_changed: boolean
  coach_changed: boolean
  activity_changed: boolean
  /** Le DÉBUT bouge (et pas seulement la durée) : nouvelle heure locale 'HH:mm'. */
  newLocalTime: string | null
  /**
   * Le cours change de JOUR à l'horloge de la salle : « jeudi 26 novembre ». Sans lui, un
   * cours déplacé du mardi au jeudi à la même heure s'annoncerait « nouvel horaire : 18:00 »
   * et le membre se présenterait le mardi.
   */
  newLocalDay: string | null
  /** La durée bouge : nouvelle durée en minutes. */
  newDurationMin: number | null
  /** L'activité du créneau APRÈS l'écriture. */
  activityId: string
}

const sameInstant = (a: string, b: Date): boolean => new Date(a).getTime() === b.getTime()

/** Compare la demande à UN créneau lu en base. */
export function diffSlot(slot: SlotRow, req: ChangeRequest): SlotChange {
  const { patch } = req
  const fields: Record<string, unknown> = {}

  const activity_changed = patch.activity_id !== undefined && patch.activity_id !== slot.activity_id
  if (activity_changed) fields.activity_id = patch.activity_id

  // '' et null disent tous deux « pas de coach » / « pas de note ».
  const coach = patch.coach_id || null
  const coach_changed = patch.coach_id !== undefined && coach !== (slot.coach_id || null)
  if (coach_changed) fields.coach_id = coach

  if (patch.capacity !== undefined && patch.capacity !== slot.capacity) fields.capacity = patch.capacity
  if (patch.level !== undefined && patch.level !== slot.level) fields.level = patch.level
  const notes = patch.notes || null
  if (patch.notes !== undefined && notes !== (slot.notes || null)) fields.notes = notes

  // ⚠️ L'HEURE SE RECALCULE PAR CRÉNEAU, JAMAIS PAR DÉCALAGE UNIFORME. De part et d'autre
  // d'un changement d'heure, le même décalage absolu ne donne pas la même heure à
  // l'horloge : on recompose « date locale du créneau + heure locale demandée » dans le
  // fuseau de la série, puis on compare l'INSTANT obtenu à celui en base.
  const currentStart = new Date(slot.starts_at)
  const currentEnd = new Date(slot.ends_at)
  const currentDurationMin = Math.round((currentEnd.getTime() - currentStart.getTime()) / 60_000)
  // Durée non demandée : le créneau garde la sienne.
  const durationMin = patch.duration_min ?? currentDurationMin

  let start = currentStart
  if (patch.starts_local_time) {
    // Portée 'single' : le gérant peut aussi avoir changé la date. Portée 'following' :
    // chaque occurrence garde la sienne, sinon elles s'empileraient toutes le même jour.
    const localDate = (req.scope === 'single' && patch.starts_local_date)
      ? patch.starts_local_date
      : localDateOf(currentStart, req.timeZone)
    start = zonedToUtc(localDate, patch.starts_local_time, req.timeZone)
  }
  const end = new Date(start.getTime() + durationMin * 60_000)

  const startChanged = !sameInstant(slot.starts_at, start)
  const endChanged = !sameInstant(slot.ends_at, end)
  if (startChanged) fields.starts_at = start.toISOString()
  if (endChanged) fields.ends_at = end.toISOString()

  // Un créneau de série modifié seul devient une EXCEPTION (décision produit 5), mais
  // seulement s'il diverge vraiment : une demande sans effet ne le détache pas de sa série.
  if (req.inSeries && req.scope === 'single' && Object.keys(fields).length > 0 && !slot.is_series_exception) {
    fields.is_series_exception = true
  }

  return {
    fields,
    time_changed: startChanged || endChanged,
    coach_changed,
    activity_changed,
    newLocalTime: startChanged ? localTimeOf(start, req.timeZone) : null,
    newLocalDay: localDateOf(start, req.timeZone) !== localDateOf(currentStart, req.timeZone)
      ? localDayOf(start, req.timeZone)
      : null,
    newDurationMin: durationMin !== currentDurationMin ? durationMin : null,
    activityId: activity_changed ? (patch.activity_id as string) : slot.activity_id,
  }
}

/** Le membre doit-il l'apprendre ? Capacité, niveau et notes internes ne le concernent pas. */
export function isVisible(c: SlotChange): boolean {
  return c.time_changed || c.coach_changed || c.activity_changed
}

/** Ce que l'écriture touche de la base. Remplacé par une doublure dans le banc. */
export interface SlotStore {
  /**
   * Écrit `fields` sur le créneau SI son `updated_at` vaut encore celui de `slot`.
   * 'stale' : la condition n'a retenu aucune ligne, quelqu'un a écrit entre-temps.
   */
  write(slot: SlotRow, fields: Record<string, unknown>): Promise<'written' | 'stale' | 'error'>
  /** Relit le créneau, ou null s'il n'existe plus. */
  reread(id: string): Promise<SlotRow | null>
}

export interface ApplyResult {
  /** Les créneaux que CETTE demande a écrits, dans l'ordre reçu, avec ce qui y a changé. */
  applied: Array<{ slotId: string; change: SlotChange }>
  /** Créneaux déjà dans l'état demandé : ni écrits, ni notifiés. */
  unchanged: number
  failed: string[]
}

/**
 * Écrit sur chaque créneau ce qui diffère de la demande, et rend ce qui a été écrit.
 *
 * ⚠️ ÉCRITURE CONDITIONNELLE. Deux demandes simultanées (double clic) lisent le même état ;
 * si chacune écrivait sans condition, chacune croirait avoir changé le créneau et chacune
 * notifierait. Avec la condition sur `updated_at`, une seule écriture passe : l'autre ne
 * retient aucune ligne, relit le créneau, n'y trouve plus de différence et se tait.
 *
 * Trois essais par créneau : une réservation prise entre la lecture et l'écriture
 * renouvelle aussi `updated_at`, sans que la demande ait perdu son objet.
 */
export async function applyToSlots(targets: SlotRow[], req: ChangeRequest, store: SlotStore): Promise<ApplyResult> {
  const result: ApplyResult = { applied: [], unchanged: 0, failed: [] }

  for (const target of targets) {
    let slot: SlotRow | null = target
    let done = false
    for (let attempt = 0; attempt < 3 && slot && !done; attempt++) {
      const change = diffSlot(slot, req)
      if (Object.keys(change.fields).length === 0) {
        result.unchanged += 1
        done = true
        break
      }
      const outcome = await store.write(slot, change.fields)
      if (outcome === 'error') break
      if (outcome === 'written') {
        result.applied.push({ slotId: slot.id, change })
        done = true
        break
      }
      slot = await store.reread(slot.id)
    }
    if (!done) result.failed.push(target.id)
  }
  return result
}

/** Le gabarit de la série tel qu'il est en base. */
export interface SeriesRow {
  activity_id: string
  coach_id: string | null
  capacity: number
  level: string | null
  notes: string | null
  /** Colonne `time` : '09:00:00'. */
  starts_local_time: string
  duration_min: number
}

/** Les colonnes du gabarit dont la valeur change. Vide : rien à écrire. */
export function diffSeries(series: SeriesRow, patch: SlotPatch): Record<string, unknown> {
  const fields: Record<string, unknown> = {}
  if (patch.activity_id !== undefined && patch.activity_id !== series.activity_id) fields.activity_id = patch.activity_id
  const coach = patch.coach_id || null
  if (patch.coach_id !== undefined && coach !== (series.coach_id || null)) fields.coach_id = coach
  if (patch.capacity !== undefined && patch.capacity !== series.capacity) fields.capacity = patch.capacity
  if (patch.level !== undefined && patch.level !== series.level) fields.level = patch.level
  const notes = patch.notes || null
  if (patch.notes !== undefined && notes !== (series.notes || null)) fields.notes = notes
  if (patch.starts_local_time && patch.starts_local_time.slice(0, 5) !== series.starts_local_time.slice(0, 5)) {
    fields.starts_local_time = patch.starts_local_time
  }
  if (patch.duration_min !== undefined && patch.duration_min !== series.duration_min) fields.duration_min = patch.duration_min
  return fields
}

/** Ce qu'UN membre doit apprendre : une ligne, un push, quel que soit le nombre de séances. */
export interface MemberMessage {
  memberId: string
  /** La première de ses séances concernées (ordre chronologique des créneaux fournis). */
  slotId: string
  /** Combien de SES séances changent, pas combien la série en compte. */
  slotCount: number
  time_changed: boolean
  coach_changed: boolean
  activity_changed: boolean
  /** L'activité, après modification, de sa première séance concernée. */
  activityId: string
  /** « nouvel horaire : 18:30 », « changement de coach »... */
  what: string
}

/**
 * Regroupe par membre les créneaux RÉELLEMENT modifiés de façon visible.
 *
 * `applied` : les créneaux dont l'écriture a abouti, dans l'ordre chronologique.
 * `bookings` : les réservations confirmées sur ces créneaux.
 *
 * Un membre inscrit à huit séances apparaît une fois, avec `slotCount` = 8. Un membre dont
 * aucune séance ne change de façon visible n'apparaît pas.
 */
export function groupByMember(
  applied: Array<{ slotId: string; change: SlotChange }>,
  bookings: Array<{ member_id: string; slot_id: string }>,
): MemberMessage[] {
  const visible = applied.filter((a) => isVisible(a.change))
  const slotsOf = new Map<string, Set<string>>()
  for (const b of bookings) {
    const set = slotsOf.get(b.member_id) ?? new Set<string>()
    set.add(b.slot_id)
    slotsOf.set(b.member_id, set)
  }

  const messages: MemberMessage[] = []
  for (const [memberId, slotIds] of slotsOf) {
    const mine = visible.filter((a) => slotIds.has(a.slotId))
    if (mine.length === 0) continue
    const time_changed = mine.some((a) => a.change.time_changed)
    const coach_changed = mine.some((a) => a.change.coach_changed)
    const activity_changed = mine.some((a) => a.change.activity_changed)

    const parts: string[] = []
    // La date d'abord : un changement de jour prime sur un changement d'heure, et le texte
    // donne alors les deux.
    const moved = mine.find((a) => a.change.newLocalDay)?.change
    const newTime = mine.find((a) => a.change.newLocalTime)?.change.newLocalTime
    const newDuration = mine.find((a) => a.change.newDurationMin !== null)?.change.newDurationMin
    if (moved) parts.push(`nouvelle date : ${moved.newLocalDay} à ${moved.newLocalTime}`)
    else if (newTime) parts.push(`nouvel horaire : ${newTime}`)
    else if (newDuration) parts.push(`nouvelle durée : ${newDuration} min`)
    if (activity_changed) parts.push('le cours a changé')
    if (coach_changed) parts.push('changement de coach')

    messages.push({
      memberId,
      slotId: mine[0].slotId,
      slotCount: mine.length,
      time_changed,
      coach_changed,
      activity_changed,
      activityId: mine[0].change.activityId,
      what: parts.join(', '),
    })
  }
  return messages
}

// ── Fuseaux ──────────────────────────────────────────────────────────────────────────

/** Date locale 'YYYY-MM-DD' d'un instant, vue depuis le fuseau. */
export function localDateOf(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(at)
}

/**
 * Jour local « jeudi 26 novembre », vu depuis le fuseau. Même format que les rappels
 * (`send-reminders/reminder-texts.ts`) : fr-BE, `formatToParts` pour ne dépendre ni du
 * séparateur ni de l'ordre d'ICU.
 */
export function localDayOf(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('fr-BE', {
    timeZone, hourCycle: 'h23', weekday: 'long', day: 'numeric', month: 'long',
  }).formatToParts(at)
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? ''
  return `${p('weekday')} ${p('day')} ${p('month')}`
}

/** Heure locale 'HH:mm' d'un instant, vue depuis le fuseau. */
export function localTimeOf(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
  }).formatToParts(at)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  return `${get('hour')}:${get('minute')}`
}

/**
 * « Date locale + heure locale + fuseau » → instant UTC, sans dépendance externe.
 *
 * Deno n'a pas date-fns-tz ici ; on résout le décalage en interrogeant Intl pour l'instant
 * candidat, puis en corrigeant. Deux passes suffisent : la première donne le bon décalage
 * sauf exactement pendant l'heure de bascule, la seconde le stabilise.
 */
export function zonedToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const [h, mi] = timeStr.split(':').map(Number)
  // Hypothèse de départ : l'heure locale lue comme si elle était UTC.
  let ts = Date.UTC(y, mo - 1, d, h, mi, 0, 0)
  for (let i = 0; i < 2; i++) {
    const offset = tzOffsetMs(new Date(ts), timeZone)
    ts = Date.UTC(y, mo - 1, d, h, mi, 0, 0) - offset
  }
  return new Date(ts)
}

/** Décalage du fuseau, en millisecondes, à un instant donné. */
function tzOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0')
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return asUtc - at.getTime()
}
