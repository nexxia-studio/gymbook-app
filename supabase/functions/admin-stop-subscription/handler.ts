// GYM-190, étape C — LE CŒUR DE `admin-stop-subscription`, DÉPENDANCES INJECTÉES.
//
// `index.ts` appelle `Deno.serve()` au chargement et n'est pas importable par un banc.
// L'ENCHAÎNEMENT vit donc ici : tout ce qu'il touche du monde (base, Mollie, journal,
// notification, alertes) passe par `StopDeps`, remplacé par des doublures dans
// `handler_test.ts`. Même modèle que `cancelBookingByGymWith`.
//
// CINQ RÈGLES QUI NE SE NÉGOCIENT PAS :
//   1. MOLLIE D'ABORD, LA BASE ENSUITE. Tant que Mollie n'a pas confirmé, rien n'est écrit.
//   2. FERMÉ PAR DÉFAUT. Une réponse Mollie qu'on n'a pas comprise, une erreur réseau, un
//      délai dépassé : 502, rien ne change.
//   3. PAS D'ARRÊT PENDANT UN PRÉLÈVEMENT. Un paiement `open` ou `pending` peut encore être
//      encaissé : arrêter maintenant couperait un accès que le membre est en train de payer.
//      Un paiement `paid` que notre webhook n'a pas encore enregistré bloque de même.
//   4. APRÈS L'ÉCRITURE EN BASE, PLUS RIEN NE FAIT ÉCHOUER L'ARRÊT. Journal, réservations,
//      notification, email et alertes sont au mieux, chacun dans son propre filet.
//   5. UN ARRÊT INTERROMPU SE REPREND. Un nouvel appel réel sur un abonnement déjà arrêté
//      par la salle annule les réservations restées en place, et ne fait RIEN d'autre :
//      ni Mollie, ni écriture sur l'abonnement, ni notification, ni email.
//
// JOURNAUX ET ALERTES : identifiants techniques seulement. Ni nom, ni email, ni motif saisi.
import type { BookingRef, CancelResult } from '../_shared/gym-booking-cancel.ts'
import {
  bookingsToCancel, classifyMollieDelete, classifyMolliePayments, classifyMollieSubscription,
  computeEndDate, evaluateEligibility, STOPPED_BY_GYM, validateReason,
  type BookingCandidate, type BookingToCancel,
} from './logic.ts'

export interface StopSubscriptionRow {
  id: string; gym_id: string; member_id: string; status: string; plan_name: string | null
  cancellation_reason: string | null; ends_at: string | null; next_payment_at: string | null
  payments_count: number | null; max_payments: number | null; source_payment_id: string | null
  mollie_subscription_id: string | null; mollie_customer_id: string | null
  cancelled_at?: string | null
}

/** Délai avant qu'un second appel reprenne les annulations d'un arrêt : en deçà, le premier
 *  appel est sans doute encore en train de les faire (double clic), et les reprendre en
 *  parallèle remonterait de faux échecs STATUS_CHANGED et une fausse alerte. */
export const RESUME_GRACE_MS = 2 * 60 * 1000

/** Le profil de l'appelant, lu en base par le câblage. `null` : profil introuvable. */
export interface Caller { id: string; role: string | null; gym_id: string | null }

export interface MollieRef { token: string; customer_id: string; subscription_id: string }
/** Une réponse HTTP de Mollie, corps lu. Une erreur réseau ou un délai dépassé LÈVE. */
export interface MollieHttp { http: number; body: string }

/** Ce qu'il faut pour prévenir le membre. `ends_at` est en UTC : l'affichage passe par le fuseau. */
export interface MemberNotice {
  sub: StopSubscriptionRow
  gym_id: string
  ends_at: string
  time_zone: string | null
  cancelled_bookings: number
}

export interface StopAlert {
  stage: 'stop_not_persisted' | 'bookings_not_cancelled'
  mollieId: string | null
  gymId: string
  detail: Record<string, unknown>
}

