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
      .select('id, member_id, slot_id, gym_id, status, waitlist_notified_at')
      .eq('id', bookingId)
      .single()

    if (!booking) return errorResponse(404, 'Réservation introuvable', 'BOOKING_NOT_FOUND')
    if (booking.member_id !== user.id) return errorResponse(403, 'Accès refusé', 'FORBIDDEN')
    if (booking.status !== 'waitlisted') return errorResponse(400, 'Réservation non en attente', 'NOT_WAITLISTED')

    // 3. Check 30-minute deadline
    if (booking.waitlist_notified_at) {
      const notifiedAt = new Date(booking.waitlist_notified_at)
      const deadline = new Date(notifiedAt.getTime() + 30 * 60 * 1000)

      if (new Date() > deadline) {
        // Expired — cancel this and promote next
        await admin.from('bookings').update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancel_reason: 'waitlist_expired',
        }).eq('id', bookingId)

        await admin.rpc('promote_next_in_waitlist', { p_slot_id: booking.slot_id })

        return errorResponse(410, 'Délai expiré — place donnée au suivant', 'WAITLIST_EXPIRED')
      }
    }

    // 4. Check slot capacity (someone else could have taken the spot)
    const { count: confirmedCount } = await admin
      .from('bookings')
      .select('*', { count: 'exact', head: true })
      .eq('slot_id', booking.slot_id)
      .eq('status', 'confirmed')

    const { data: slot } = await admin
      .from('time_slots')
      .select('capacity, starts_at, activities(name), coaches(name)')
      .eq('id', booking.slot_id)
      .single()

    if (!slot) return errorResponse(404, 'Créneau introuvable', 'SLOT_NOT_FOUND')

    if ((confirmedCount ?? 0) >= slot.capacity) {
      return errorResponse(409, 'Place déjà prise par un autre membre', 'SLOT_FULL')
    }

    // 5. Confirm the booking (trigger trg_update_bookings_count maintains time_slots counts)
    await admin.from('bookings').update({
      status: 'confirmed',
      waitlist_position: null,
      waitlist_notified_at: null,
      promoted_from_waitlist_at: new Date().toISOString(),
    }).eq('id', bookingId)

    // 6. Send confirmation
    const activityName = (slot.activities as { name: string } | null)?.name ?? 'Cours'

    const { data: profile } = await admin
      .from('profiles')
      .select('email, first_name')
      .eq('id', user.id)
      .single()

    if (resendKey && profile?.email) {
      const startDate = new Date(slot.starts_at)
      const dateStr = startDate.toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long' })
      const timeStr = startDate.toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' })

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify({
          from: 'Dopamine <noreply@nexxia.net>',
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
