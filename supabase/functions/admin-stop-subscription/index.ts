// GYM-190, étape C — LE GÉRANT ARRÊTE UN ABONNEMENT RÉCURRENT.
//
// CE QUE FAIT CETTE FONCTION. Elle coupe les prélèvements chez Mollie, puis pose
// l'abonnement en `canceling` avec `cancellation_reason = 'stopped_by_gym'` : le membre
// garde son accès jusqu'à la fin de la dernière période payée, et les réservations prises
// sous abonnement après cette date sont annulées.
//
// TROIS RÈGLES QUI NE SE NÉGOCIENT PAS :
//   1. MOLLIE D'ABORD, LA BASE ENSUITE (même ordre que `cancel-subscription`, GYM-113).
//      Tant que Mollie n'a pas confirmé, rien n'est écrit : la base ne dit jamais « arrêté »
//      pendant qu'un mandat prélève encore.
//   2. LA SALLE VIENT DU PROFIL DE L'APPELANT, JAMAIS DU CORPS (modèle `admin-lift-suspension`).
//   3. L'UPDATE EST CONDITIONNEL (`status = 'active'`) ET SES LIGNES SONT RELUES. Deux clics
//      simultanés : un seul écrit, l'autre reçoit `already` et ne refait rien.
//
// Les décisions vivent dans `logic.ts`, pures et testées. Ce fichier ne fait que les brancher.
//
// JOURNAUX : identifiants techniques seulement. Ni nom, ni email, ni motif saisi.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getValidMollieToken } from '../_shared/mollie-token.ts'
import { cancelBookingByGym } from '../_shared/gym-booking-cancel.ts'
import { emailSender, loadGymBranding } from '../_shared/gym-branding.ts'
import { notifier, textes } from '../_shared/notify.ts'
import { buildSubscriptionStoppedEmail, formatEndDate, langueDe } from '../_shared/subscription-stopped-email.ts'
import {
  bookingsToCancel, classifyMollieDelete, computeEndDate, evaluateEligibility,
  STOPPED_BY_GYM, validateReason,
  type BookingCandidate,
} from './logic.ts'

const FN = 'admin-stop-subscription'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const IS_TEST_MODE = Deno.env.get('MOLLIE_TEST_MODE') === 'true'
const MOLLIE_TEST_API_KEY = Deno.env.get('MOLLIE_TEST_API_KEY') ?? ''
const MOLLIE_TIMEOUT_MS = 15_000
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const RESEND_TIMEOUT_MS = 10_000

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function errorResponse(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return jsonResponse({ error: true, code, message, ...extra }, status)
}

