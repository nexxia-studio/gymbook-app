// GYM-190 — BANC DE L'ANNULATION D'UNE RÉSERVATION PAR LA SALLE.
//
//     deno test --no-check supabase/functions/_shared/gym-booking-cancel_test.ts
//
// AUCUN RÉSEAU, AUCUNE BASE : les dépendances sont des doublures, comme dans notify_test.ts.
import {
  cancelBookingByGymWith, cancelPatch,
  type BookingRef, type CancelDeps,
} from './gym-booking-cancel.ts'

function eq(actual: unknown, expected: unknown, message = ''): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`${message}\n  attendu : ${e}\n  obtenu  : ${a}`)
}

const NOW = '2026-11-25T10:00:00.000Z'

interface Monde {
  deps: CancelDeps; appels: string[]; verrous: string[]; patches: Record<string, unknown>[]
  journal: { message: string; detail: Record<string, unknown> }[]
}
const ref = (o: Partial<BookingRef> = {}): BookingRef =>
  ({ id: 'b1', slot_id: 's1', status: 'confirmed', gym_id: 'g1', member_id: 'm1', ...o })
function monde(o: {
  touchees?: number
  erreurEcriture?: string
  ecrireLeve?: boolean
  erreurSuite?: string
  suiteLeve?: boolean
} = {}): Monde {
  const m: Monde = { appels: [], patches: [], journal: [], verrous: [], deps: null as unknown as CancelDeps }
  const suite = (nom: string) => (slotId: string) => {
    m.appels.push(`${nom}:${slotId}`)
    if (o.suiteLeve) throw new Error('rpc injoignable')
    return Promise.resolve(o.erreurSuite ?? null)
  }
  m.deps = {
    annuler(b, patch) {
      m.appels.push(`annuler:${b.id}:${b.status}`)
      m.verrous.push(`${b.gym_id}:${b.member_id}`)
      m.patches.push(patch)
      if (o.ecrireLeve) throw new Error('base injoignable')
      if (o.erreurEcriture) return Promise.resolve({ error: o.erreurEcriture, touched: 0 })
      return Promise.resolve({ error: null, touched: o.touchees ?? 1 })
    },
    reordonner: suite('reorder_waitlist'),
    notifierFile: suite('notify_waitlist_for_free_seats'),
    maintenant: () => NOW,
    journal: (message, detail) => { m.journal.push({ message, detail }) },
  }
  return m
}

Deno.test('patch d’une confirmée : annulée, datée, motivée, jamais tardive', () => {
  eq(cancelPatch('confirmed', NOW), {
    status: 'cancelled', cancelled_at: NOW, cancel_reason: 'subscription_stopped_by_gym', is_late_cancel: false,
  })
})

Deno.test('patch d’une réservation en attente : champs de liste d’attente remis à null', () => {
  eq(cancelPatch('waitlisted', NOW), {
    status: 'cancelled', cancelled_at: NOW, cancel_reason: 'subscription_stopped_by_gym', is_late_cancel: false,
    waitlist_position: null, waitlist_notified_at: null, waitlist_confirmation_deadline: null,
  })
})

Deno.test('confirmée : UPDATE gardé par le statut lu, puis la file est prévenue', async () => {
  const m = monde()
  const r = await cancelBookingByGymWith(ref(), m.deps)
  eq(r, { id: 'b1', ok: true })
  eq(m.appels, ['annuler:b1:confirmed', 'notify_waitlist_for_free_seats:s1'])
  eq(m.patches[0], cancelPatch('confirmed', NOW))
})

Deno.test('en attente : UPDATE puis renumérotation, personne n’est notifié', async () => {
  const m = monde()
  const r = await cancelBookingByGymWith(ref({ id: 'b2', slot_id: 's2', status: 'waitlisted' }), m.deps)
  eq(r, { id: 'b2', ok: true })
  eq(m.appels, ['annuler:b2:waitlisted', 'reorder_waitlist:s2'])
  eq(m.patches[0], cancelPatch('waitlisted', NOW))
})

Deno.test('erreur d’écriture : échec rendu, aucune suite', async () => {
  const m = monde({ erreurEcriture: 'permission denied' })
  const r = await cancelBookingByGymWith(ref(), m.deps)
  eq(r, { id: 'b1', ok: false, error: 'UPDATE_FAILED' })
  eq(m.appels, ['annuler:b1:confirmed'])
  eq(m.journal.length, 1)
})

Deno.test('l’écriture lève : échec rendu, jamais d’exception', async () => {
  const m = monde({ ecrireLeve: true })
  const r = await cancelBookingByGymWith(ref(), m.deps)
  eq(r, { id: 'b1', ok: false, error: 'UPDATE_FAILED' })
})

Deno.test('zéro ligne touchée (statut changé entre-temps) : échec STATUS_CHANGED, aucune suite', async () => {
  const m = monde({ touchees: 0 })
  const r = await cancelBookingByGymWith(ref({ status: 'waitlisted' }), m.deps)
  eq(r, { id: 'b1', ok: false, error: 'STATUS_CHANGED' })
  eq(m.appels, ['annuler:b1:waitlisted'])
})

Deno.test('la suite échoue ou lève : la réservation reste annulée, l’échec est journalisé', async () => {
  for (const o of [{ erreurSuite: 'SLOT_NOT_FOUND' }, { suiteLeve: true }]) {
    const m = monde(o)
    const r = await cancelBookingByGymWith(ref(), m.deps)
    eq(r, { id: 'b1', ok: true, follow_up_failed: true }, JSON.stringify(o))
    eq(m.journal.length, 1)
  }
})

// Ce banc prouve la TRANSMISSION, pas le verrou : les `.eq('gym_id')` et `.eq('member_id')`
// de l'UPDATE vivent dans le câblage (`cancelBookingByGym`), hors de portée d'une doublure.
Deno.test('la salle et le membre de la référence sont transmis tels quels à la dépendance d’écriture', async () => {
  const m = monde()
  await cancelBookingByGymWith(ref({ gym_id: 'salle-A', member_id: 'membre-7' }), m.deps)
  eq(m.verrous, ['salle-A:membre-7'])
})

Deno.test('le journal ne porte que des identifiants techniques', async () => {
  const permis = ['booking_id', 'slot_id', 'status', 'gym_id', 'error']
  for (const o of [{ erreurEcriture: 'boom' }, { ecrireLeve: true }, { erreurSuite: 'SLOT_NOT_FOUND' }, { suiteLeve: true }]) {
    const m = monde(o)
    await cancelBookingByGymWith(ref(), m.deps)
    eq(m.journal.length, 1, JSON.stringify(o))
    const { detail } = m.journal[0]
    const enTrop = Object.keys(detail).filter((k) => !permis.includes(k))
    eq(enTrop, [], `clés hors liste : ${JSON.stringify(o)}`)
    eq([detail.booking_id, detail.slot_id, detail.status, detail.gym_id], ['b1', 's1', 'confirmed', 'g1'])
    // Le membre n'est pas nommé dans le journal, même par son identifiant.
    if (JSON.stringify(detail).includes('m1')) throw new Error(JSON.stringify(detail))
  }
})
