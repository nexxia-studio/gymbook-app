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

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const resendKey = Deno.env.get('RESEND_API_KEY') ?? ''

    const { booking_id: bookingId, member_id: memberId } = await req.json()
    if (!bookingId || !memberId) return jsonResponse({ error: 'Missing params' }, 400)

    const { data: booking } = await admin
      .from('bookings')
      .select('id, slot_id, status')
      .eq('id', bookingId)
      .single()

    if (!booking || booking.status !== 'waitlisted') {
      return jsonResponse({ skipped: true, reason: 'Not waitlisted' })
    }

    const { data: slot } = await admin
      .from('time_slots')
      .select('starts_at, ends_at, activities(name), coaches(name)')
      .eq('id', booking.slot_id)
      .single()

    const { data: profile } = await admin
      .from('profiles')
      .select('email, first_name')
      .eq('id', memberId)
      .single()

    if (!slot || !profile) return jsonResponse({ skipped: true, reason: 'Data not found' })

    const activityName = (slot.activities as { name: string } | null)?.name ?? 'Cours'
    const startDate = new Date(slot.starts_at)
    const dateStr = startDate.toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' })
    const timeStr = startDate.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })

    // Send email
    if (resendKey && profile.email) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify({
          from: 'Dopamine <noreply@dopamineclub.be>',
          to: profile.email,
          subject: `Place disponible — ${activityName}`,
          html: `<div style="font-family:'DM Sans',sans-serif;background:#F5F4F0;padding:40px 20px;"><div style="max-width:480px;margin:0 auto;"><div style="background:#111111;padding:24px;border-radius:16px 16px 0 0;text-align:center;"><span style="font-family:'Arial Black',sans-serif;color:#C8F000;font-size:24px;letter-spacing:2px;">DOPAMINE</span></div><div style="background:#FFFFFF;padding:32px 24px;border-radius:0 0 16px 16px;"><h2 style="margin:0 0 16px;color:#111111;">Place disponible !</h2><p style="color:#6B6861;">Une place vient de se libérer pour <strong>${activityName}</strong> le ${dateStr} à ${timeStr}.</p><p style="color:#EF4444;font-weight:bold;margin:16px 0;">Vous avez 30 minutes pour confirmer.</p><a href="dopamine://bookings?confirm=${bookingId}" style="display:inline-block;background:#111111;color:#C8F000;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Confirmer ma place</a></div></div></div>`,
        }),
      }).catch(() => {})
    }

    return jsonResponse({ notified: true, booking_id: bookingId })
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500)
  }
})
