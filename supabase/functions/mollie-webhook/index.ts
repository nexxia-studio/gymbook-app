import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// GYM-238 — chrome des emails composée depuis nexxia_gyms.
import { loadGymBranding, emailSender, emailShell } from '../_shared/gym-branding.ts'
import { getValidMollieToken } from '../_shared/mollie-token.ts'
import { recordWebhookFailure } from '../_shared/webhook-failures.ts'

const FN = 'mollie-webhook'

const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const IS_TEST_MODE = Deno.env.get('MOLLIE_TEST_MODE') === 'true'
const MOLLIE_TEST_API_KEY = Deno.env.get('MOLLIE_TEST_API_KEY') ?? ''

// GYM-112 — Détection refund / chargeback. La vérité arrive par ce webhook : si Mollie
// signale un montant remboursé (ou rétrofacturé) cumulé > 0, on applique apply_refund_atomic
// (idempotent sur le cumul). Best-effort transactionnel : un échec suit le même chemin
// d'erreur que le reste (dead-letter + 503 → retry Mollie). Le chargeback prime (escalade).
async function applyRefundsIfAny(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  // deno-lint-ignore no-explicit-any
  payment: any,
  molliePayment: { amountRefunded?: { value: string }; amountChargedBack?: { value: string } },
): Promise<boolean> {
  const refunded = Number.parseFloat(molliePayment.amountRefunded?.value ?? '0') || 0
  const chargedBack = Number.parseFloat(molliePayment.amountChargedBack?.value ?? '0') || 0
  if (refunded <= 0 && chargedBack <= 0) return true // rien à traiter

  const isChargeback = chargedBack > 0
  const amount = isChargeback ? chargedBack : refunded

  const { data: result, error } = await supabase.rpc('apply_refund_atomic', {
    p_payment_id: payment.id,
    p_refunded_amount: amount,
    p_is_chargeback: isChargeback,
  })

  if (error || result?.status === 'not_found') {
    await recordWebhookFailure(supabase, {
      functionName: FN, mollieId: payment.mollie_payment_id, paymentId: payment.id,
      gymId: payment.gym_id, stage: 'apply_refund',
      detail: { isChargeback, amount, result: result ?? null, error: error?.message ?? null },
    })
    return false
  }
  return true
}

