// GYM-228 — Génération des créneaux Open Gym.
//
// RÈGLES PRODUIT (Antoine, 18/08), tranchées — ce module les applique, il n'en décide
// aucune :
//   · créneaux de 2 HEURES, démarrant TOUTES LES HEURES ;
//   · dans les heures d'ouverture de la salle, jour par jour ;
//   · pas d'Open Gym s'il y a un cours collectif (règle de Nico).
//
// ⚠️ LE RECOUVREMENT EST VOULU. Deux créneaux consécutifs se chevauchent d'une heure, et
// Antoine l'assume explicitement : « capacité de 8 membres par créneau avec possibilité de
// 16 entre 2 créneaux ». Ce n'est PAS un défaut à corriger — il ne faut surtout pas
// inventer ici un calcul de capacité par tranche horaire.
import { DAY_KEYS, dayKeyOf, isUsableDay, minutesToTime, timeToMinutes, type OpeningHours } from '@/lib/openingHours'

/** Durée d'un créneau Open Gym. */
export const OPEN_GYM_DURATION_MIN = 120
/** Pas entre deux départs. */
export const OPEN_GYM_STEP_MIN = 60

/** Intervalle occupé par un cours, en minutes locales depuis minuit, pour un jour donné. */
export interface BusyInterval {
  /** Date locale 'YYYY-MM-DD'. */
  date: string
  startMin: number
  endMin: number
}

export interface PlannedSlot {
  /** Date locale 'YYYY-MM-DD'. */
  date: string
  /** Heure locale de début 'HH:MM'. */
  startTime: string
}

/**
 * Heures de départ d'un jour, d'après ses horaires d'ouverture.
 *
 * ⚠️ LE CRÉNEAU DOIT TENIR ENTIÈREMENT DANS L'OUVERTURE. Avec 07:00–22:00, les départs
 * vont de 07:00 à 20:00 — le dernier créneau finit pile à la fermeture. Un départ à 21:00
 * déborderait d'une heure sur une salle fermée.
 *
 * Cela fait 14 départs par jour, et non 15 : de 07 à 20 inclus. (Le chiffre de 15 avancé
 * au cadrage comptait une heure de trop ; la règle « dernier créneau 20h→22h » est celle
 * qui fait foi, et c'est elle qui est appliquée.)
 */
export function startTimesForDay(hours: OpeningHours[keyof OpeningHours]): string[] {
  if (!isUsableDay(hours)) return []
  const open = timeToMinutes(hours!.open)
  const close = timeToMinutes(hours!.close)

  const out: string[] = []
  for (let m = open; m + OPEN_GYM_DURATION_MIN <= close; m += OPEN_GYM_STEP_MIN) {
    out.push(minutesToTime(m))
  }
  return out
}

/**
 * Deux intervalles se CHEVAUCHENT-ils ?
 *
 * ⚠️ COMPARAISON D'INTERVALLES RÉELS, jamais d'heures de début. C'est la consigne, et elle
 * est la seule correcte : un cours de 18 h à 19 h exclut l'Open Gym de 17 h→19 h (qui finit
 * quand le cours finit) COMME celui de 18 h→20 h (qui commence quand le cours commence).
 * Comparer les débuts n'aurait attrapé que le second.
 *
 * Bornes STRICTES : un cours de 17 h→18 h ne chevauche pas un Open Gym de 18 h→20 h. Ils se
 * touchent, ils ne se recouvrent pas — enchaîner est précisément ce qu'on veut permettre.
 */
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd
}

/**
 * Créneaux Open Gym à poser sur une période, exclusions faites.
 *
 * `busy` porte les cours collectifs DÉJÀ connus sur la période, et `existing` les créneaux
 * Open Gym déjà générés.
 *
 * ⚠️ IDEMPOTENCE. `existing` est la clé : relancer la génération sur une période déjà
 * couverte ne produit RIEN, parce que chaque candidat y est retrouvé. On ne se repose pas
 * sur une borne de progression qui pourrait mentir après une suppression manuelle — on
 * compare à ce qui existe RÉELLEMENT. Une génération interrompue se reprend donc en
 * relançant, sans doublon ni trou.
 */
export function planOpenGymSlots(params: {
  /** Dates locales à couvrir, 'YYYY-MM-DD', dans l'ordre. */
  dates: string[]
  hours: OpeningHours
  /** Cours collectifs de la période (Open Gym exclu de cette liste). */
  busy: BusyInterval[]
  /** Créneaux Open Gym déjà posés : clés `${date}T${HH:MM}`. */
  existing: Set<string>
}): { planned: PlannedSlot[]; skippedOverlap: number; skippedExisting: number } {
  const { dates, hours, busy, existing } = params

  // Index des cours par jour : sans lui, chaque candidat balaierait toute la période.
  const busyByDate = new Map<string, BusyInterval[]>()
  for (const b of busy) {
    const list = busyByDate.get(b.date)
    if (list) list.push(b)
    else busyByDate.set(b.date, [b])
  }

  const planned: PlannedSlot[] = []
  let skippedOverlap = 0
  let skippedExisting = 0

  for (const date of dates) {
    const dayHours = hours[dayKeyOf(date)]
    const dayBusy = busyByDate.get(date) ?? []

    for (const startTime of startTimesForDay(dayHours)) {
      if (existing.has(`${date}T${startTime}`)) { skippedExisting += 1; continue }

      const s = timeToMinutes(startTime)
      const e = s + OPEN_GYM_DURATION_MIN
      if (dayBusy.some((b) => overlaps(s, e, b.startMin, b.endMin))) { skippedOverlap += 1; continue }

      planned.push({ date, startTime })
    }
  }

  return { planned, skippedOverlap, skippedExisting }
}

/** Dates locales 'YYYY-MM-DD' de `from` à `to` inclus. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = []
  const [y, m, d] = from.split('-').map(Number)
  // Ancrage à minuit UTC : ce sont des cases de calendrier, pas des instants
  // (même discipline que lib/recurrence).
  const cur = new Date(Date.UTC(y, m - 1, d))
  const end = to
  for (let guard = 0; guard < 400; guard++) {
    const iso = `${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, '0')}-${String(cur.getUTCDate()).padStart(2, '0')}`
    if (iso > end) break
    out.push(iso)
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return out
}

/** Nombre de jours d'ouverture dans la semaine — sert à annoncer le volume au gérant. */
export function openDaysCount(hours: OpeningHours): number {
  return DAY_KEYS.filter((d) => isUsableDay(hours[d])).length
}
