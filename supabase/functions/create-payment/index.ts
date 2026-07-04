import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getValidMollieToken } from '../_shared/mollie-token.ts'
import { resolvePlan } from '../_shared/plan-resolver.ts'
import { getEffectiveCommission } from '../_shared/commission.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface PaymentRequest {
  gym_id: string
  plan_id: string
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

    // Prix autoritatif serveur : le body ne porte que l'identité du plan.
    // amount / payment_type éventuellement présents sont totalement ignorés.
    const body = await req.json() as PaymentRequest
    const { gym_id: gymId, plan_id: planId, redirect_url: redirectUrl } = body

    if (!gymId || typeof gymId !== 'string') return errorResponse(400, 'gym_id requis', 'MISSING_GYM_ID')
    if (!planId || typeof planId !== 'string') return errorResponse(400, 'plan_id requis', 'MISSING_PLAN_ID')
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

    // Résolution autoritative du plan (gym_plans = source de vérité).
    const plan = await resolvePlan(supabaseAdmin, gymId, planId)
    if (!plan) return errorResponse(404, 'Formule introuvable', 'PLAN_NOT_FOUND')
    if (!plan.is_one_time) {
      return errorResponse(400, 'Cette formule n\'est pas un paiement unique — utiliser create-subscription', 'PLAN_NOT_ONE_TIME')
    }
    if (plan.credit_count == null || plan.credit_count <= 0) {
      return errorResponse(422, 'Formule mal configurée (crédits invalides)', 'PLAN_MISCONFIGURED')
    }

    // GYM-94 — abonnement actif = accès illimité : acheter des crédits one_time = payer pour rien.
    // Définition "actif" = status='active' UNIQUEMENT : le schéma member_subscriptions n'a pas
    // d'état en vol ('pending'/'past_due'), et la ligne n'est créée qu'au webhook de confirmation.
    // Le cumul one_time reste LIBRE quand des crédits existent (aucun blocage lié aux crédits).
    const { data: activeSub } = await supabaseAdmin
      .from('member_subscriptions')
      .select('id')
      .eq('member_id', profile.id)
      .eq('gym_id', gymId)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle()

    if (activeSub) {
      return errorResponse(409, 'Accès illimité déjà actif — achat de crédits inutile', 'SUBSCRIPTION_ACTIVE')
    }

    const amount = plan.price_cents / 100
    const creditsGranted = plan.credit_count
    const currency = plan.currency

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

    const amountCents = plan.price_cents
    const { cbRate: effectiveCbRate } = await getEffectiveCommission(supabaseAdmin, gymId)
    const applicationFeeCents = Math.round(amountCents * effectiveCbRate)
    const feeValue = applicationFeeCents / 100

    console.log('[create-payment] gym plan limits:', planLimits)
    console.log('[create-payment] plan:', plan.plan_id, plan.name, 'amountCents:', amountCents, 'credits:', creditsGranted, 'applicationFeeCents:', applicationFeeCents)
    console.log('[create-payment] isTestMode:', isTestMode, 'mollieApiKey length:', mollieApiKey?.length, 'profileId:', profileId)

    const webhookSecret = Deno.env.get('MOLLIE_WEBHOOK_SECRET') ?? ''
    const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/mollie-webhook?secret=${webhookSecret}`

    // GYM-89 (niveau 2) — pré-générer l'id de la ligne payments et l'injecter dans la
    // redirectUrl (/payment/success?...&id=<uuid>) pour que la page membre poll le paiement
    // et affiche la confirmation + le deep link retour-app.
    const paymentRowId = crypto.randomUUID()
    const sep = redirectUrl.includes('?') ? '&' : '?'
    const redirectUrlWithId = `${redirectUrl}${sep}id=${paymentRowId}`

    const molliePayload: Record<string, unknown> = {
      amount: { currency, value: formatAmount(amount) },
      description: plan.name,
      redirectUrl: redirectUrlWithId,
      webhookUrl,
      metadata: {
        gym_id: gymId,
        member_id: profile.id,
        plan_id: plan.plan_id,
      },
    }
    if (profileId) molliePayload.profileId = profileId
    if (!isTestMode && applicationFeeCents > 0) {
      molliePayload.applicationFee = {
        amount: { currency, value: formatAmount(feeValue) },
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

    const { error: insertError } = await supabaseAdmin
      .from('payments')
      .insert({
        id: paymentRowId,
        gym_id: gymId,
        member_id: profile.id,
        plan_id: plan.plan_id,
        plan_name: plan.name,
        amount,
        mollie_payment_id: mollieData.id,
        checkout_url: checkoutUrl,
        credits_granted: creditsGranted,
        status: 'pending',
        nexxia_fee: feeValue > 0 ? feeValue : null,
      })

    if (insertError) {
      console.error('[create-payment] DB insert failed:', insertError)
      return errorResponse(500, 'Paiement créé mais non sauvegardé', 'DB_INSERT_FAILED')
    }

    console.log('[create-payment] payment saved to DB:', mollieData.id, 'credits:', creditsGranted)

    return jsonResponse({
      success: true,
      payment_id: mollieData.id,
      checkout_url: checkoutUrl,
    })
  } catch (err) {
    return errorResponse(500, (err as Error).message ?? 'Erreur interne', 'INTERNAL')
  }
})
