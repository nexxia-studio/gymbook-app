import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface PaymentRequest {
  gym_id: string
  amount: number
  payment_type: 'drop_in' | 'card_10' | string
  redirect_url: string
}

async function getGymPlanLimits(
  supabase: SupabaseClient,
  gymId: string,
): Promise<{ commission_cb_rate: number; payments_enabled: boolean } | null> {
  const { data: gym } = await supabase
    .from('nexxia_gyms')
    .select('plan')
    .eq('id', gymId)
    .single()

  if (!gym?.plan) return null

  const { data: limits } = await supabase
    .from('nexxia_plan_limits')
    .select('commission_cb_rate, payments_enabled')
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

function describePaymentType(type: string): string {
  if (type === 'drop_in') return 'Drop-in (1 séance)'
  if (type === 'card_10') return 'Carte 10 séances'
  return `Paiement ${type}`
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

    const body = await req.json() as PaymentRequest
    const { gym_id: gymId, amount, payment_type: paymentType, redirect_url: redirectUrl } = body

    if (!gymId || typeof gymId !== 'string') return errorResponse(400, 'gym_id requis', 'MISSING_GYM_ID')
    if (typeof amount !== 'number' || amount <= 0) return errorResponse(400, 'amount invalide', 'INVALID_AMOUNT')
    if (!paymentType) return errorResponse(400, 'payment_type requis', 'MISSING_PAYMENT_TYPE')
    if (!redirectUrl) return errorResponse(400, 'redirect_url requis', 'MISSING_REDIRECT_URL')

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

    const isTestMode = Deno.env.get('MOLLIE_TEST_MODE') === 'true'

    let mollieApiKey: string
    let profileId: string | null = null

    if (isTestMode) {
      mollieApiKey = Deno.env.get('MOLLIE_TEST_API_KEY') ?? ''
      if (!mollieApiKey) return errorResponse(500, 'MOLLIE_TEST_API_KEY manquant', 'CONFIG_ERROR')
    } else {
      const { data: connData, error: connError } = await supabaseAdmin
        .rpc('get_gym_mollie_tokens', { p_gym_id: gymId })

      if (connError || !connData || connData.length === 0) {
        return errorResponse(404, 'Connexion Mollie introuvable pour ce gym', 'MOLLIE_NOT_CONNECTED')
      }

      const conn = connData[0]
      if (conn.status !== 'active') {
        return errorResponse(403, 'Connexion Mollie inactive', 'MOLLIE_INACTIVE')
      }

      mollieApiKey = conn.access_token

      const { data: connMeta } = await supabaseAdmin
        .from('gym_mollie_connections')
        .select('mollie_profile_id')
        .eq('gym_id', gymId)
        .maybeSingle()

      profileId = connMeta?.mollie_profile_id ?? null
    }

    const amountCents = Math.round(amount * 100)
    const applicationFeeCents = Math.round(amountCents * planLimits.commission_cb_rate)
    const feeValue = applicationFeeCents / 100

    console.log('[create-payment] gym plan limits:', planLimits)
    console.log('[create-payment] amount:', amount, 'amountCents:', amountCents, 'applicationFeeCents:', applicationFeeCents)
    console.log('[create-payment] isTestMode:', isTestMode, 'mollieApiKey length:', mollieApiKey?.length, 'profileId:', profileId)

    const webhookSecret = Deno.env.get('MOLLIE_WEBHOOK_SECRET') ?? ''
    const webhookUrl = `https://fcjupgvmjkqztxtwymdb.supabase.co/functions/v1/mollie-webhook?secret=${webhookSecret}`

    const molliePayload: Record<string, unknown> = {
      amount: { currency: 'EUR', value: formatAmount(amount) },
      description: describePaymentType(paymentType),
      redirectUrl,
      webhookUrl,
      metadata: {
        gym_id: gymId,
        member_id: profile.id,
        payment_type: paymentType,
      },
    }
    if (profileId) molliePayload.profileId = profileId
    if (applicationFeeCents > 0) {
      molliePayload.applicationFee = {
        amount: { currency: 'EUR', value: formatAmount(feeValue) },
        description: 'GymBook commission',
      }
    }

    console.log('[create-payment] Mollie payload:', JSON.stringify(molliePayload))

    const mollieRes = await fetch('https://api.mollie.com/v2/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${mollieApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(molliePayload),
    })

    console.log('[create-payment] Mollie response status:', mollieRes.status)

    if (!mollieRes.ok) {
      const detail = await mollieRes.text()
      console.error('[create-payment] Mollie error body:', detail)
      return errorResponse(502, `Mollie API a refusé la requête: ${detail}`, 'MOLLIE_ERROR')
    }

    const mollieData = await mollieRes.json()
    const checkoutUrl = mollieData?._links?.checkout?.href as string | undefined

    if (!checkoutUrl) {
      return errorResponse(502, 'Mollie n\'a pas retourné d\'URL de checkout', 'MOLLIE_NO_CHECKOUT')
    }

    return jsonResponse({
      success: true,
      payment_id: mollieData.id,
      checkout_url: checkoutUrl,
    })
  } catch (err) {
    return errorResponse(500, (err as Error).message ?? 'Erreur interne', 'INTERNAL')
  }
})
