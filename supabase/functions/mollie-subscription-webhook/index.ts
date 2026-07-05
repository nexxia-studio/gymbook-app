import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getValidMollieToken } from '../_shared/mollie-token.ts'
import { resolvePlan } from '../_shared/plan-resolver.ts'
import { getEffectiveCommission } from '../_shared/commission.ts'

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
    console.warn('[sub-webhook] Invalid webhook secret')
    return new Response('OK', { status: 200 })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const body = await req.formData()
    const molliePaymentId = body.get('id')?.toString() ?? ''

    // Guard 2 — Validation format Payment ID (tr_*, sub_*, re_*)
    if (!molliePaymentId || !/^(tr|sub|re)_[a-zA-Z0-9]+$/.test(molliePaymentId)) {
      console.warn('[sub-webhook] Invalid payment ID format:', molliePaymentId)
      return new Response('OK', { status: 200 })
    }

    // Guard 3 — Rate limiting (10 appels / 60s par payment ID)
    const { data: allowed } = await supabase.rpc('check_webhook_rate_limit', {
      p_identifier: molliePaymentId,
      p_action: 'mollie_sub_webhook',
      p_max_calls: 10,
      p_window_seconds: 60,
    })
    if (!allowed) {
      console.warn('[sub-webhook] Rate limit exceeded for:', molliePaymentId)
      return new Response('OK', { status: 200 })
    }

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
    const planId = metadata.plan_id ?? null
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
        // GYM-55b — idempotence : si ce premier paiement a déjà été traité (ligne payments
        // en 'paid'), un retry Mollie du même webhook ne doit PAS recréer l'abonnement Mollie,
        // la ligne member_subscriptions, ni renvoyer les notifications.
        if (existingPayment?.status === 'paid') {
          console.log('[sub-webhook] first payment already processed — idempotent skip')
          return new Response('OK', { status: 200 })
        }

        console.log('[sub-webhook] first payment paid — activating mandate')

        const mandateId = molliePayment.mandateId ?? null
        const customerId = molliePayment.customerId ?? null

        await supabase.from('mollie_customers').update({
          has_valid_mandate: true,
          mollie_mandate_id: mandateId,
          updated_at: new Date().toISOString(),
        }).eq('member_id', memberId).eq('gym_id', gymId)

        const plan = planId ? await resolvePlan(supabase, gymId, planId) : null
        if (plan && customerId) {
          const planAmount = plan.price_cents / 100
          const durationMonths = plan.duration_months ?? 1
          const renewalTimes = Math.max(durationMonths - 1, 1)

          // GYM-79 — applicationFee SEPA récurrent (commission effective, jamais en test mode)
          const { sepaRate: effectiveSepaRate } = await getEffectiveCommission(supabase, gymId)
          const feeCents = Math.round(plan.price_cents * effectiveSepaRate)
          const subPayload: Record<string, unknown> = {
            amount: { currency: plan.currency, value: planAmount.toFixed(2) },
            interval: '1 month',
            times: renewalTimes,
            description: `${plan.name} — Dopamine Performance Club`,
            webhookUrl: `${Deno.env.get('SUPABASE_URL')}/functions/v1/mollie-subscription-webhook?secret=${Deno.env.get('MOLLIE_WEBHOOK_SECRET') ?? ''}`,
            metadata: { member_id: memberId, gym_id: gymId, plan_id: planId, type: 'subscription_renewal' },
          }
          if (!IS_TEST_MODE && feeCents > 0) {
            subPayload.applicationFee = {
              amount: { currency: plan.currency, value: (feeCents / 100).toFixed(2) },
              description: 'GymBook commission',
            }
          }
          const subRes = await fetch(`https://api.mollie.com/v2/customers/${customerId}/subscriptions`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(subPayload),
          })

          if (subRes.ok) {
            const subscription = await subRes.json() as { id: string; nextPaymentDate?: string }
            const startsAt = new Date()
            const endsAt = new Date(startsAt)
            endsAt.setMonth(endsAt.getMonth() + durationMonths)

            await supabase.from('member_subscriptions').insert({
              gym_id: gymId, member_id: memberId, plan_id: planId,
              plan_name: plan.name, status: 'active',
              mollie_subscription_id: subscription.id, mollie_customer_id: customerId,
              amount: planAmount,
              starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(),
              max_payments: plan.duration_months, payments_count: 1,
              next_payment_at: subscription.nextPaymentDate ?? null,
            })
          } else {
            console.error('[sub-webhook] subscription creation failed:', await subRes.text())
          }
        }

        // GYM-55b — nexxia_fee : MÊME logique que les one_time (create-payment) → commission
        // SEPA effective (0 pour Dopamine via override), en euros, null si nul. C'est le fee
        // réellement prélevé en applicationFee sur ce premier paiement (create-subscription).
        let firstNexxiaFee: number | null = null
        if (plan) {
          const { sepaRate } = await getEffectiveCommission(supabase, gymId)
          const feeEur = Math.round(plan.price_cents * sepaRate) / 100
          firstNexxiaFee = feeEur > 0 ? feeEur : null
        }

        // GYM-55b — laisser une ligne payments pour le PREMIER paiement d'abo, comme tout euro
        // encaissé (auparavant : simple UPDATE .eq(mollie_payment_id) → 0 ligne, car aucune n'est
        // insérée en amont, contrairement aux one_time via create-payment). Upsert idempotent
        // (clé de conflit mollie_payment_id, UNIQUE). credits_granted=0 → classé "abonnement"
        // côté /revenus (critère credits_granted>0 ⇒ à l'unité). invoice_number laissé NULL :
        // aucun mécanisme (ni trigger ni code) ne le génère pour les one_time non plus.
        if (planId) {
          await supabase.from('payments').upsert({
            gym_id: gymId,
            member_id: memberId,
            mollie_payment_id: molliePaymentId,
            plan_id: planId,
            plan_name: plan?.name ?? 'Abonnement',
            amount: molliePayment.amount ? parseFloat(molliePayment.amount.value) : 0,
            currency: molliePayment.amount?.currency ?? 'EUR',
            status: 'paid',
            payment_method: molliePayment.method ?? null,
            credits_granted: 0,
            paid_at: molliePayment.paidAt ?? null,
            nexxia_fee: firstNexxiaFee,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'mollie_payment_id' })
        } else {
          // Sécurité : plan_id absent (colonne NOT NULL) — on ne peut pas créer la ligne.
          // On conserve l'ancien comportement (update ciblé, no-op si aucune ligne).
          await supabase.from('payments').update({
            status: 'paid', paid_at: molliePayment.paidAt ?? null,
            payment_method: molliePayment.method ?? null,
            updated_at: new Date().toISOString(),
          }).eq('mollie_payment_id', molliePaymentId)
        }

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
                html: `<p>Votre abonnement ${plan.name} est activé. ${(plan.price_cents / 100).toFixed(2)}€/mois × ${plan.duration_months ?? 1} mois.</p>`,
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
                body: `${plan.name} — ${(plan.price_cents / 100).toFixed(2)}€/mois`,
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

        const renewalPlan = planId ? await resolvePlan(supabase, gymId, planId) : null
        const planName = renewalPlan?.name ?? 'Renouvellement'

        await supabase.from('payments').upsert({
          gym_id: gymId, member_id: memberId, mollie_payment_id: molliePaymentId,
          plan_id: planId, plan_name: `Renouvellement — ${planName}`,
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
