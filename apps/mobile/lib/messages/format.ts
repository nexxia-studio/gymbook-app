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

/** Numéro du jour de calendrier LOCAL (un entier par jour, insensible aux changements d'heure). */
function localDayNumber(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY
}

/**
 * Décrit l'ancienneté d'un message. Sous 24 h écoulées : minutes puis heures. Au-delà, on
 * compte en JOURS DE CALENDRIER de l'heure locale de l'appareil (veille = « hier », 2 à 7
 * jours, puis la date) : lundi 13 h lu mercredi 12 h vaut 2 jours, pas « hier ».
 * Rend null si l'une des deux dates est illisible.
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

  // ⚠️ Jamais `elapsed / DAY` ici : une journée de 23 ou 25 h décalerait le compte.
  // Le jour de recul d'heure, 24 h écoulées peuvent tomber le même jour de calendrier
  // (00 h 30 → 23 h 30) : on reste alors en heures.
  const days = localDayNumber(now) - localDayNumber(created)
  if (days < 1) return { kind: 'hours', count: Math.floor(elapsed / HOUR) }
  if (days === 1) return { kind: 'yesterday' }
  if (days <= 7) return { kind: 'days', count: days }

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
