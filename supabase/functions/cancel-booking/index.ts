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

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000)
}

function emailHtml(title: string, body: string, ctaText?: string, ctaHref?: string): string {
  const cta = ctaText
    ? `<a href="${ctaHref}" style="display:inline-block;background:#111111;color:#C8F000;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">${ctaText}</a>`
    : ''
  return `<div style="font-family:'DM Sans',sans-serif;background:#F5F4F0;padding:40px 20px;"><div style="max-width:480px;margin:0 auto;"><div style="background:#111111;padding:24px;border-radius:16px 16px 0 0;text-align:center;"><span style="font-family:'Arial Black',sans-serif;color:#C8F000;font-size:24px;letter-spacing:2px;">DOPAMINE</span></div><div style="background:#FFFFFF;padding:32px 24px;border-radius:0 0 16px 16px;"><h2 style="margin:0 0 16px;color:#111111;">${title}</h2>${body}${cta ? `<div style="margin-top:24px;">${cta}</div>` : ''}</div></div></div>`
}

async function sendEmail(resendKey: string, to: string, subject: string, html: string) {
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({ from: 'Dopamine <noreply@nexxia.net>', to, subject, html }),
    })
  } catch {
    // Non-blocking
  }
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

    console.log('[cancel-booking] Starting for booking:', bookingId, 'user:', user.id)

    // 2. Get booking
    const { data: booking, error: bookingError } = await admin
      .from('bookings')
      .select('id, member_id, slot_id, gym_id, status, debited_credit_id')
      .eq('id', bookingId)
      .single()

    console.log('[cancel-booking] Booking found:', booking?.id, booking?.status, 'member_id:', booking?.member_id)
    if (bookingError) console.log('[cancel-booking] Booking query error:', bookingError)

    if (!booking) return errorResponse(404, 'Réservation introuvable', 'BOOKING_NOT_FOUND')
    if (booking.member_id !== user.id) {
      console.log('[cancel-booking] FORBIDDEN — booking.member_id', booking.member_id, '!== user.id', user.id)
      return errorResponse(403, 'Accès refusé', 'FORBIDDEN')
    }
    if (!['confirmed', 'waitlisted'].includes(booking.status)) {
      return errorResponse(400, 'Réservation non annulable', 'ALREADY_CANCELLED')
    }

    const wasWaitlisted = booking.status === 'waitlisted'

    // 3. Get slot
    const { data: slot, error: slotError } = await admin
      .from('time_slots')
      .select('id, starts_at, ends_at, gym_id, activities(name), coaches(name)')
      .eq('id', booking.slot_id)
      .single()

    if (slotError) console.log('[cancel-booking] Slot query error:', slotError)
    if (!slot) return errorResponse(404, 'Créneau introuvable', 'SLOT_NOT_FOUND')

    // 4. Calculate late cancel (only meaningful for confirmed bookings)
    const now = new Date()
    const slotStart = new Date(slot.starts_at)
    const hoursUntil = (slotStart.getTime() - now.getTime()) / (1000 * 60 * 60)
    const isLateCancellation = !wasWaitlisted && hoursUntil < 2 && hoursUntil > 0
    const isSlotPassed = slotStart < now

    // ============================================================
    // GYM-64/69 — Remboursement crédit si annulation éligible
    // Refund si : booking 'confirmed' + slot futur + > 2h avant (un crédit a réellement été débité)
    // Pas de refund si : 'waitlisted' (rien n'avait été débité), late cancel (< 2h), slot passé, ou abonnement actif
    // ============================================================
    const { data: activeSubscription } = await admin
      .from('member_subscriptions')
      .select('id')
      .eq('member_id', booking.member_id)
      .eq('gym_id', booking.gym_id)
      .eq('status', 'active')
      .maybeSingle()

    // GYM-70b — remboursement CIBLÉ sur la ligne réellement débitée (tracée à la réservation).
    // Éligibilité GYM-64 INCHANGÉE : jamais 'waitlisted', ni late cancel, ni slot passé, ni abonnement actif.
    const shouldRefund = !wasWaitlisted && !isLateCancellation && !isSlotPassed

    if (!activeSubscription && shouldRefund) {
      if (booking.debited_credit_id) {
        // Ciblage exact : la ligne débitée à la réservation.
        const { data: dc } = await admin
          .from('member_credits')
          .select('id, credits_used')
          .eq('id', booking.debited_credit_id)
          .maybeSingle()
        if (dc) {
          await admin
            .from('member_credits')
            .update({ credits_used: Math.max(0, dc.credits_used - 1), updated_at: new Date().toISOString() })
            .eq('id', dc.id)
        }
        // debited_credit_id → NULL : empêche tout double remboursement (idempotence de l'annulation).
        await admin.from('bookings').update({ debited_credit_id: null }).eq('id', bookingId)
        console.log('[cancel-booking] Crédit remboursé (ligne débitée tracée):', booking.debited_credit_id)
      } else {
        // Legacy (booking d'avant GYM-70b, sans traçage) : ligne la plus récente avec credits_used > 0 (LIFO).
        const { data: legacy } = await admin
          .from('member_credits')
          .select('id, credits_used')
          .eq('member_id', booking.member_id)
          .eq('gym_id', booking.gym_id)
          .gt('credits_used', 0)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (legacy) {
          await admin
            .from('member_credits')
            .update({ credits_used: Math.max(0, legacy.credits_used - 1), updated_at: new Date().toISOString() })
            .eq('id', legacy.id)
          console.log('[cancel-booking] Crédit remboursé (fallback legacy LIFO):', legacy.id)
        } else {
          console.warn('[cancel-booking] Aucune ligne crédit à rembourser (legacy sans crédit utilisé) — annulation poursuivie')
        }
      }
    } else if (!activeSubscription) {
      console.log('[cancel-booking] Crédit non remboursé:',
        wasWaitlisted ? '(waitlist)' : isSlotPassed ? '(slot passé)' : isLateCancellation ? '(désistement tardif < 2h)' : '(non éligible)')
    }
    // ============================================================

    // 5a. Waitlist cancellation — simple path: cancel + reorder, no penalty, no promotion
    if (wasWaitlisted) {
      const { error: wlErr } = await admin.from('bookings').update({
        status: 'cancelled',
        cancelled_at: now.toISOString(),
        cancel_reason: 'member_left_waitlist',
        waitlist_position: null,
        waitlist_notified_at: null,
        waitlist_confirmation_deadline: null,
      }).eq('id', bookingId)

      if (wlErr) {
        console.log('[cancel-booking] Waitlist update error:', wlErr)
        return errorResponse(500, wlErr.message, 'UPDATE_FAILED')
      }

      await admin.rpc('reorder_waitlist', { p_slot_id: booking.slot_id })

      console.log('[cancel-booking] Waitlist cancelled + reordered')
      return jsonResponse({ cancelled: true, noshow: null })
    }

    // 5b. Confirmed cancellation (trigger trg_update_bookings_count maintains time_slots counts)
    const { error: updateErr } = await admin.from('bookings').update({
      status: 'cancelled',
      cancelled_at: now.toISOString(),
      is_late_cancel: isLateCancellation,
    }).eq('id', bookingId)

    if (updateErr) {
      console.log('[cancel-booking] Update error:', updateErr)
      return errorResponse(500, updateErr.message, 'UPDATE_FAILED')
    }

    const activityName = (slot.activities as { name: string } | null)?.name ?? 'Cours'
    const coachName = (slot.coaches as { name: string } | null)?.name ?? ''
    const dateStr = slotStart.toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long' })
    const timeStr = slotStart.toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' })

    // Get profile for emails
    const { data: profile } = await admin
      .from('profiles')
      .select('id, email, first_name, noshow_count, gym_id')
      .eq('id', user.id)
      .single()

    let noshowResult: { level: string; count?: number; hours?: number; until?: string } | null = null

    // 7. No-show logic if late cancel
    if (isLateCancellation && !isSlotPassed && profile) {
      const newCount = (profile.noshow_count ?? 0) + 1

      await admin.from('profiles').update({ noshow_count: newCount }).eq('id', user.id)

      if (newCount === 1) {
        // Warning
        await admin.from('penalties').insert({
          member_id: user.id,
          gym_id: profile.gym_id,
          booking_id: bookingId,
          type: 'warning',
          applied_at: now.toISOString(),
          notes: `1er avertissement no-show — ${activityName}`,
        })

        noshowResult = { level: 'warning', count: 1 }

        if (resendKey && profile.email) {
          await sendEmail(resendKey, profile.email,
            'Annulation tardive — 1er avertissement',
            emailHtml('Annulation tardive',
              `<p style="color:#6B6861;">Votre annulation pour <strong>${activityName}</strong> (${dateStr} à ${timeStr}) était inférieure à 2h avant le début du cours.</p><p style="color:#6B6861;">Ceci est votre <strong>1er avertissement</strong>. Au 2ème, votre compte sera suspendu 48h.</p>`))
        }
      } else if (newCount === 2) {
        // 48h suspension
        const suspendedUntil = addHours(now, 48)
        await admin.from('profiles').update({ suspended_until: suspendedUntil.toISOString() }).eq('id', user.id)
        await admin.from('penalties').insert({
          member_id: user.id,
          gym_id: profile.gym_id,
          booking_id: bookingId,
          type: 'suspension',
          applied_at: now.toISOString(),
          expires_at: suspendedUntil.toISOString(),
          notes: 'Suspension 48h — 2ème no-show',
        })

        noshowResult = { level: 'suspension', hours: 48, until: suspendedUntil.toISOString() }

        if (resendKey && profile.email) {
          await sendEmail(resendKey, profile.email,
            'Compte suspendu 48h — Dopamine',
            emailHtml('Compte suspendu',
              `<p style="color:#6B6861;">Suite à 2 annulations tardives, votre compte est suspendu jusqu'au <strong>${suspendedUntil.toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</strong>.</p><p style="color:#6B6861;">Vous ne pourrez pas effectuer de réservation pendant cette période.</p>`))
        }
      } else {
        // 2 weeks suspension
        const suspendedUntil = addHours(now, 336)
        await admin.from('profiles').update({ suspended_until: suspendedUntil.toISOString() }).eq('id', user.id)
        await admin.from('penalties').insert({
          member_id: user.id,
          gym_id: profile.gym_id,
          booking_id: bookingId,
          type: 'suspension',
          applied_at: now.toISOString(),
          expires_at: suspendedUntil.toISOString(),
          notes: `Suspension 2 semaines — ${newCount}ème no-show`,
        })

        noshowResult = { level: 'suspension', hours: 336, until: suspendedUntil.toISOString() }

        if (resendKey && profile.email) {
          await sendEmail(resendKey, profile.email,
            'Compte suspendu 2 semaines — Dopamine',
            emailHtml('Compte suspendu',
              `<p style="color:#6B6861;">Suite à plusieurs annulations tardives, votre compte est suspendu jusqu'au <strong>${suspendedUntil.toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long' })}</strong>.</p>`))
        }
      }
    }

    // 8. Promote first waitlisted member
    const { data: nextInLine } = await admin
      .from('bookings')
      .select('id, member_id')
      .eq('slot_id', booking.slot_id)
      .eq('status', 'waitlisted')
      .order('waitlist_position', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (nextInLine) {
      // Fetch gym-configured confirmation window
      const { data: gym } = await admin
        .from('nexxia_gyms')
        .select('waitlist_confirmation_minutes')
        .eq('id', slot.gym_id)
        .single()

      const delayMinutes = gym?.waitlist_confirmation_minutes ?? 30
      const deadline = new Date(now.getTime() + delayMinutes * 60 * 1000)

      // Only notify — do NOT confirm automatically. Member has delayMinutes to confirm.
      await admin.from('bookings').update({
        waitlist_notified_at: now.toISOString(),
        waitlist_confirmation_deadline: deadline.toISOString(),
      }).eq('id', nextInLine.id)

      // Délégation email + push à notify-waitlist (non-bloquant)
      const internalSecret = Deno.env.get('INTERNAL_FUNCTIONS_SECRET')
      if (internalSecret) {
        fetch(`${supabaseUrl}/functions/v1/notify-waitlist`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Secret': internalSecret,
          },
          body: JSON.stringify({ booking_id: nextInLine.id }),
        }).catch((e) => console.error('[cancel-booking] notify-waitlist error:', e))
      } else {
        console.warn('[cancel-booking] INTERNAL_FUNCTIONS_SECRET not set — waitlist notification skipped')
      }
    }

    // 9. Cancellation confirmation email
    if (resendKey && profile?.email) {
      const lateWarning = isLateCancellation
        ? '<p style="color:#EF4444;font-weight:bold;margin-top:16px;">Annulation tardive détectée — voir avertissement séparé.</p>'
        : ''
      await sendEmail(resendKey, profile.email,
        `Réservation annulée — ${activityName}`,
        emailHtml('Réservation annulée',
          `<p style="color:#6B6861;"><strong>${activityName}</strong></p><p style="color:#6B6861;">${dateStr} à ${timeStr}</p><p style="color:#9A9890;">Coach: ${coachName}</p>${lateWarning}`))
    }

    console.log('[cancel-booking] Success — late:', isLateCancellation, 'noshow:', noshowResult?.level ?? 'none')
    return jsonResponse({ cancelled: true, noshow: noshowResult })
  } catch (err) {
    console.error('[cancel-booking] Uncaught error:', err)
    return errorResponse(500, (err as Error).message ?? 'Erreur interne', 'INTERNAL_ERROR')
  }
})
