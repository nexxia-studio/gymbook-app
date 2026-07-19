// GYM-112 — Remboursement d'un paiement Mollie par le gérant (gym_admin / super_admin).
//
// Le gérant rembourse tout ou partie d'un paiement carte depuis /revenus. Cette fonction
// se contente de DEMANDER le remboursement à Mollie (POST /refunds) ; elle ne touche NI aux
// crédits NI au statut : la vérité arrive par le webhook (amountRefunded cumulé) qui appelle
// apply_refund_atomic. Aucune UI optimiste sur l'argent.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getValidMollieToken } from '../_shared/mollie-token.ts'

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

function formatAmount(value: number): string {
  return value.toFixed(2)
}

// Tolérance centimes pour les comparaisons de montants (numeric ↔ float).
const EPS = 0.005

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(supabaseUrl, serviceKey)

    // 1. Auth appelant + rôle gym_admin / super_admin.
    const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    if (!token) return errorResponse(401, 'UNAUTHORIZED', 'Non authentifié')

    const { data: { user }, error: authError } = await admin.auth.getUser(token)
    if (authError || !user) return errorResponse(401, 'UNAUTHORIZED', 'Non authentifié')

    const { data: adminProfile } = await admin
      .from('profiles')
      .select('role, gym_id')
      .eq('id', user.id)
      .single()

    if (!adminProfile || (adminProfile.role !== 'gym_admin' && adminProfile.role !== 'super_admin')) {
      return errorResponse(403, 'FORBIDDEN', 'Réservé au gérant de la salle')
    }
    if (!adminProfile.gym_id) return errorResponse(400, 'NO_GYM', 'Aucune salle associée à ce compte')

    // 2. Entrée.
    const { payment_id: paymentId, amount: rawAmount } = await req.json() as { payment_id?: string; amount?: number }
    if (!paymentId) return errorResponse(400, 'MISSING_PAYMENT_ID', 'payment_id requis')

    // 3. Charger le paiement (appartenance au gym de l'appelant, jamais du body).
    const { data: payment } = await admin
      .from('payments')
      .select('id, gym_id, status, amount, refunded_amount, currency, mollie_payment_id, credits_granted, plan_name')
      .eq('id', paymentId)
      .single()

    if (!payment) return errorResponse(404, 'PAYMENT_NOT_FOUND', 'Paiement introuvable')
    if (payment.gym_id !== adminProfile.gym_id) return errorResponse(403, 'WRONG_GYM', 'Paiement hors de votre salle')

    // 4. Gardes métier.
    // 4a. Abonnement récurrent : HORS PÉRIMÈTRE v1 (logique différente). Convention du code
    //     (Revenue.tsx) : credits_granted > 0 = paiement à l'unité/carte ; 0/null = abonnement.
    if (!payment.credits_granted || payment.credits_granted <= 0) {
      return errorResponse(422, 'SUBSCRIPTION_PAYMENT', 'Le remboursement d\'un abonnement n\'est pas géré ici')
    }
    // 4b. Paiement hors-ligne (cash / terminal, GYM-144) : pas de Mollie → à rembourser en salle.
    if (!payment.mollie_payment_id) {
      return errorResponse(422, 'MANUAL_PAYMENT', 'Paiement hors-ligne — à rembourser en salle')
    }
    // 4c. Seuls les paiements encaissés (ou déjà partiellement remboursés) sont remboursables.
    if (payment.status !== 'paid' && payment.status !== 'partially_refunded') {
      return errorResponse(409, 'NOT_REFUNDABLE', 'Ce paiement ne peut pas être remboursé dans cet état')
    }

    // 5. Montant remboursable restant = montant - déjà remboursé.
    const alreadyRefunded = Number(payment.refunded_amount ?? 0)
    const remaining = Number(payment.amount) - alreadyRefunded
    if (remaining <= EPS) {
      return errorResponse(409, 'NOTHING_TO_REFUND', 'Ce paiement est déjà entièrement remboursé')
    }

    // amount absent = remboursement total du restant.
    const amount = rawAmount == null ? remaining : Number(rawAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      return errorResponse(400, 'INVALID_AMOUNT', 'Montant de remboursement invalide')
    }
    if (amount > remaining + EPS) {
      return errorResponse(400, 'AMOUNT_TOO_HIGH', 'Montant supérieur au remboursable restant')
    }

    const currency = (payment.currency as string) ?? 'EUR'

    // 6. Token Mollie (même logique test/live que create-payment).
    const isTestMode = Deno.env.get('MOLLIE_TEST_MODE') === 'true'
    let mollieApiKey: string
    if (isTestMode) {
      mollieApiKey = Deno.env.get('MOLLIE_TEST_API_KEY') ?? ''
      if (!mollieApiKey) return errorResponse(500, 'CONFIG_ERROR', 'MOLLIE_TEST_API_KEY manquant')
    } else {
      const oauthToken = await getValidMollieToken(admin, payment.gym_id)
      if (!oauthToken) return errorResponse(503, 'MOLLIE_TOKEN_EXPIRED', 'Token Mollie expiré — reconnexion requise')
      mollieApiKey = oauthToken
    }

    // 7. Demande de remboursement à Mollie.
    const mollieRes = await fetch(`https://api.mollie.com/v2/payments/${payment.mollie_payment_id}/refunds`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${mollieApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: { currency, value: formatAmount(amount) },
        description: `Remboursement ${payment.plan_name ?? ''}`.trim(),
      }),
    })

    if (!mollieRes.ok) {
      const detail = await mollieRes.text()
      console.error('[create-refund] Mollie refund refused:', mollieRes.status, detail)
      // Solde du gym insuffisant → message dédié.
      const lower = detail.toLowerCase()
      if (mollieRes.status === 422 && (lower.includes('balance') || lower.includes('insufficient') || lower.includes('funds') || lower.includes('amount'))) {
        return errorResponse(422, 'INSUFFICIENT_BALANCE', 'Solde Mollie insuffisant pour ce remboursement')
      }
      return errorResponse(502, 'MOLLIE_ERROR', `Mollie a refusé le remboursement: ${detail.slice(0, 300)}`)
    }

    const refund = await mollieRes.json() as { id?: string }

    // La création/écriture est déclenchée par le WEBHOOK (source unique). On ne touche
    // ici NI aux crédits NI au statut.
    return jsonResponse({ refund_id: refund.id ?? null, status: 'refund_requested' })
  } catch (err) {
    console.error('[create-refund] uncaught:', err)
    return errorResponse(500, 'SERVER_ERROR', (err as Error).message)
  }
})
