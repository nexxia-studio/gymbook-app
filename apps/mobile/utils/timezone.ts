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

/** Format UTC timestamp as "YYYY-MM-DD" in Brussels time */
export function formatDateStr(utcDate: string | Date): string {
  const local = toLocalTime(utcDate)
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`
}
