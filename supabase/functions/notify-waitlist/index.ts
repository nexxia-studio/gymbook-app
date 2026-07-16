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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // Vérification secret interne — appels externes rejetés
  const internalSecret = Deno.env.get('INTERNAL_FUNCTIONS_SECRET')
  const providedSecret = req.headers.get('X-Internal-Secret')
  if (!internalSecret || !providedSecret || providedSecret !== internalSecret) {
    console.warn('[notify-waitlist] Unauthorized — invalid X-Internal-Secret')
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const resendKey = Deno.env.get('RESEND_API_KEY') ?? ''
    const admin = createClient(supabaseUrl, serviceKey)

    const { booking_id: bookingId } = await req.json() as { booking_id?: string }
    if (!bookingId) return jsonResponse({ error: 'Missing booking_id' }, 400)

    console.log('[notify-waitlist] booking:', bookingId)

    const { data: booking } = await admin
      .from('bookings')
      .select('id, member_id, slot_id, gym_id, status, waitlist_notified_at, waitlist_confirmation_deadline')
      .eq('id', bookingId)
      .single()

    if (!booking) return jsonResponse({ skipped: true, reason: 'booking_not_found' })
    if (booking.status !== 'waitlisted') return jsonResponse({ skipped: true, reason: 'not_waitlisted' })
    if (!booking.waitlist_notified_at) return jsonResponse({ skipped: true, reason: 'not_notified' })

    const { data: slot } = await admin
      .from('time_slots')
      .select('starts_at, activities(name), coaches(name)')
      .eq('id', booking.slot_id)
      .single()

    const { data: profile } = await admin
      .from('profiles')
      .select('email, first_name, push_token')
      .eq('id', booking.member_id)
      .single()

    if (!slot || !profile) return jsonResponse({ skipped: true, reason: 'data_missing' })

    let minutes = 30
    if (booking.waitlist_confirmation_deadline) {
      const ms = new Date(booking.waitlist_confirmation_deadline).getTime() - Date.now()
      minutes = Math.max(1, Math.round(ms / 60000))
    } else {
      const { data: gym } = await admin
        .from('nexxia_gyms')
        .select('waitlist_confirmation_minutes')
        .eq('id', booking.gym_id)
        .single()
      minutes = gym?.waitlist_confirmation_minutes ?? 30
    }

    // cast via unknown : la relation to-one `activities(name)` est typée en tableau par
    // supabase-js mais renvoyée en objet au runtime (comportement inchangé, fix deno check).
    const activityName = (slot.activities as unknown as { name: string } | null)?.name ?? 'Cours'
    const startDate = new Date(slot.starts_at)
    const dateStr = startDate.toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long' })
    const timeStr = startDate.toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' })

    // Feature critique waitlist : on lit le vrai statut d'envoi et on LOG explicitement
    // tout échec (avec booking_id) pour le voir dans les logs.
    let emailOk = false
    if (resendKey && profile.email) {
      try {
        const resp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
          body: JSON.stringify({
            from: 'Dopamine <noreply@nexxia.net>',
            to: profile.email,
            subject: `Place disponible — ${activityName}`,
            html: `<div style="font-family:'DM Sans',sans-serif;background:#F5F4F0;padding:40px 20px;"><div style="max-width:480px;margin:0 auto;"><div style="background:#111111;padding:24px;border-radius:16px 16px 0 0;text-align:center;"><span style="font-family:'Arial Black',sans-serif;color:#C8F000;font-size:24px;letter-spacing:2px;">DOPAMINE</span></div><div style="background:#FFFFFF;padding:32px 24px;border-radius:0 0 16px 16px;"><h2 style="margin:0 0 16px;color:#111111;">Place disponible !</h2><p style="color:#6B6861;">Une place vient de se libérer pour <strong>${activityName}</strong> le ${dateStr} à ${timeStr}.</p><p style="color:#EF4444;font-weight:bold;margin:16px 0;">Vous avez ${minutes} minutes pour confirmer.</p><a href="https://links.viniz.app/dopamine/confirm-waitlist?booking=${bookingId}" style="display:inline-block;background:#111111;color:#C8F000;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Confirmer ma place</a></div></div></div>`,
          }),
        })
        emailOk = resp.ok
        if (!emailOk) console.error('[notify-waitlist] email FAILED — booking:', bookingId, 'status:', resp.status, await resp.text())
      } catch (e) {
        console.error('[notify-waitlist] email error — booking:', bookingId, e)
      }
    }

    let pushOk = false
    if (profile.push_token) {
      try {
        const resp = await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({
            tokens: [profile.push_token],
            title: 'Place disponible !',
            body: `Vous avez ${minutes} min pour confirmer — ${activityName}`,
            data: { type: 'waitlist_promotion', slot_id: booking.slot_id },
          }),
        })
        const result = await resp.json().catch(() => null)
        pushOk = result?.ok === true && (result?.sent ?? 0) >= 1
        if (!pushOk) console.error('[notify-waitlist] push NOT delivered — booking:', bookingId, 'status:', resp.status, result)
      } catch (e) {
        console.error('[notify-waitlist] push error — booking:', bookingId, e)
      }
    }

    return jsonResponse({ notified: true, booking_id: bookingId, minutes, push_sent: pushOk, email_sent: emailOk })
  } catch (err) {
    console.error('[notify-waitlist] error:', err)
    return jsonResponse({ error: (err as Error).message }, 500)
  }
})
