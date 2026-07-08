import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getValidMollieToken } from '../_shared/mollie-token.ts'
import { isEngaged } from '../_shared/subscription-engagement.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const IS_TEST_MODE = Deno.env.get('MOLLIE_TEST_MODE') === 'true'
const MOLLIE_TEST_API_KEY = Deno.env.get('MOLLIE_TEST_API_KEY') ?? ''
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    const { data: { user } } = await supabase.auth.getUser(token)
    if (!user) return json({ error: true, code: 'UNAUTHORIZED' }, 401)

    const body = await req.json() as { subscription_id?: string }
    const subscriptionId = body.subscription_id ?? ''
    if (!subscriptionId) return json({ error: true, code: 'MISSING_SUBSCRIPTION_ID' }, 400)

    console.log('[cancel-subscription] id:', subscriptionId, 'user:', user.id)

    const { data: sub } = await supabase
      .from('member_subscriptions')
      .select('id, gym_id, member_id, status, mollie_subscription_id, mollie_customer_id, plan_name, ends_at')
      .eq('id', subscriptionId)
      .single()

    if (!sub) return json({ error: true, code: 'NOT_FOUND' }, 404)
    if (sub.member_id !== user.id) return json({ error: true, code: 'FORBIDDEN' }, 403)
    // Early return existant : déjà en cours / résilié → idempotent (AVANT le guard engagement).
    if (sub.status === 'canceling' || sub.status === 'canceled') {
      return json({ ok: true, already: true })
    }

    // ── GYM-113 — GUARD ENGAGEMENT FERME (sur LA ligne visée, pas member-level) : un abonnement
    //    'active' dont le terme est futur est dû jusqu'à ends_at → pas de résiliation anticipée.
    //    Aucun appel Mollie ni écriture avant ce return.
    if (sub.status === 'active' && isEngaged(sub.status, sub.ends_at)) {
      console.log('[cancel-subscription] blocked — engaged', JSON.stringify({ id: sub.id, ends_at: sub.ends_at }))
      return json({
        error: true,
        code: 'SUBSCRIPTION_ENGAGED',
        ends_at: sub.ends_at,
        message: 'Abonnement engagé jusqu\'au terme — résiliation anticipée impossible.',
      }, 409)
    }

    let accessToken: string
    if (IS_TEST_MODE) {
      if (!MOLLIE_TEST_API_KEY) return json({ error: true, code: 'TEST_KEY_MISSING' }, 500)
      accessToken = MOLLIE_TEST_API_KEY
    } else {
      const t = await getValidMollieToken(supabase, sub.gym_id)
      // Pas de connexion Mollie → on NE PEUT PAS confirmer l'annulation → 400, aucune écriture.
      if (!t) return json({ error: true, code: 'MOLLIE_NOT_CONNECTED' }, 400)
      accessToken = t
    }

    // ── GYM-113 — FIX DU 200 MENTEUR : Mollie D'ABORD, DB APRÈS. Un échec Mollie (hors 404)
    //    STOPPE tout : 502 SANS aucune écriture (status reste 'active', le SEPA n'est pas laissé
    //    vivant sous un état 'canceling' mensonger). 404 = déjà annulé côté Mollie → état convergent.
    if (sub.mollie_subscription_id && sub.mollie_customer_id) {
      const cancelRes = await fetch(
        `https://api.mollie.com/v2/customers/${sub.mollie_customer_id}/subscriptions/${sub.mollie_subscription_id}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } },
      )
      console.log('[cancel-subscription] Mollie DELETE status:', cancelRes.status)
      if (!cancelRes.ok && cancelRes.status !== 404) {
        const errText = await cancelRes.text()
        console.error('[cancel-subscription] Mollie cancel FAILED — no DB write:', JSON.stringify({ id: sub.id, status: cancelRes.status, body: errText.slice(0, 500) }))
        return json({
          error: true,
          code: 'MOLLIE_CANCEL_FAILED',
          message: 'La résiliation n\'a pas pu être confirmée côté paiement — abonnement toujours actif.',
        }, 502)
      }
    }

    // Écriture DB : UNIQUEMENT après un succès (ou 404) Mollie → la DB ne ment jamais.
    await supabase
      .from('member_subscriptions')
      .update({
        status: 'canceling',
        cancelled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', subscriptionId)

    // ── Email de confirmation : NON bloquant, APRÈS l'écriture DB.
    const { data: profile } = await supabase
      .from('profiles')
      .select('email, first_name, push_token')
      .eq('id', user.id)
      .single()

    const endsAtFormatted = sub.ends_at
      ? new Date(sub.ends_at).toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric' })
      : ''

    if (RESEND_KEY && profile?.email) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
          body: JSON.stringify({
            from: 'Dopamine <noreply@nexxia.net>',
            to: profile.email,
            subject: `Résiliation confirmée — ${sub.plan_name ?? ''}`,
            html: `<p>Votre abonnement ${sub.plan_name ?? ''} a été résilié.${endsAtFormatted ? ` Il reste actif jusqu'au ${endsAtFormatted}.` : ''}</p>`,
          }),
        })
      } catch (e) {
        console.error('[cancel-subscription] email error (non-blocking):', e)
      }
    }

    return json({ ok: true, ends_at: sub.ends_at })
  } catch (err) {
    console.error('[cancel-subscription] uncaught:', err)
    return json({ error: true, code: 'SERVER_ERROR', details: (err as Error).message }, 500)
  }
})
