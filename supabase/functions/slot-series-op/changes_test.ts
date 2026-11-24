// GYM-391 — BANC DE `changes.ts` : la demande comparée à l'état en base.
//
//     deno run supabase/functions/slot-series-op/changes_test.ts
//
// ⚠️ AUCUNE DÉPENDANCE, AUCUN RÉSEAU, AUCUNE BASE. Script à corps de module : lire la
// sortie et le code de sortie, pas « N passed ».
//
// La base est une doublure en mémoire qui reproduit ce que `slot-series-op` attend de la
// vraie : une écriture conditionnelle à `updated_at`, renouvelé à chaque écriture. Les
// messages passent par le vrai `notifierAvec` et les vrais `textes` : ce que le banc
// compte, ce sont les lignes et les push qui seraient partis.
import {
  applyToSlots, diffSeries, diffSlot, groupByMember, localTimeOf, zonedToUtc,
  type ChangeRequest, type SlotPatch, type SlotRow, type SlotStore,
} from './changes.ts'
import { notifierAvec, textes, type ChargePush, type LigneNotification } from '../_shared/notify.ts'

let failures = 0
function check(label: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ✓ ${label}`)
  else { failures++; console.log(`  ✗ ${label} : ${detail}`) }
}

const TZ = 'Europe/Brussels'
const YOGA = 'act-yoga'
const HIIT = 'act-hiit'
const LEA = 'coach-lea'
const TOM = 'coach-tom'
const NOMS: Record<string, string> = { [YOGA]: 'Yoga', [HIIT]: 'HIIT' }

/** Un créneau Yoga de 60 min avec Léa, à l'heure LOCALE donnée. */
function creneau(id: string, date: string, heure = '18:00', o: Partial<SlotRow> = {}): SlotRow {
  const debut = zonedToUtc(date, heure, TZ)
  return {
    id,
    starts_at: debut.toISOString(),
    ends_at: new Date(debut.getTime() + 60 * 60_000).toISOString(),
    activity_id: YOGA,
    coach_id: LEA,
    capacity: 12,
    level: 'all',
    notes: null,
    is_series_exception: false,
    updated_at: 'v1',
    ...o,
  }
}

/** Ce que le formulaire du dashboard envoie : TOUS les champs, modifiés ou non. */
function formulaire(o: SlotPatch = {}): SlotPatch {
  return {
    activity_id: YOGA,
    coach_id: LEA,
    capacity: 12,
    level: 'all',
    notes: null,
    starts_local_time: '18:00',
    duration_min: 60,
    ...o,
  }
}

interface Base {
  store: SlotStore
  lignes: Map<string, SlotRow>
  ecritures: Array<{ id: string; fields: Record<string, unknown> }>
}
/** `lent` : l'écriture rend la main avant de comparer, comme un aller-retour réseau. */
function base(creneaux: SlotRow[], o: { lent?: boolean; erreurSur?: string } = {}): Base {
  const b: Base = { lignes: new Map(creneaux.map((c) => [c.id, { ...c }])), ecritures: [], store: null as unknown as SlotStore }
  let version = 1
  b.store = {
    async write(slot, fields) {
      if (o.lent) await new Promise((r) => setTimeout(r, 0))
      if (o.erreurSur === slot.id) return 'error'
      const enBase = b.lignes.get(slot.id)
      if (!enBase || enBase.updated_at !== slot.updated_at) return 'stale'
      b.lignes.set(slot.id, { ...enBase, ...fields, updated_at: `v${++version}` } as SlotRow)
      b.ecritures.push({ id: slot.id, fields })
      return 'written'
    },
    reread: (id) => Promise.resolve(b.lignes.has(id) ? { ...b.lignes.get(id)! } : null),
  }
  return b
}

interface Envois { lignes: LigneNotification[]; pushes: ChargePush[] }
/** Fait partir, par le vrai `notifierAvec`, ce que la fonction enverrait pour ces écritures. */
async function notifierComme(
  applied: Awaited<ReturnType<typeof applyToSlots>>['applied'],
  reservations: Array<{ member_id: string; slot_id: string }>,
  envois: Envois = { lignes: [], pushes: [] },
): Promise<Envois> {
  for (const m of groupByMember(applied, reservations)) {
    await notifierAvec({
      gymId: 'g1',
      memberId: m.memberId,
      type: 'session_updated_by_gym',
      ...textes.coursModifie({ activite: NOMS[m.activityId] ?? 'Cours', quoi: m.what, seances: m.slotCount }),
      data: {
        slot_id: m.slotId, slot_count: m.slotCount,
        time_changed: m.time_changed, coach_changed: m.coach_changed, activity_changed: m.activity_changed,
      },
      pushToken: 'ExponentPushToken[banc]',
      pushType: 'slot_series_updated',
    }, {
      lireJeton: () => Promise.resolve(null),
      envoyer: (charge) => { envois.pushes.push(charge); return Promise.resolve({ ok: true, results: [{ status: 'ok' }] }) },
      ecrire: (ligne) => { envois.lignes.push(ligne); return Promise.resolve(null) },
      maintenant: () => '2026-11-24T10:00:00.000Z',
      journal: () => {},
    })
  }
  return envois
}

const serie = (patch: SlotPatch): ChangeRequest => ({ patch, scope: 'following', timeZone: TZ, inSeries: true })
const seul = (patch: SlotPatch): ChangeRequest => ({ patch, scope: 'single', timeZone: TZ, inSeries: false })

console.log('demande identique à l’état en base → 0 notification')
{
  const b = base([creneau('s1', '2026-12-01'), creneau('s2', '2026-12-08')])
  const r = await applyToSlots([...b.lignes.values()], serie(formulaire()), b.store)
  const e = await notifierComme(r.applied, [{ member_id: 'm1', slot_id: 's1' }, { member_id: 'm1', slot_id: 's2' }])
  check('aucune écriture', b.ecritures.length === 0, JSON.stringify(b.ecritures))
  check('les 2 créneaux sont comptés inchangés, aucun en échec', r.unchanged === 2 && r.failed.length === 0, JSON.stringify(r))
  check('aucune ligne, aucun push', e.lignes.length === 0 && e.pushes.length === 0, JSON.stringify(e))
  check('note vide du formulaire = note absente en base', Object.keys(diffSlot(creneau('s', '2026-12-01'), serie(formulaire({ notes: '' }))).fields).length === 0)
  check('coach vide du formulaire = créneau sans coach', Object.keys(diffSlot(creneau('s', '2026-12-01', '18:00', { coach_id: null }), serie(formulaire({ coach_id: '' }))).fields).length === 0)
  check('portée « ce cours seulement » sans différence : pas marqué exception', Object.keys(diffSlot(creneau('s', '2026-12-01'), { ...serie(formulaire({ starts_local_date: '2026-12-01' })), scope: 'single' }).fields).length === 0)
}

console.log('seul l’horaire change → time_changed seul')
{
  const b = base([creneau('s1', '2026-12-01')])
  const r = await applyToSlots([...b.lignes.values()], seul(formulaire({ starts_local_time: '18:30', starts_local_date: '2026-12-01' })), b.store)
  const e = await notifierComme(r.applied, [{ member_id: 'm1', slot_id: 's1' }])
  const d = e.lignes[0]?.data ?? {}
  check('une ligne, un push', e.lignes.length === 1 && e.pushes.length === 1, JSON.stringify(e))
  check('time_changed vrai', d.time_changed === true, JSON.stringify(d))
  check('coach_changed et activity_changed faux', d.coach_changed === false && d.activity_changed === false, JSON.stringify(d))
  check('seuls le début et la fin sont écrits', Object.keys(b.ecritures[0].fields).sort().join() === 'ends_at,starts_at', JSON.stringify(b.ecritures[0]))
  check('le corps dit le nouvel horaire, sans compte de séances', e.lignes[0].body === 'Yoga, nouvel horaire : 18:30.', e.lignes[0].body)
  check('le push porte le même corps et le type historique', e.pushes[0].body === e.lignes[0].body && e.pushes[0].data.type === 'slot_series_updated', JSON.stringify(e.pushes[0]))
  check('créneau ponctuel : jamais marqué exception', !('is_series_exception' in b.ecritures[0].fields))
}

console.log('2 créneaux pour un membre → 1 ligne')
{
  const b = base([creneau('s1', '2026-12-01'), creneau('s2', '2026-12-08'), creneau('s3', '2026-12-15')])
  const r = await applyToSlots([...b.lignes.values()], serie(formulaire({ starts_local_time: '19:00' })), b.store)
  const e = await notifierComme(r.applied, [
    { member_id: 'm1', slot_id: 's1' }, { member_id: 'm1', slot_id: 's2' },
    { member_id: 'm2', slot_id: 's3' },
  ])
  const m1 = e.lignes.filter((l) => l.member_id === 'm1')
  check('3 créneaux écrits', b.ecritures.length === 3, String(b.ecritures.length))
  check('m1 : une seule ligne', m1.length === 1, String(m1.length))
  check('m1 : un seul push', e.pushes.filter((p) => p.data.slot_id === 's1').length === 1 && e.pushes.length === 2, String(e.pushes.length))
  check('m1 : « 2 séances concernées », les siennes et pas les 3 de la série', m1[0].body === 'Yoga, nouvel horaire : 19:00 (2 séances concernées).', m1[0].body)
  check('m1 : la ligne pointe sa première séance et compte 2', m1[0].data?.slot_id === 's1' && m1[0].data?.slot_count === 2, JSON.stringify(m1[0].data))
  check('m2, une séance : une ligne sans compte', e.lignes.find((l) => l.member_id === 'm2')?.body === 'Yoga, nouvel horaire : 19:00.')
}

console.log('double clic : deux demandes simultanées sur le même état')
{
  const b = base([creneau('s1', '2026-12-01')], { lent: true })
  const lu = [...b.lignes.values()].map((c) => ({ ...c }))
  const demande = seul(formulaire({ starts_local_time: '18:30', starts_local_date: '2026-12-01' }))
  const [a, c] = await Promise.all([applyToSlots(lu, demande, b.store), applyToSlots(lu, demande, b.store)])
  const e: Envois = { lignes: [], pushes: [] }
  await notifierComme(a.applied, [{ member_id: 'm1', slot_id: 's1' }], e)
  await notifierComme(c.applied, [{ member_id: 'm1', slot_id: 's1' }], e)
  check('une seule écriture en base', b.ecritures.length === 1, String(b.ecritures.length))
  check('une seule ligne et un seul push pour les deux demandes', e.lignes.length === 1 && e.pushes.length === 1, JSON.stringify(e))
  check('la demande perdante relit, ne trouve plus de différence, et n’échoue pas', a.unchanged + c.unchanged === 1 && a.failed.length + c.failed.length === 0, JSON.stringify([a, c]))
  const rejoue = await applyToSlots([...b.lignes.values()], demande, b.store)
  check('rejouée après coup : rien à écrire', rejoue.applied.length === 0 && b.ecritures.length === 1)
}

console.log('série partiellement déjà à jour')
{
  // s2 est déjà à 19:00 : seuls les inscrits de s1 sont concernés.
  const b = base([creneau('s1', '2026-12-01'), creneau('s2', '2026-12-08', '19:00')])
  const r = await applyToSlots([...b.lignes.values()], serie(formulaire({ starts_local_time: '19:00' })), b.store)
  const e = await notifierComme(r.applied, [{ member_id: 'm1', slot_id: 's1' }, { member_id: 'm2', slot_id: 's2' }])
  check('s1 écrit, s2 inchangé', r.applied.map((x) => x.slotId).join() === 's1' && r.unchanged === 1, JSON.stringify(r))
  check('m1 prévenu, m2 non', e.lignes.length === 1 && e.lignes[0].member_id === 'm1', JSON.stringify(e.lignes))
}

console.log('drapeaux : chacun ne dit que ce qui change')
{
  const s = creneau('s1', '2026-12-01')
  const coach = diffSlot(s, serie(formulaire({ coach_id: TOM })))
  check('coach seul', coach.coach_changed && !coach.time_changed && !coach.activity_changed, JSON.stringify(coach))
  const activite = diffSlot(s, serie(formulaire({ activity_id: HIIT })))
  check('activité seule, et le message porte la nouvelle', activite.activity_changed && !activite.time_changed && !activite.coach_changed && activite.activityId === HIIT, JSON.stringify(activite))
  const duree = diffSlot(s, serie(formulaire({ duration_min: 45 })))
  check('durée seule : time_changed, seule la fin est écrite', duree.time_changed && Object.keys(duree.fields).join() === 'ends_at' && duree.newLocalTime === null && duree.newDurationMin === 45, JSON.stringify(duree))
  const capacite = diffSlot(s, serie(formulaire({ capacity: 20, notes: 'apporter un tapis' })))
  check('capacité et note : écrites, aucun drapeau', Object.keys(capacite.fields).sort().join() === 'capacity,notes' && !capacite.time_changed && !capacite.coach_changed && !capacite.activity_changed, JSON.stringify(capacite))
  const b = base([s])
  const r = await applyToSlots([s], serie(formulaire({ capacity: 20 })), b.store)
  const e = await notifierComme(r.applied, [{ member_id: 'm1', slot_id: 's1' }])
  check('capacité seule : écrite, personne n’est prévenu', b.ecritures.length === 1 && e.lignes.length === 0)
  const les2 = groupByMember([{ slotId: 's1', change: diffSlot(s, serie(formulaire({ starts_local_time: '18:30', coach_id: TOM }))) }], [{ member_id: 'm1', slot_id: 's1' }])
  check('horaire et coach : les deux sont dits', les2[0].what === 'nouvel horaire : 18:30, changement de coach', les2[0].what)
  const exception = diffSlot(s, { ...serie(formulaire({ starts_local_time: '18:30' })), scope: 'single' })
  check('portée « ce cours seulement » dans une série : marqué exception', exception.fields.is_series_exception === true)
}

console.log('heure locale de part et d’autre du changement d’heure')
{
  // Série à 18:00 heure de Bruxelles : 16:00Z l'été, 17:00Z l'hiver. Les deux valent 18:00.
  const ete = creneau('s1', '2026-10-20')
  const hiver = creneau('s2', '2026-10-27')
  check('les deux instants UTC diffèrent d’une heure', ete.starts_at.slice(11, 16) === '16:00' && hiver.starts_at.slice(11, 16) === '17:00', `${ete.starts_at} ${hiver.starts_at}`)
  check('demander 18:00 ne change aucun des deux', [ete, hiver].every((s) => Object.keys(diffSlot(s, serie(formulaire())).fields).length === 0))
  const d = diffSlot(hiver, serie(formulaire({ starts_local_time: '19:00' })))
  check('19:00 demandé en hiver → 18:00Z, annoncé 19:00', (d.fields.starts_at as string).slice(11, 16) === '18:00' && d.newLocalTime === '19:00', JSON.stringify(d))
  check('localTimeOf relit l’heure à l’horloge de la salle', localTimeOf(new Date(ete.starts_at), TZ) === '18:00')
}

console.log('reprises et échecs')
{
  // Une réservation prise entre la lecture et l'écriture renouvelle updated_at.
  const b = base([creneau('s1', '2026-12-01')])
  const lu = [{ ...b.lignes.get('s1')! }]
  b.lignes.set('s1', { ...b.lignes.get('s1')!, updated_at: 'v-reservation' })
  const r = await applyToSlots(lu, serie(formulaire({ starts_local_time: '19:00' })), b.store)
  check('updated_at renouvelé par un tiers : relu, puis écrit', r.applied.length === 1 && r.failed.length === 0 && b.ecritures.length === 1, JSON.stringify(r))

  const ko = base([creneau('s1', '2026-12-01'), creneau('s2', '2026-12-08')], { erreurSur: 's1' })
  const rk = await applyToSlots([...ko.lignes.values()], serie(formulaire({ starts_local_time: '19:00' })), ko.store)
  check('écriture en erreur : créneau en échec, le suivant est traité', rk.failed.join() === 's1' && rk.applied.map((x) => x.slotId).join() === 's2', JSON.stringify(rk))

  const parti = base([creneau('s1', '2026-12-01')])
  const luParti = [{ ...parti.lignes.get('s1')!, updated_at: 'v0' }]
  parti.lignes.delete('s1')
  const rp = await applyToSlots(luParti, serie(formulaire({ starts_local_time: '19:00' })), parti.store)
  check('créneau disparu entre-temps : en échec, pas de message', rp.failed.join() === 's1' && rp.applied.length === 0, JSON.stringify(rp))
}

console.log('gabarit de la série')
{
  const gabarit = { activity_id: YOGA, coach_id: LEA, capacity: 12, level: 'all', notes: null, starts_local_time: '18:00:00', duration_min: 60 }
  check('demande identique : rien à écrire (18:00 = 18:00:00)', Object.keys(diffSeries(gabarit, formulaire())).length === 0, JSON.stringify(diffSeries(gabarit, formulaire())))
  check('horaire seul : seule l’heure locale est écrite', JSON.stringify(diffSeries(gabarit, formulaire({ starts_local_time: '19:00' }))) === '{"starts_local_time":"19:00"}')
}

if (failures > 0) { console.log(`\n❌ slot-series-op/changes : ${failures} échec(s)`); Deno.exit(1) }
console.log('\n✅ slot-series-op/changes : tout passe')
