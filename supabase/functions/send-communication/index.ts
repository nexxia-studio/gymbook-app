// GYM-35 — Envoi d'une communication gérant → membres
// Appelée par le dashboard (gym_admin authentifié). Lit gym_communications, envoie
// push + email aux destinataires retournés par get_communication_recipients,
// puis enregistre dans gym_communication_recipients.
//
// TODO GYM-54 : SMS et WhatsApp (non implémentés ici).
//
// Shape attendu pour gym_communications (sur prod, non dans le repo) :
//   id, gym_id, title, body, segment, template, send_push, send_email,
//   status ('draft'|'sending'|'sent'|'failed'), sent_at, recipient_count
// Shape retourné par get_communication_recipients(p_gym_id, p_segment) :
//   member_id, email, first_name, push_token
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function errorResponse(status: number, code: string, message?: string) {
  return jsonResponse({ error: true, code, message: message ?? code }, status)
}

interface Recipient {
  member_id: string
  email: string | null
  first_name: string | null
  push_token: string | null
}

interface Communication {
  id: string
  gym_id: string
  title: string
  body: string
  segment: string
  template: string
  send_push: boolean
  send_email: boolean
  status: string
}

function templateIcon(template: string): string {
  switch (template) {
    case 'info': return '📢'
    case 'closure': return '🔒'
    case 'promo': return '🎉'
    case 'cancellation': return '⚠️'
    default: return '💬'
  }
}

function buildEmailHtml(title: string, body: string, template: string, firstName: string | null): string {
  const icon = templateIcon(template)
  const greeting = firstName ? `Bonjour ${firstName},` : 'Bonjour,'
  const safeBody = body.replace(/\n/g, '<br>')
  return `<div style="font-family:'DM Sans','Helvetica Neue',Arial,sans-serif;background:#F5F4F0;padding:40px 20px;"><div style="max-width:520px;margin:0 auto;"><div style="background:#111111;padding:24px;border-radius:16px 16px 0 0;text-align:center;"><span style="font-family:'Arial Black',Arial,sans-serif;color:#C8F000;font-size:24px;letter-spacing:2px;">DOPAMINE</span></div><div style="background:#FFFFFF;padding:32px 28px;border-radius:0 0 16px 16px;"><div style="font-size:28px;margin-bottom:12px;">${icon}</div><h2 style="margin:0 0 8px;color:#111111;font-size:20px;">${title}</h2><p style="color:#9A9890;font-size:13px;margin:0 0 20px;">${greeting}</p><p style="color:#3D3B36;font-size:14px;line-height:1.6;margin:0;">${safeBody}</p></div></div></div>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabaseAdmin = createClient(supabaseUrl, serviceKey)

    // 1. Auth + gym_admin role check
    const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    if (!token) return errorResponse(401, 'UNAUTHORIZED')

    const { data: { user } } = await supabaseAdmin.auth.getUser(token)
    if (!user) return errorResponse(401, 'UNAUTHORIZED')

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role, gym_id')
      .eq('id', user.id)
      .single()
    if (!profile || profile.role !== 'gym_admin') return errorResponse(403, 'FORBIDDEN')
    if (!profile.gym_id) return errorResponse(400, 'NO_GYM')

    // 2. Fetch communication
    const { communication_id: communicationId } = await req.json() as { communication_id?: string }
    if (!communicationId) return errorResponse(400, 'MISSING_COMMUNICATION_ID')

    const { data: comm } = await supabaseAdmin
      .from('gym_communications')
      .select('*')
      .eq('id', communicationId)
      .eq('gym_id', profile.gym_id)
      .single()

    if (!comm) return errorResponse(404, 'NOT_FOUND')
    const c = comm as Communication
    if (c.status === 'sent') return errorResponse(400, 'ALREADY_SENT')

    // 3. Mark as sending
    await supabaseAdmin
      .from('gym_communications')
      .update({ status: 'sending' })
      .eq('id', communicationId)

    // 4. Get recipients
    const { data: recipientsRaw } = await supabaseAdmin
      .rpc('get_communication_recipients', { p_gym_id: profile.gym_id, p_segment: c.segment })
    const recipients = (recipientsRaw ?? []) as Recipient[]

    let pushSent = 0
    let emailSent = 0

    for (const r of recipients) {
      let pushOk = false
      let emailOk = false

      // 5a. Push
      if (c.send_push && r.push_token) {
        try {
          await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
            body: JSON.stringify({
              tokens: [r.push_token],
              title: c.title,
              body: c.body,
              data: { type: 'gym_communication', communication_id: c.id, template: c.template },
            }),
          })
          pushOk = true
          pushSent++
        } catch (e) {
          console.error('[send-communication] push error:', e)
        }
      }

      // 5b. Email
      if (c.send_email && r.email && RESEND_KEY) {
        try {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
            body: JSON.stringify({
              from: 'Dopamine <noreply@nexxia.net>',
              to: r.email,
              subject: c.title,
              html: buildEmailHtml(c.title, c.body, c.template, r.first_name),
            }),
          })
          emailOk = true
          emailSent++
        } catch (e) {
          console.error('[send-communication] email error:', e)
        }
      }

      // 6. Per-recipient record
      await supabaseAdmin.from('gym_communication_recipients').insert({
        communication_id: c.id,
        member_id: r.member_id,
        push_sent: pushOk,
        email_sent: emailOk,
      })
    }

    // 7. Mark as sent
    await supabaseAdmin
      .from('gym_communications')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        recipient_count: recipients.length,
      })
      .eq('id', communicationId)

    console.log('[send-communication] sent comm', c.id, 'push:', pushSent, 'email:', emailSent, 'total:', recipients.length)
    return jsonResponse({ success: true, push_sent: pushSent, email_sent: emailSent, recipient_count: recipients.length })
  } catch (err) {
    console.error('[send-communication] uncaught:', err)
    return errorResponse(500, 'SERVER_ERROR', (err as Error).message)
  }
})
