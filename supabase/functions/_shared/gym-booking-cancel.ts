// GYM-190, étape C — ANNULER UNE RÉSERVATION AU NOM DE LA SALLE.
//
// POURQUOI CE MODULE. Il n'existait aucun chemin d'annulation d'UNE réservation côté salle :
// `cancel-booking` exige le JWT du membre, `cancel-slot` annule tout un créneau. Quand le
// gérant arrête un abonnement, les réservations prises sous cet abonnement après la date
// de fin doivent tomber une à une.
//
// CE QUI EST REPRIS DE `cancel-booking` (sections 5a, 5b et 8), ET CE QUI NE L'EST PAS :
//   - repris : l'UPDATE en `cancelled` (le trigger `trg_update_bookings_count` recalcule
//     les compteurs du créneau), puis `notify_waitlist_for_free_seats` pour une confirmée
//     ou `reorder_waitlist` pour une réservation en attente ;
//   - pas repris : la sanction d'annulation tardive (`is_late_cancel` reste faux, la
//     décision vient de la salle), le remboursement de crédit (l'appelant ne passe que des
//     réservations sans crédit débité) et l'email par réservation.
//
// Les deux RPC sont réservées à `service_role` : `admin` doit être un client service_role.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export const GYM_STOP_CANCEL_REASON = 'subscription_stopped_by_gym'

export type CancellableStatus = 'confirmed' | 'waitlisted'

export interface BookingRef {
  id: string
  slot_id: string
  status: CancellableStatus
}

export interface CancelResult {
  id: string
  ok: boolean
  /** `UPDATE_FAILED` : la base a refusé. `STATUS_CHANGED` : la réservation n'était plus dans le statut lu. */
  error?: 'UPDATE_FAILED' | 'STATUS_CHANGED'
  /** La réservation EST annulée, mais la file d'attente n'a pas pu être prévenue ou renumérotée. */
  follow_up_failed?: true
}

/** Ce que l'annulation touche du monde. Remplacé par des doublures dans le banc. */
export interface CancelDeps {
  /** UPDATE gardé par le statut lu ; rend l'erreur et le nombre de lignes touchées. */
  annuler(
    bookingId: string, depuis: CancellableStatus, patch: Record<string, unknown>,
  ): Promise<{ error: string | null; touched: number }>
  /** RPC `reorder_waitlist` ; rend le message d'erreur, ou null. */
  reordonner(slotId: string): Promise<string | null>
  /** RPC `notify_waitlist_for_free_seats` ; rend le message d'erreur, ou null. */
  notifierFile(slotId: string): Promise<string | null>
  maintenant(): string
  journal(message: string, detail: Record<string, unknown>): void
}

/** Les colonnes écrites. Une réservation en attente rend aussi sa place dans la file. */
export function cancelPatch(status: CancellableStatus, now: string): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    status: 'cancelled',
    cancelled_at: now,
    cancel_reason: GYM_STOP_CANCEL_REASON,
    is_late_cancel: false,
  }
  if (status === 'waitlisted') {
    patch.waitlist_position = null
    patch.waitlist_notified_at = null
    patch.waitlist_confirmation_deadline = null
  }
  return patch
}

/**
 * Annule UNE réservation. Ne lève jamais : un échec est rendu, pour que l'appelant passe
 * à la suivante.
 *
 * L'UPDATE est gardé par le statut lu. Si la réservation a changé entre la lecture et
 * l'écriture (le membre l'a annulée, ou elle est passée de la file au cours), rien n'est
 * écrit et l'échec `STATUS_CHANGED` remonte : on n'applique pas le chemin d'une file
 * d'attente à une place confirmée.
 */
export async function cancelBookingByGymWith(b: BookingRef, deps: CancelDeps): Promise<CancelResult> {
  const ctx = { booking_id: b.id, slot_id: b.slot_id, status: b.status }

  try {
    const { error, touched } = await deps.annuler(b.id, b.status, cancelPatch(b.status, deps.maintenant()))
    if (error) {
      deps.journal('annulation refusée par la base', { ...ctx, error })
      return { id: b.id, ok: false, error: 'UPDATE_FAILED' }
    }
    if (touched === 0) return { id: b.id, ok: false, error: 'STATUS_CHANGED' }
  } catch (e) {
    deps.journal('annulation interrompue', { ...ctx, error: (e as Error).message })
    return { id: b.id, ok: false, error: 'UPDATE_FAILED' }
  }

  // La réservation est annulée. La suite est au mieux, comme dans `cancel-booking` : une
  // file non prévenue ne défait pas une annulation écrite, mais l'échec est journalisé.
  try {
    const suite = b.status === 'waitlisted' ? await deps.reordonner(b.slot_id) : await deps.notifierFile(b.slot_id)
    if (suite) {
      deps.journal('file d\'attente non mise à jour après annulation', { ...ctx, error: suite })
      return { id: b.id, ok: true, follow_up_failed: true }
    }
  } catch (e) {
    deps.journal('file d\'attente non mise à jour après annulation', { ...ctx, error: (e as Error).message })
    return { id: b.id, ok: true, follow_up_failed: true }
  }
  return { id: b.id, ok: true }
}

/** Version branchée sur la base. `admin` est un client service_role. */
export function cancelBookingByGym(admin: SupabaseClient, b: BookingRef): Promise<CancelResult> {
  return cancelBookingByGymWith(b, {
    async annuler(bookingId, depuis, patch) {
      const { data, error } = await admin
        .from('bookings').update(patch).eq('id', bookingId).eq('status', depuis).select('id')
      return { error: error ? error.message : null, touched: data?.length ?? 0 }
    },
    async reordonner(slotId) {
      const { error } = await admin.rpc('reorder_waitlist', { p_slot_id: slotId })
      return error ? error.message : null
    },
    async notifierFile(slotId) {
      const { error } = await admin.rpc('notify_waitlist_for_free_seats', { p_slot_id: slotId })
      return error ? error.message : null
    },
    maintenant: () => new Date().toISOString(),
    journal: (message, detail) => console.error(`[gym-booking-cancel] ${message}:`, JSON.stringify(detail)),
  })
}
