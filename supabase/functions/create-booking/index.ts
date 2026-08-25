import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// GYM-238 — chrome des emails composée depuis nexxia_gyms.
import { loadGymBranding, emailSender, emailShell } from '../_shared/gym-branding.ts'

// L'embed to-one (activities, coaches) est typé en TABLEAU par le client généré ; à
// l'exécution PostgREST renvoie un objet unique. Même contournement qu'admin-book-member.
function embeddedName(rel: unknown, fallback: string): string {
  const value = rel as { name?: string } | { name?: string }[] | null
  const one = Array.isArray(value) ? value[0] ?? null : value
  return one?.name ?? fallback
}
// GYM-226 — les quatre lectures de garde (quota salle, abonnement ouvrant, crédit
// disponible, plafond de réservations à venir) vivent désormais dans _shared, partagées
// avec admin-book-member. EXTRACTION PURE : requêtes, filtres et replis inchangés.
import {
  checkMemberQuota,
  countFutureConfirmedBookings,
  hasAccessRights,
  hasAvailableCredits,
} from '../_shared/booking-guards.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface BookingRequest {
  slot_id: string
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function errorResponse(status: number, message: string, code?: string) {
  return jsonResponse({ error: true, code: code ?? 'ERROR', message }, status)
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Auth client using the user's JWT
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return errorResponse(401, 'Non authentifié', 'UNAUTHORIZED')

    const supabaseUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    })

    // Admin client for writes
    const supabaseAdmin = createClient(supabaseUrl, serviceKey)

    // 1. Verify authentication
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
    if (authError || !user) return errorResponse(401, 'Non authentifié', 'UNAUTHORIZED')

    // Parse body
    const { slot_id: slotId } = await req.json() as BookingRequest
    if (!slotId) return errorResponse(400, 'slot_id requis', 'MISSING_SLOT_ID')

    // 2. Get member profile
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, gym_id, noshow_count, suspended_until, push_token, first_name, email')
      .eq('id', user.id)
      .single()

    if (!profile) return errorResponse(404, 'Profil introuvable', 'PROFILE_NOT_FOUND')

    // 3. Check no-show suspension via suspended_until
    const isSuspended = profile.suspended_until !== null
      && new Date(profile.suspended_until) > new Date()

    if (isSuspended) {
      return jsonResponse({
        error: true,
        code: 'SUSPENDED',
        message: 'Compte suspendu pour no-show',
        suspended_until: profile.suspended_until,
      }, 403)
    }

    // 4. Get time slot
    const { data: slot } = await supabaseAdmin
      .from('time_slots')
      .select('id, gym_id, activity_id, coach_id, starts_at, ends_at, capacity, status, activities(name), coaches(name)')
      .eq('id', slotId)
      .single()

    if (!slot) return errorResponse(404, 'Créneau introuvable', 'SLOT_NOT_FOUND')
    if (slot.status === 'cancelled') return errorResponse(400, 'Créneau annulé', 'SLOT_CANCELLED')
    if (new Date(slot.starts_at) < new Date()) return errorResponse(400, 'Créneau déjà passé', 'SLOT_PAST')
    if (slot.gym_id !== profile.gym_id) return errorResponse(403, 'Accès refusé', 'WRONG_GYM')

    // 4b. Freemium member quota guard
    const quotaCheck = await checkMemberQuota(supabaseAdmin, slot.gym_id)
    if (!quotaCheck.allowed) {
      return errorResponse(403, 'Limite de membres atteinte sur ce plan Viniz', quotaCheck.reason)
    }

    // 5. Check if already booked (any status)
    const { data: existingRows } = await supabaseAdmin
      .from('bookings')
      .select('id, status')
      .eq('member_id', user.id)
      .eq('slot_id', slotId)
      .limit(1)

    const existingBooking = existingRows?.[0] ?? null

    if (existingBooking?.status === 'confirmed') {
      return errorResponse(400, 'Déjà inscrit à ce créneau', 'ALREADY_BOOKED')
    }
    if (existingBooking?.status === 'waitlisted') {
      return errorResponse(400, 'Déjà en liste d\'attente', 'ALREADY_WAITLISTED')
    }
    // If cancelled → we'll reuse this row below

    // 6. Limite de réservations confirmées à venir (GYM-196 — configurable par salle).
    //    Position INCHANGÉE dans l'ordre des gardes : avant le guard paiement et avant la
    //    RPC, pour ne débiter aucun crédit à un membre qu'on va refuser.
    //    La limite vient du gym DU CRÉNEAU, et a déjà été lue par checkMemberQuota
    //    ci-dessus — aucune requête supplémentaire. NULL = aucune limite.
    const maxActiveBookings = quotaCheck.maxActiveBookings
    if (maxActiveBookings !== null) {
      const futureCount = await countFutureConfirmedBookings(supabaseAdmin, user.id)

      if (futureCount >= maxActiveBookings) {
        // `limit` est renvoyé pour que l'app affiche le bon nombre : elle ne charge
        // jamais nexxia_gyms et ne peut donc pas connaître la limite autrement.
        return jsonResponse({
          error: true,
          code: 'MAX_BOOKINGS_REACHED',
          message: `Maximum ${maxActiveBookings} réservations simultanées`,
          limit: maxActiveBookings,
        }, 400)
      }
    }

    // ============================================================
    // GYM-63 — Guard paiement : abonnement OU crédit obligatoire
    // ============================================================
    // GYM-191 — le terme compte autant que le statut : un abonnement échu ne doit plus
    // ouvrir de réservation sans débit de crédit, même si le cron d'expiration a du retard.
    // GYM-195 — 'canceling' compte comme actif : le membre a payé et reste engagé
    // jusqu'au terme, lui débiter un crédit ici serait le faire payer deux fois.
    const activeSubscription = await hasAccessRights(supabaseAdmin, user.id, slot.gym_id)

    // GYM-94 — dispo crédit = MÊME sélection que la RPC (colonne générée
    // credits_remaining, sans limit 1 qui masquait des crédits cumulés).
    const creditsAvailable = await hasAvailableCredits(supabaseAdmin, user.id, slot.gym_id)

    if (!activeSubscription && !creditsAvailable) {
      return jsonResponse({
        error: true,
        code: 'PAYMENT_REQUIRED',
        message: 'Abonnement ou crédit requis pour réserver ce cours',
      }, 402)
    }

    // GYM-69 — le débit du crédit est déplacé APRÈS la confirmation du siège
    // (chemin 'confirmed' plus bas). Aucun débit ici, ni sur le chemin waitlist.
    // ============================================================

    // ============================================================
    // GYM-70 — capacité + insertion/réactivation + débit crédit dans UNE transaction.
    // Le verrou FOR UPDATE sur la ligne du créneau (dans la RPC) sérialise la dernière
    // place : 2 requêtes simultanées → 1 seule 'confirmed', l'autre repart 'full' → waitlist.
    // Le débit FIFO est atomique avec l'insert (NO_CREDIT annule tout).
    // ============================================================
    const idempotencyKey = `${user.id}-${slotId}`

    const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc('create_booking_atomic', {
      p_member_id: user.id,
      p_slot_id: slotId,
      p_gym_id: slot.gym_id,
      p_has_subscription: activeSubscription,
      p_existing_booking_id: existingBooking?.status === 'cancelled' ? existingBooking.id : null,
    })

    if (rpcError) {
      // Course rare : crédit consommé entre le guard GYM-63 et la RPC.
      if (rpcError.message?.includes('NO_CREDIT')) {
        return jsonResponse({
          error: true,
          code: 'PAYMENT_REQUIRED',
          message: 'Abonnement ou crédit requis pour réserver ce cours',
        }, 402)
      }
      return errorResponse(500, rpcError.message, 'BOOKING_FAILED')
    }

    // Plein → chemin waitlist ACTUEL inchangé (hors verrou, aucun débit).
    if (rpcResult?.status === 'full') {
      const { count: waitlistCount } = await supabaseAdmin
        .from('bookings')
        .select('*', { count: 'exact', head: true })
        .eq('slot_id', slotId)
        .eq('status', 'waitlisted')

      const position = (waitlistCount ?? 0) + 1

      let booking
      let insertErr
      if (existingBooking?.status === 'cancelled') {
        const res = await supabaseAdmin
          .from('bookings')
          .update({ status: 'waitlisted', waitlist_position: position, cancelled_at: null, cancel_reason: null, is_late_cancel: false })
          .eq('id', existingBooking.id)
          .select()
          .single()
        booking = res.data; insertErr = res.error
      } else {
        const res = await supabaseAdmin
          .from('bookings')
          .insert({ member_id: user.id, slot_id: slotId, gym_id: slot.gym_id, status: 'waitlisted', waitlist_position: position, idempotency_key: idempotencyKey })
          .select()
          .single()
        booking = res.data; insertErr = res.error
      }

      if (insertErr) return errorResponse(500, insertErr.message, 'INSERT_FAILED')

      return jsonResponse({ booking, status: 'waitlisted', position })
    }

    // Confirmé — la RPC a inséré/réactivé le siège ET débité le crédit atomiquement.
    // On relit la ligne pour conserver la forme de réponse (booking complet) + email.
    const { data: booking } = await supabaseAdmin
      .from('bookings')
      .select()
      .eq('id', rpcResult.booking_id)
      .single()

    // 9. Send confirmation email (non-blocking)
    // (trigger trg_update_bookings_count maintains time_slots.bookings_count)
    // ⚠️ CORRECTIF PRÉALABLE (GYM-238) : ces deux casts faisaient ÉCHOUER `deno check` sur
    // cette fonction, AVANT ce lot — l'embed to-one est typé en TABLEAU par le client
    // généré alors que PostgREST renvoie un objet unique. Le dépôt a déjà la parade, dans
    // admin-book-member et mark-attendance : passer par `unknown`, puis tolérer les deux
    // formes. Sans ça, le gate « deno check → exit 0 » de ce lot était inatteignable ici.
    const activityName = embeddedName(slot.activities, 'Cours')
    const coachName = embeddedName(slot.coaches, '')
    // GYM-229 — pas de coach, pas de ligne. Une activité en accès libre (Open Gym) n'en a
    // aucun : un libellé « Coach » suivi d'un blanc n'informe de rien et se lit comme une
    // donnée manquante. Le bloc entier disparaît, libellé compris.
    // (Ces emails n'ont pas de version texte — Resend ne reçoit qu'un champ `html`.)
    const coachLine = coachName
      ? `<p style="color:#9A9890;margin:0 0 4px;">Coach: ${coachName}</p>`
      : ''

    try {
      const resendKey = Deno.env.get('RESEND_API_KEY')
      if (resendKey && profile.email) {
        const startDate = new Date(slot.starts_at)
        const dateStr = startDate.toLocaleDateString('fr-BE', {
          timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long',
        })
        const timeStr = startDate.toLocaleTimeString('fr-BE', {
          timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit',
        })

        // GYM-238 — 🔴 C'EST CET EMAIL QU'ANTOINE A REÇU EN QA LE 18/08 : le bouton
        // « Voir ma réservation » pointait `dopamine://bookings`, inerte dans Gmail comme
        // dans Apple Mail. Il devient un Universal Link, et toute la chrome est lue en base.
        const gym = await loadGymBranding(supabaseAdmin, slot.gym_id as string)

        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${resendKey}`,
          },
          body: JSON.stringify({
            from: emailSender(gym),
            to: profile.email,
            subject: `Réservation confirmée — ${activityName}`,
            html: emailShell(gym, {
              title: 'Réservation confirmée',
              width: 480,
              bodyHtml:
                `<p style="color:#6B6861;margin:0 0 8px;"><strong>${activityName}</strong></p>` +
                `<p style="color:#6B6861;margin:0 0 4px;">${dateStr} à ${timeStr}</p>` +
                coachLine,
              ctaLabel: 'Voir ma réservation',
              ctaPath: 'bookings',
            }),
          }),
        })
      }
    } catch {
      // Email send failure is non-blocking
    }

    return jsonResponse({
      booking,
      status: 'confirmed',
      activity: activityName,
      coach: coachName,
      starts_at: slot.starts_at,
    })
  } catch (err) {
    return errorResponse(500, (err as Error).message ?? 'Erreur interne', 'INTERNAL_ERROR')
  }
})