export interface StopDeps {
  lireAbonnement(id: string): Promise<{ error: string | null; sub: StopSubscriptionRow | null }>
  lireFuseau(gymId: string): Promise<string | null>
  /** Réservations du membre dans la salle, bornées EN SQL : créneau à `ends_at` ou après, sans crédit débité. */
  lireReservations(q: { member_id: string; gym_id: string; ends_at: string }): Promise<{ error: string | null; rows: BookingCandidate[] }>
  jetonMollie(gymId: string): Promise<string | null>
  /** GET .../subscriptions/{id}/payments. Lecture seule. */
  molliePaiements(ref: MollieRef): Promise<MollieHttp>
  /** GET .../subscriptions/{id}. Lecture seule. */
  mollieStatut(ref: MollieRef): Promise<MollieHttp>
  /** DELETE .../subscriptions/{id}. */
  mollieDelete(ref: MollieRef): Promise<MollieHttp>
  /** UPDATE conditionnel (`status = 'active'`), verrouillé sur la salle, lignes relues. */
  updateSub(subscriptionId: string, gymId: string, patch: Record<string, unknown>): Promise<{ error: string | null; touched: number }>
  /** Relecture verrouillée sur la salle. */
  relireSub(subscriptionId: string, gymId: string): Promise<{ status: string; cancellation_reason: string | null; ends_at: string | null } | null>
  journal(row: Record<string, unknown>): Promise<{ error: string | null; id: string | null }>
  /** UPDATE de la ligne de journal, verrouillé sur la salle. */
  completerJournal(id: string, gymId: string, metadata: Record<string, unknown>): Promise<string | null>
  cancelBooking(ref: BookingRef): Promise<CancelResult>
  /** Rend vrai si la notification est écrite. */
  notification(n: MemberNotice): Promise<boolean>
  /** Rend vrai si l'email est parti. */
  email(n: MemberNotice): Promise<boolean>
  /** `recordWebhookFailure`. Jamais bloquant : le cœur avale aussi ce qu'elle lèverait. */
  alerte(a: StopAlert): Promise<void>
  maintenant(): Date
  log(niveau: 'info' | 'error', message: string, detail: Record<string, unknown>): void
}

export interface StopResult { status: number; body: Record<string, unknown> }

const ok = (body: Record<string, unknown>): StopResult => ({ status: 200, body })
const refus = (status: number, code: string, message: string, extra: Record<string, unknown> = {}): StopResult =>
  ({ status, body: { error: true, code, message, ...extra } })

const nomErreur = (e: unknown): string => (e instanceof Error ? e.name : 'unknown')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const introuvable = (): StopResult => refus(404, 'NOT_FOUND', 'Abonnement introuvable')

