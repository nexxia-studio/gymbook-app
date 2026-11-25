// GYM-190, étape C — LE GÉRANT ARRÊTE UN ABONNEMENT RÉCURRENT.
//
// CE QUE FAIT CETTE FONCTION. Elle coupe les prélèvements chez Mollie, puis pose
// l'abonnement en `canceling` avec `cancellation_reason = 'stopped_by_gym'` : le membre
// garde son accès jusqu'à la fin de la dernière période payée, et les réservations prises
// sous abonnement après cette date sont annulées.
//
// CE FICHIER NE FAIT QUE LE CÂBLAGE : authentification, clients, `fetch`. L'enchaînement
// et ses règles (Mollie d'abord, fermé par défaut, pas d'arrêt pendant un prélèvement)
// vivent dans `handler.ts`, testé avec des doublures ; les décisions pures dans `logic.ts`.
//
// JOURNAUX : identifiants techniques seulement. Ni nom, ni email, ni motif saisi.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getValidMollieToken } from '../_shared/mollie-token.ts'
import { cancelBookingByGym } from '../_shared/gym-booking-cancel.ts'
import { emailSender, loadGymBranding } from '../_shared/gym-branding.ts'
import { notifier, textes } from '../_shared/notify.ts'
import { buildSubscriptionStoppedEmail, formatEndDate, langueDe } from '../_shared/subscription-stopped-email.ts'
import { recordWebhookFailure } from '../_shared/webhook-failures.ts'
import { stopSubscriptionWith, type MollieHttp, type MollieRef, type StopSubscriptionRow } from './handler.ts'
import type { BookingCandidate } from './logic.ts'

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

function errorResponse(status: number, code: string, message: string) {
  return jsonResponse({ error: true, code, message }, status)
}

// Les embeds to-one sont typés en tableau par le client alors que PostgREST rend un objet :
// on tolère les deux formes, comme `cancel-booking`.
const embedOne = <T,>(v: unknown): T | null =>
  Array.isArray(v) ? ((v[0] as T | undefined) ?? null) : ((v as T | null) ?? null)

const SUBSCRIPTION_COLUMNS = 'id, gym_id, member_id, status, plan_name, cancellation_reason, ends_at, next_payment_at, '
  + 'payments_count, max_payments, source_payment_id, mollie_subscription_id, mollie_customer_id'

const subscriptionUrl = (ref: MollieRef) =>
  `https://api.mollie.com/v2/customers/${encodeURIComponent(ref.customer_id)}`
  + `/subscriptions/${encodeURIComponent(ref.subscription_id)}`

