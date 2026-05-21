import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const IS_TEST_MODE = Deno.env.get('MOLLIE_TEST_MODE') === 'true'
const MOLLIE_TEST_API_KEY = Deno.env.get('MOLLIE_TEST_API_KEY') ?? ''

const PLANS: Record<string, { amount: string; times: number; interval: string; name: string }> = {
  monthly_3: { amount: '120.00', times: 3, interval: '1 month', name: 'Illimité 3 mois' },
  monthly_6: { amount: '110.00', times: 6, interval: '1 month', name: 'Illimité 6 mois' },
  monthly_12: { amount: '95.00', times: 12, interval: '1 month', name: 'Illimité 12 mois' },
}

// VERSION CORRIGÉE — lit depuis Vault via RPC
async function getValidMollieToken(supabase: SupabaseClient, gymId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_gym_mollie_tokens', { p_gym_id: gymId })
  if (error || !data || data.length === 0) return null
  const conn = data[0]
  if (conn.status !== 'active') return null
  return conn.access_token
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const body = await req.formData()
    const molliePaymentId = body.get('id')?.toString()
    if (!molliePaymentId) return new Response('Bad Request', { status: 400 })

    console.log('[sub-webhook] payment ID:', molliePaymentId, 'test_mode:', IS_TEST_MODE)

    const { data: existingPayment } = await supabase
      .from('payments')
      .select('id, gym_id, member_id, status')
      .eq('mollie_payment_id', molliePaymentId)
      .maybeSingle()

    let gymIdForToken = existingPayment?.gym_id ?? null
    let accessToken: string | null = null

    if (IS_TEST_MODE) {
      accessToken = MOLLIE_TEST_API_KEY
      console.log('[sub-webhook] Using TEST API KEY')
    } else if (gymIdForToken) {
      accessToken = await getValidMollieToken(supabase, gymIdForToken)
    }

    if (!accessToken) {
      console.error('[sub-webhook] no access token available')
      return new Response('OK', { status: 200 })
    }

    const mollieRes = await fetch(`https://api.mollie.com/v2/payments/${molliePaymentId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!mollieRes.ok) {
      const err = await mollieRes.text()
      console.error('[sub-webhook] fetch failed:', err)
      return new Response('OK', { status: 200 })
    }

    const molliePayment = await mollieRes.json() as {
      id: string; status: string; method?: string; paidAt?: string
      amount?: { value: string; currency: string }; sequenceType?: string
      mandateId?: string; customerId?: string; subscriptionId?: string
      metadata?: Record<string, string>
    }

    console.log('[sub-webhook] status:', molliePayment.status, 'sequence:', molliePayment.sequenceType)

    const metadata = molliePayment.metadata ?? {}
    const memberId = metadata.member_id ?? existingPayment?.member_id ?? null
    const gymId = metadata.gym_id ?? existingPayment?.gym_id ?? null
    const planCode = metadata.plan_code ?? metadata.plan_id ?? null
    const type = metadata.type ?? null

    if (!memberId || !gymId) {
      console.error('[sub-webhook] missing memberId/gymId')
      return new Response('OK', { status: 200 })
    }

    if (!IS_TEST_MODE && !gymIdForToken && gymId) {
      accessToken = await getValidMollieToken(supabase, gymId) ?? accessToken
      gymIdForToken = gymId
    }

    if (molliePayment.status === 'paid') {
      if (type === 'subscription_first' || molliePayment.sequenceType === 'first') {
        console.log('[sub-webhook] first payment paid — activating mandate')

        const mandateId = molliePayment.mandateId ?? null
        const customerId = molliePayment.customerId ?? null

        await supabase.from('mollie_customers').update({
          has_valid_mandate: true,
          mollie_mandate_id: mandateId,
          updated_at: new Date().toISOString(),
        }).eq('member_id', memberId).eq('gym_id', gymId)

        const plan = planCode ? PLANS[planCode] : null
        if (plan && customerId) {
          const subRes = await fetch(`https://api.mollie.com/v2/customers/${customerId}/subscriptions`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              amount: { currency: 'EUR', value: plan.amount },
              interval: plan.interval,
              times: Math.max(plan.times - 1, 1),
              description: `${plan.name} — Dopamine Performance Club`,
              webhookUrl: 'https://fcjupgvmjkqztxtwymdb.supabase.co/functions/v1/mollie-subscription-webhook',
              metadata: { member_id: memberId, gym_id: gymId, plan_code: planCode, type: 'subscription_renewal' },
            }),
          })

          if (subRes.ok) {
            const subscription = await subRes.json() as { id: string; nextPaymentDate?: string }
            const startsAt = new Date()
            const endsAt = new Date(startsAt)
            endsAt.setMonth(endsAt.getMonth() + plan.times)

            await supabase.from('member_subscriptions').insert({
              gym_id: gymId, member_id: memberId, plan_code: planCode,
              plan_name: plan.name, status: 'active',
              mollie_subscription_id: subscription.id, mollie_customer_id: customerId,
              amount: parseFloat(plan.amount),
              starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(),
              max_payments: plan.times, payments_count: 1,
              next_payment_at: subscription.nextPaymentDate ?? null,
            })
          } else {
            console.error('[sub-webhook] subscription creation failed:', await subRes.text())
          }
        }

        await supabase.from('payments').update({
          status: 'paid', paid_at: molliePayment.paidAt ?? null,
          payment_method: molliePayment.method ?? null,
          updated_at: new Date().toISOString(),
        }).eq('mollie_payment_id', molliePaymentId)

        const { data: profile } = await supabase
          .from('profiles').select('email, first_name, push_token').eq('id', memberId).single()

        if (RESEND_KEY && profile?.email && plan) {
          try {
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
              body: JSON.stringify({
                from: 'Dopamine <noreply@nexxia.net>', to: profile.email,
                subject: `Abonnement activé — ${plan.name}`,
                html: `<p>Votre abonnement ${plan.name} est activé. ${parseFloat(plan.amount).toFixed(2)}€/mois × ${plan.times} mois.</p>`,
              }),
            })
          } catch (e) { console.error('[sub-webhook] email error:', e) }
        }

        if (profile?.push_token && plan) {
          try {
            await supabase.functions.invoke('send-notification', {
              body: {
                tokens: [profile.push_token],
                title: '✅ Abonnement activé !',
                body: `${plan.name} — ${parseFloat(plan.amount).toFixed(2)}€/mois`,
                data: { type: 'subscription_activated' },
              },
            })
          } catch (e) { console.error('[sub-webhook] push error:', e) }
        }
      } else if (molliePayment.sequenceType === 'recurring') {
        console.log('[sub-webhook] recurring payment paid')
        const mollieSubscriptionId = molliePayment.subscriptionId ?? null

        if (mollieSubscriptionId) {
          const { data: sub } = await supabase
            .from('member_subscriptions').select('id, payments_count, max_payments')
            .eq('mollie_subscription_id', mollieSubscriptionId).maybeSingle()

          if (sub) {
            const nextCount = (sub.payments_count ?? 0) + 1
            const isFinal = sub.max_payments != null && nextCount >= sub.max_payments
            await supabase.from('member_subscriptions').update({
              payments_count: nextCount,
              status: isFinal ? 'completed' : 'active',
              updated_at: new Date().toISOString(),
            }).eq('id', sub.id)
          }
        }

        const planName = planCode ? (PLANS[planCode]?.name ?? planCode) : 'Renouvellement'

        await supabase.from('payments').upsert({
          gym_id: gymId, member_id: memberId, mollie_payment_id: molliePaymentId,
          plan_id: planCode, plan_name: `Renouvellement — ${planName}`,
          amount: molliePayment.amount ? parseFloat(molliePayment.amount.value) : 0,
          status: 'paid', payment_method: molliePayment.method ?? null,
          paid_at: molliePayment.paidAt ?? null, credits_granted: 0,
        }, { onConflict: 'mollie_payment_id' })
      }
    } else if (['failed', 'expired', 'canceled'].includes(molliePayment.status)) {
      const statusMap: Record<string, string> = { failed: 'failed', expired: 'expired', canceled: 'canceled' }
      await supabase.from('payments').update({
        status: statusMap[molliePayment.status],
        updated_at: new Date().toISOString(),
      }).eq('mollie_payment_id', molliePaymentId)
    }

    return new Response('OK', { status: 200 })
  } catch (err) {
    console.error('[sub-webhook] uncaught:', err)
    return new Response('OK', { status: 200 })
  }
})
