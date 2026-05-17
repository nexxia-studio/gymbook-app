import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
      .select('id, gym_id, first_name, last_name, email')
      .eq('id', user.id)
      .single()

    if (!profile) return errorResponse(404, 'Profil introuvable', 'PROFILE_NOT_FOUND')

    // 3. Check no-show suspension
    const { data: penalties } = await supabaseAdmin
      .from('penalties')
      .select('id, expires_at')
      .eq('member_id', user.id)
      .eq('type', 'suspension')
      .gte('expires_at', new Date().toISOString())
      .limit(1)

    if (penalties && penalties.length > 0) {
      return errorResponse(403, 'Compte suspendu pour no-show', 'SUSPENDED')
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

    // 6. Check max 2 future confirmed bookings
    const { count: futureCount } = await supabaseAdmin
      .from('bookings')
      .select('id, time_slots!inner(starts_at)', { count: 'exact', head: true })
      .eq('member_id', user.id)
      .eq('status', 'confirmed')
      .gte('time_slots.starts_at', new Date().toISOString())

    if ((futureCount ?? 0) >= 2) {
      return errorResponse(400, 'Maximum 2 réservations simultanées', 'MAX_BOOKINGS_REACHED')
    }

    // 7. Check capacity
    const { count: confirmedCount } = await supabaseAdmin
      .from('bookings')
      .select('*', { count: 'exact', head: true })
      .eq('slot_id', slotId)
      .eq('status', 'confirmed')

    const booked = confirmedCount ?? 0
    const isFull = booked >= slot.capacity

    // Generate idempotency key
    const idempotencyKey = `${user.id}-${slotId}`

    if (isFull) {
      // Waitlist
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

    // 8. Create confirmed booking (or reuse cancelled row)
    let booking
    let insertErr
    if (existingBooking?.status === 'cancelled') {
      const res = await supabaseAdmin
        .from('bookings')
        .update({ status: 'confirmed', cancelled_at: null, cancel_reason: null, is_late_cancel: false, booked_at: new Date().toISOString() })
        .eq('id', existingBooking.id)
        .select()
        .single()
      booking = res.data; insertErr = res.error
    } else {
      const res = await supabaseAdmin
        .from('bookings')
        .insert({ member_id: user.id, slot_id: slotId, gym_id: slot.gym_id, status: 'confirmed', idempotency_key: idempotencyKey })
        .select()
        .single()
      booking = res.data; insertErr = res.error
    }
      .select()
      .single()

    if (insertErr) return errorResponse(500, insertErr.message, 'INSERT_FAILED')

    // 9. Increment counter
    await supabaseAdmin.rpc('increment_slot_booking_count', { p_slot_id: slotId })

    // 10. Send confirmation email (non-blocking)
    const activityName = (slot.activities as { name: string } | null)?.name ?? 'Cours'
    const coachName = (slot.coaches as { name: string } | null)?.name ?? ''

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

        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${resendKey}`,
          },
          body: JSON.stringify({
            from: 'Dopamine <noreply@nexxia.net>',
            to: profile.email,
            subject: `Réservation confirmée — ${activityName}`,
            html: `
              <div style="font-family:'DM Sans',sans-serif;background:#F5F4F0;padding:40px 20px;">
                <div style="max-width:480px;margin:0 auto;">
                  <div style="background:#111111;padding:24px;border-radius:16px 16px 0 0;text-align:center;">
                    <span style="font-family:'Arial Black',sans-serif;color:#C8F000;font-size:24px;letter-spacing:2px;">DOPAMINE</span>
                  </div>
                  <div style="background:#FFFFFF;padding:32px 24px;border-radius:0 0 16px 16px;">
                    <h2 style="margin:0 0 16px;color:#111111;">Réservation confirmée</h2>
                    <p style="color:#6B6861;margin:0 0 8px;"><strong>${activityName}</strong></p>
                    <p style="color:#6B6861;margin:0 0 4px;">${dateStr} à ${timeStr}</p>
                    <p style="color:#9A9890;margin:0 0 24px;">Coach: ${coachName}</p>
                    <a href="dopamine://bookings" style="display:inline-block;background:#111111;color:#C8F000;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">
                      Voir ma réservation
                    </a>
                  </div>
                </div>
              </div>
            `,
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
