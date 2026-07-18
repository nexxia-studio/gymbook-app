import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const resendKey = Deno.env.get('RESEND_API_KEY') ?? ''

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return errorResponse(401, 'Non authentifié', 'UNAUTHORIZED')

    const supabaseUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    })
    const admin = createClient(supabaseUrl, serviceKey)

    // 1. Auth
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
    if (authError || !user) return errorResponse(401, 'Non authentifié', 'UNAUTHORIZED')

    const { booking_id: bookingId } = await req.json() as { booking_id: string }
    if (!bookingId) return errorResponse(400, 'booking_id requis', 'MISSING_BOOKING_ID')

    // 2. Get booking
    const { data: booking } = await admin
      .from('bookings')
      .select('id, member_id, slot_id, gym_id, status, waitlist_notified_at, waitlist_confirmation_deadline')
      .eq('id', bookingId)
      .single()

    if (!booking) return errorResponse(404, 'Réservation introuvable', 'BOOKING_NOT_FOUND')
    if (booking.member_id !== user.id) return errorResponse(403, 'Accès refusé', 'FORBIDDEN')
    if (booking.status !== 'waitlisted') return errorResponse(400, 'Réservation non en attente', 'NOT_WAITLISTED')

    // 3. Check confirmation deadline (gym-configured)
    if (booking.waitlist_notified_at) {
      // Prefer explicit deadline if set, else fall back to notified_at + gym setting
      let deadline: Date
      if (booking.waitlist_confirmation_deadline) {
        deadline = new Date(booking.waitlist_confirmation_deadline)
      } else {
        const { data: gym } = await admin
          .from('nexxia_gyms')
          .select('waitlist_confirmation_minutes')
          .eq('id', booking.gym_id)
          .single()
        const minutes = gym?.waitlist_confirmation_minutes ?? 30
        deadline = new Date(new Date(booking.waitlist_notified_at).getTime() + minutes * 60 * 1000)
      }

      if (new Date() > deadline) {
        // Expired — cancel this and notify the next (modèle A : notify-and-wait).
        await admin.from('bookings').update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancel_reason: 'waitlist_expired',
        }).eq('id', bookingId)

        // GYM-108 — remplace l'appel fantôme : notify_next_in_waitlist (fonction partagée avec le
        // cron expire_waitlist_confirmations). Le booking expiré vient de passer 'cancelled' → il
        // n'est plus sélectionné (filtre waitlist_notified_at IS NULL + status='waitlisted'), pas
        // besoin d'exclusion. Retour VÉRIFIÉ + log non bloquant : l'expiration renvoyée à
        // l'appelant ne doit jamais échouer si la notification échoue.
        const { error: notifyErr } = await admin.rpc('notify_next_in_waitlist', {
          p_slot_id: booking.slot_id,
        })
        if (notifyErr) {
          console.error('[confirm-waitlist] notify_next_in_waitlist failed (non-blocking):', JSON.stringify({ slot_id: booking.slot_id, message: notifyErr.message }))
        }

        return errorResponse(410, 'Délai expiré — place donnée au suivant', 'WAITLIST_EXPIRED')
      }
    }

    // 4. GYM-70c — promotion ATOMIQUE sous verrou créneau : capacité (recount sous FOR UPDATE)
    // + débit crédit FIFO + confirmation en UNE transaction. NO_CREDIT annule tout (booking reste waitlisted).
    const { data: promo, error: promoError } = await admin.rpc('promote_waitlist_atomic', {
      p_booking_id: bookingId,
    })

    if (promoError) {
      return errorResponse(500, promoError.message, 'PROMOTE_FAILED')
    }

    // Non promu → REPRODUIT à l'identique le comportement actuel : erreur renvoyée au caller,
    // le booking reste 'waitlisted', AUCUNE avance automatique au suivant de la waitlist.
    if (promo?.status === 'skipped') {
      if (promo.reason === 'NO_CREDIT') {
        return jsonResponse({
          error: true,
          code: 'PAYMENT_REQUIRED',
          message: 'Abonnement ou crédit requis pour confirmer cette place',
        }, 402)
      }
      if (promo.reason === 'NOT_WAITLISTED') {
        return errorResponse(400, 'Réservation non en attente', 'NOT_WAITLISTED')
      }
      if (promo.reason === 'FULL') {
        return errorResponse(409, 'Place déjà prise par un autre membre', 'SLOT_FULL')
      }
      return errorResponse(404, 'Créneau introuvable', 'SLOT_NOT_FOUND')
    }

    // promoted → notifications actuelles (email de confirmation).
    const { data: slot } = await admin
      .from('time_slots')
      .select('starts_at, activities(name)')
      .eq('id', booking.slot_id)
      .single()

    // 6. Send confirmation
    const activityName = (slot?.activities as { name: string } | null)?.name ?? 'Cours'

    const { data: profile } = await admin
      .from('profiles')
      .select('email, first_name')
      .eq('id', user.id)
      .single()

    if (resendKey && profile?.email && slot) {
      const startDate = new Date(slot.starts_at)
      const dateStr = startDate.toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long' })
      const timeStr = startDate.toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' })

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify({
          from: 'Dopamine <noreply@viniz.app>',
          to: profile.email,
          subject: `Place confirmée — ${activityName}`,
          html: `<div style="font-family:'DM Sans',sans-serif;background:#F5F4F0;padding:40px 20px;"><div style="max-width:480px;margin:0 auto;"><div style="background:#111111;padding:24px;border-radius:16px 16px 0 0;text-align:center;"><span style="font-family:'Arial Black',sans-serif;color:#C8F000;font-size:24px;letter-spacing:2px;">DOPAMINE</span></div><div style="background:#FFFFFF;padding:32px 24px;border-radius:0 0 16px 16px;"><h2 style="margin:0 0 16px;color:#111111;">Place confirmée !</h2><p style="color:#6B6861;">Vous êtes inscrit à <strong>${activityName}</strong> le ${dateStr} à ${timeStr}.</p><a href="dopamine://bookings" style="display:inline-block;background:#111111;color:#C8F000;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:16px;">Voir ma réservation</a></div></div></div>`,
        }),
      }).catch(() => {})
    }

    return jsonResponse({ confirmed: true, activity: activityName })
  } catch (err) {
    return errorResponse(500, (err as Error).message ?? 'Erreur interne', 'INTERNAL_ERROR')
  }
})
