// GYM-190 — BANC DE L'ANNULATION D'UNE RÉSERVATION PAR LA SALLE.
//
//     deno test --no-check supabase/functions/_shared/gym-booking-cancel_test.ts
//
// AUCUN RÉSEAU, AUCUNE BASE : les dépendances sont des doublures, comme dans notify_test.ts.
import {
  cancelBookingByGymWith, cancelPatch, GYM_STOP_CANCEL_REASON,
  type CancelDeps,
} from './gym-booking-cancel.ts'

function eq(actual: unknown, expected: unknown, message = ''): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`${message}\n  attendu : ${e}\n  obtenu  : ${a}`)
}

const NOW = '2026-11-25T10:00:00.000Z'

interface Monde { deps: CancelDeps; appels: string[]; patches: Record<string, unknown>[]; journal: string[] }
function monde(o: {
  touchees?: number
  erreurEcriture?: string
  ecrireLeve?: boolean
  erreurSuite?: string
  suiteLeve?: boolean
} = {}): Monde {
  const m: Monde = { appels: [], patches: [], journal: [], deps: null as unknown as CancelDeps }
  const suite = (nom: string) => (slotId: string) => {
    m.appels.push(`${nom}:${slotId}`)
    if (o.suiteLeve) throw new Error('rpc injoignable')
    return Promise.resolve(o.erreurSuite ?? null)
  }
  m.deps = {
    annuler(id, depuis, patch) {
      m.appels.push(`annuler:${id}:${depuis}`)
      m.patches.push(patch)
      if (o.ecrireLeve) throw new Error('base injoignable')
      if (o.erreurEcriture) return Promise.resolve({ error: o.erreurEcriture, touched: 0 })
      return Promise.resolve({ error: null, touched: o.touchees ?? 1 })
    },
    reordonner: suite('reorder_waitlist'),
    notifierFile: suite('notify_waitlist_for_free_seats'),
    maintenant: () => NOW,
    journal: (message, detail) => { m.journal.push(`${message} ${JSON.stringify(detail)}`) },
  }
  return m
}

Deno.test('motif d’annulation', () => {
  eq(GYM_STOP_CANCEL_REASON, 'subscription_stopped_by_gym')
})

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
  const r = await cancelBookingByGymWith({ id: 'b1', slot_id: 's1', status: 'confirmed' }, m.deps)
  eq(r, { id: 'b1', ok: true })
  eq(m.appels, ['annuler:b1:confirmed', 'notify_waitlist_for_free_seats:s1'])
  eq(m.patches[0], cancelPatch('confirmed', NOW))
})

Deno.test('en attente : UPDATE puis renumérotation, personne n’est notifié', async () => {
  const m = monde()
  const r = await cancelBookingByGymWith({ id: 'b2', slot_id: 's2', status: 'waitlisted' }, m.deps)
  eq(r, { id: 'b2', ok: true })
  eq(m.appels, ['annuler:b2:waitlisted', 'reorder_waitlist:s2'])
  eq(m.patches[0], cancelPatch('waitlisted', NOW))
})

Deno.test('erreur d’écriture : échec rendu, aucune suite', async () => {
  const m = monde({ erreurEcriture: 'permission denied' })
  const r = await cancelBookingByGymWith({ id: 'b1', slot_id: 's1', status: 'confirmed' }, m.deps)
  eq(r, { id: 'b1', ok: false, error: 'UPDATE_FAILED' })
  eq(m.appels, ['annuler:b1:confirmed'])
  eq(m.journal.length, 1)
})

Deno.test('l’écriture lève : échec rendu, jamais d’exception', async () => {
  const m = monde({ ecrireLeve: true })
  const r = await cancelBookingByGymWith({ id: 'b1', slot_id: 's1', status: 'confirmed' }, m.deps)
  eq(r, { id: 'b1', ok: false, error: 'UPDATE_FAILED' })
})

Deno.test('zéro ligne touchée (statut changé entre-temps) : échec STATUS_CHANGED, aucune suite', async () => {
  const m = monde({ touchees: 0 })
  const r = await cancelBookingByGymWith({ id: 'b1', slot_id: 's1', status: 'waitlisted' }, m.deps)
  eq(r, { id: 'b1', ok: false, error: 'STATUS_CHANGED' })
  eq(m.appels, ['annuler:b1:waitlisted'])
})

Deno.test('la suite échoue ou lève : la réservation reste annulée, l’échec est journalisé', async () => {
  for (const o of [{ erreurSuite: 'SLOT_NOT_FOUND' }, { suiteLeve: true }]) {
    const m = monde(o)
    const r = await cancelBookingByGymWith({ id: 'b1', slot_id: 's1', status: 'confirmed' }, m.deps)
    eq(r, { id: 'b1', ok: true, follow_up_failed: true }, JSON.stringify(o))
    eq(m.journal.length, 1)
  }
})

Deno.test('le journal ne porte que des identifiants techniques', async () => {
  const m = monde({ erreurEcriture: 'boom' })
  await cancelBookingByGymWith({ id: 'b1', slot_id: 's1', status: 'confirmed' }, m.deps)
  if (!m.journal[0].includes('b1') || !m.journal[0].includes('s1')) throw new Error(m.journal[0])
})
