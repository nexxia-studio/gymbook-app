// GYM-230 — Moteur de récurrence : de la règle aux créneaux.
//
// ⚠️ LE PIÈGE CENTRAL DE CE MODULE, ET LA RAISON DE SA FORME.
//
// La bibliothèque `rrule` manipule des `Date` JavaScript et raisonne en UTC. Si on lui
// donne un `dtstart` construit en heure locale, elle applique un décalage et les dates
// produites glissent — d'un jour près des minuits, d'une heure aux changements d'heure.
//
// La parade, documentée par la bibliothèque elle-même : lui parler en DATES DE CALENDRIER
// PURES, sans notion d'instant. On encode « le 5 novembre » en `Date.UTC(2026, 10, 5)` et
// on relit les occurrences avec `getUTCFullYear/Month/Date`. rrule ne fait alors que de
// l'arithmétique de calendrier — jamais de conversion de fuseau.
//
// C'est SEULEMENT ENSUITE, une fois la date locale connue, qu'on compose « date + heure
// locale » et qu'on convertit en UTC via le fuseau du gym. Chaque occurrence est convertie
// SÉPARÉMENT, et c'est ce qui rend le 25 octobre inoffensif :
//
//     18/10 09:00 Europe/Brussels → 07:00Z   (CEST, UTC+2)
//     01/11 09:00 Europe/Brussels → 08:00Z   (CET,  UTC+1)
//
// Deux instants absolus différents, la même heure à l'horloge de la salle. Une série
// stockée en UTC aurait produit 07:00Z les deux fois — soit 8 h locales en novembre, tous
// les cours de Dopamine décalés d'une heure (GYM-93).
//
// createSlot faisait déjà cette conversion par occurrence ; ce module la conserve et
// l'entoure d'une règle standard.
import { RRule, type Options as RRuleOptions } from 'rrule'
import { fromZonedTime } from 'date-fns-tz'

/**
 * Horizon maximal de génération — UN AN (décision produit 3 : pas de « jamais »).
 *
 * 366 pour couvrir une année bissextile. La même borne est posée en base
 * (slot_series_horizon_check) : celle-ci guide l'interface, celle-là est infranchissable.
 */
export const MAX_HORIZON_DAYS = 366

/** Garde-fou d'exécution : au-delà, on refuse de générer plutôt que de figer l'onglet.
 *  Un cours quotidien sur un an fait 366 occurrences — la borne est au-dessus. */
export const MAX_OCCURRENCES = 400

/** Modes proposés dans l'interface, repris de Notion Calendar (décision produit). */
export type RecurrenceMode =
  | 'daily'
  | 'weekly'
  | 'biweekly'
  | 'monthly_day'      // chaque mois, le N (le 15)
  | 'monthly_weekday'  // chaque mois, le Xᵉ jour (le 2ᵉ mardi)
  | 'custom_weekdays'  // jours de la semaine choisis

export const RECURRENCE_MODES: RecurrenceMode[] = [
  'daily', 'weekly', 'biweekly', 'monthly_day', 'monthly_weekday', 'custom_weekdays',
]

/** Fin de série. PAS de « jamais » — décision produit 3. */
export type RecurrenceEndMode = 'until' | 'count'

export interface RecurrenceInput {
  mode: RecurrenceMode
  /** Date de la PREMIÈRE occurrence, locale, 'YYYY-MM-DD'. */
  startsOn: string
  endMode: RecurrenceEndMode
  /** endMode 'until' : dernière date incluse, locale, 'YYYY-MM-DD'. */
  until?: string
  /** endMode 'count' : nombre d'occurrences, première comprise. */
  count?: number
  /** mode 'custom_weekdays' : 0 = lundi … 6 = dimanche (ordre RRule.MO…SU). */
  weekdays?: number[]
}

// ─────────────────────────────────────────────────────────────────────────────────────
// Dates de calendrier ↔ Date JS « pure » (encodée à minuit UTC)
// ─────────────────────────────────────────────────────────────────────────────────────

/** 'YYYY-MM-DD' → Date encodée à minuit UTC. AUCUNE notion de fuseau ici : c'est une case
 *  de calendrier, pas un instant. */
function calendarDateToUtcAnchor(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0))
}

/** L'inverse : Date encodée à minuit UTC → 'YYYY-MM-DD'. */
function utcAnchorToCalendarDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/** Index de jour de semaine de RRule (0 = lundi) pour une date de calendrier. */
function weekdayIndexOf(dateStr: string): number {
  // getUTCDay() : 0 = dimanche. RRule : 0 = lundi. D'où le décalage.
  return (calendarDateToUtcAnchor(dateStr).getUTCDay() + 6) % 7
}

/** Rang du jour dans son mois (1 = premier mardi, 2 = deuxième…), pour 'monthly_weekday'. */
function weekdayOrdinalOf(dateStr: string): number {
  const day = Number(dateStr.split('-')[2])
  return Math.floor((day - 1) / 7) + 1
}

// ─────────────────────────────────────────────────────────────────────────────────────
// Construction de la règle
// ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Traduit un choix d'interface en options RRule.
 *
 * ⚠️ `dtstart` n'est PAS inclus dans la chaîne produite par `toRRuleString()` : dans un
 * VEVENT, la date de début vit sur DTSTART et le fuseau sur son TZID — pas dans RRULE.
 * C'est ce que stocke `slot_series.starts_on` / `.timezone`, et c'est ce que GYM-235
 * réassemblera pour le .ics.
 */
