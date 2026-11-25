// GYM-391 — la liste de l'écran Messages : ce qui se décide SANS React ni Supabase (icône par
// type, fusion des pages, fin de liste, marquage optimiste, identifiant venu de l'URL).
// Figé par tests/messagesList.test.ts.
import { MESSAGES_PAGE_SIZE, isUnread, isUuid, type MessageRow } from './data'

/** Le NOM de l'icône ; le composant qui le dessine vit dans components/messages/shared.tsx. */
export type MessageIconName =
  | 'calendar-check' | 'trending-up' | 'calendar-x' | 'calendar-clock' | 'badge-check'
  | 'credit-card' | 'ticket' | 'ban' | 'megaphone' | 'bell'

export const MESSAGE_ICON_BY_TYPE: Readonly<Record<string, MessageIconName>> = {
  booking_confirmed: 'calendar-check',
  waitlist_promoted: 'trending-up',
  session_cancelled_by_gym: 'calendar-x',
  session_updated_by_gym: 'calendar-clock',
  subscription_activated: 'badge-check',
  subscription_payment_failed: 'credit-card',
  credits_purchased: 'ticket',
  no_show_suspension: 'ban',
  communication: 'megaphone',
}

/** L'icône d'un type de message ; tout type non prévu reçoit la cloche. */
export function messageIconName(type: string | null | undefined): MessageIconName {
  // Propriété PROPRE seulement : « toString » ou « constructor » ne sont pas des types de message.
  return typeof type === 'string' && Object.prototype.hasOwnProperty.call(MESSAGE_ICON_BY_TYPE, type)
    ? MESSAGE_ICON_BY_TYPE[type]!
    : 'bell'
}

/**
 * `first` puis les lignes de `next` qu'elle ne contient pas déjà (par `id`) : les lignes
 * chargées, puis la page suivante. Une ligne peut glisser d'une page à l'autre si un message
 * arrive entre deux lectures : sans ce filtre, elle apparaîtrait deux fois.
 */
export function mergePages(first: readonly MessageRow[], next: readonly MessageRow[]): MessageRow[] {
  const seen = new Set<string>()
  return [...first, ...next].filter((row) => !seen.has(row.id) && seen.add(row.id))
}

/** Une page pleine laisse supposer une suite ; une page incomplète est la dernière. */
export function hasMorePages(pageLength: number): boolean {
  return pageLength >= MESSAGES_PAGE_SIZE
}

/** Marquage optimiste : la ligne `id` passe à « lu », ou toutes si `id` est omis. */
export function withRead(rows: readonly MessageRow[], id?: string): MessageRow[] {
  return rows.map((row) => (isUnread(row) && (id === undefined || row.id === id) ? { ...row, read: true } : row))
}

/**
 * Annule un marquage optimiste : chaque ligne de `originals` retrouve son `read` et son
 * `read_at` d'avant. Les autres lignes (une page chargée entre-temps) ne bougent pas.
 */
export function withReadStateOf(rows: readonly MessageRow[], originals: readonly MessageRow[]): MessageRow[] {
  const byId = new Map(originals.map((row) => [row.id, row]))
  return rows.map((row) => {
    const original = byId.get(row.id)
    return original ? { ...row, read: original.read, read_at: original.read_at } : row
  })
}

/**
 * L'identifiant d'un message lu dans l'URL (non fiable : lien profond, saisie). Rend null
 * pour tout ce qui n'a pas la forme d'un uuid : l'écran affiche alors « introuvable » sans
 * requêter.
 */
export function messageIdFromParam(param: unknown): string | null {
  const value = Array.isArray(param) && param.length === 1 ? param[0] : param
  return isUuid(value) ? value : null
}
