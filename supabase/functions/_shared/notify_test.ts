// GYM-391 — BANC DE L'AIDE PARTAGÉE `notify.ts` (une ligne + un push).
//
//     deno run supabase/functions/_shared/notify_test.ts
//
// ⚠️ AUCUNE DÉPENDANCE, AUCUN RÉSEAU, AUCUNE BASE. Script à corps de module : lire la
// sortie et le code de sortie, pas « N passed ».
import {
  jetonsAcceptes, motifDuRefus, notifierAvec, textes,
  type ChargePush, type Dependances, type LigneNotification, type Notification,
} from './notify.ts'

let failures = 0
function check(label: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ✓ ${label}`)
  else { failures++; console.log(`  ✗ ${label} : ${detail}`) }
}

const JETON = 'ExponentPushToken[secret-du-banc]'
const OK = { ok: true, sent: 1, failed: 0, results: [{ status: 'ok', id: 't1' }] }

interface Monde {
  deps: Dependances
  pushes: ChargePush[]
  lignes: LigneNotification[]
  journal: string[]
  lectures: number
}
function monde(o: {
  jetonEnBase?: string | null
  reponse?: unknown
  envoyerLeve?: boolean
  erreurEcriture?: string | null
  ecrireLeve?: boolean
  lireLeve?: boolean
} = {}): Monde {
  const m: Monde = { pushes: [], lignes: [], journal: [], lectures: 0, deps: null as unknown as Dependances }
  m.deps = {
    lireJeton() {
      m.lectures++
      if (o.lireLeve) throw new Error('base injoignable')
      return Promise.resolve(o.jetonEnBase ?? null)
    },
    envoyer(charge) {
      m.pushes.push(charge)
      if (o.envoyerLeve) throw new Error(`réseau coupé pour ${charge.tokens[0]}`)
      return Promise.resolve('reponse' in o ? o.reponse : OK)
    },
    ecrire(ligne) {
      if (o.ecrireLeve) throw new Error('base injoignable')
      if (o.erreurEcriture) return Promise.resolve(o.erreurEcriture)
      m.lignes.push(ligne)
      return Promise.resolve(null)
    },
    maintenant: () => '2026-11-23T10:00:00.000Z',
    journal: (message, detail) => { m.journal.push(`${message} ${JSON.stringify(detail)}`) },
  }
  return m
}
const base: Notification = {
  gymId: 'g1', memberId: 'm1', type: 'booking_confirmed',
  title: 'Réservation confirmée', body: 'Yoga, lundi 24 novembre à 18:00.',
  data: { booking_id: 'b1', slot_id: 's1' },
}

console.log('membre avec jeton, Expo accepte')
{
  const m = monde()
  const r = await notifierAvec({ ...base, pushToken: JETON }, m.deps)
  check('un seul push', m.pushes.length === 1, String(m.pushes.length))
  check('une seule ligne', m.lignes.length === 1, String(m.lignes.length))
  check('issue : ligne écrite, push envoyé', r.inbox_written && r.push_sent && r.push_attempted, JSON.stringify(r))
  check('push : gym_id et un seul jeton', m.pushes[0].gym_id === 'g1' && m.pushes[0].tokens.join() === JETON)
  check('push : même titre et même corps que la ligne', m.pushes[0].title === m.lignes[0].title && m.pushes[0].body === m.lignes[0].body)
  check('push : data porte le type et le contexte', JSON.stringify(m.pushes[0].data) === JSON.stringify({ booking_id: 'b1', slot_id: 's1', type: 'booking_confirmed' }), JSON.stringify(m.pushes[0].data))
  const l = m.lignes[0]
  check('ligne : salle, membre, type', l.gym_id === 'g1' && l.member_id === 'm1' && l.type === 'booking_confirmed')
  check('ligne : push_sent = true, sent_at daté', l.push_sent === true && l.sent_at === '2026-11-23T10:00:00.000Z')
  check('ligne : data = contexte, sans le type du push', JSON.stringify(l.data) === JSON.stringify({ booking_id: 'b1', slot_id: 's1' }), JSON.stringify(l.data))
  check('jeton fourni → profiles non relu', m.lectures === 0)
  check('rien au journal', m.journal.length === 0, m.journal.join(' | '))
}

console.log('membre sans jeton : la ligne quand même')
{
  for (const [nom, jeton] of [['null', null], ['vide', ''], ['blanc', '   ']] as const) {
    const m = monde()
    const r = await notifierAvec({ ...base, pushToken: jeton }, m.deps)
    check(`jeton ${nom} → aucun push, une ligne, push_sent = false`,
      m.pushes.length === 0 && m.lignes.length === 1 && m.lignes[0].push_sent === false && !r.push_sent && !r.push_attempted && r.inbox_written)
  }
  const m = monde()
  await notifierAvec({ ...base, data: undefined, pushToken: null }, m.deps)
  check('sans contexte → data = null dans la ligne', m.lignes[0].data === null)
}

console.log('jeton non fourni : lu dans profiles')
{
  const m = monde({ jetonEnBase: JETON })
  const r = await notifierAvec(base, m.deps)
  check('une lecture, un push, push_sent = true', m.lectures === 1 && m.pushes.length === 1 && r.push_sent)
  const sans = monde({ jetonEnBase: null })
  const r2 = await notifierAvec(base, sans.deps)
  check('aucun jeton en base → aucun push, une ligne', sans.pushes.length === 0 && sans.lignes.length === 1 && !r2.push_sent)
  const panne = monde({ lireLeve: true })
  const r3 = await notifierAvec(base, panne.deps)
  check('lecture en panne → la ligne est écrite quand même', panne.lignes.length === 1 && r3.inbox_written && !r3.push_sent)
}

console.log('push_sent = ticket Expo ok, rien d’autre (règle de send-communication)')
{
  const cas: [string, unknown, string][] = [
    ['plan sans notifications', { ok: true, sent: 0, failed: 0, skipped: 'notifications_disabled' }, 'notifications_disabled'],
    ['ticket en erreur', { ok: true, sent: 0, failed: 1, results: [{ status: 'error', message: `"${JETON}" is not a registered push notification recipient`, details: { error: 'DeviceNotRegistered' } }] }, 'DeviceNotRegistered'],
    ['Expo en panne (502)', { ok: false, error: `bad token ${JETON}`, status: 502 }, 'http_502'],
    ['résolution du plan en panne', { ok: false, code: 'PLAN_RESOLUTION_FAILED' }, 'PLAN_RESOLUTION_FAILED'],
    ['aucune réponse', null, 'no_response'],
    ['deux tickets pour un jeton', { ok: true, results: [{ status: 'ok' }, { status: 'ok' }] }, 'ticket_ok'],
    ['sent = 1 sans tickets', { ok: true, sent: 1 }, 'no_ticket'],
  ]
  for (const [nom, reponse, motif] of cas) {
    const m = monde({ reponse })
    const r = await notifierAvec({ ...base, pushToken: JETON }, m.deps)
    check(`${nom} → push_sent = false, ligne écrite`, !r.push_sent && r.push_attempted && m.lignes.length === 1 && m.lignes[0].push_sent === false, JSON.stringify(r))
    check(`${nom} → motif « ${motif} »`, motifDuRefus(reponse) === motif, motifDuRefus(reponse))
    check(`${nom} → le journal ne cite pas le jeton`, m.journal.length === 1 && !m.journal.join('').includes('secret-du-banc'), m.journal.join(' | '))
  }
  const m = monde({ envoyerLeve: true })
  const r = await notifierAvec({ ...base, pushToken: JETON }, m.deps)
  check('envoi qui lève → ne lève pas, ligne écrite, push_sent = false', !r.push_sent && r.inbox_written && m.lignes[0].push_sent === false)
  check('envoi qui lève → le journal ne cite ni le jeton ni le message', m.journal.length === 1 && !m.journal[0].includes('secret-du-banc'), m.journal.join(' | '))
  check('jetonsAcceptes : un ticket ok pour un jeton', jetonsAcceptes([JETON], OK).length === 1)
}

console.log('la ligne ne s’écrit pas : le push est parti, l’échec est dit')
{
  const m = monde({ erreurEcriture: 'violates check constraint "notifications_type_check"' })
  const r = await notifierAvec({ ...base, pushToken: JETON }, m.deps)
  check('contrainte refusée → inbox_written = false, push_sent = true', !r.inbox_written && r.push_sent && m.pushes.length === 1, JSON.stringify(r))
  check('contrainte refusée → journalisée', m.journal.length === 1 && m.journal[0].includes('ligne non écrite'))
  const leve = monde({ ecrireLeve: true })
  const r2 = await notifierAvec({ ...base, pushToken: JETON }, leve.deps)
  check('écriture qui lève → ne lève pas', !r2.inbox_written && r2.push_sent)
}

console.log('push: false : la ligne seule (create-booking)')
{
  const m = monde({ jetonEnBase: JETON })
  const r = await notifierAvec({ ...base, pushToken: JETON, push: false }, m.deps)
  check('aucun appel à send-notification, malgré un jeton fourni', m.pushes.length === 0)
  check('une ligne, push_sent = false', m.lignes.length === 1 && m.lignes[0].push_sent === false)
  check('issue : ligne écrite, push ni tenté ni envoyé', r.inbox_written && !r.push_sent && !r.push_attempted, JSON.stringify(r))
  const sansJeton = monde({ jetonEnBase: JETON })
  await notifierAvec({ ...base, push: false }, sansJeton.deps)
  check('jeton non fourni → profiles non lu, aucun push', sansJeton.lectures === 0 && sansJeton.pushes.length === 0 && sansJeton.lignes.length === 1)
  check('rien au journal', m.journal.length === 0 && sansJeton.journal.length === 0)
  const defaut = monde()
  await notifierAvec({ ...base, pushToken: JETON, push: true }, defaut.deps)
  check('push: true ou absent → le push part', defaut.pushes.length === 1)
}

console.log('pushType : le type du push peut différer de celui de la ligne')
{
  const m = monde()
  await notifierAvec({ ...base, type: 'waitlist_promoted', pushType: 'waitlist_promotion', pushToken: JETON }, m.deps)
  check('ligne en waitlist_promoted, push en waitlist_promotion', m.lignes[0].type === 'waitlist_promoted' && m.pushes[0].data.type === 'waitlist_promotion')
  check('slot_id transmis au push (ouverture du cours)', m.pushes[0].data.slot_id === 's1')
  const piege = monde()
  await notifierAvec({ ...base, data: { type: 'intrus' }, pushToken: JETON }, piege.deps)
  check('un `type` glissé dans data ne remplace pas celui du push', piege.pushes[0].data.type === 'booking_confirmed')
}

console.log('jamais deux push ni deux lignes pour un appel')
{
  for (const reponse of [OK, null, { ok: false, status: 400 }]) {
    const m = monde({ reponse })
    await notifierAvec({ ...base, pushToken: JETON }, m.deps)
    check(`réponse ${JSON.stringify(reponse)?.slice(0, 24)} → 1 push, 1 ligne (aucune relance)`, m.pushes.length === 1 && m.lignes.length === 1)
  }
}

console.log('textes')
{
  const c = { activite: 'Yoga', jour: 'lundi 24 novembre', heure: '18:00' }
  check('réservation', textes.reservationConfirmee(c).body === 'Yoga, lundi 24 novembre à 18:00.')
  check('inscription par la salle', textes.inscriptionParLaSalle(c).body === 'Yoga, lundi 24 novembre à 18:00. Inscrit par ta salle.')
  check('place disponible', textes.placeDisponible({ activite: 'Yoga', minutes: 30 }).body === 'Yoga : tu as 30 min pour confirmer.')
  check('cours annulé, crédit rendu', textes.coursAnnule({ ...c, creditRendu: true }).body === "Yoga du lundi 24 novembre à 18:00 est annulé. Ton crédit t'a été rendu.")
  check('cours annulé, sans crédit', textes.coursAnnule({ ...c, creditRendu: false }).body === 'Yoga du lundi 24 novembre à 18:00 est annulé.')
  check('abonnement mensuel', textes.abonnementActive({ plan: 'Illimité', centimesParMois: 5990 }).body === 'Illimité, 59,90 €/mois.')
  check('abonnement payé en une fois', textes.abonnementActive({ plan: 'Illimité' }).body === 'Illimité : ton abonnement est actif.')
  check('crédits : pluriel', textes.creditsAchetes({ plan: 'Carte 10', seances: 10 }).body === 'Carte 10 : 10 séances ajoutées.')
  check('crédits : singulier', textes.creditsAchetes({ plan: 'Séance', seances: 1 }).body === 'Séance : 1 séance ajoutée.')
  check('cours modifié, une séance', textes.coursModifie({ activite: 'Yoga', quoi: 'nouvel horaire : 18:30', seances: 1 }).body === 'Yoga, nouvel horaire : 18:30.')
  check('cours modifié, série', textes.coursModifie({ activite: 'Yoga', quoi: 'changement de coach', seances: 8 }).body === 'Yoga, changement de coach (8 séances concernées).')
  const susp = textes.suspensionNoShow({ activite: 'Yoga', duree: '48 h', jusquAu: 'mercredi 26 novembre à 10:00' })
  check('suspension no-show', susp.title === 'Compte suspendu 48 h' && susp.body === "Absence enregistrée pour Yoga. Ton compte est suspendu jusqu'au mercredi 26 novembre à 10:00.")
  check('prélèvement refusé', textes.paiementEchoue({ plan: 'Illimité', avant: '26 novembre' }).body.includes("d'ici au 26 novembre"))

  const tous = [
    textes.reservationConfirmee(c), textes.inscriptionParLaSalle(c),
    textes.placeDisponible({ activite: 'Yoga', minutes: 30 }),
    textes.coursAnnule({ ...c, creditRendu: true }), textes.coursAnnule({ ...c, creditRendu: false }),
    textes.abonnementActive({ plan: 'Illimité', centimesParMois: 5990 }), textes.abonnementActive({ plan: 'Illimité' }),
    textes.paiementEchoue({ plan: 'Illimité', avant: '26 novembre' }),
    textes.creditsAchetes({ plan: 'Carte 10', seances: 10 }), textes.creditsAchetes({ plan: 'Séance', seances: 1 }),
    textes.coursModifie({ activite: 'Yoga', quoi: 'nouvel horaire : 18:30', seances: 1 }),
    textes.coursModifie({ activite: 'Yoga', quoi: 'le cours a changé', seances: 8 }),
    susp,
  ]
  check('le banc couvre chaque texte de `textes`', new Set(Object.keys(textes)).size === 9, Object.keys(textes).join(','))
  const avecTiret = tous.filter((t) => /[—–]/.test(t.title + t.body))
  check(`aucun tiret long ni demi-cadratin dans les ${tous.length} textes`, avecTiret.length === 0, JSON.stringify(avecTiret))
  // Tutoiement partout : « vous », « votre » et « vos » sont refusés, en mot entier, quelle
  // que soit la casse. Les données du banc (Yoga, Illimité…) n'en contiennent pas.
  const vouvoiement = /(^|[^\p{L}])(vous|votre|vos)(?![\p{L}])/iu
  const vouvoyes = tous.filter((t) => vouvoiement.test(t.title) || vouvoiement.test(t.body))
  check(`tutoiement : ni « vous », ni « votre », ni « vos » dans les ${tous.length} textes`, vouvoyes.length === 0, JSON.stringify(vouvoyes))
  check('le contrôle attrape bien « Vous avez », « votre » et « vos »', ['Vous avez 30 min', 'Yoga : votre place', 'Tous vos cours'].every((x) => vouvoiement.test(x)))
  check('« rendez-vous » est refusé aussi : mieux vaut un faux positif à relire qu’un « vous » qui passe', vouvoiement.test('rendez-vous'))
  check('le contrôle ne se déclenche pas dans un mot (« Devos », « vosgien »)', !vouvoiement.test('Devos') && !vouvoiement.test('vosgien'))
  check('aucun titre ni corps vide', tous.every((t) => t.title.trim() !== '' && t.body.trim() !== ''))
}

if (failures > 0) { console.log(`\n❌ notify : ${failures} échec(s)`); Deno.exit(1) }
console.log('\n✅ notify : tout passe')
