import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getValidMollieToken } from '../_shared/mollie-token.ts'
import { resolvePlan } from '../_shared/plan-resolver.ts'
import { getEffectiveCommission } from '../_shared/commission.ts'
import { notExpiredFilter } from '../_shared/active-subscription.ts'

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
    if (!planLimits) return errorResponse(404, 'Plan Viniz introuvable', 'PLAN_NOT_FOUND')
    if (!planLimits.payments_enabled) {
      return errorResponse(403, 'Paiements non disponibles sur votre plan Viniz', 'PAYMENTS_DISABLED')
    }

    // Résolution autoritative du plan (gym_plans = source de vérité).
    const plan = await resolvePlan(supabaseAdmin, gymId, planId)
    if (!plan) return errorResponse(404, 'Formule introuvable', 'PLAN_NOT_FOUND')
    if (!plan.is_one_time) {
      return errorResponse(400, 'Cette formule n\'est pas un paiement unique — utiliser create-subscription', 'PLAN_NOT_ONE_TIME')
    }
    // GYM-189 — « mal configuré » dépend de la NATURE du plan, plus de la seule présence
    // de crédits : un abonnement payé en une fois n'a légitimement pas de credit_count.
    // Côté Mollie rien ne change (paiement simple, aucun mandat) ; seule la contrepartie
    // délivrée par apply_paid_payment diffère.
    const isUnlimited = plan.plan_type === 'unlimited'
    if (isUnlimited) {
      if (plan.duration_months == null || plan.duration_months <= 0) {
        return errorResponse(422, 'Formule mal configurée (durée invalide)', 'PLAN_MISCONFIGURED')
      }
    } else if (plan.credit_count == null || plan.credit_count <= 0) {
      return errorResponse(422, 'Formule mal configurée (crédits invalides)', 'PLAN_MISCONFIGURED')
    }

    // GYM-94 — abonnement actif = accès illimité : acheter des crédits one_time = payer pour rien.
    // Définition "actif" = status='active' UNIQUEMENT : le schéma member_subscriptions n'a pas
    // d'état en vol ('pending'/'past_due'), et la ligne n'est créée qu'au webhook de confirmation.
    // Le cumul one_time reste LIBRE quand des crédits existent (aucun blocage lié aux crédits).
    // GYM-191 — la garde ne doit mordre que sur un abonnement RÉELLEMENT en cours :
    // un abonnement échu (pas encore passé 'expired' par le cron) bloquerait sinon le
    // rachat, exactement au moment où le membre veut se réabonner.
    const { data: activeSub } = await supabaseAdmin
      .from('member_subscriptions')
      .select('id')
      .eq('member_id', profile.id)
      .eq('gym_id', gymId)
      .eq('status', 'active')
      .or(notExpiredFilter())
      .limit(1)
      .maybeSingle()

    if (activeSub) {
      // GYM-189 — la garde vaut pour les DEUX contreparties : des crédits seraient inutiles
      // sous accès illimité, et un second abonnement ne doit pas pouvoir être ouvert.
      // Code inchangé (SUBSCRIPTION_ACTIVE) : l'app mobile mappe déjà ce code.
      return errorResponse(
        409,
        isUnlimited
          ? 'Un abonnement est déjà actif'
          : 'Accès illimité déjà actif — achat de crédits inutile',
        'SUBSCRIPTION_ACTIVE',
      )
    }

    // ── GYM-193 — formule limitée à un achat par membre ────────────────────────
    // Placée APRÈS la garde GYM-94 (un abonnement actif prime : le message « accès
    // illimité déjà actif » est plus utile que « offre déjà utilisée ») et AVANT tout
    // appel à Mollie : on ne crée jamais un paiement qu'on refusera ensuite.
    //
    // La limite est un ATTRIBUT DU PLAN, jamais son nom : chaque salle nomme son offre
    // de découverte comme elle veut. once_per_member n'est pas exposé par
    // resolve_plan_for_payment (dont la signature a déjà été refaite en GYM-189) — un
    // SELECT ciblé sur la PK évite une nouvelle rupture de signature pour un booléen.
    const { data: planFlags } = await supabaseAdmin
      .from('gym_plans')
      .select('once_per_member')
      .eq('id', plan.plan_id)
      .maybeSingle()

    if (planFlags?.once_per_member) {
      // Seul un encaissement RÉELLEMENT survenu consomme le droit. Un remboursement ne
      // le rouvre pas : le membre a bien bénéficié de l'offre de découverte.
      // 'pending' / 'failed' / 'expired' / 'canceled' ne consomment RIEN — un membre qui
      // a abandonné son paiement doit pouvoir réessayer.
      //
      // 'charged_back' CONSOMME le droit — décision produit, NE PAS le retirer en le
      // prenant pour une erreur : une rétrofacturation n'est pas un achat annulé mais un
      // litige exceptionnel, et la prestation a bien été délivrée (le membre est venu).
      // La règle automatique reste stricte ; les cas légitimes (carte volée…) se traitent
      // par la dérogation comptoir, qui n'applique pas cette limite (admin-create-member).
      //
      // ⚠️ Liste dupliquée dans apps/mobile/hooks/useGymPlans.ts
      //    (CONSUMING_PAYMENT_STATUSES) — les deux runtimes ne peuvent pas partager de
      //    code. Toute modification ici doit y être reportée.
      const CONSUMING_STATUSES = ['paid', 'partially_refunded', 'refunded', 'charged_back']

      // payments.plan_id est un TEXT : comparaison texte↔texte, aucun cast.
      const { data: priorPurchase } = await supabaseAdmin
        .from('payments')
        .select('id')
        .eq('member_id', profile.id)
        .eq('gym_id', gymId)
        .eq('plan_id', plan.plan_id)
        .in('status', CONSUMING_STATUSES)
        .limit(1)
        .maybeSingle()

      if (priorPurchase) {
        return errorResponse(
          409,
          'Cette offre est limitée à un achat par personne — vous en avez déjà bénéficié',
          'PLAN_ALREADY_USED',
        )
      }
    }

    const amount = plan.price_cents / 100
    // NULL pour un abonnement : c'est la convention du code (credits_granted > 0 ⇒ vente à
    // l'unité) sur laquelle s'appuient /revenus et create-refund pour distinguer les deux.
    const creditsGranted = isUnlimited ? null : plan.credit_count
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
        description: 'Viniz commission',
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
