// GYM-391 — données de l'écran Messages : ce qui se décide SANS Supabase ni React
// (périmètre des requêtes, pagination, « non lu », charge utile du marquage, garde du
// compteur). Les requêtes elles-mêmes vivent dans ./api.ts ; figé par tests/messagesData.test.ts.
import type { Database } from '../../types/database'

type NotificationRow = Database['public']['Tables']['notifications']['Row']

/** Une ligne de `public.notifications`, réduite aux colonnes que l'app lit. */
export type MessageRow = Pick<
  NotificationRow,
  'id' | 'type' | 'title' | 'body' | 'data' | 'read' | 'read_at' | 'created_at'
>

/** Les colonnes de `MessageRow`, pour `.select()`. À garder alignées sur le type. */
export const MESSAGE_COLUMNS = 'id, type, title, body, data, read, read_at, created_at'

export const MESSAGES_PAGE_SIZE = 30

/** Le périmètre de TOUTE requête sur `notifications` : ce membre, dans cette salle. */
export interface MessageScope {
  memberId: string
  gymId: string
}

function filled(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * La valeur a-t-elle la forme d'un uuid, et rien autour ? Tout identifiant venu d'une source
 * non fiable (URL, `data` d'un message) passe par ici AVANT de partir dans une requête ou
 * une route.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

/**
 * Rend le périmètre, ou null si le membre ou la salle manque : l'appelant s'abstient alors
 * de requêter. La RLS ne filtre pas la salle : une requête sans `gym_id` rendrait les
 * messages de toutes les salles du membre (même règle que GYM-292).
 */
export function messageScope(
  memberId: string | null | undefined,
  gymId: string | null | undefined,
): MessageScope | null {
  return filled(memberId) && filled(gymId) ? { memberId, gymId } : null
}

/** Deux périmètres désignent-ils le même membre dans la même salle ? Un null n'égale rien. */
export function sameScope(a: MessageScope | null, b: MessageScope | null): boolean {
  return a !== null && b !== null && a.memberId === b.memberId && a.gymId === b.gymId
}

/** Bornes `.range()` (incluses) de la page demandée, la première étant la page 0. */
export function pageRange(page: number): { from: number; to: number } {
  const index = Number.isFinite(page) && page > 0 ? Math.floor(page) : 0
  const from = index * MESSAGES_PAGE_SIZE
  return { from, to: from + MESSAGES_PAGE_SIZE - 1 }
}

/** « Non lu » = `read` n'est pas true : la colonne est nullable, un null compte comme non lu. */
export function isUnread(row: { read?: boolean | null }): boolean {
  return row.read !== true
}

/**
 * La charge utile d'un marquage « lu ». ⚠️ Exactement ces deux colonnes : la base n'accorde
 * au membre que UPDATE (read, read_at) et refuse tout UPDATE qui en porte une autre.
 */
export function readPayload(now: Date): { read: true; read_at: string } {
  return { read: true, read_at: now.toISOString() }
}

/**
 * Garde « la dernière demande gagne ». `begin()` rend le jeton d'une demande ; à la réponse,
 * `isCurrent(jeton)` dit si elle peut encore s'appliquer. Une demande plus récente ou un
 * `invalidate()` (déconnexion, changement de salle) périme toutes les précédentes.
 */
export function createLatestGuard(): {
  begin: () => number
  isCurrent: (token: number) => boolean
  invalidate: () => void
} {
  let latest = 0
  return {
    begin: () => ++latest,
    isCurrent: (token) => token === latest,
    invalidate: () => { latest++ },
  }
}