function toOptions(input: RecurrenceInput): Partial<RRuleOptions> {
  const dtstart = calendarDateToUtcAnchor(input.startsOn)
  const base: Partial<RRuleOptions> = { dtstart }

  switch (input.mode) {
    case 'daily':
      Object.assign(base, { freq: RRule.DAILY, interval: 1 })
      break
    case 'weekly':
      Object.assign(base, { freq: RRule.WEEKLY, interval: 1, byweekday: [weekdayIndexOf(input.startsOn)] })
      break
    case 'biweekly':
      Object.assign(base, { freq: RRule.WEEKLY, interval: 2, byweekday: [weekdayIndexOf(input.startsOn)] })
      break
    case 'monthly_day':
      // « Le 15 de chaque mois ». Les mois trop courts sautent l'occurrence, comportement
      // RFC 5545 : un cours « le 31 » n'a pas lieu en février, il n'est pas déplacé.
      Object.assign(base, {
        freq: RRule.MONTHLY, interval: 1,
        bymonthday: [Number(input.startsOn.split('-')[2])],
      })
      break
    case 'monthly_weekday':
      // « Le 2ᵉ mardi de chaque mois ».
      Object.assign(base, {
        freq: RRule.MONTHLY, interval: 1,
        byweekday: [weekdayIndexOf(input.startsOn)],
        bysetpos: [weekdayOrdinalOf(input.startsOn)],
      })
      break
    case 'custom_weekdays': {
      // Repli sur le jour de `startsOn` si le gérant n'a rien coché : une série sans jour
      // ne produirait aucune occurrence, ce qui serait un silence au lieu d'un refus.
      const days = input.weekdays?.length ? input.weekdays : [weekdayIndexOf(input.startsOn)]
      Object.assign(base, { freq: RRule.WEEKLY, interval: 1, byweekday: days })
      break
    }
  }

  if (input.endMode === 'count') {
    base.count = Math.min(Math.max(input.count ?? 1, 1), MAX_OCCURRENCES)
  } else if (input.until) {
    // UNTIL est inclusif. L'ancre est à minuit UTC : on vise la fin de journée pour que la
    // date choisie compte comme une occurrence possible.
    const u = calendarDateToUtcAnchor(input.until)
    u.setUTCHours(23, 59, 59, 0)
    base.until = u
  }

  return base
}

/** Chaîne RRULE standard, telle qu'elle est stockée dans slot_series.rrule. */
export function buildRRuleString(input: RecurrenceInput): string {
  const rule = new RRule(toOptions(input))
  // `toString()` produit « DTSTART:…\nRRULE:… ». On ne garde que la règle : la date de
  // début est stockée à part (cf. commentaire de toOptions).
  const line = rule.toString().split('\n').find((l) => l.startsWith('RRULE:'))
  return (line ?? `RRULE:${rule.toString()}`).replace(/^RRULE:/, '')
}

// ─────────────────────────────────────────────────────────────────────────────────────
// Génération
// ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Dates LOCALES ('YYYY-MM-DD') produites par une règle, bornées par l'horizon.
 *
 * `horizonEnd` est la dernière date locale acceptable. Elle prime sur le UNTIL de la règle
 * comme sur son COUNT : c'est le plafond d'un an, et il ne se négocie pas.
 */
export function generateLocalDates(
  rruleString: string,
  startsOn: string,
  horizonEnd: string,
): string[] {
  const rule = new RRule({
    ...RRule.parseString(rruleString),
    dtstart: calendarDateToUtcAnchor(startsOn),
  })

  const horizon = calendarDateToUtcAnchor(horizonEnd)
  horizon.setUTCHours(23, 59, 59, 0)

  return rule
    .between(calendarDateToUtcAnchor(startsOn), horizon, true)
    .slice(0, MAX_OCCURRENCES)
    .map(utcAnchorToCalendarDate)
}

/**
 * Date locale + heure locale + fuseau → instant UTC.
 *
 * ⚠️ LE CŒUR DE LA CORRECTION DU 25 OCTOBRE. Appelée UNE FOIS PAR OCCURRENCE, jamais une
 * fois pour toute la série : c'est la conversion individuelle qui fait que le décalage
 * horaire est absorbé au lieu d'être propagé.
 */
export function localToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  return fromZonedTime(new Date(`${dateStr}T${timeStr}:00`), timeZone)
}

/** 'HH:mm' + minutes → 'HH:mm'. Débordement de minuit non géré : un cours ne franchit pas
 *  la nuit, et la contrainte time_slots_check (ends_at > starts_at) le refuserait. */
export function addMinutesToTime(time: string, mins: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = h * 60 + m + mins
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** Dernière date locale atteignable depuis `startsOn` sans dépasser l'horizon d'un an. */
export function maxHorizonDate(startsOn: string): string {
  const d = calendarDateToUtcAnchor(startsOn)
  d.setUTCDate(d.getUTCDate() + MAX_HORIZON_DAYS)
  return utcAnchorToCalendarDate(d)
}

/** Borne effective : la fin voulue, rabotée à l'horizon. Utilisée pour `generated_until`. */
export function clampHorizon(startsOn: string, wantedEnd: string): string {
  const max = maxHorizonDate(startsOn)
  return wantedEnd > max ? max : wantedEnd
}
