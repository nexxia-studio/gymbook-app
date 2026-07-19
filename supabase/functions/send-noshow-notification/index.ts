// GYM-33 — Notification après détection no-show
// Appelée par pg_cron toutes les 30 min via X-Internal-Secret.
// Appelle process_no_shows() qui détecte + applique les pénalités, puis notifie.
//
// TODO GYM-61 : canaux configurables par gym (SMS, WhatsApp en plus de email/push).
//
// Shape retourné par process_no_shows() (confirmé prod) :
//   processed_booking_id, member_id, gym_id, new_noshow_count,
//   penalty_applied ('warning' | 'suspension_48h' | 'suspension_2w')
// Email/push/activité/date sont fetchés depuis bookings + time_slots + profiles.
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const INTERNAL_SECRET = Deno.env.get('INTERNAL_FUNCTIONS_SECRET') ?? ''

interface NoShowResult {
  processed_booking_id: string
  member_id: string
  gym_id: string
  new_noshow_count: number
  penalty_applied: 'warning' | 'suspension_48h' | 'suspension_2w'
}

interface MemberContext {
  email: string | null
  first_name: string | null
  push_token: string | null
  suspended_until: string | null
  activity_name: string
  starts_at: string | null
}

async function fetchContext(supabase: SupabaseClient, ns: NoShowResult): Promise<MemberContext | null> {
  const { data: booking } = await supabase
    .from('bookings')
    .select('slot_id, time_slots(starts_at, activities(name))')
    .eq('id', ns.processed_booking_id)
    .single()

  const { data: profile } = await supabase
    .from('profiles')
    .select('email, first_name, push_token, suspended_until')
    .eq('id', ns.member_id)
    .single()

  if (!profile) return null

  const slot = (booking?.time_slots as { starts_at: string; activities: { name: string } | null } | null) ?? null
  const activityName = slot?.activities?.name ?? 'Cours'

  return {
    email: profile.email ?? null,
    first_name: profile.first_name ?? null,
    push_token: profile.push_token ?? null,
    suspended_until: profile.suspended_until ?? null,
    activity_name: activityName,
    starts_at: slot?.starts_at ?? null,
  }
}

function emailHtml(title: string, body: string): string {
  return `<div style="font-family:'DM Sans',sans-serif;background:#F5F4F0;padding:40px 20px;"><div style="max-width:480px;margin:0 auto;"><div style="background:#111111;padding:24px;border-radius:16px 16px 0 0;text-align:center;"><span style="font-family:'Arial Black',sans-serif;color:#C8F000;font-size:24px;letter-spacing:2px;">DOPAMINE</span></div><div style="background:#FFFFFF;padding:32px 24px;border-radius:0 0 16px 16px;"><h2 style="margin:0 0 16px;color:#111111;">${title}</h2>${body}</div></div></div>`
}

function buildMessage(
  level: NoShowResult['penalty_applied'],
  ctx: MemberContext,
  dateStr: string,
) {
  const activityName = ctx.activity_name
  const untilStr = ctx.suspended_until
    ? new Date(ctx.suspended_until).toLocaleDateString('fr-BE', {
        timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
      })
    : '—'

  if (level === 'warning') {
    return {
      subject: 'Absence enregistrée — 1er avertissement',
      html: emailHtml('Absence enregistrée',
        `<p style="color:#6B6861;">Vous n'étiez pas présent au cours <strong>${activityName}</strong> du ${dateStr}.</p><p style="color:#6B6861;">Ceci est votre <strong>1er avertissement</strong>. Au 2ème, votre compte sera suspendu 48h.</p>`),
      pushTitle: 'Absence enregistrée ⚠️',
      pushBody: `1er avertissement — ${activityName}`,
    }
  }

  if (level === 'suspension_48h') {
    return {
      subject: 'Compte suspendu 48h — Dopamine',
      html: emailHtml('Compte suspendu',
        `<p style="color:#6B6861;">Suite à 2 absences non justifiées, votre compte est suspendu jusqu'au <strong>${untilStr}</strong>.</p><p style="color:#6B6861;">Vous ne pourrez pas réserver pendant cette période.</p>`),
      pushTitle: 'Compte suspendu 48h ⚠️',
      pushBody: `Jusqu'au ${untilStr}`,
    }
  }

  return {
    subject: 'Compte suspendu 2 semaines — Dopamine',
    html: emailHtml('Compte suspendu',
      `<p style="color:#6B6861;">Suite à plusieurs absences, votre compte est suspendu jusqu'au <strong>${untilStr}</strong>.</p>`),
    pushTitle: 'Compte suspendu 2 semaines ⚠️',
    pushBody: `Jusqu'au ${untilStr}`,
  }
}

async function sendEmail(to: string, subject: string, html: string) {
  if (!RESEND_KEY) return
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({
      from: 'Dopamine <noreply@viniz.app>',
      to,
      subject,
      html,
    }),
  }).catch((e) => console.error('[send-noshow-notification] email error:', e))
}

async function sendPush(supabaseUrl: string, serviceKey: string, pushToken: string, title: string, body: string, bookingId: string) {
  await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify({
      tokens: [pushToken],
      title,
      body,
      data: { type: 'noshow_penalty', booking_id: bookingId },
    }),
  }).catch((e) => console.error('[send-noshow-notification] push error:', e))
}

Deno.serve(async (req) => {
  const providedSecret = req.headers.get('X-Internal-Secret')
  if (!INTERNAL_SECRET || providedSecret !== INTERNAL_SECRET) {
    console.warn('[send-noshow-notification] Unauthorized — invalid X-Internal-Secret')
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, serviceKey)

    const { data: noShows, error } = await supabase.rpc('process_no_shows')
    if (error) {
      console.error('[send-noshow-notification] RPC error:', error)
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      })
    }

    let notified = 0
    for (const ns of (noShows ?? []) as NoShowResult[]) {
      try {
        const ctx = await fetchContext(supabase, ns)
        if (!ctx) {
          console.warn('[send-noshow-notification] no context for booking', ns.processed_booking_id)
          continue
        }

        const dateStr = ctx.starts_at
          ? new Date(ctx.starts_at).toLocaleDateString('fr-BE', {
              timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long',
            })
          : '—'

        const t = buildMessage(ns.penalty_applied, ctx, dateStr)

        if (ctx.email) await sendEmail(ctx.email, t.subject, t.html)
        if (ctx.push_token) await sendPush(supabaseUrl, serviceKey, ctx.push_token, t.pushTitle, t.pushBody, ns.processed_booking_id)

        notified++
      } catch (e) {
        console.error('[send-noshow-notification] error for booking', ns.processed_booking_id, e)
      }
    }

    console.log('[send-noshow-notification] notified:', notified, 'of', noShows?.length ?? 0)
    return new Response(JSON.stringify({ notified }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[send-noshow-notification] uncaught:', err)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
})