/** Un appel Mollie, corps lu. Réseau ou délai dépassé : lève, le cœur ferme par défaut. */
async function mollieCall(method: 'GET' | 'DELETE', url: string, token: string): Promise<MollieHttp> {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(MOLLIE_TIMEOUT_MS),
  })
  return { http: res.status, body: await res.text() }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Appelant : son rôle et sa salle sont lus sur SON profil, jamais dans le corps.
    const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    if (!token) return errorResponse(401, 'UNAUTHORIZED', 'Non authentifié')

    const { data: { user }, error: authError } = await admin.auth.getUser(token)
    if (authError || !user) return errorResponse(401, 'UNAUTHORIZED', 'Non authentifié')

    // Une PANNE de lecture n'est pas un refus : 500. Seuls l'absence de profil et un rôle
    // insuffisant répondent 403 (dans le cœur).
    const { data: adminProfile, error: profileError } = await admin
      .from('profiles')
      .select('role, gym_id')
      .eq('id', user.id)
      .maybeSingle()
    if (profileError) {
      console.error(`[${FN}] lecture du profil de l'appelant impossible:`, JSON.stringify({ code: profileError.code ?? null }))
      return errorResponse(500, 'SERVER_ERROR', 'Erreur interne')
    }

    const body = await req.json().catch(() => null)

    const result = await stopSubscriptionWith({
      appelant: adminProfile
        ? { id: user.id, role: (adminProfile.role as string | null) ?? null, gym_id: (adminProfile.gym_id as string | null) ?? null }
        : null,
      body,
    }, {
      async lireAbonnement(id) {
        const { data, error } = await admin
          .from('member_subscriptions')
          .select(SUBSCRIPTION_COLUMNS)
          .eq('id', id)
          .maybeSingle<StopSubscriptionRow>()
        return { error: error ? error.message : null, sub: data ?? null }
      },

      async lireFuseau(gymId) {
        const { data } = await admin.from('nexxia_gyms').select('timezone').eq('id', gymId).maybeSingle()
        return (data?.timezone as string | null | undefined) ?? null
      },

      // Bornée EN SQL : jointure interne sur le créneau, créneau à la date de fin ou après,
      // aucun crédit débité. Sans ces bornes, tout l'historique actif du membre remontait.
      async lireReservations({ member_id, gym_id, ends_at }) {
        const { data, error } = await admin
          .from('bookings')
          .select('id, slot_id, status, debited_credit_id, time_slots!inner(starts_at, activities(name))')
          .eq('member_id', member_id)
          .eq('gym_id', gym_id)
          .in('status', ['confirmed', 'waitlisted'])
          .is('debited_credit_id', null)
          .gte('time_slots.starts_at', ends_at)
        if (error) return { error: error.message, rows: [] }
        const rows: BookingCandidate[] = (data ?? []).map((row) => {
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
        return { error: null, rows }
      },

      // Jeton OAuth de la salle, ou clé de test : même règle que `cancel-subscription`.
      async jetonMollie(gymId) {
        if (IS_TEST_MODE) return MOLLIE_TEST_API_KEY || null
        return (await getValidMollieToken(admin, gymId)) ?? null
      },

      // raccourci: une seule page de 250 paiements, les plus récents d'abord — suivre
      // `_links.next` le jour où un abonnement dépasse 250 échéances (20 ans de mensualités).
      molliePaiements: (ref) => mollieCall('GET', `${subscriptionUrl(ref)}/payments?limit=250`, ref.token),
      mollieStatut: (ref) => mollieCall('GET', subscriptionUrl(ref), ref.token),
      mollieDelete: (ref) => mollieCall('DELETE', subscriptionUrl(ref), ref.token),

      // Client service_role : chaque écriture et relecture porte AUSSI la salle de l'appelant.
      async updateSub(subscriptionId, gymId, patch) {
        const { data, error } = await admin
          .from('member_subscriptions')
          .update(patch)
          .eq('id', subscriptionId)
          .eq('gym_id', gymId)
          .eq('status', 'active')
          .select('id')
        return { error: error ? error.message : null, touched: data?.length ?? 0 }
      },

      async relireSub(subscriptionId, gymId) {
        const { data } = await admin
          .from('member_subscriptions')
          .select('status, cancellation_reason, ends_at')
          .eq('id', subscriptionId)
          .eq('gym_id', gymId)
          .maybeSingle<{ status: string; cancellation_reason: string | null; ends_at: string | null }>()
        return data ?? null
      },

      async journal(row) {
        const { data, error } = await admin.from('gym_admin_actions').insert(row).select('id').maybeSingle()
        return { error: error ? error.message : null, id: (data?.id as string | undefined) ?? null }
      },

      async completerJournal(id, gymId, metadata) {
        const { error } = await admin.from('gym_admin_actions').update({ metadata }).eq('id', id).eq('gym_id', gymId)
        return error ? error.message : null
      },

      cancelBooking: (ref) => cancelBookingByGym(admin, ref),

      // ⚠️ `ends_at` est en UTC (22:00 ou 23:00 la veille) : la date affichée passe
      // TOUJOURS par `formatEndDate` avec le fuseau de la salle.
      async notification({ sub, gym_id, ends_at, time_zone }) {
        const issue = await notifier(admin, {
          gymId: gym_id,
          memberId: sub.member_id,
          type: 'subscription_stopped_by_gym',
          ...textes.abonnementArrete({ plan: sub.plan_name, date: formatEndDate(ends_at, time_zone) }),
          data: { subscription_id: sub.id, ends_at },
        })
        return issue.inbox_written
      },

      async email({ sub, gym_id, ends_at, time_zone, cancelled_bookings }) {
        const { data: member } = await admin
          .from('profiles')
          .select('email, first_name, preferred_language')
          .eq('id', sub.member_id)
          .maybeSingle()
        const to = typeof member?.email === 'string' ? member.email.trim() : ''
        if (!RESEND_KEY || !to) {
          console.error(`[${FN}] email non envoyé (non bloquant):`, JSON.stringify({ subscription_id: sub.id, motif: RESEND_KEY ? 'no_address' : 'no_resend_key' }))
          return false
        }
        const branding = await loadGymBranding(admin, gym_id)
        const mail = buildSubscriptionStoppedEmail({
          branding,
          firstName: (member?.first_name as string | null | undefined) ?? null,
          planName: sub.plan_name,
          endsAt: ends_at,
          timeZone: time_zone,
          cancelledBookings: cancelled_bookings,
          langue: langueDe(member?.preferred_language as string | null | undefined),
        })
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
          body: JSON.stringify({ from: emailSender(branding), to, subject: mail.subject, html: mail.html }),
          signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
        })
        if (!res.ok) {
          // Le corps de la réponse peut citer l'adresse : seul le statut est journalisé.
          await res.body?.cancel().catch(() => {})
          console.error(`[${FN}] email refusé par Resend (non bloquant):`, JSON.stringify({ subscription_id: sub.id, http: res.status }))
        }
        return res.ok
      },

      // Table `webhook_failures`, email et Slack. Ne lève jamais ; le cœur l'entoure quand même.
      alerte: ({ stage, mollieId, gymId, detail }) =>
        recordWebhookFailure(admin, { functionName: FN, mollieId, paymentId: null, gymId, stage, detail }),

      maintenant: () => new Date(),

      log(niveau, message, detail) {
        const line = `[${FN}] ${message}:`
        if (niveau === 'error') console.error(line, JSON.stringify(detail))
        else console.log(line, JSON.stringify(detail))
      },
    })

    return jsonResponse(result.body, result.status)
  } catch (err) {
    // Une exception n'arrive ici qu'AVANT toute écriture : après l'UPDATE, le cœur
    // contient chacune de ses suites.
    console.error(`[${FN}] uncaught:`, (err as Error).message)
    return errorResponse(500, 'SERVER_ERROR', 'Erreur interne')
  }
})
