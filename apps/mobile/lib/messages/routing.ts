// GYM-391 — où mène un message : depuis la boîte (écran Messages) et depuis un push.
// Logique pure : ni React, ni routeur, ni Supabase. Les deux tables sont DISTINCTES et le
// restent : les types écrits dans `public.notifications` ne sont pas ceux des push.

import { isUuid } from './data'

export type MessageDestination =
  | { kind: 'session'; slotId: string } // /session/[id]
  | { kind: 'bookings' } // /(tabs)/bookings
  | { kind: 'subscription' } // /profile/subscription
  | { kind: 'profile' } // /(tabs)/profile
  | { kind: 'detail' } // /messages/[id] — le message en entier

const SLOT_TYPES: ReadonlySet<string> = new Set([
  'booking_confirmed',
  'waitlist_promoted',
  'session_cancelled_by_gym',
  'session_updated_by_gym',
])

const SUBSCRIPTION_TYPES: ReadonlySet<string> = new Set([
  'subscription_activated',
  'subscription_payment_failed',
  'credits_purchased',
])

/** Ce type mène-t-il à la fiche d'un cours, donc dépend-il de l'heure de ce cours ? */
export function messageNeedsSlotTime(type: string | null | undefined): boolean {
  return typeof type === 'string' && SLOT_TYPES.has(type)
}

/**
 * Le `slot_id` dont l'écran doit charger l'heure avant de router, ou null s'il n'y a rien à
 * charger : type sans cours, ou `data` (JSON non fiable) sans `slot_id` exploitable.
 * ⚠️ Seul un uuid passe : la valeur part dans une requête puis dans une route.
 */
export function messageSlotId(type: string | null | undefined, data: unknown): string | null {
  if (!messageNeedsSlotTime(type)) return null
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  const slotId = (data as Record<string, unknown>).slot_id
  return isUuid(slotId) ? slotId : null
}

/**
 * Destination d'un message touché dans la boîte. `slotStartsAt` est l'heure de début du
 * cours chargée par l'écran (absente, null ou illisible = cours introuvable ou heure
 * inconnue). Un cours déjà commencé compte comme passé.
 */
export function messageDestination(
  type: string | null | undefined,
  data: unknown,
  context: { now: Date; slotStartsAt?: string | null },
): MessageDestination {
  if (messageNeedsSlotTime(type)) {
    const slotId = messageSlotId(type, data)
    const startsAt = typeof context.slotStartsAt === 'string' ? new Date(context.slotStartsAt).getTime() : NaN
    // Une comparaison avec NaN est fausse : heure illisible → Mes réservations.
    return slotId !== null && startsAt > context.now.getTime() ? { kind: 'session', slotId } : { kind: 'bookings' }
  }
  if (typeof type !== 'string') return { kind: 'detail' }
  if (SUBSCRIPTION_TYPES.has(type)) return { kind: 'subscription' }
  if (type === 'no_show_suspension') return { kind: 'profile' }
  return { kind: 'detail' }
}

/**
 * Route ouverte au toucher d'un PUSH, ou null s'il n'y a rien à ouvrir.
 * ⚠️ Table extraite À L'IDENTIQUE de `handleNotificationTap` et figée par
 * tests/messages.test.ts : `slot_id` n'est pas validé (absent, la route porte « undefined »)
 * et aucun type n'est ajouté. Corriger ces écarts est hors périmètre de GYM-391.
 */
export type PushRoute = '/(tabs)/bookings' | '/(tabs)/profile' | '/(tabs)/schedule' | `/session/${string}`

export function pushRoute(data: Record<string, string>): PushRoute | null {
  switch (data.type) {
    case 'booking_confirmed':
    case 'booking_cancelled':
      return '/(tabs)/bookings'
    case 'waitlist_promotion':
      return `/session/${data.slot_id}`
    case 'noshow_warning':
    case 'noshow_suspension_48h':
    case 'noshow_suspension_2w':
      return '/(tabs)/profile'
    case 'slot_cancelled':
      return '/(tabs)/schedule'
    case 'reminder_24h':
    case 'reminder_2h':
      return `/session/${data.slot_id}`
    default:
      return null
  }
}