// GYM-206 — facture auto sur paiement EN LIGNE. Symétrique de l'encaissement au comptoir
// (admin-create-member, GYM-167) : même appel interne à generate-invoice via
// X-Internal-Secret (contourne le contrôle de rôle membre/gym_admin), même mode 'email'
// (génère ET envoie). Jusqu'ici le chemin en ligne n'émettait AUCUNE facture
// (invoice_number NULL) — non conforme depuis GYM-180 (identité EMS 95 + TVA 12 %).
//
// Best-effort strict : le paiement prime sur le document. Un échec ici ne doit jamais
// faire échouer le webhook (sinon 503 → Mollie rejoue → re-crédit refusé mais bruit) ni
// empêcher le crédit déjà appliqué. On log de quoi retrouver la ligne et régénérer à la
// main depuis /revenus.
async function sendInvoiceEmail(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  paymentId: string,
  memberId: string | null,
): Promise<void> {
  try {
    const secret = Deno.env.get('INTERNAL_FUNCTIONS_SECRET') ?? ''
    if (!secret) {
      console.error('[mollie-webhook] INTERNAL_FUNCTIONS_SECRET absent — facture non émise',
        { payment_id: paymentId, member_id: memberId })
      return
    }
    const { data, error } = await supabase.functions.invoke('generate-invoice', {
      body: { payment_id: paymentId, mode: 'email' },
      headers: { 'X-Internal-Secret': secret },
    })
    if (error) {
      console.error('[mollie-webhook] invoice send failed (non-blocking):',
        { payment_id: paymentId, member_id: memberId, error })
      return
    }
    const res = (data ?? {}) as { success?: boolean; invoice_number?: string; code?: string }
    if (res.success !== true) {
      console.error('[mollie-webhook] invoice not generated (non-blocking):',
        { payment_id: paymentId, member_id: memberId, response: res })
      return
    }
    console.log('[mollie-webhook] invoice sent:', res.invoice_number, 'for payment', paymentId)
  } catch (e) {
    console.error('[mollie-webhook] invoice threw (non-blocking):',
      { payment_id: paymentId, member_id: memberId, error: e instanceof Error ? e.message : String(e) })
  }
}

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
      // Échec de traitement (et non rejet légitime) : un paiement Mollie sans ligne
      // payments correspondante ne doit pas être avalé silencieusement → retry.
      await recordWebhookFailure(supabase, {
        functionName: FN, mollieId: molliePaymentId, stage: 'payment_lookup',
        detail: { reason: 'payment not found for mollie_payment_id' },
      })
      return new Response('payment not found', { status: 503 })
    }

    let accessToken: string | null = null
    if (IS_TEST_MODE) {
      if (!MOLLIE_TEST_API_KEY) {
        await recordWebhookFailure(supabase, {
          functionName: FN, mollieId: molliePaymentId, paymentId: payment.id,
          gymId: payment.gym_id, stage: 'token',
          detail: { reason: 'MOLLIE_TEST_API_KEY not set (test mode)' },
        })
        return new Response('missing api key', { status: 503 })
      }
      accessToken = MOLLIE_TEST_API_KEY
      console.log('[mollie-webhook] Using TEST API KEY')
    } else {
      accessToken = await getValidMollieToken(supabase, payment.gym_id)
      if (!accessToken) {
        await recordWebhookFailure(supabase, {
          functionName: FN, mollieId: molliePaymentId, paymentId: payment.id,
          gymId: payment.gym_id, stage: 'token',
          detail: { reason: 'no valid Mollie OAuth token / refresh failed' },
        })
        return new Response('no token', { status: 503 })
      }
      console.log('[mollie-webhook] Using OAuth token (live)')
    }

    const mollieResponse = await fetch(`https://api.mollie.com/v2/payments/${molliePaymentId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!mollieResponse.ok) {
      const err = await mollieResponse.text()
      await recordWebhookFailure(supabase, {
        functionName: FN, mollieId: molliePaymentId, paymentId: payment.id,
        gymId: payment.gym_id, stage: 'mollie_fetch',
        detail: { httpStatus: mollieResponse.status, body: err.slice(0, 500) },
      })
      return new Response('mollie fetch failed', { status: 503 })
    }

    const molliePayment = await mollieResponse.json() as {
      status: string
      method?: string
      paidAt?: string
      // GYM-112 — PIÈGE MOLLIE : sur un refund, le payment garde status='paid' ;
      // le remboursement se lit via amountRefunded (cumul), le chargeback via amountChargedBack.
      amountRefunded?: { value: string; currency: string }
      amountChargedBack?: { value: string; currency: string }
    }

    console.log('[mollie-webhook] Mollie status:', molliePayment.status)

    const statusMap: Record<string, string> = {
      paid: 'paid', failed: 'failed', expired: 'expired',
      canceled: 'canceled', pending: 'pending', open: 'pending',
    }
    const newStatus = statusMap[molliePayment.status] ?? 'pending'

    if (molliePayment.status !== 'paid') {
      // Statuts failed/expired/canceled/pending : simple update de statut (pas de crédits).
      // MAIS on vérifie désormais l'erreur → un échec d'écriture n'est plus silencieux.
      const { error: updateError } = await supabase
        .from('payments')
        .update({
          status: newStatus,
          payment_method: molliePayment.method ?? null,
          paid_at: molliePayment.paidAt ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', payment.id)

      if (updateError) {
        await recordWebhookFailure(supabase, {
          functionName: FN, mollieId: molliePaymentId, paymentId: payment.id,
          gymId: payment.gym_id, stage: 'status_update',
          detail: { newStatus, error: updateError.message },
        })
        return new Response('status update failed', { status: 503 })
      }

      // GYM-112 — un refund/chargeback peut aussi arriver sur ces statuts (no-op sinon).
      if (!await applyRefundsIfAny(supabase, payment, molliePayment)) {
        return new Response('apply_refund failed', { status: 503 })
      }

      return new Response('OK', { status: 200 })
    }

    // ── Statut 'paid' : passage à paid + contrepartie dans UNE transaction (RPC atomique) ──
    // GYM-189 — la contrepartie dépend de la nature du plan : crédits ('credits') ou
    // ouverture d'abonnement ('unlimited'). Le RPC renvoie du jsonb décrivant ce qui a été
    // délivré ; `result` garde les valeurs de l'ancien retour texte.
    const { data: applyRaw, error: applyError } = await supabase.rpc('apply_paid_payment', {
      p_payment_id: payment.id,
      p_payment_method: molliePayment.method ?? null,
      p_paid_at: molliePayment.paidAt ?? null,
    })

    const apply = (applyRaw ?? {}) as {
      result?: string; delivered?: string; credits_granted?: number; subscription_id?: string
    }
    const applyResult = apply.result

    if (applyError || applyResult === 'not_found') {
      await recordWebhookFailure(supabase, {
        functionName: FN, mollieId: molliePaymentId, paymentId: payment.id,
        gymId: payment.gym_id, stage: 'apply_paid',
        detail: { applyResult: applyResult ?? null, error: applyError?.message ?? null },
      })
      return new Response('apply_paid failed', { status: 503 })
    }

    // GYM-112 — détecter refund/chargeback AVANT le retour idempotent : un webhook de
    // refund garde status='paid', donc apply_paid_payment répond 'already_applied' ; sans
    // ce point de contrôle le remboursement ne serait jamais appliqué. Les deux branches
    // (paid + refund) coexistent sans exclusion mutuelle.
    if (!await applyRefundsIfAny(supabase, payment, molliePayment)) {
      return new Response('apply_refund failed', { status: 503 })
    }

    if (applyResult === 'already_applied') {
      // Retry idempotent d'un paiement déjà traité : pas de re-crédit ni re-notification.
      console.log('[mollie-webhook] payment already applied — idempotent skip:', molliePaymentId)
      return new Response('OK', { status: 200 })
    }

    // applyResult === 'applied' → contrepartie délivrée, on notifie (email + push).
    {
      // GYM-189 — le libellé suit ce qui a RÉELLEMENT été délivré : annoncer
      // « N séance(s) ajoutée(s) » à qui vient d'acheter un abonnement serait faux
      // (credits_granted est NULL sur ce paiement).
      const isSubscription = apply.delivered === 'subscription'
      const deliveredLine = isSubscription
        ? 'Votre abonnement est actif'
        : `Crédits ajoutés : <strong>${payment.credits_granted} séance(s)</strong>`
      const deliveredPush = isSubscription
        ? 'Votre abonnement est actif'
        : `${payment.credits_granted} séance(s) ajoutée(s)`

      console.log('[mollie-webhook] applied', apply.delivered ?? 'credits', 'to', payment.member_id,
        isSubscription ? `(subscription ${apply.subscription_id})` : `(${payment.credits_granted} credits)`)

      const { data: profile } = await supabase
        .from('profiles')
        .select('email, first_name, push_token')
        .eq('id', payment.member_id)
        .single()

      if (RESEND_KEY && profile?.email) {
        try {
          // GYM-238 — chrome de la salle, et bouton en Universal Link (il pointait
          // `dopamine://bookings`, inerte dans tout client mail).
          const gym = await loadGymBranding(supabase, payment.gym_id as string)
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
            body: JSON.stringify({
              from: emailSender(gym),
              to: profile.email,
              subject: `Paiement confirmé — ${payment.plan_name}`,
              html: emailShell(gym, {
                title: '✅ Paiement confirmé !',
                width: 480,
                bodyHtml:
                  `<p style="color:#6B6861;margin:0 0 8px;"><strong>${payment.plan_name}</strong></p>` +
                  `<p style="color:#6B6861;margin:0 0 8px;">Montant : <strong>${payment.amount}€</strong></p>` +
                  `<p style="color:#6B6861;margin:0 0 24px;">${deliveredLine}</p>`,
                ctaLabel: 'Réserver un cours',
                ctaPath: 'bookings',
              }),
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
              body: `${payment.plan_name} — ${deliveredPush}`,
              data: { type: 'payment_confirmed', payment_id: payment.id },
            },
          })
        } catch (e) {
          console.error('[mollie-webhook] push error (non-blocking):', e)
        }
      }

      // GYM-206 — facture émise et envoyée au membre. Placé ICI, dans la branche
      // applyResult === 'applied', donc :
      //  · uniquement sur un paiement réellement encaissé (les statuts pending/failed/
      //    expired/canceled sont sortis bien plus haut) ;
      //  · une seule fois — un rejeu Mollie repasse par 'already_applied' et retourne
      //    avant ce point, le membre ne reçoit donc jamais deux factures ;
      //  · pour les DEUX contreparties, crédits comme abonnement payé en une fois
      //    (GYM-189) : cette branche couvre delivered = 'credits' ET 'subscription'.
      // Après l'email de confirmation et le push : la facture ne doit pas retarder
      // l'accusé de paiement du membre.
      await sendInvoiceEmail(supabase, payment.id, payment.member_id ?? null)
    }

    return new Response('OK', { status: 200 })
  } catch (err) {
    // Erreur non rattrapée = échec de traitement → dead-letter + 503 pour retry Mollie.
    // Best-effort : on tente d'enregistrer, mais on renvoie 503 quoi qu'il arrive.
    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      )
      await recordWebhookFailure(supabase, {
        functionName: FN, mollieId: null, stage: 'uncaught',
        detail: { error: err instanceof Error ? err.message : String(err) },
      })
    } catch (e) {
      console.error('[mollie-webhook] uncaught + failed to record:', e)
    }
    console.error('[mollie-webhook] uncaught:', err)
    return new Response('internal error', { status: 503 })
  }
})
