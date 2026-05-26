import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getValidMollieToken } from '../_shared/mollie-token.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface SubscriptionRequest {
  gym_id: string
  member_id: string
  plan_id: string
  redirect_url: string
}

async function getGymPlanLimits(
  supabase: SupabaseClient,
  gymId: string,
): Promise<{ commission_sepa_rate: number; payments_enabled: boolean } | null> {
  const { data: gym } = await supabase
    .from('nexxia_gyms')
    .select('plan')
    .eq('id', gymId)
    .single()

  if (!gym?.plan) return null

  const { data: limits } = await supabase
    .from('nexxia_plan_limits')
    .select('commission_sepa_rate, payments_enabled')
    .eq('plan', gym.plan)
    .single()

  return limits ?? null
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

function formatAmount(value: number): string {
  return value.toFixed(2)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return errorResponse(401, 'Non authentifié', 'UNAUTHORIZED')

    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const supabaseAdmin = createClient(supabaseUrl, serviceKey)

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
    if (authError || !user) return errorResponse(401, 'Non authentifié', 'UNAUTHORIZED')

    const body = await req.json() as SubscriptionRequest
    const { gym_id: gymId, member_id: memberId, plan_id: planId, redirect_url: redirectUrl } = body

    if (!gymId) return errorResponse(400, 'gym_id requis', 'MISSING_GYM_ID')
    if (!memberId) return errorResponse(400, 'member_id requis', 'MISSING_MEMBER_ID')
    if (!planId) return errorResponse(400, 'plan_id requis', 'MISSING_PLAN_ID')
    if (!redirectUrl) return errorResponse(400, 'redirect_url requis', 'MISSING_REDIRECT_URL')

    if (user.id !== memberId) {
      return errorResponse(403, 'Vous ne pouvez souscrire que pour vous-même', 'MEMBER_MISMATCH')
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, gym_id, email, first_name, last_name')
      .eq('id', user.id)
      .single()

    if (!profile) return errorResponse(404, 'Profil introuvable', 'PROFILE_NOT_FOUND')
    if (profile.gym_id !== gymId) return errorResponse(403, 'Accès interdit à ce gym', 'GYM_FORBIDDEN')

    const planLimits = await getGymPlanLimits(supabaseAdmin, gymId)
    if (!planLimits) return errorResponse(404, 'Plan GymBook introuvable', 'PLAN_NOT_FOUND')
    if (!planLimits.payments_enabled) {
      return errorResponse(403, 'Paiements non disponibles sur votre plan GymBook', 'PAYMENTS_DISABLED')
    }

    const { data: plan } = await supabaseAdmin
      .from('gym_plans')
      .select('id, name, price_cents, currency, billing_type, active')
      .eq('id', planId)
      .eq('gym_id', gymId)
      .maybeSingle()

    if (!plan) return errorResponse(404, 'Formule introuvable', 'PLAN_NOT_FOUND')
    if (!plan.active) return errorResponse(403, 'Formule désactivée', 'PLAN_INACTIVE')
    if (plan.billing_type === 'one_time') {
      return errorResponse(400, 'Cette formule est un paiement unique — utiliser create-payment', 'PLAN_NOT_RECURRING')
    }

    const isTestMode = Deno.env.get('MOLLIE_TEST_MODE') === 'true'

    let mollieApiKey: string
    let profileId: string | null = null

    if (isTestMode) {
      mollieApiKey = Deno.env.get('MOLLIE_TEST_API_KEY') ?? ''
      if (!mollieApiKey) return errorResponse(500, 'MOLLIE_TEST_API_KEY manquant', 'CONFIG_ERROR')
    } else {
      const token = await getValidMollieToken(supabaseAdmin, gymId)
      if (!token) return errorResponse(503, 'Token Mollie expiré — reconnexion requise', 'MOLLIE_TOKEN_EXPIRED')
      mollieApiKey = token

      const { data: connMeta } = await supabaseAdmin
        .from('gym_mollie_connections')
        .select('mollie_profile_id')
        .eq('gym_id', gymId)
        .maybeSingle()
      profileId = connMeta?.mollie_profile_id ?? null
    }

    const { data: existingSub } = await supabaseAdmin
      .from('member_subscriptions')
      .select('mollie_customer_id')
      .eq('member_id', memberId)
      .not('mollie_customer_id', 'is', null)
      .limit(1)
      .maybeSingle()

    let customerId = existingSub?.mollie_customer_id ?? null

    if (!customerId) {
      const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.email
      const customerRes = await fetch('https://api.mollie.com/v2/customers', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${mollieApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: fullName,
          email: profile.email,
          metadata: { gym_id: gymId, member_id: memberId },
        }),
      })

      if (!customerRes.ok) {
        const detail = await customerRes.text()
        return errorResponse(502, `Création customer Mollie échouée: ${detail}`, 'MOLLIE_CUSTOMER_ERROR')
      }

      const customerData = await customerRes.json()
      customerId = customerData.id as string
    }

    const priceEur = plan.price_cents / 100
    const applicationFeeCents = Math.round(plan.price_cents * planLimits.commission_sepa_rate)
    const feeValue = applicationFeeCents / 100

    const webhookSecret = Deno.env.get('MOLLIE_WEBHOOK_SECRET') ?? ''
    const webhookUrl = `https://fcjupgvmjkqztxtwymdb.supabase.co/functions/v1/mollie-subscription-webhook?secret=${webhookSecret}`

    const firstPaymentPayload: Record<string, unknown> = {
      amount: { currency: plan.currency ?? 'EUR', value: formatAmount(priceEur) },
      customerId,
      sequenceType: 'first',
      description: `Mandat SEPA — ${plan.name}`,
      redirectUrl,
      webhookUrl,
      method: ['directdebit', 'bancontact', 'creditcard'],
      metadata: {
        gym_id: gymId,
        member_id: memberId,
        plan_id: planId,
        purpose: 'subscription_mandate',
      },
    }
    if (profileId) firstPaymentPayload.profileId = profileId
    if (!isTestMode && applicationFeeCents > 0) {
      firstPaymentPayload.applicationFee = {
        amount: { currency: plan.currency ?? 'EUR', value: formatAmount(feeValue) },
        description: 'GymBook commission',
      }
    }

    const paymentRes = await fetch('https://api.mollie.com/v2/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${mollieApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(firstPaymentPayload),
    })

    if (!paymentRes.ok) {
      const detail = await paymentRes.text()
      return errorResponse(502, `Mollie API a refusé la requête: ${detail}`, 'MOLLIE_ERROR')
    }

    const paymentData = await paymentRes.json()
    const checkoutUrl = paymentData?._links?.checkout?.href as string | undefined

    if (!checkoutUrl) {
      return errorResponse(502, 'Mollie n\'a pas retourné d\'URL de checkout', 'MOLLIE_NO_CHECKOUT')
    }

    return jsonResponse({
      success: true,
      payment_id: paymentData.id,
      customer_id: customerId,
      checkout_url: checkoutUrl,
    })
  } catch (err) {
    return errorResponse(500, (err as Error).message ?? 'Erreur interne', 'INTERNAL')
  }
})
