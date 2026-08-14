// GYM-226 — LES GARDES D'UNE RÉSERVATION, une seule fois.
//
// POURQUOI CE MODULE EXISTE. Le dashboard obtient un second chemin de réservation
// (admin-book-member : le GÉRANT inscrit un tiers à un cours futur) à côté du chemin
// libre-service existant (create-booking : le MEMBRE se réserve lui-même). Les deux
// posent EXACTEMENT les mêmes questions à la base — quota de la salle, abonnement
// encore ouvrant, crédit disponible, plafond de réservations à venir — et seule
// l'identité du sujet change.
//
// Recopier ces quatre lectures dans la nouvelle fonction, c'était accepter qu'elles
// divergent au premier ajustement. Le dépôt en a déjà fait les frais : GYM-191 a dû
// rattraper le prédicat « abonnement encore valide » dans QUATRE Edge Functions parce
// qu'il y avait été dupliqué (cf. _shared/active-subscription.ts, dont ce module est le
// prolongement direct).
//
// ⚠️ EXTRACTION PURE. Chaque fonction ci-dessous reproduit à l'identique la requête
// qu'elle remplace dans create-booking : mêmes colonnes, mêmes filtres, mêmes valeurs de
// repli. Aucune règle n'est ajoutée, retirée ni assouplie ici — le chemin membre, seul
// chemin de réservation en production sur iOS, doit se comporter exactement comme avant.
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ACTIVE_SUBSCRIPTION_STATUSES, notExpiredFilter } from './active-subscription.ts'

/**
 * GYM-196 — quota de membres du plan Viniz + plafond de réservations simultanées.
 *
 * `maxActiveBookings` est remonté ICI plutôt que par une seconde requête : la ligne
 * nexxia_gyms est déjà lue pour le quota de membres, autant en tirer les deux
 * informations. NULL = aucune limite de réservations.
 */
export async function checkMemberQuota(
  supabase: SupabaseClient,
  gymId: string,
): Promise<{ allowed: boolean; reason?: string; maxActiveBookings: number | null }> {
  const { data: gym } = await supabase
    .from('nexxia_gyms')
    .select('plan, max_active_bookings')
    .eq('id', gymId)
    .single()

  const maxActiveBookings = (gym?.max_active_bookings as number | null) ?? null

  if (!gym?.plan) return { allowed: false, reason: 'PLAN_NOT_FOUND', maxActiveBookings }

  const { data: limits } = await supabase
    .from('nexxia_plan_limits')
    .select('max_members')
    .eq('plan', gym.plan)
    .single()

  // null = illimité
  if (!limits || limits.max_members === null) return { allowed: true, maxActiveBookings }

  const { count } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('gym_id', gymId)
    .eq('role', 'member')
    .is('deleted_at', null)

  if ((count ?? 0) >= limits.max_members) {
    return { allowed: false, reason: 'MEMBER_QUOTA_REACHED', maxActiveBookings }
  }

  return { allowed: true, maxActiveBookings }
}

/**
 * GYM-63 / GYM-191 / GYM-195 — abonnement qui ouvre encore des droits sur cette salle.
 *
 * Le terme compte autant que le statut : un abonnement échu ne doit plus ouvrir de
 * réservation sans débit de crédit, même si le cron d'expiration a du retard. 'canceling'
 * compte comme actif — le membre a payé et reste engagé jusqu'au terme, lui débiter un
 * crédit ici serait le faire payer deux fois.
 *
 * Le booléen retourné alimente `p_has_subscription` de create_booking_atomic : c'est LUI
 * qui décide si la RPC débite un crédit.
 */
export async function hasActiveSubscription(
  supabase: SupabaseClient,
  memberId: string,
  gymId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('member_subscriptions')
    .select('id')
    .eq('member_id', memberId)
    .eq('gym_id', gymId)
    .in('status', ACTIVE_SUBSCRIPTION_STATUSES)
    .or(notExpiredFilter())
    .maybeSingle()

  return !!data
}

/**
 * GYM-94 — disponibilité crédit, avec la MÊME sélection que la RPC : au moins une ligne
 * avec (credits_total - credits_used) > 0, via la colonne générée credits_remaining.
 *
 * ⚠️ PAS de `.limit(1)` : c'est précisément ce qui masquait des crédits cumulés et
 * provoquait un faux 402.
 */
export async function hasAvailableCredits(
  supabase: SupabaseClient,
  memberId: string,
  gymId: string,
): Promise<boolean> {
  const { count } = await supabase
    .from('member_credits')
    .select('id', { count: 'exact', head: true })
    .eq('member_id', memberId)
    .eq('gym_id', gymId)
    .gt('credits_remaining', 0)

  return (count ?? 0) > 0
}

/**
 * GYM-196 — nombre de réservations CONFIRMÉES encore à venir, pour le plafond
 * nexxia_gyms.max_active_bookings.
 *
 * Compte volontairement sur TOUTES les salles du membre, comme le fait create-booking :
 * le plafond lu est celui de la salle du créneau, mais le décompte n'est pas restreint
 * (un membre n'appartient qu'à une salle — profiles.gym_id est unique et immuable
 * depuis GYM-203).
 */
export async function countFutureConfirmedBookings(
  supabase: SupabaseClient,
  memberId: string,
): Promise<number> {
  const { count } = await supabase
    .from('bookings')
    .select('id, time_slots!inner(starts_at)', { count: 'exact', head: true })
    .eq('member_id', memberId)
    .eq('status', 'confirmed')
    .gte('time_slots.starts_at', new Date().toISOString())

  return count ?? 0
}
