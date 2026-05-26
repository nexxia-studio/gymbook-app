import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getValidMollieToken } from '../_shared/mollie-token.ts'

const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const IS_TEST_MODE = Deno.env.get('MOLLIE_TEST_MODE') === 'true'
const MOLLIE_TEST_API_KEY = Deno.env.get('MOLLIE_TEST_API_KEY') ?? ''

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  // Guard 1 — Secret URL (?secret=xxx). Toujours 200 sur rejet pour éviter les retries Mollie.
  const WEBHOOK_SECRET = Deno.env.get('MOLLIE_WEBHOOK_SECRET') ?? ''
  const url = new URL(req.url)
  const providedSecret = url.searchParams.get('secret')
  if (!WEBHOOK_SECRET || providedSecret !== WEBHOOK_SECRET) {
    console.warn('[mollie-webhook] Invalid webhook secret')
    return new Response('OK', { status: 200 })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const body = await req.formData()
    const molliePaymentId = body.get('id')?.toString() ?? ''

    // Guard 2 — Validation format Payment ID (tr_*, re_*, ord_*)
    if (!molliePaymentId || !/^(tr|re|ord)_[a-zA-Z0-9]+$/.test(molliePaymentId)) {
      console.warn('[mollie-webhook] Invalid payment ID format:', molliePaymentId)
      return new Response('OK', { status: 200 })
    }

    // Guard 3 — Rate limiting (10 appels / 60s par payment ID)
    const { data: allowed } = await supabase.rpc('check_webhook_rate_limit', {
      p_identifier: molliePaymentId,
      p_action: 'mollie_webhook',
      p_max_calls: 10,
      p_window_seconds: 60,
    })
    if (!allowed) {
      console.warn('[mollie-webhook] Rate limit exceeded for:', molliePaymentId)
      return new Response('OK', { status: 200 })
    }

    console.log('[mollie-webhook] payment ID:', molliePaymentId, 'test_mode:', IS_TEST_MODE)

    const { data: payment } = await supabase
      .from('payments')
      .select('*')
      .eq('mollie_payment_id', molliePaymentId)
      .single()

    if (!payment) {
      console.error('[mollie-webhook] payment not found:', molliePaymentId)
      return new Response('OK', { status: 200 })
    }

    let accessToken: string | null = null
    if (IS_TEST_MODE) {
      if (!MOLLIE_TEST_API_KEY) {
        console.error('[mollie-webhook] MOLLIE_TEST_API_KEY not set')
        return new Response('OK', { status: 200 })
      }
      accessToken = MOLLIE_TEST_API_KEY
      console.log('[mollie-webhook] Using TEST API KEY')
    } else {
      accessToken = await getValidMollieToken(supabase, payment.gym_id)
      if (!accessToken) {
        console.error('[mollie-webhook] no Mollie token for gym:', payment.gym_id)
        return new Response('OK', { status: 200 })
      }
      console.log('[mollie-webhook] Using OAuth token (live)')
    }

    const mollieResponse = await fetch(`https://api.mollie.com/v2/payments/${molliePaymentId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!mollieResponse.ok) {
      const err = await mollieResponse.text()
      console.error('[mollie-webhook] fetch failed:', err)
      return new Response('OK', { status: 200 })
    }

    const molliePayment = await mollieResponse.json() as {
      status: string
      method?: string
      paidAt?: string
    }

    console.log('[mollie-webhook] Mollie status:', molliePayment.status)

    const statusMap: Record<string, string> = {
      paid: 'paid', failed: 'failed', expired: 'expired',
      canceled: 'canceled', pending: 'pending', open: 'pending',
    }
    const newStatus = statusMap[molliePayment.status] ?? 'pending'

    await supabase
      .from('payments')
      .update({
        status: newStatus,
        payment_method: molliePayment.method ?? null,
        paid_at: molliePayment.paidAt ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', payment.id)

    if (molliePayment.status === 'paid' && payment.status !== 'paid') {
      console.log('[mollie-webhook] granting', payment.credits_granted, 'credits to', payment.member_id)

      const { data: existing } = await supabase
        .from('member_credits')
        .select('id, credits_total')
        .eq('member_id', payment.member_id)
        .eq('gym_id', payment.gym_id)
        .eq('plan_id', payment.plan_id)
        .maybeSingle()

      if (existing) {
        await supabase
          .from('member_credits')
          .update({
            credits_total: existing.credits_total + payment.credits_granted,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
      } else {
        await supabase.from('member_credits').insert({
          gym_id: payment.gym_id,
          member_id: payment.member_id,
          plan_id: payment.plan_id,
          credits_total: payment.credits_granted,
          credits_used: 0,
        })
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('email, first_name, push_token')
        .eq('id', payment.member_id)
        .single()

      if (RESEND_KEY && profile?.email) {
        try {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
            body: JSON.stringify({
              from: 'Dopamine <noreply@nexxia.net>',
              to: profile.email,
              subject: `Paiement confirmé — ${payment.plan_name}`,
              html: `<div style="font-family:'DM Sans',sans-serif;background:#F5F4F0;padding:40px 20px;"><div style="max-width:480px;margin:0 auto;"><div style="background:#111111;padding:24px;border-radius:16px 16px 0 0;text-align:center;"><span style="font-family:'Arial Black',sans-serif;color:#C8F000;font-size:24px;letter-spacing:2px;">DOPAMINE</span></div><div style="background:#FFFFFF;padding:32px 24px;border-radius:0 0 16px 16px;"><h2 style="margin:0 0 16px;color:#111111;">✅ Paiement confirmé !</h2><p style="color:#6B6861;margin:0 0 8px;"><strong>${payment.plan_name}</strong></p><p style="color:#6B6861;margin:0 0 8px;">Montant : <strong>${payment.amount}€</strong></p><p style="color:#6B6861;margin:0 0 24px;">Crédits ajoutés : <strong>${payment.credits_granted} séance(s)</strong></p><a href="dopamine://bookings" style="display:inline-block;background:#111111;color:#C8F000;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Réserver un cours</a></div></div></div>`,
            }),
          })
          console.log('[mollie-webhook] email sent to:', profile.email)
        } catch (e) {
          console.error('[mollie-webhook] email error (non-blocking):', e)
        }
      }

      if (profile?.push_token) {
        try {
          await supabase.functions.invoke('send-notification', {
            body: {
              tokens: [profile.push_token],
              title: '✅ Paiement confirmé !',
              body: `${payment.plan_name} — ${payment.credits_granted} séance(s) ajoutée(s)`,
              data: { type: 'payment_confirmed', payment_id: payment.id },
            },
          })
        } catch (e) {
          console.error('[mollie-webhook] push error (non-blocking):', e)
        }
      }
    }

    return new Response('OK', { status: 200 })
  } catch (err) {
    console.error('[mollie-webhook] uncaught:', err)
    return new Response('OK', { status: 200 })
  }
})
