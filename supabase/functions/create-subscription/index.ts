import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getValidMollieToken } from '../_shared/mollie-token.ts'
import { resolvePlan } from '../_shared/plan-resolver.ts'
// GYM-246 — porte d'entrée unique du gating (GYM-245).
import { getEffectivePlan, hasFeature } from '../_shared/effective-plan.ts'
import { getEffectiveCommission } from '../_shared/commission.ts'
import { notExpiredFilter } from '../_shared/active-subscription.ts'

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

    // ── GYM-246 — garde serveur : paiement EN LIGNE ─────────────────────────────
    // Le gating d'interface est contournable par appel direct : la décision se prend ici.
    // Source UNIQUE (GYM-245) — cette fonction lisait nexxia_plan_limits en direct, ce qui
    // faisait deux chemins pour la même question et ignorait les overrides par salle.
    //
    // ⚠️ null = PANNE DE RÉSOLUTION, jamais « aucun droit ». Une base indisponible ne doit
    // pas se lire comme une rétrogradation : on refuse en 503 (retryable), on n'écrit rien,
    // et on ne dégrade JAMAIS en 403.
    const effectivePlan = await getEffectivePlan(supabaseAdmin, gymId)
    if (!effectivePlan) {
      return errorResponse(503, 'Plan indisponible — réessayez dans un instant', 'PLAN_RESOLUTION_FAILED')
    }
    if (!hasFeature(effectivePlan, 'payments_enabled')) {
      // Refus AVANT tout appel Mollie : aucun paiement créé chez le prestataire.
      return errorResponse(403, 'Paiements en ligne non disponibles sur votre plan Viniz', 'PLAN_PAYMENTS_DISABLED')
    }

    // Résolution autoritative du plan (gym_plans = source de vérité).
    const plan = await resolvePlan(supabaseAdmin, gymId, planId)
    if (!plan) return errorResponse(404, 'Formule introuvable', 'PLAN_NOT_FOUND')
    if (plan.is_one_time) {
      return errorResponse(400, 'Cette formule est un paiement unique — utiliser create-payment', 'PLAN_NOT_RECURRING')
    }

    // GYM-94 — un seul abonnement actif à la fois (futur upsell de changement de durée).
    // Définition "actif" = status='active' UNIQUEMENT (voir note create-payment : pas d'état en vol).
    // Les crédits existants ne bloquent JAMAIS un achat d'abonnement (conversion drop-in → illimité).
    // GYM-191 — idem create-payment : un abonnement échu ne doit pas bloquer le
    // réabonnement. Seul ce prédicat change ; le cycle de vie récurrent (webhook
    // Mollie) n'est pas touché.
    const { data: activeSub } = await supabaseAdmin
      .from('member_subscriptions')
      .select('id')
      .eq('member_id', memberId)
      .eq('gym_id', gymId)
      .eq('status', 'active')
      .or(notExpiredFilter())
      .limit(1)
      .maybeSingle()

    if (activeSub) {
      return errorResponse(409, 'Un abonnement est déjà actif', 'SUBSCRIPTION_ALREADY_ACTIVE')
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
    const { sepaRate: effectiveSepaRate } = await getEffectiveCommission(supabaseAdmin, gymId)
    const applicationFeeCents = Math.round(plan.price_cents * effectiveSepaRate)
    const feeValue = applicationFeeCents / 100

    const webhookSecret = Deno.env.get('MOLLIE_WEBHOOK_SECRET') ?? ''
    // GYM-244 — le gym_id voyage à côté du secret, par le même chemin. Sur CE rappel-ci
    // il n'est qu'une ceinture : la ligne payments insérée plus bas (GYM-243) reste la
    // source prioritaire, et le webhook ne descend au paramètre que si elle manque. Le
    // paramètre est en revanche INDISPENSABLE sur le rappel de l'ABONNEMENT, posé par
    // mollie-subscription-webhook au moment où il crée l'abonnement Mollie : aucune ligne
    // payments n'existe pour une échéance. Un seul mécanisme d'identité pour les deux
    // rappels, plutôt qu'une seconde façon de retrouver une salle.
    const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/mollie-subscription-webhook?secret=${webhookSecret}&gym_id=${encodeURIComponent(gymId)}`

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
        type: 'subscription_first',
        purpose: 'subscription_mandate',
      },
    }
    if (profileId) firstPaymentPayload.profileId = profileId
    if (!isTestMode && applicationFeeCents > 0) {
      firstPaymentPayload.applicationFee = {
        amount: { currency: plan.currency ?? 'EUR', value: formatAmount(feeValue) },
        description: 'Viniz commission',
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

    // ── GYM-243 — la ligne payments est écrite ICI, AVANT de rendre l'URL de checkout ──
    //
    // 🔴 DÉFAUT CORRIGÉ (prod, 21/08 — alerte Sentry sur tr_kzY6Yio9bxNAyGBMWTgVJ).
    // Cette fonction n'insérait AUCUNE ligne : elle créait le paiement chez Mollie et
    // rendait l'URL, point. Or mollie-subscription-webhook résout la salle en lisant
    // `payments.gym_id` (lookup sur mollie_payment_id) pour aller chercher le jeton :
    //
    //     let gymIdForToken = existingPayment?.gym_id ?? null
    //     ...
    //     } else if (gymIdForToken) { accessToken = await getValidMollieToken(...) }
    //
    // Sans ligne → gymIdForToken null → le jeton n'était même pas DEMANDÉ → sortie 503
    // « no Mollie access token available », Gym: (none). Le message était trompeur : le
    // jeton était valide et disponible. Le gym_id est bien dans la metadata Mollie, mais
    // il faut le jeton pour la lire — l'œuf et la poule.
    //
    // ⚠️ INDÉPENDANT DE L'ABANDON : un paiement RÉUSSI échouait exactement pareil.
    // L'abandon a seulement déclenché le webhook plus tôt. Aucun abonnement ne pouvait
    // aboutir — member_subscriptions est vide en production.
    //
    // MOTIF REPRIS DE create-payment (v42, déployée et fonctionnelle) À L'IDENTIQUE :
    // même moment (après la création Mollie, seule à fournir mollie_payment_id et
    // checkout_url, et AVANT le retour de l'URL), même statut initial 'pending', même
    // traitement de l'échec. Faire résoudre le gym_id autrement côté webhook aurait
    // créé un SECOND chemin pour retrouver une salle — deux chemins finissent par
    // diverger, c'est le motif déjà corrigé quatre fois sur ce projet.
    //
    // BÉNÉFICE SECONDAIRE : une trace existe même si le membre abandonne. Le gérant voit
    // la tentative dans /revenus, et le webhook peut la passer en 'expired'/'canceled'
    // (branche de fin de mollie-subscription-webhook), ce qu'il ne pouvait pas faire non
    // plus jusqu'ici faute de ligne à mettre à jour.
    //
    // ⚠️ AUCUN numéro de facture ici : la facture se génère à l'encaissement CONFIRMÉ
    // (generate-invoice, appelé par le webhook), jamais à l'intention de payer.
    const { error: insertError } = await supabaseAdmin
      .from('payments')
      .insert({
        gym_id: gymId,
        member_id: memberId,
        // plan.plan_id (résolu par resolve_plan_for_payment), et non le planId brut du
        // body — c'est ce que fait create-payment. Les deux valeurs coïncident (le RPC
        // est un lookup sur gym_plans.id), mais la source de vérité reste le plan résolu.
        plan_id: plan.plan_id,
        plan_name: plan.name,
        amount: priceEur,
        currency: plan.currency ?? 'EUR',
        mollie_payment_id: paymentData.id,
        checkout_url: checkoutUrl,
        // 0 et non NULL : c'est la valeur que l'upsert du webhook posera à la
        // confirmation (« credits_granted=0 → classé abonnement côté /revenus »). Les
        // deux satisfont le critère `credits_granted > 0 ⇒ vente à l'unité`; prendre 0
        // évite une bascule NULL → 0 en cours de vie de la ligne.
        credits_granted: 0,
        // MÊME valeur que create-payment. 'open' n'existe pas : payments_status_check
        // n'admet que pending|paid|failed|expired|canceled|refunded|partially_refunded|
        // charged_back (migration gym112), et 'pending' est aussi le DEFAULT de la colonne.
        status: 'pending',
        // Commission SEPA effective, comme l'applicationFee demandé à Mollie ci-dessus.
        // Le webhook la recalcule et la réécrit à la confirmation.
        nexxia_fee: feeValue > 0 ? feeValue : null,
      })

    if (insertError) {
      // ⚠️ ON NE REND PAS L'URL DE CHECKOUT. Un membre qui paierait sans ligne en base
      // reproduirait EXACTEMENT le défaut corrigé ici : webhook incapable de retrouver
      // la salle, 503, et un euro encaissé sans abonnement ouvert. Échec explicite : le
      // paiement Mollie créé juste au-dessus expirera de lui-même, personne n'est débité.
      console.error('[create-subscription] DB insert failed:', insertError)
      return errorResponse(500, 'Abonnement créé mais non sauvegardé', 'DB_INSERT_FAILED')
    }

    console.log('[create-subscription] payment row saved:', paymentData.id, 'plan:', plan.plan_id)

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
