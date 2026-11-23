// GYM-35 — Envoi d'une communication gérant → membres
// Appelée par le dashboard (gym_admin authentifié). Lit gym_communications, envoie un
// PUSH (par lots de 100) aux destinataires retournés par get_communication_recipients,
// écrit une ligne par destinataire dans public.notifications (boîte de réception in-app),
// puis enregistre dans gym_communication_recipients.
//
// GYM-134, décision du 23/11 : la v1 passe par le push et la boîte in-app, PAS par l'email.
// email : hors v1, voir quota Resend.
//
// TODO GYM-54 : SMS et WhatsApp (non implémentés ici).
//
// Shape attendu pour gym_communications (sur prod, non dans le repo) :
//   id, gym_id, title, body, segment, template, send_push, send_email,
//   status ('draft'|'sending'|'sent'|'failed'), sent_at, recipient_count
// Shape retourné par get_communication_recipients(p_gym_id, p_segment) :
//   member_id, email, first_name, push_token
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// GYM-134 (v1) — lots de push et bilan, purs et testés.
import { bilan, envoyerLot, lotsDeJetons, paquets } from './push-batches.ts'

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

    // 5. Push, PAR LOTS de 100 jetons (limite d'Expo), plus une requête par membre.
    //    Succès réel = ticket `ok` d'Expo pour CE jeton (plus de faux positif, GYM-134 p1).
    //    Un lot refusé EN ENTIER par Expo est relancé jeton par jeton (`envoyerLot`), pour
    //    qu'un seul jeton pourri ne prive pas de push tout le reste de la salle.
    const acceptes: string[] = []
    if (c.send_push) {
      // Le seul contact avec le réseau. Rend la réponse de send-notification, ou null.
      const envoyer = async (jetons: string[]): Promise<unknown> => {
        try {
          const resp = await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}`,
            // GYM-282 — le tuyau exige désormais le secret interne.
            'X-Internal-Secret': Deno.env.get('INTERNAL_FUNCTIONS_SECRET') ?? '' },
            body: JSON.stringify({
              tokens: jetons,
              // GYM-282 — `gym_id` est OBLIGATOIRE : c'est lui qui arme la garde de plan.
              // 🔴 GYM-317 — `c.gym_id` : la salle d'une campagne est celle de la communication.
              gym_id: c.gym_id,
              title: c.title,
              body: c.body,
              data: { type: 'gym_communication', communication_id: c.id, template: c.template },
            }),
          })
          return await resp.json().catch(() => null)
        } catch {
          return null
        }
      }

      for (const lot of lotsDeJetons(recipients)) {
        const issue = await envoyerLot(lot, envoyer)
        acceptes.push(...issue.acceptes)
        // ⚠️ UN SEUL journal par lot, et JAMAIS la valeur d'un jeton : des nombres uniquement.
        // (Le texte d'erreur d'Expo n'est pas journalisé non plus, il peut citer un jeton.)
        if (issue.relance) {
          console.error('[send-communication] lot refusé en entier, relancé un par un:', c.id,
            lot.length, 'jetons,', issue.acceptes.length, 'acceptés')
        } else if (issue.acceptes.length < lot.length) {
          console.error('[send-communication] push lot partiel:', c.id,
            issue.acceptes.length, 'acceptés sur', lot.length)
        }
      }
    }
    const b = bilan(recipients, acceptes)

    // email : hors v1, voir quota Resend. Le plan gratuit donne 100 emails par jour, partagés
    // avec les factures et les confirmations : un envoi à toute une salle bloquerait les
    // emails transactionnels de la journée. Aucun appel à Resend ici, `email_sent` reste false.

    const sentAt = new Date().toISOString()

    // 6. Suivi par destinataire, en insertions groupées.
    for (const paquet of paquets(b.parMembre, 500)) {
      const { error } = await supabaseAdmin.from('gym_communication_recipients').insert(
        paquet.map((m) => ({
          communication_id: c.id, member_id: m.member_id, push_sent: m.push_sent, email_sent: false,
        })),
      )
      if (error) console.error('[send-communication] recipients insert failed:', c.id, error.message)
    }

    // 7. Boîte de réception in-app : une ligne par destinataire, avec ou sans jeton push.
    //    ⚠️ UN ÉCHEC ICI NE FAIT PAS ÉCHOUER L'ENVOI : les push sont déjà partis. Il est
    //    journalisé et visible dans la réponse (`inbox_written`). Cas attendu : la migration
    //    qui ajoute le type 'communication' n'est pas encore appliquée.
    let inboxWritten = 0
    for (const paquet of paquets(b.parMembre, 500)) {
      const { error } = await supabaseAdmin.from('notifications').insert(
        paquet.map((m) => ({
          gym_id: c.gym_id,
          member_id: m.member_id,
          type: 'communication',
          title: c.title,
          body: c.body,
          data: { communication_id: c.id },
          push_sent: m.push_sent,
          email_sent: false,
          sent_at: sentAt,
        })),
      )
      if (error) console.error('[send-communication] inbox insert failed:', c.id, error.message)
      else inboxWritten += paquet.length
    }

    // 8. Mark as sent. `send_email` est remis à false quoi qu'ait écrit le client.
    await supabaseAdmin
      .from('gym_communications')
      .update({
        status: 'sent',
        sent_at: sentAt,
        recipient_count: b.recipient_count,
        send_email: false,
      })
      .eq('id', communicationId)

    console.log('[send-communication] sent comm', c.id, 'push:', b.push_sent, 'failed:', b.push_failed,
      'no token:', b.without_token, 'total:', b.recipient_count, 'inbox:', inboxWritten)
    return jsonResponse({
      success: true,
      recipient_count: b.recipient_count,
      push_sent: b.push_sent,
      push_failed: b.push_failed,
      with_token: b.with_token,
      without_token: b.without_token,
      inbox_written: inboxWritten,
      email_sent: 0,
    })
  } catch (err) {
    console.error('[send-communication] uncaught:', err)
    return errorResponse(500, 'SERVER_ERROR', (err as Error).message)
  }
})