export async function stopSubscriptionWith(
  input: { appelant: Caller | null; body: unknown },
  deps: StopDeps,
): Promise<StopResult> {
  // ── 1. Appelant : gérant, et sa salle lue sur SON profil, jamais dans le corps.
  //    La spec réserve ce geste au gérant de la salle : `super_admin` n'y entre pas.
  const { appelant } = input
  if (!appelant || appelant.role !== 'gym_admin' || !appelant.gym_id) {
    return refus(403, 'FORBIDDEN', 'Réservé au gérant de la salle')
  }
  const gymId = appelant.gym_id

  // ── 2. Entrée.
  const body = (input.body !== null && typeof input.body === 'object' ? input.body : {}) as
    { subscription_id?: unknown; member_id?: unknown; reason?: unknown; dry_run?: unknown }
  const subscriptionId = typeof body.subscription_id === 'string' ? body.subscription_id : ''
  if (!subscriptionId) return refus(400, 'MISSING_SUBSCRIPTION_ID', 'subscription_id requis')
  const dryRun = body.dry_run === true

  // Le motif n'est pas exigé pour un aperçu : la modale le demande APRÈS l'avoir affiché.
  let reason = ''
  if (!dryRun) {
    const checked = validateReason(body.reason)
    if (!checked.ok) return refus(400, checked.code, checked.message)
    reason = checked.reason
  }

  // ── 3. L'abonnement. Celui d'une autre salle, ou d'un autre membre que celui annoncé,
  //    répond comme un abonnement qui n'existe pas : un gérant ne doit pas pouvoir sonder
  //    les identifiants des autres salles. Un identifiant qui n'a pas la forme d'un UUID
  //    ne peut désigner aucune ligne : même réponse, sans requête, et sa valeur brute
  //    n'entre dans aucun journal.
  const memberId = body.member_id === undefined || body.member_id === null ? null : body.member_id
  if (!UUID.test(subscriptionId) || (memberId !== null && (typeof memberId !== 'string' || !UUID.test(memberId)))) {
    return introuvable()
  }
  const lu = await deps.lireAbonnement(subscriptionId)
  if (lu.error) {
    deps.log('error', 'lecture de l\'abonnement impossible', { subscription_id: subscriptionId, error: lu.error })
    return refus(500, 'SERVER_ERROR', 'Lecture de l\'abonnement impossible')
  }
  const sub = lu.sub
  if (!sub || sub.gym_id !== gymId) return introuvable()
  if (memberId !== null && memberId.toLowerCase() !== sub.member_id.toLowerCase()) return introuvable()

  const alerter = async (a: StopAlert) => {
    try {
      await deps.alerte(a)
    } catch (e) {
      deps.log('error', 'alerte non envoyée (non bloquant)', { subscription_id: sub.id, stage: a.stage, error: nomErreur(e) })
    }
  }

  /** Annule une à une, par le helper idempotent. Un échec n'arrête pas les autres. */
  const annuler = async (liste: BookingToCancel[], alerte: Record<string, unknown> = {}) => {
    const cancelled: string[] = []
    const failed: { id: string; error: string }[] = []
    for (const b of liste) {
      try {
        const result = await deps.cancelBooking({
          id: b.id, slot_id: b.slot_id, status: b.status, gym_id: gymId, member_id: sub.member_id,
        })
        if (result.ok) cancelled.push(b.id)
        else failed.push({ id: b.id, error: result.error ?? 'UPDATE_FAILED' })
      } catch {
        failed.push({ id: b.id, error: 'UPDATE_FAILED' })
      }
    }
    if (failed.length > 0) {
      // Le membre garde une place sur un créneau où il n'aura plus d'accès : à reprendre à la main.
      deps.log('error', 'réservations non annulées', { subscription_id: sub.id, failed })
      await alerter({
        stage: 'bookings_not_cancelled', mollieId: sub.mollie_subscription_id, gymId,
        detail: { subscription_id: sub.id, ...alerte, failed_bookings: failed },
      })
    }
    return { cancelled, failed }
  }

  // ── 4. Éligibilité.
  const eligibility = evaluateEligibility(sub)
  if (eligibility.kind === 'already') {
    // Déjà arrêté par la salle. En aperçu : rien. En réel : REPRISE d'un arrêt qui serait
    // mort entre l'UPDATE et la fin des annulations. Les réservations au-delà du `ends_at`
    // DE LA LIGNE sont relues par la même requête bornée et annulées. Rien d'autre : ni
    // Mollie, ni écriture sur l'abonnement, ni notification, ni email.
    if (dryRun) return ok({ ok: true, already: true, ends_at: eligibility.ends_at })
    const finLue = eligibility.ends_at
    if (!finLue) {
      deps.log('error', 'reprise impossible : abonnement arrêté sans date de fin', { subscription_id: sub.id, gym_id: gymId })
      return refus(500, 'SERVER_ERROR', 'Abonnement arrêté sans date de fin : contactez le support')
    }
    const arreteDepuis = sub.cancelled_at ? deps.maintenant().getTime() - new Date(sub.cancelled_at).getTime() : Infinity
    if (arreteDepuis < RESUME_GRACE_MS) {
      return ok({ ok: true, already: true, ends_at: finLue, cancelled_bookings: [], failed_bookings: [] })
    }
    const restantes = await deps.lireReservations({ member_id: sub.member_id, gym_id: gymId, ends_at: finLue })
    if (restantes.error) {
      deps.log('error', 'lecture des réservations impossible (reprise)', { subscription_id: sub.id, error: restantes.error })
      return refus(500, 'SERVER_ERROR', 'Lecture des réservations impossible : réessayez')
    }
    const reliquat = bookingsToCancel(restantes.rows, finLue)
    if (reliquat.length === 0) {
      return ok({ ok: true, already: true, ends_at: finLue, cancelled_bookings: [], failed_bookings: [] })
    }
    const repris = await annuler(reliquat, { resumed: true })
    try {
      const j = await deps.journal({
        gym_id: gymId,
        admin_id: appelant.id,
        target_id: sub.member_id,
        action_type: 'subscription_cancel',
        reason,
        metadata: {
          subscription_id: sub.id, resumed: true, ends_at: finLue,
          cancelled_bookings: repris.cancelled, failed_bookings: repris.failed,
        },
      })
      if (j.error) deps.log('error', 'journal de reprise non écrit (non bloquant)', { subscription_id: sub.id, admin_id: appelant.id, error: j.error })
    } catch (e) {
      deps.log('error', 'journal de reprise non écrit (non bloquant)', { subscription_id: sub.id, admin_id: appelant.id, error: nomErreur(e) })
    }
    deps.log('info', 'arrêt repris', {
      subscription_id: sub.id, gym_id: gymId, ends_at: finLue, cancelled: repris.cancelled.length, failed: repris.failed.length,
    })
    return ok({ ok: true, already: true, ends_at: finLue, cancelled_bookings: repris.cancelled, failed_bookings: repris.failed })
  }
  if (eligibility.kind === 'refused') {
    return refus(409, eligibility.code, eligibility.message, { status: eligibility.status })
  }

  // ── 5. Date de fin, dans le calendrier de la salle.
  const timeZone = await deps.lireFuseau(gymId)
  const now = deps.maintenant()
  const end = computeEndDate(sub, timeZone, now)
  if (!end.ok) {
    return refus(409, end.code, 'Date de fin de la période payée inconnue : l\'abonnement n\'a pas été modifié')
  }
  const endsAt = end.ends_at

  // ── 6. Réservations concernées. Lues AVANT Mollie : si cette lecture échoue, rien n'a
  //    encore changé nulle part. La requête est bornée en SQL ; le filtre pur repasse
  //    derrière, pour que la règle ne dépende pas d'une clause oubliée.
  const reservations = await deps.lireReservations({ member_id: sub.member_id, gym_id: gymId, ends_at: endsAt })
  if (reservations.error) {
    deps.log('error', 'lecture des réservations impossible', { subscription_id: sub.id, error: reservations.error })
    return refus(500, 'SERVER_ERROR', 'Lecture des réservations impossible : l\'abonnement n\'a pas été modifié')
  }
  const bookings = bookingsToCancel(reservations.rows, endsAt)

  // ── 7. PRÉLÈVEMENT EN COURS, OU ENCAISSÉ SANS ÊTRE ENREGISTRÉ ? Lecture seule chez
  //    Mollie, faite aussi en aperçu pour que la modale affiche le refus avant la saisie
  //    du motif.
  const token = (await deps.jetonMollie(gymId)) ?? ''
  if (!token) {
    deps.log('error', 'aucun jeton Mollie, rien n\'est écrit', { subscription_id: sub.id, gym_id: gymId })
    return refus(502, 'MOLLIE_NOT_CONNECTED',
      'Le compte de paiement de la salle n\'est pas joignable : l\'abonnement est toujours actif')
  }
  const ref: MollieRef = {
    token,
    customer_id: sub.mollie_customer_id as string,
    subscription_id: sub.mollie_subscription_id as string,
  }
  const lectureImpossible = () => refus(502, 'MOLLIE_READ_FAILED',
    'Le prestataire de paiement n\'a pas pu être consulté : l\'abonnement est toujours actif, réessayez')

  try {
    const res = await deps.molliePaiements(ref)
    const outcome = classifyMolliePayments(res.http, res.body, { next_payment_at: sub.next_payment_at, timeZone })
    deps.log('info', 'Mollie paiements', { subscription_id: sub.id, http: res.http, outcome })
    if (outcome === 'failed') return lectureImpossible()
    if (outcome === 'in_flight') {
      return refus(409, 'PAYMENT_IN_FLIGHT',
        'Un prélèvement est en cours pour cet abonnement. Réessayez quand il sera encaissé ou rejeté.')
    }
    if (outcome === 'paid_not_recorded') {
      // L'échéance est payée chez Mollie et notre webhook ne l'a pas encore traitée : la
      // date de fin calculée plus haut couperait l'accès tout juste payé.
      return refus(409, 'PAYMENT_NOT_RECORDED',
        'Un prélèvement vient d\'être encaissé et n\'est pas encore enregistré. Réessayez dans quelques minutes.')
    }
    // `clear`, ou `not_found` : l'abonnement n'existe plus chez Mollie, rien n'est en cours.
  } catch (e) {
    deps.log('error', 'Mollie injoignable (paiements), rien n\'est écrit', { subscription_id: sub.id, gym_id: gymId, error: nomErreur(e) })
    return lectureImpossible()
  }

  // ── 8. Aperçu : aucune écriture nulle part.
  if (dryRun) {
    return ok({ ok: true, dry_run: true, ends_at: endsAt, plan_name: sub.plan_name, bookings })
  }

  // ── 9. MOLLIE D'ABORD. Le statut dit s'il reste quelque chose à arrêter : « déjà
  //    annulé » se lit sur un champ documenté, pas sur le texte d'une erreur du DELETE.
  let mollieOutcome: 'cancelled' | 'already_gone'
  try {
    const res = await deps.mollieStatut(ref)
    const state = classifyMollieSubscription(res.http, res.body)
    deps.log('info', 'Mollie statut', { subscription_id: sub.id, http: res.http, state })
    if (state === 'failed') return lectureImpossible()
    mollieOutcome = state === 'already_gone' ? 'already_gone' : 'cancelled'
  } catch (e) {
    deps.log('error', 'Mollie injoignable (statut), rien n\'est écrit', { subscription_id: sub.id, gym_id: gymId, error: nomErreur(e) })
    return lectureImpossible()
  }

  if (mollieOutcome === 'cancelled') {
    try {
      const res = await deps.mollieDelete(ref)
      const outcome = classifyMollieDelete(res.http)
      deps.log('info', 'Mollie DELETE', { subscription_id: sub.id, http: res.http, outcome })
      if (outcome === 'failed') {
        // Le statut HTTP seulement : le corps d'une réponse Mollie peut citer le client.
        deps.log('error', 'arrêt refusé par Mollie, rien n\'est écrit', { subscription_id: sub.id, gym_id: gymId, http: res.http })
        return refus(502, 'MOLLIE_STOP_FAILED',
          'L\'arrêt n\'a pas pu être confirmé par le prestataire de paiement : l\'abonnement est toujours actif')
      }
      mollieOutcome = outcome
    } catch (e) {
      // Réseau ou délai dépassé : on ne sait pas si Mollie a reçu la demande. Rien n'est
      // écrit ; un nouvel essai convergera (le statut dira « déjà parti »).
      deps.log('error', 'Mollie injoignable (DELETE), rien n\'est écrit', { subscription_id: sub.id, gym_id: gymId, error: nomErreur(e) })
      return refus(502, 'MOLLIE_STOP_FAILED',
        'Le prestataire de paiement est injoignable : l\'abonnement est toujours actif, réessayez')
    }
  }

  // ── 10. LA BASE ENSUITE. UPDATE conditionnel, lignes relues.
  const divergent = async (cause: string, detail: Record<string, unknown>): Promise<StopResult> => {
    // Mollie ne prélève plus et la base ne le dit pas : état divergent, journalisé en
    // entier et signalé pour être repris à la main (comme `cancel-subscription`).
    const etat = { subscription_id: sub.id, cause, mollie: mollieOutcome, intended_ends_at: endsAt, ...detail }
    deps.log('error', 'ÉCRITURE NON FAITE APRÈS L\'ARRÊT MOLLIE, ÉTAT DIVERGENT', {
      ...etat, gym_id: gymId, member_id: sub.member_id,
      mollie_subscription_id: sub.mollie_subscription_id, mollie_customer_id: sub.mollie_customer_id,
    })
    await alerter({ stage: 'stop_not_persisted', mollieId: sub.mollie_subscription_id, gymId, detail: etat })
    return refus(500, 'STOP_NOT_PERSISTED',
      'Les prélèvements sont arrêtés chez le prestataire de paiement mais l\'arrêt n\'a pas pu être enregistré : contactez le support')
  }

  const nowIso = now.toISOString()
  let ecrit: { error: string | null; touched: number }
  try {
    ecrit = await deps.updateSub(sub.id, gymId, {
      status: 'canceling',
      auto_renew: false,
      cancelled_at: nowIso,
      cancellation_reason: STOPPED_BY_GYM,
      ends_at: endsAt,
      next_payment_at: null,
      prenotification_sent_at: null,
      updated_at: nowIso,
    })
  } catch (e) {
    return await divergent('écriture interrompue', { error: nomErreur(e) })
  }
  if (ecrit.error) return await divergent('erreur d\'écriture', { error: ecrit.error })

  if (ecrit.touched === 0) {
    // Zéro ligne : la ligne n'était plus `active`. Si un appel concurrent a gagné, on ne
    // refait rien et on rend SA date de fin. Pas de reprise ici : l'autre appel est en
    // train d'annuler les réservations. Si c'est autre chose qui a changé le statut,
    // on ne dit pas « déjà fait » : c'est un état divergent.
    let current: Awaited<ReturnType<StopDeps['relireSub']>> = null
    try {
      current = await deps.relireSub(sub.id, gymId)
    } catch (e) {
      return await divergent('relecture interrompue', { error: nomErreur(e) })
    }
    if (current?.status === 'canceling' && current.cancellation_reason === STOPPED_BY_GYM) {
      return ok({ ok: true, already: true, ends_at: current.ends_at })
    }
    return await divergent('statut changé pendant l\'arrêt', { db_status_now: current?.status ?? null })
  }

  // ── 11. Journal, écrit AVANT les réservations : l'arrêt est tracé même si la suite
  //     s'interrompt. Il est complété après avec le résultat des annulations.
  const journalMetadata = {
    subscription_id: sub.id,
    previous_ends_at: sub.ends_at,
    new_ends_at: endsAt,
    previous_next_payment_at: sub.next_payment_at,
    end_date_rule: end.rule,
    mollie: mollieOutcome,
    planned_bookings: bookings.map((b) => b.id),
  }
  let journalId: string | null = null
  try {
    const j = await deps.journal({
      gym_id: gymId,
      admin_id: appelant.id,
      target_id: sub.member_id,
      action_type: 'subscription_cancel',
      reason,
      metadata: journalMetadata,
    })
    if (j.error) deps.log('error', 'journal non écrit (non bloquant)', { subscription_id: sub.id, admin_id: appelant.id, error: j.error })
    else journalId = j.id
  } catch (e) {
    deps.log('error', 'journal non écrit (non bloquant)', { subscription_id: sub.id, admin_id: appelant.id, error: nomErreur(e) })
  }

  // ── 12. Réservations, une à une. Un échec n'arrête pas les autres.
  const { cancelled: cancelledBookings, failed: failedBookings } = await annuler(bookings)

  if (journalId) {
    try {
      const erreur = await deps.completerJournal(journalId, gymId,
        { ...journalMetadata, cancelled_bookings: cancelledBookings, failed_bookings: failedBookings })
      if (erreur) deps.log('error', 'journal non complété (non bloquant)', { subscription_id: sub.id, error: erreur })
    } catch (e) {
      deps.log('error', 'journal non complété (non bloquant)', { subscription_id: sub.id, error: nomErreur(e) })
    }
  }

  // ── 13. MEMBRE PRÉVENU (critère 3). APRÈS l'écriture en base et les annulations, AU
  //     MIEUX. Ce bloc n'est atteint qu'une fois par arrêt : un appel concurrent ou répété
  //     sort plus haut en `already` (la reprise ne prévient personne), donc une seule
  //     notification et un seul email.
  const notice: MemberNotice = {
    sub, gym_id: gymId, ends_at: endsAt, time_zone: timeZone, cancelled_bookings: cancelledBookings.length,
  }
  let notified = false
  try {
    notified = await deps.notification(notice)
  } catch (e) {
    deps.log('error', 'notification non envoyée (non bloquant)', { subscription_id: sub.id, error: nomErreur(e) })
  }
  let emailed = false
  try {
    emailed = await deps.email(notice)
  } catch (e) {
    deps.log('error', 'email en erreur (non bloquant)', { subscription_id: sub.id, error: nomErreur(e) })
  }

  deps.log('info', 'arrêt enregistré', {
    subscription_id: sub.id, gym_id: gymId, mollie: mollieOutcome, ends_at: endsAt,
    cancelled: cancelledBookings.length, failed: failedBookings.length, notified, emailed,
  })

  return ok({
    ok: true,
    ends_at: endsAt,
    mollie: mollieOutcome,
    cancelled_bookings: cancelledBookings,
    failed_bookings: failedBookings,
  })
}
