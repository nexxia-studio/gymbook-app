import { toZonedTime } from 'date-fns-tz'

export const GYM_TIMEZONE = 'Europe/Brussels'

/** Convert UTC date to Brussels local Date object */
export function toLocalTime(utcDate: string | Date): Date {
  const d = typeof utcDate === 'string' ? new Date(utcDate) : utcDate
  return toZonedTime(d, GYM_TIMEZONE)
}

/** Format UTC timestamp as "HH:mm" in Brussels time */
export function formatTime(utcDate: string | Date): string {
  const local = toLocalTime(utcDate)
  return `${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`
}

/**
 * GYM-241 / GYM-93 — Lundi de la semaine de `instant`, DANS LE FUSEAU DE LA SALLE.
 *
 * 🔴 CE QU'ELLE REMPLACE. Le filtre de période du planning appelait un `getMonday` qui
 * lisait `Date.getDay()` sur l'heure du TÉLÉPHONE. Un membre à l'étranger — ou simplement
 * un téléphone dont le fuseau automatique a suivi un déplacement — voyait « cette semaine »
 * et « semaine prochaine » décalés d'un jour aux frontières : le dimanche soir à Bruxelles
 * est déjà lundi à Tokyo, et le planning basculait d'une semaine entière.
 *
 * ⚠️ LE RESTE DU HOOK ÉTAIT DÉJÀ CORRECT : `groupedByDay` passe par `toLocalTime`, et il
 * n'est pas touché. Seul le calcul des frontières de semaine était en cause.
 *
 * Le résultat est une date « miroir » : ses champs LOCAUX portent l'heure murale de la
 * salle. Elle ne sert qu'à produire des clés de comparaison via `formatDateStr`, jamais à
 * être réécrite en base.
 */
export function getGymMonday(instant: Date | string = new Date()): Date {
  const local = toLocalTime(instant)
  const day = local.getDay()
  local.setDate(local.getDate() - (day === 0 ? 6 : day - 1))
  local.setHours(0, 0, 0, 0)
  return local
}

/** Format UTC timestamp as "YYYY-MM-DD" in Brussels time */
export function formatDateStr(utcDate: string | Date): string {
  const local = toLocalTime(utcDate)
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`
}
