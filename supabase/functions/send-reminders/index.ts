// GYM-32 — Rappels automatiques avant cours
// Appelée par pg_cron toutes les 15 min via X-Internal-Secret.
//
// TODO GYM-61 : lire gym_reminder_settings pour les intervalles et canaux configurés
// Actuellement hardcodé : 24h (email + push) / 2h (push uniquement)
//
// Shape retourné par get_pending_reminders() (confirmé prod) :
//   booking_id, member_id, gym_id, slot_id, slot_starts_at,
//   activity_name, coach_name, member_email, member_first_name, push_token, reminder_type
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const INTERNAL_SECRET = Deno.env.get('INTERNAL_FUNCTIONS_SECRET') ?? ''

interface PendingReminder {
  booking_id: string
  member_id: string
  gym_id: string
  slot_id: string
  slot_starts_at: string
  activity_name: string | null
  coach_name: string | null
  member_email: string | null
  member_first_name: string | null
  push_token: string | null
  reminder_type: '24h' | '2h'
}

function emailHtml(title: string, body: string, ctaText: string, ctaHref: string): string {
  return `<div style="font-family:'DM Sans',sans-serif;background:#F5F4F0;padding:40px 20px;"><div style="max-width:480px;margin:0 auto;"><div style="background:#111111;padding:24px;border-radius:16px 16px 0 0;text-align:center;"><span style="font-family:'Arial Black',sans-serif;color:#C8F000;font-size:24px;letter-spacing:2px;">DOPAMINE</span></div><div style="background:#FFFFFF;padding:32px 24px;border-radius:0 0 16px 16px;"><h2 style="margin:0 0 16px;color:#111111;">${title}</h2>${body}<div style="margin-top:24px;"><a href="${ctaHref}" style="display:inline-block;background:#111111;color:#C8F000;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">${ctaText}</a></div></div></div></div>`
}

async function sendReminderEmail(reminder: PendingReminder, dateStr: string, timeStr: string) {
  if (!RESEND_KEY || !reminder.member_email) return
  const activityName = reminder.activity_name ?? 'Cours'
  const coachName = reminder.coach_name ?? '—'
  const html = emailHtml(
    'Rappel — votre cours demain',
    `<p style="color:#6B6861;">Vous avez un cours demain : <strong>${activityName}</strong> le ${dateStr} à ${timeStr}.</p><p style="color:#6B6861;">Coach : ${coachName}</p>`,
    'Voir ma réservation', 'dopamine://bookings',
  )
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({
      from: 'Dopamine <noreply@nexxia.net>',
      to: reminder.member_email,
      subject: `Rappel — ${activityName} demain à ${timeStr}`,
      html,
    }),
  }).catch((e) => console.error('[send-reminders] email error:', e))
}

async function sendReminderPush(supabaseUrl: string, serviceKey: string, reminder: PendingReminder, timeStr: string) {
  if (!reminder.push_token) return
  const activityName = reminder.activity_name ?? 'Cours'
  const is24h = reminder.reminder_type === '24h'
  const title = is24h ? 'Rappel cours 🏋️' : "C'est bientôt ! 🏃"
  const body = is24h ? `${activityName} à ${timeStr}` : `Votre cours commence dans 2h — ${activityName}`
  await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify({
      tokens: [reminder.push_token],
      title,
      body,
      data: { type: 'booking_reminder', booking_id: reminder.booking_id },
    }),
  }).catch((e) => console.error('[send-reminders] push error:', e))
}

Deno.serve(async (req) => {
  const providedSecret = req.headers.get('X-Internal-Secret')
  if (!INTERNAL_SECRET || providedSecret !== INTERNAL_SECRET) {
    console.warn('[send-reminders] Unauthorized — invalid X-Internal-Secret')
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, serviceKey)

    const { data: reminders, error } = await supabase.rpc('get_pending_reminders')
    if (error) {
      console.error('[send-reminders] RPC error:', error)
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      })
    }

    let sent = 0
    for (const r of (reminders ?? []) as PendingReminder[]) {
      try {
        const startDate = new Date(r.slot_starts_at)
        const dateStr = startDate.toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long' })
        const timeStr = startDate.toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' })

        if (r.reminder_type === '24h') {
          await sendReminderEmail(r, dateStr, timeStr)
          await sendReminderPush(supabaseUrl, serviceKey, r, timeStr)
        } else if (r.reminder_type === '2h') {
          await sendReminderPush(supabaseUrl, serviceKey, r, timeStr)
        }

        await supabase.rpc('mark_reminder_sent', {
          p_booking_id: r.booking_id,
          p_reminder_type: r.reminder_type,
        })

        sent++
      } catch (e) {
        console.error('[send-reminders] error for booking', r.booking_id, e)
      }
    }

    console.log('[send-reminders] processed:', sent, 'of', reminders?.length ?? 0)
    return new Response(JSON.stringify({ sent }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[send-reminders] uncaught:', err)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
})
