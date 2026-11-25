// GYM-391 — accès à `public.notifications` pour l'app membre.
//
// ⚠️ TOUTE requête filtre `member_id` ET `gym_id` : la RLS ne filtre pas la salle. Le
// périmètre (`MessageScope`) ne s'obtient que par `messageScope()` / `currentMessageScope()`,
// qui rendent null quand le membre ou la salle manque : l'appelant s'abstient alors.
// ⚠️ Lecture et UPDATE (read, read_at) seulement : aucun insert, aucun delete.
// Les erreurs Supabase sont LEVÉES : à l'appelant de décider quoi en faire.
import { supabase } from '../supabase'
import { useAuthStore } from '../../stores/useAuthStore'
import {
  MESSAGE_COLUMNS, messageScope, pageRange, readPayload, type MessageRow, type MessageScope,
} from './data'

/** Le périmètre courant (utilisateur connecté, salle active), ou null s'il en manque un. */
export function currentMessageScope(): MessageScope | null {
  const { user, gym_id } = useAuthStore.getState()
  return messageScope(user?.id, gym_id)
}

/** Une page de messages (30), du plus récent au plus ancien. `page` commence à 0. */
export async function fetchMessagesPage(scope: MessageScope, page: number): Promise<MessageRow[]> {
  const { from, to } = pageRange(page)
  const { data, error } = await supabase
    .from('notifications')
    .select(MESSAGE_COLUMNS)
    .eq('member_id', scope.memberId)
    .eq('gym_id', scope.gymId)
    // `created_at` est nullable : sans date, la ligne va en fin de liste, pas en tête.
    .order('created_at', { ascending: false, nullsFirst: false })
    // Départage stable : deux messages de même date ne changent pas de page entre deux lectures.
    .order('id', { ascending: false })
    .range(from, to)
  if (error) throw error
  return (data ?? []) as MessageRow[]
}

/** Le nombre de messages non lus (`read` n'est pas true : un null compte). */
export async function fetchUnreadCount(scope: MessageScope): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('member_id', scope.memberId)
    .eq('gym_id', scope.gymId)
    .not('read', 'is', true)
  if (error) throw error
  return count ?? 0
}

/** Marque UN message comme lu. Sans effet s'il l'est déjà (son `read_at` d'origine est gardé). */
export async function markMessageRead(scope: MessageScope, id: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update(readPayload(new Date()))
    .eq('id', id)
    .eq('member_id', scope.memberId)
    .eq('gym_id', scope.gymId)
    .not('read', 'is', true)
  if (error) throw error
}

/** Marque comme lus tous les messages non lus du membre dans la salle. */
export async function markAllMessagesRead(scope: MessageScope): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update(readPayload(new Date()))
    .eq('member_id', scope.memberId)
    .eq('gym_id', scope.gymId)
    .not('read', 'is', true)
  if (error) throw error
}
