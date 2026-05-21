// GYM-33 — Notification après détection no-show
// Appelée par pg_cron toutes les 30 min via X-Internal-Secret.
// Appelle process_no_shows() qui détecte + applique les pénalités, puis notifie.
//
// TODO GYM-61 : canaux configurables par gym (SMS, WhatsApp en plus de email/push).
//
// Hypothèse sur le shape retourné par process_no_shows() (RPC sur prod, non versionnée
// dans le repo — voir [[project-edge-functions-governance]]). Ajuster si différent :
//   { booking_id, member_id, member_email, member_first_name, member_push_token,
//     activity_name, starts_at, noshow_count,
//     penalty_applied ('warning' | 'suspension'),
//     suspended_until (ISO timestamp, null si warning) }
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const INTERNAL_SECRET = Deno.env.get('INTERNAL_FUNCTIONS_SECRET') ?? ''

interface NoShowResult {
  booking_id: string
  member_id: string
  member_email: string | null
  member_first_name: string | null
  member_push_token: string | null
  activity_name: string | null
  starts_at: string
  noshow_count: number
  penalty_applied: 'warning' | 'suspension'
  suspended_until: string | null
}

type PenaltyLevel = 'warning' | 'suspension_48h' | 'suspension_2w'

function resolveLevel(ns: NoShowResult): PenaltyLevel {
  if (ns.penalty_applied === 'warning') return 'warning'
  // 2e no-show = 48h, 3+ = 2 semaines (cohérent avec cancel-booking inline)
  if ((ns.noshow_count ?? 0) <= 2) return 'suspension_48h'
  return 'suspension_2w'
}

function emailHtml(title: string, body: string): string {
  return `<div style="font-family:'DM Sans',sans-serif;background:#F5F4F0;padding:40px 20px;"><div style="max-width:480px;margin:0 auto;"><div style="background:#111111;padding:24px;border-radius:16px 16px 0 0;text-align:center;"><span style="font-family:'Arial Black',sans-serif;color:#C8F000;font-size:24px;letter-spacing:2px;">DOPAMINE</span></div><div style="background:#FFFFFF;padding:32px 24px;border-radius:0 0 16px 16px;"><h2 style="margin:0 0 16px;color:#111111;">${title}</h2>${body}</div></div></div>`
}

function templates(ns: NoShowResult, level: PenaltyLevel, dateStr: string) {
  const activityName = ns.activity_name ?? 'Cours'
  const untilStr = ns.suspended_until
    ? new Date(ns.suspended_until).toLocaleDateString('fr-BE', {
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

async function sendEmail(ns: NoShowResult, subject: string, html: string) {
  if (!RESEND_KEY || !ns.member_email) return
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({
      from: 'Dopamine <noreply@nexxia.net>',
      to: ns.member_email,
      subject,
      html,
    }),
  }).catch((e) => console.error('[send-noshow-notification] email error:', e))
}

async function sendPush(supabaseUrl: string, serviceKey: string, ns: NoShowResult, title: string, body: string) {
  if (!ns.member_push_token) return
  await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify({
      tokens: [ns.member_push_token],
      title,
      body,
      data: { type: 'noshow_penalty', booking_id: ns.booking_id },
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
        const dateStr = new Date(ns.starts_at).toLocaleDateString('fr-BE', {
          timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long',
        })
        const level = resolveLevel(ns)
        const t = templates(ns, level, dateStr)

        await sendEmail(ns, t.subject, t.html)
        await sendPush(supabaseUrl, serviceKey, ns, t.pushTitle, t.pushBody)

        notified++
      } catch (e) {
        console.error('[send-noshow-notification] error for booking', ns.booking_id, e)
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