// Les embeds to-one sont typés en tableau par le client alors que PostgREST rend un objet :
// on tolère les deux formes, comme `cancel-booking`.
const embedOne = <T,>(v: unknown): T | null =>
  Array.isArray(v) ? ((v[0] as T | undefined) ?? null) : ((v as T | null) ?? null)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // ── 1. Appelant : gérant, et sa salle lue sur SON profil.
    const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    if (!token) return errorResponse(401, 'UNAUTHORIZED', 'Non authentifié')

    const { data: { user }, error: authError } = await admin.auth.getUser(token)
    if (authError || !user) return errorResponse(401, 'UNAUTHORIZED', 'Non authentifié')

    const { data: adminProfile } = await admin
      .from('profiles')
      .select('role, gym_id')
      .eq('id', user.id)
      .single()

    // La spec réserve ce geste au gérant de la salle : `super_admin` n'y entre pas.
    if (!adminProfile || adminProfile.role !== 'gym_admin' || !adminProfile.gym_id) {
      return errorResponse(403, 'FORBIDDEN', 'Réservé au gérant de la salle')
    }
    const gymId = adminProfile.gym_id as string

    // ── 2. Entrée.
    const body = await req.json().catch(() => null) as
      { subscription_id?: unknown; reason?: unknown; dry_run?: unknown } | null
    const subscriptionId = typeof body?.subscription_id === 'string' ? body.subscription_id : ''
    if (!subscriptionId) return errorResponse(400, 'MISSING_SUBSCRIPTION_ID', 'subscription_id requis')
    const dryRun = body?.dry_run === true

    // Le motif n'est pas exigé pour un aperçu : la modale le demande APRÈS l'avoir affiché.
    let reason = ''
    if (!dryRun) {
      const checked = validateReason(body?.reason)
      if (!checked.ok) return errorResponse(400, checked.code, checked.message)
      reason = checked.reason
    }

    // ── 3. L'abonnement, et son appartenance à la salle de l'appelant.
    const { data: sub, error: subError } = await admin
      .from('member_subscriptions')
      .select('id, gym_id, member_id, status, plan_name, cancellation_reason, ends_at, next_payment_at, '
        + 'payments_count, max_payments, source_payment_id, mollie_subscription_id, mollie_customer_id')
      .eq('id', subscriptionId)
      .maybeSingle<{
        id: string; gym_id: string; member_id: string; status: string; plan_name: string | null
        cancellation_reason: string | null; ends_at: string | null; next_payment_at: string | null
        payments_count: number | null; max_payments: number | null; source_payment_id: string | null
        mollie_subscription_id: string | null; mollie_customer_id: string | null
      }>()

    if (subError) {
      console.error(`[${FN}] lecture de l'abonnement impossible:`, JSON.stringify({ subscription_id: subscriptionId, error: subError.message }))
      return errorResponse(500, 'SERVER_ERROR', 'Lecture de l\'abonnement impossible')
    }
    if (!sub) return errorResponse(404, 'NOT_FOUND', 'Abonnement introuvable')
    if (sub.gym_id !== gymId) return errorResponse(403, 'WRONG_GYM', 'Abonnement hors de votre salle')

    // ── 4. Éligibilité. « Déjà arrêté par la salle » sort ici, en aperçu comme en réel.
    const eligibility = evaluateEligibility(sub)
    if (eligibility.kind === 'already') {
      return jsonResponse({ ok: true, already: true, ends_at: eligibility.ends_at })
    }
    if (eligibility.kind === 'refused') {
      return errorResponse(409, eligibility.code, eligibility.message, { status: eligibility.status })
    }

    // ── 5. Date de fin, dans le calendrier de la salle.
    const { data: gymRow } = await admin
      .from('nexxia_gyms').select('timezone').eq('id', gymId).maybeSingle()
    const now = new Date()
    const end = computeEndDate(sub, gymRow?.timezone as string | null | undefined, now)
    if (!end.ok) {
      return errorResponse(409, end.code,
        'Date de fin de la période payée inconnue : l\'abonnement n\'a pas été modifié')
    }
    const endsAt = end.ends_at

    // ── 6. Réservations concernées. Lues AVANT Mollie : si cette lecture échoue, rien n'a
    //    encore changé nulle part.
    const { data: bookingRows, error: bookingsError } = await admin
      .from('bookings')
      .select('id, slot_id, status, debited_credit_id, time_slots(starts_at, activities(name))')
      .eq('member_id', sub.member_id)
      .eq('gym_id', gymId)
      .in('status', ['confirmed', 'waitlisted'])

    if (bookingsError) {
      console.error(`[${FN}] lecture des réservations impossible:`, JSON.stringify({ subscription_id: sub.id, error: bookingsError.message }))
      return errorResponse(500, 'SERVER_ERROR', 'Lecture des réservations impossible : l\'abonnement n\'a pas été modifié')
    }

    const candidates: BookingCandidate[] = (bookingRows ?? []).map((row) => {
      const slot = embedOne<{ starts_at: string | null; activities: unknown }>(row.time_slots)
      return {
        id: row.id as string,
        slot_id: row.slot_id as string,
        status: row.status as string,
        debited_credit_id: (row.debited_credit_id as string | null) ?? null,
        starts_at: slot?.starts_at ?? null,
        activity_name: embedOne<{ name: string }>(slot?.activities)?.name ?? null,
      }
    })
    const bookings = bookingsToCancel(candidates, endsAt)

    // ── 7. Aperçu : aucune écriture, aucun appel Mollie.
    if (dryRun) {
      return jsonResponse({ ok: true, dry_run: true, ends_at: endsAt, plan_name: sub.plan_name, bookings })
    }

    // ── 8. MOLLIE D'ABORD. Sans confirmation, 502 et aucune écriture.
    const mollieFailed = (code: string, message: string) => errorResponse(502, code, message)

    let accessToken: string
    if (IS_TEST_MODE) {
      accessToken = MOLLIE_TEST_API_KEY
    } else {
      accessToken = (await getValidMollieToken(admin, gymId)) ?? ''
    }
    if (!accessToken) {
      console.error(`[${FN}] aucun jeton Mollie, rien n'est écrit:`, JSON.stringify({ subscription_id: sub.id, gym_id: gymId, test_mode: IS_TEST_MODE }))
      return mollieFailed('MOLLIE_NOT_CONNECTED',
        'Le compte de paiement de la salle n\'est pas joignable : l\'abonnement est toujours actif')
    }

    let mollieOutcome: 'cancelled' | 'already_gone'
    try {
      const res = await fetch(
        `https://api.mollie.com/v2/customers/${encodeURIComponent(sub.mollie_customer_id as string)}`
          + `/subscriptions/${encodeURIComponent(sub.mollie_subscription_id as string)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(MOLLIE_TIMEOUT_MS),
        },
      )
      const text = await res.text()
      const outcome = classifyMollieDelete(res.status, text)
      console.log(`[${FN}] Mollie DELETE:`, JSON.stringify({ subscription_id: sub.id, http: res.status, outcome }))
      if (outcome === 'failed') {
        console.error(`[${FN}] arrêt refusé par Mollie, rien n'est écrit:`, JSON.stringify({ subscription_id: sub.id, gym_id: gymId, http: res.status, body: text.slice(0, 500) }))
        return mollieFailed('MOLLIE_STOP_FAILED',
          'L\'arrêt n\'a pas pu être confirmé par le prestataire de paiement : l\'abonnement est toujours actif')
      }
      mollieOutcome = outcome
    } catch (e) {
      // Réseau ou délai dépassé : on ne sait pas si Mollie a reçu la demande. Rien n'est
      // écrit ; un nouvel essai convergera (succès, ou « déjà parti »).
      console.error(`[${FN}] Mollie injoignable, rien n'est écrit:`, JSON.stringify({ subscription_id: sub.id, gym_id: gymId, error: (e as Error).message }))
      return mollieFailed('MOLLIE_STOP_FAILED',
        'Le prestataire de paiement est injoignable : l\'abonnement est toujours actif, réessayez')
    }

    // ── 9. LA BASE ENSUITE. UPDATE conditionnel, lignes relues.
    const nowIso = now.toISOString()
    const { data: updatedRows, error: updateError } = await admin
      .from('member_subscriptions')
      .update({
        status: 'canceling',
        auto_renew: false,
        cancelled_at: nowIso,
        cancellation_reason: STOPPED_BY_GYM,
        ends_at: endsAt,
        next_payment_at: null,
        prenotification_sent_at: null,
        updated_at: nowIso,
      })
      .eq('id', sub.id)
      .eq('status', 'active')
      .select('id')

    const divergent = (cause: string, detail: Record<string, unknown>) => {
      // Mollie a DÉJÀ arrêté les prélèvements et la base ne le dit pas : état divergent,
      // journalisé en entier pour être repris à la main (comme `cancel-subscription`).
      console.error(`[${FN}] ÉCRITURE NON FAITE APRÈS L'ARRÊT MOLLIE, ÉTAT DIVERGENT (${cause}):`, JSON.stringify({
        subscription_id: sub.id, member_id: sub.member_id, gym_id: gymId,
        mollie_subscription_id: sub.mollie_subscription_id, mollie_customer_id: sub.mollie_customer_id,
        mollie: mollieOutcome, intended_ends_at: endsAt, ...detail,
      }))
      return errorResponse(500, 'STOP_NOT_PERSISTED',
        'Les prélèvements sont arrêtés chez le prestataire de paiement mais l\'arrêt n\'a pas pu être enregistré : contactez le support')
    }

    if (updateError) return divergent('erreur d\'écriture', { error: updateError.message })

    if (!updatedRows || updatedRows.length === 0) {
      // Zéro ligne : la ligne n'était plus `active`. Un appel concurrent a gagné, on ne
      // refait rien. On relit pour rendre SA date de fin, et pour ne pas dire « déjà fait »
      // si c'est autre chose qui a changé le statut.
      const { data: current } = await admin
        .from('member_subscriptions')
        .select('status, cancellation_reason, ends_at')
        .eq('id', sub.id)
        .maybeSingle()
      if (current?.status === 'canceling' && current.cancellation_reason === STOPPED_BY_GYM) {
        return jsonResponse({ ok: true, already: true, ends_at: current.ends_at })
      }
      return divergent('statut changé pendant l\'arrêt', { db_status_now: current?.status ?? null })
    }

    // ── 10. Journal, écrit AVANT les réservations : l'arrêt est tracé même si la suite
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
    const { data: journalRow, error: journalError } = await admin
      .from('gym_admin_actions')
      .insert({
        gym_id: gymId,
        admin_id: user.id,
        target_id: sub.member_id,
        action_type: 'subscription_cancel',
        reason,
        metadata: journalMetadata,
      })
      .select('id')
      .maybeSingle()
    if (journalError) {
      console.error(`[${FN}] journal non écrit (non bloquant):`, JSON.stringify({ subscription_id: sub.id, admin_id: user.id, error: journalError.message }))
    }

    // ── 11. Réservations, une à une. Un échec n'arrête pas les autres.
    const cancelledBookings: string[] = []
    const failedBookings: { id: string; error: string }[] = []
    for (const b of bookings) {
      const result = await cancelBookingByGym(admin, { id: b.id, slot_id: b.slot_id, status: b.status })
      if (result.ok) cancelledBookings.push(b.id)
      else failedBookings.push({ id: b.id, error: result.error ?? 'UPDATE_FAILED' })
    }
    if (failedBookings.length > 0) {
      console.error(`[${FN}] réservations non annulées:`, JSON.stringify({ subscription_id: sub.id, failed: failedBookings }))
    }

    if (journalRow?.id) {
      const { error: journalUpdateError } = await admin
        .from('gym_admin_actions')
        .update({ metadata: { ...journalMetadata, cancelled_bookings: cancelledBookings, failed_bookings: failedBookings } })
        .eq('id', journalRow.id)
      if (journalUpdateError) {
        console.error(`[${FN}] journal non complété (non bloquant):`, JSON.stringify({ subscription_id: sub.id, error: journalUpdateError.message }))
      }
    }

    // ── 12. MEMBRE PRÉVENU (GYM-190, critère 3). APRÈS l'écriture en base et les
    //     annulations, AU MIEUX : rien de ce bloc ne peut faire échouer l'arrêt, chaque
    //     échec est journalisé (identifiants seulement, jamais l'adresse).
    //     Ce bloc n'est atteint qu'une fois par arrêt : un appel concurrent ou répété sort
    //     plus haut en `already`, donc une seule notification et un seul email.
    //     ⚠️ `endsAt` est en UTC (22:00 ou 23:00 la veille) : la date affichée passe
    //     TOUJOURS par `formatEndDate` avec le fuseau de la salle.
    const timeZone = gymRow?.timezone as string | null | undefined
    let notified = false
    try {
      // `notifier` ne lève pas ; le try couvre la composition du texte.
      const issue = await notifier(admin, {
        gymId,
        memberId: sub.member_id,
        type: 'subscription_stopped_by_gym',
        ...textes.abonnementArrete({ plan: sub.plan_name, date: formatEndDate(endsAt, timeZone) }),
        data: { subscription_id: sub.id, ends_at: endsAt },
      })
      notified = issue.inbox_written
    } catch (e) {
      console.error(`[${FN}] notification non envoyée (non bloquant):`, JSON.stringify({ subscription_id: sub.id, error: (e as Error).name }))
    }

    let emailed = false
    try {
      const { data: member } = await admin
        .from('profiles')
        .select('email, first_name, preferred_language')
        .eq('id', sub.member_id)
        .maybeSingle()
      const to = typeof member?.email === 'string' ? member.email.trim() : ''
      if (!RESEND_KEY || !to) {
        console.error(`[${FN}] email non envoyé (non bloquant):`, JSON.stringify({ subscription_id: sub.id, motif: RESEND_KEY ? 'no_address' : 'no_resend_key' }))
      } else {
        const branding = await loadGymBranding(admin, gymId)
        const mail = buildSubscriptionStoppedEmail({
          branding,
          firstName: (member?.first_name as string | null | undefined) ?? null,
          planName: sub.plan_name,
          endsAt,
          timeZone,
          cancelledBookings: cancelledBookings.length,
          langue: langueDe(member?.preferred_language as string | null | undefined),
        })
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
          body: JSON.stringify({ from: emailSender(branding), to, subject: mail.subject, html: mail.html }),
          signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
        })
        emailed = res.ok
        if (!res.ok) {
          // Le corps de la réponse peut citer l'adresse : seul le statut est journalisé.
          await res.body?.cancel().catch(() => {})
          console.error(`[${FN}] email refusé par Resend (non bloquant):`, JSON.stringify({ subscription_id: sub.id, http: res.status }))
        }
      }
    } catch (e) {
      console.error(`[${FN}] email en erreur (non bloquant):`, JSON.stringify({ subscription_id: sub.id, error: (e as Error).name }))
    }

    console.log(`[${FN}] arrêt enregistré:`, JSON.stringify({
      subscription_id: sub.id, gym_id: gymId, mollie: mollieOutcome, ends_at: endsAt,
      cancelled: cancelledBookings.length, failed: failedBookings.length, notified, emailed,
    }))

    return jsonResponse({
      ok: true,
      ends_at: endsAt,
      mollie: mollieOutcome,
      cancelled_bookings: cancelledBookings,
      failed_bookings: failedBookings,
    })
  } catch (err) {
    console.error(`[${FN}] uncaught:`, (err as Error).message)
    return errorResponse(500, 'SERVER_ERROR', 'Erreur interne')
  }
})
