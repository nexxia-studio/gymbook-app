// GYM-391 — écran Messages : date relative et libellé de pastille.
// Logique pure : aucun texte ici, l'écran traduit la description rendue (i18n).

export type RelativeDate =
  | { kind: 'now' }
  | { kind: 'minutes'; count: number }
  | { kind: 'hours'; count: number }
  | { kind: 'yesterday' }
  | { kind: 'days'; count: number }
  // `month` de 1 à 12 ; `year` vaut null quand c'est l'année en cours (on ne l'affiche pas).
  | { kind: 'date'; day: number; month: number; year: number | null }

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * Décrit l'ancienneté d'un message. Les seuils sont des DURÉES écoulées, pas des jours de
 * calendrier : « hier » couvre de 24 h à 48 h. Le jour, le mois et l'année sont ceux de
 * l'heure locale de l'appareil. Rend null si l'une des deux dates est illisible.
 */
export function relativeDate(createdAt: string | null | undefined, now: Date): RelativeDate | null {
  if (typeof createdAt !== 'string' || createdAt.trim() === '') return null
  const created = new Date(createdAt)
  const elapsed = now.getTime() - created.getTime()
  if (Number.isNaN(elapsed)) return null

  // Une date dans le futur (horloge décalée) tombe ici aussi : `elapsed` est négatif.
  if (elapsed < MINUTE) return { kind: 'now' }
  if (elapsed < HOUR) return { kind: 'minutes', count: Math.floor(elapsed / MINUTE) }
  if (elapsed < DAY) return { kind: 'hours', count: Math.floor(elapsed / HOUR) }
  if (elapsed < 2 * DAY) return { kind: 'yesterday' }
  if (elapsed <= 7 * DAY) return { kind: 'days', count: Math.floor(elapsed / DAY) }

  const year = created.getFullYear()
  return {
    kind: 'date',
    day: created.getDate(),
    month: created.getMonth() + 1,
    year: year === now.getFullYear() ? null : year,
  }
}

/** Texte de la pastille de la cloche : null = aucune pastille. */
export function badgeLabel(count: number | null | undefined): string | null {
  if (typeof count !== 'number' || !Number.isInteger(count) || count <= 0) return null
  return count > 9 ? '9+' : String(count)
}
