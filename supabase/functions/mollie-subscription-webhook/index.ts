import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// GYM-238 — nom d'expéditeur lu depuis nexxia_gyms.
import { loadGymBranding, emailSender } from '../_shared/gym-branding.ts'
import { getValidMollieToken } from '../_shared/mollie-token.ts'
import { resolvePlan } from '../_shared/plan-resolver.ts'
import { getEffectiveCommission } from '../_shared/commission.ts'
import { recordWebhookFailure } from '../_shared/webhook-failures.ts'
// GYM-252 — gabarits partagés avec le balayage quotidien (process-failed-renewals).
import {
  buildMemberFailureEmail,
  buildOwnerAlertEmail,
} from '../_shared/failed-renewal-emails.ts'

const FN = 'mollie-subscription-webhook'

const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const IS_TEST_MODE = Deno.env.get('MOLLIE_TEST_MODE') === 'true'
const MOLLIE_TEST_API_KEY = Deno.env.get('MOLLIE_TEST_API_KEY') ?? ''

// GYM-212 — facture auto sur les abonnements récurrents. Repris À L'IDENTIQUE de
// mollie-webhook (GYM-206, déployé et validé en prod v27), lui-même calqué sur
// l'encaissement au comptoir (admin-create-member, GYM-167) : appel interne à
// generate-invoice via X-Internal-Secret (contourne le contrôle de rôle
// membre/gym_admin), mode 'email' (génère ET envoie).
//
// Jusqu'ici cette fonction n'émettait AUCUNE facture, sur AUCUNE échéance — ni au
// premier paiement, ni aux renouvellements. C'est le chemin qui SE RÉPÈTE : un abonné
// à 90 €/mois produit 12 encaissements par an, donc 12 factures dues. Non conforme
// depuis GYM-180 (identité EMS 95 + détail TVA 12 %).
//
// Best-effort strict : le paiement prime sur le document. Un échec ici ne doit jamais
// faire échouer le webhook (sinon 503 → Mollie rejoue → reconduction rejouée), ni
// empêcher la reconduction de l'abonnement, ni bloquer l'accès du membre. On log de
// quoi retrouver la ligne et régénérer à la main depuis /revenus.
async function sendInvoiceEmail(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  paymentId: string,
  memberId: string | null,
): Promise<void> {
  try {
    const secret = Deno.env.get('INTERNAL_FUNCTIONS_SECRET') ?? ''
    if (!secret) {
      console.error('[sub-webhook] INTERNAL_FUNCTIONS_SECRET absent — facture non émise',
        { payment_id: paymentId, member_id: memberId })
      return
    }
    const { data, error } = await supabase.functions.invoke('generate-invoice', {
      body: { payment_id: paymentId, mode: 'email' },
      headers: { 'X-Internal-Secret': secret },
    })
    if (error) {
      console.error('[sub-webhook] invoice send failed (non-blocking):',
        { payment_id: paymentId, member_id: memberId, error })
      return
    }
    const res = (data ?? {}) as { success?: boolean; invoice_number?: string; code?: string }
    if (res.success !== true) {
      console.error('[sub-webhook] invoice not generated (non-blocking):',
        { payment_id: paymentId, member_id: memberId, response: res })
      return
    }
    console.log('[sub-webhook] invoice sent:', res.invoice_number, 'for payment', paymentId)
  } catch (e) {
    console.error('[sub-webhook] invoice threw (non-blocking):',
      { payment_id: paymentId, member_id: memberId, error: e instanceof Error ? e.message : String(e) })
  }
}

// ═════════════════════════════════════════════════════════════════════════════════
// GYM-252 — ÉCHÉANCE EN ÉCHEC
// ═════════════════════════════════════════════════════════════════════════════════
// 🔴 CE QUE FAISAIT CETTE FONCTION AVANT CE LOT, ET QUI EXPLIQUE TOUT LE RESTE :
// la branche failed/expired/canceled se réduisait à
//     UPDATE payments SET status='failed' WHERE mollie_payment_id = <id>
// Pour une ÉCHÉANCE, aucune ligne `payments` n'existe — elle n'est écrite que dans la
// branche `paid`, les renouvellements étant générés par Mollie (motif de GYM-244).
// L'UPDATE portait donc sur ZÉRO ligne, sans erreur : le membre gardait son accès, la
// salle ne voyait rien, et il ne restait aucune trace à retrouver.
//
// ⚠️ MOLLIE RETENTE SEUL, « up to 5 times (once a day) » (docs.mollie.com/docs/
// recurring-payments, 24/08/2026), et « like regular payments your webhook is called ».
// CETTE FONCTION EST DONC RAPPELÉE JUSQU'À CINQ FOIS POUR LE MÊME IMPAYÉ. D'où :
//   · `last_failed_payment_id` sert de clé d'idempotence — même paiement rejoué = sortie
//     immédiate, exactement comme `existingPayment.status === 'paid'` protège la branche
//     de renouvellement réussi ;
//   · le 1er email membre est adossé à la TRANSITION payment_failed_at NULL → now(), pas
//     à la réception d'un webhook. Sans ça, cinq courriers identiques en cinq jours.

/** Grâce avant coupure, en jours. ⚠️ Doit rester égale au défaut de
 *  suspend_overdue_subscriptions(p_grace_days) — la migration cite cette constante. */
const GRACE_DAYS = 3

/** Statuts d'abonnement sur lesquels un échec d'échéance a encore un sens. */
const FAILURE_RELEVANT_STATUSES = ['active', 'canceling', 'past_due']

/**
 * Envoi Resend best-effort. Un email ne doit JAMAIS faire échouer un webhook de
 * paiement : un 503 ferait rejouer Mollie, et le rejeu ne renverrait de toute façon
 * pas l'email (idempotence). On journalise et on continue.
 */
async function sendMail(from: string, to: string, subject: string, html: string): Promise<void> {
  if (!RESEND_KEY) {
    console.error('[sub-webhook] RESEND_API_KEY absent — email non envoyé:', subject)
    return
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({ from, to, subject, html }),
    })
    if (!res.ok) {
      console.error('[sub-webhook] Resend refus (non-bloquant):', res.status, (await res.text()).slice(0, 300))
    }
  } catch (e) {
    console.error('[sub-webhook] Resend threw (non-bloquant):', e)
  }
}

/**
 * J0 — bascule l'abonnement en `past_due`, prévient le membre et le gérant.
 *
 * ⚠️ L'ACCÈS N'EST PAS COUPÉ ICI. `past_due` figure dans TOUS les prédicats « ouvre des
 * droits » (migration GYM-252, section c) : le membre continue de réserver normalement.
 * La coupure est le fait du balayage J+3, et de lui seul.
 *
 * ⚠️ UN `canceling` NE DEVIENT PAS `past_due`. Ce statut porte une information qu'aucune
 * autre colonne ne réplique — « résiliation demandée, accès dû jusqu'au terme » (GYM-113,
 * GYM-195). L'écraser ferait disparaître l'engagement du membre pour un incident de
 * prélèvement. Les colonnes de suivi sont néanmoins renseignées : la trace ne se perd pas.
 *
 * Ne lève jamais : renvoie `false` si rien n'a pu être écrit, l'appelant décide.
 */
async function handleRenewalFailure(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  params: {
    molliePaymentId: string
    mollieSubscriptionId: string | null
    memberId: string
    gymId: string
    mollieStatus: string
  },
): Promise<boolean> {
  const { molliePaymentId, mollieSubscriptionId, memberId, gymId, mollieStatus } = params

  // ── La ligne d'abonnement. Par mollie_subscription_id quand Mollie le donne (le cas
  // nominal d'une échéance) ; sinon repli sur le plus récent abonnement pertinent du
  // membre dans CETTE salle — jamais au-delà, gym_id est dans le filtre.
  const SUB_COLS = 'id, status, plan_name, amount, payment_failed_at, payment_failed_count, last_failed_payment_id'
  let sub: Record<string, unknown> | null = null
  if (mollieSubscriptionId) {
    const { data } = await supabase
      .from('member_subscriptions')
      .select(SUB_COLS)
      .eq('mollie_subscription_id', mollieSubscriptionId)
      .maybeSingle()
    sub = data ?? null
  }
  if (!sub) {
    const { data } = await supabase
      .from('member_subscriptions')
      .select(SUB_COLS)
      .eq('member_id', memberId)
      .eq('gym_id', gymId)
      .in('status', FAILURE_RELEVANT_STATUSES)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    sub = data ?? null
  }

  if (!sub) {
    // ⚠️ C'EST UNE ANOMALIE, PAS UN IMPAYÉ ORDINAIRE : Mollie a prélevé pour un
    // abonnement dont nous n'avons pas la ligne. Dead-letter + alerte, c'est ce que
    // recordWebhookFailure est fait pour. (Un refus bancaire ordinaire, lui, ne passe
    // PAS par ce canal — voir la note de la PR : #viniz-bugs est un canal de défauts.)
    await recordWebhookFailure(supabase, {
      functionName: FN, mollieId: molliePaymentId, paymentId: null, gymId,
      stage: 'renewal_failure_no_subscription',
      detail: { reason: 'failed renewal but no member_subscriptions row', mollieSubscriptionId, memberId, mollieStatus },
    })
    return false
  }

  // Idempotence : ce paiement précis a déjà été traité (rejeu Mollie du même webhook).
  if (sub.last_failed_payment_id === molliePaymentId) {
    console.log('[sub-webhook] renewal failure already processed — idempotent skip:', molliePaymentId)
    return true
  }

  const currentStatus = sub.status as string
  if (!FAILURE_RELEVANT_STATUSES.includes(currentStatus)) {
    // Abonnement déjà expiré / résilié / suspendu : l'échec n'apprend rien et ne doit
    // surtout pas ressusciter une ligne close en `past_due`.
    console.log('[sub-webhook] failed renewal on non-active subscription — ignored:', currentStatus)
    return true
  }

  const isFirstFailure = !sub.payment_failed_at
  const failedCount = ((sub.payment_failed_count as number) ?? 0) + 1
  const failedAt = (sub.payment_failed_at as string | null) ?? new Date().toISOString()

  const { error: subError } = await supabase.from('member_subscriptions').update({
    // 'canceling' est préservé (cf. entête) ; 'past_due' reste 'past_due'.
    status: currentStatus === 'active' ? 'past_due' : currentStatus,
    payment_failed_at: failedAt,
    payment_failed_count: failedCount,
    last_failed_payment_id: molliePaymentId,
    updated_at: new Date().toISOString(),
  }).eq('id', sub.id as string)

  if (subError) {
    await recordWebhookFailure(supabase, {
      functionName: FN, mollieId: molliePaymentId, paymentId: null, gymId,
      stage: 'renewal_failure_update',
      detail: { error: subError.message, subscriptionId: sub.id },
    })
    return false
  }

  console.log('[sub-webhook] renewal failed →', currentStatus === 'active' ? 'past_due' : currentStatus,
    '| attempt', failedCount, '| sub', sub.id)

  // ── Courriers, UNIQUEMENT au premier échec du cycle ────────────────────────────
  // Les tentatives 2 à 5 de Mollie ne réécrivent pas payment_failed_at : elles ne
  // repassent donc jamais ici. Le gérant et le membre reçoivent UN courrier, pas cinq.
  if (!isFirstFailure) return true

  try {
    const branding = await loadGymBranding(supabase, gymId)
    const from = emailSender(branding)
    const { data: profile } = await supabase
      .from('profiles').select('email, first_name, last_name').eq('id', memberId).maybeSingle()

    const planName = (sub.plan_name as string) ?? 'Abonnement'
    const amount = typeof sub.amount === 'number' ? sub.amount : null
    const suspendOn = new Date(new Date(failedAt).getTime() + GRACE_DAYS * 86_400_000)

    if (profile?.email) {
      const mail = buildMemberFailureEmail({
        branding, firstName: profile.first_name ?? null,
        planName, amount, graceDays: GRACE_DAYS, suspendOn,
      })
      await sendMail(from, profile.email, mail.subject, mail.html)
    } else {
      console.error('[sub-webhook] membre sans email — 1re relance non envoyée:', memberId)
    }

    // Alerte gérant. `nexxia_gyms.email` est NULL en production tant que la salle ne
    // l'a pas renseignée (GYM-265 l'expose dans /settings) : sans destinataire, on ne
    // fabrique pas d'adresse, on journalise. Le statut past_due reste visible au
    // dashboard — l'information n'est pas perdue, seulement moins poussée.
    if (branding.email) {
      const memberName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ')
        || profile?.email || memberId
      const alert = buildOwnerAlertEmail({
        branding, memberName, memberEmail: profile?.email ?? null,
        planName, amount, stage: 'failed', failedCount, graceDays: GRACE_DAYS,
      })
      await sendMail(from, branding.email, alert.subject, alert.html)
    } else {
      console.warn('[sub-webhook] nexxia_gyms.email absent — alerte gérant non envoyée, gym', gymId)
    }
  } catch (e) {
    // Best-effort strict : la bascule d'état est faite, elle prime sur les courriers.
    console.error("[sub-webhook] notifications d'échec non envoyées (non-bloquant):", e)
  }

  return true
}

// GYM-212 — les deux upserts de cette fonction ne renvoient pas la ligne écrite, et on ne
// touche PAS à ces écritures critiques (leur `error` pilote le 503). On relit donc l'id
// par mollie_payment_id, qui est UNIQUE. Lecture seule, sans effet sur le flux de paiement.
async function resolvePaymentRowId(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  molliePaymentId: string,
  knownId: string | null,
): Promise<string | null> {
  if (knownId) return knownId
  try {
    const { data } = await supabase
      .from('payments')
      .select('id')
      .eq('mollie_payment_id', molliePaymentId)
      .maybeSingle()
    return (data?.id as string | undefined) ?? null
  } catch (e) {
    console.error('[sub-webhook] payment id lookup failed (non-blocking):',
      { mollie_payment_id: molliePaymentId, error: e instanceof Error ? e.message : String(e) })
    return null
  }
}

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

    // GYM-213 — `existingPayment` est lu ICI, AVANT toute écriture : c'est le signal de
    // rejeu des DEUX branches (premier paiement et échéance), chacune sortant en tête sur
    // `existingPayment?.status === 'paid'`. Ne pas déplacer cette lecture après un upsert :
    // les upserts posent status='paid' et le signal deviendrait toujours vrai.
    let gymIdForToken = existingPayment?.gym_id ?? null
    let accessToken: string | null = null

    // ── GYM-244 — repli sur le gym_id porté par l'URL de rappel ────────────────────
    //
    // 🔴 DÉFAUT COUVERT ICI : les ÉCHÉANCES. GYM-243 garantit une ligne payments pour le
    // PREMIER paiement (create-subscription l'insère avant de rendre le checkout), mais
    // les paiements de renouvellement sont générés par Mollie : aucune ligne ne peut être
    // pré-insérée, l'upsert de la branche 'recurring' n'a lieu qu'APRÈS l'obtention du
    // jeton. Sans repli, le tout premier webhook d'échéance sortait donc en 503
    // « no Mollie access token available » — exactement le blocage de GYM-243, décalé
    // d'un mois. Invisible tant qu'aucun abonnement n'a atteint son deuxième mois.
    //
    // ORDRE VOLONTAIRE — la base locale PRIME, le paramètre n'est qu'un repli : une ligne
    // payments a été écrite par nous, un paramètre d'URL a fait un aller-retour chez un
    // tiers. On ne descend au paramètre que si la ligne est absente.
    //
    // ⚠️ Ce gym_id ne sert QU'À OBTENIR LE JETON. Il n'autorise rien par lui-même : la
    // garde inter-tenant plus bas exige que la metadata du paiement porte le MÊME gym_id
    // avant la moindre écriture. Le secret dit que l'appel est permis, pas au nom de qui.
    const urlGymId = url.searchParams.get('gym_id')
    let gymIdFromUrl = false
    if (!gymIdForToken && urlGymId) {
      gymIdForToken = urlGymId
      gymIdFromUrl = true
      console.log('[sub-webhook] gym_id from callback URL (no payments row):', urlGymId)
    }

    if (IS_TEST_MODE) {
      accessToken = MOLLIE_TEST_API_KEY
      console.log('[sub-webhook] Using TEST API KEY')
    } else if (gymIdForToken) {
      accessToken = await getValidMollieToken(supabase, gymIdForToken)
    }

    if (!accessToken) {
      await recordWebhookFailure(supabase, {
        functionName: FN, mollieId: molliePaymentId, paymentId: existingPayment?.id ?? null,
        gymId: gymIdForToken, stage: 'token',
        detail: { reason: 'no Mollie access token available' },
      })
      return new Response('no token', { status: 503 })
    }

    const mollieRes = await fetch(`https://api.mollie.com/v2/payments/${molliePaymentId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!mollieRes.ok) {
      const err = await mollieRes.text()
      await recordWebhookFailure(supabase, {
        functionName: FN, mollieId: molliePaymentId, paymentId: existingPayment?.id ?? null,
        gymId: gymIdForToken, stage: 'mollie_fetch',
        detail: { httpStatus: mollieRes.status, body: err.slice(0, 500) },
      })
      return new Response('mollie fetch failed', { status: 503 })
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
      // Paiement Mollie réel mais impossible à attribuer (metadata + ligne payments absentes).
      // Classé échec de traitement (dead-letter + 503) plutôt qu'avalé. ⚠️ Voir POINT AMBIGU :
      // la metadata Mollie étant immuable, un retry ne s'auto-résout pas — le dead-letter sert
      // au triage manuel; Mollie cesse de retenter après ses tentatives.
      await recordWebhookFailure(supabase, {
        functionName: FN, mollieId: molliePaymentId, paymentId: existingPayment?.id ?? null,
        gymId, stage: 'metadata',
        detail: { reason: 'missing member_id/gym_id', memberId, gymId },
      })
      return new Response('missing metadata', { status: 503 })
    }

    // ╔═══════════════════════════════════════════════════════════════════════════╗
    // ║  🔴 GYM-244 — GARDE INTER-TENANT. Ne pas retirer, ne pas assouplir.        ║
    // ╚═══════════════════════════════════════════════════════════════════════════╝
    // Le gym_id qui a servi à OBTENIR LE JETON doit être celui que le paiement déclare
    // dans sa metadata. Sans cette vérification, quelqu'un connaissant le secret pourrait
    // appeler la fonction avec le gym_id de la salle A et l'identifiant d'un paiement de
    // la salle B : le jeton de A serait utilisé et les données de B écrites sous
    // l'identité de A. C'est une élévation de privilège inter-tenant — le motif de
    // GYM-203. Le secret autorise l'APPEL, il ne dit pas AU NOM DE QUI.
    //
    // Comparaison sur `metadata.gym_id` et non sur `gymId` : ce dernier retombe sur
    // `existingPayment.gym_id`, donc se comparerait partiellement à lui-même.
    //
    // La garde vaut pour les DEUX sources (ligne payments ET paramètre d'URL) : une
    // divergence entre notre propre base et ce que Mollie déclare est tout aussi
    // anormale, et une règle unique ne peut pas diverger d'elle-même. Elle ne mord que
    // si les deux valeurs sont présentes — l'absence est déjà traitée juste au-dessus.
    //
    // 403 et non 503 : un rejeu ne résoudra jamais une divergence d'identité, et il ne
    // faut pas que Mollie retente. Refus journalisé, AUCUNE écriture métier.
    const metadataGymId = metadata.gym_id ?? null
    if (gymIdForToken && metadataGymId && metadataGymId !== gymIdForToken) {
      await recordWebhookFailure(supabase, {
        functionName: FN, mollieId: molliePaymentId, paymentId: existingPayment?.id ?? null,
        gymId: metadataGymId, stage: 'gym_mismatch',
        detail: {
          reason: 'gym_id used for token does not match payment metadata',
          gymIdForToken,
          metadataGymId,
          source: gymIdFromUrl ? 'callback_url' : 'payments_row',
        },
      })
      console.error('[sub-webhook] gym mismatch — refused:', { gymIdForToken, metadataGymId })
      return new Response('gym mismatch', { status: 403 })
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

        const { error: mandateError } = await supabase.from('mollie_customers').update({
          has_valid_mandate: true,
          mollie_mandate_id: mandateId,
          updated_at: new Date().toISOString(),
        }).eq('member_id', memberId).eq('gym_id', gymId)

        if (mandateError) {
          await recordWebhookFailure(supabase, {
            functionName: FN, mollieId: molliePaymentId, paymentId: existingPayment?.id ?? null,
            gymId, stage: 'mandate_update', detail: { error: mandateError.message },
          })
          return new Response('mandate update failed', { status: 503 })
        }

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
            // GYM-244 — C'EST ICI QUE TOUT SE JOUE : cette URL est celle que Mollie
            // appellera à CHAQUE échéance, et le seul endroit où l'on puisse encore
            // attacher l'identité de la salle. Aucune ligne payments n'existera alors
            // pour la porter. Le gym_id voyage à côté du secret, par le même chemin.
            webhookUrl: `${Deno.env.get('SUPABASE_URL')}/functions/v1/mollie-subscription-webhook?secret=${Deno.env.get('MOLLIE_WEBHOOK_SECRET') ?? ''}&gym_id=${encodeURIComponent(gymId)}`,
            metadata: { member_id: memberId, gym_id: gymId, plan_id: planId, type: 'subscription_renewal' },
          }
          if (!IS_TEST_MODE && feeCents > 0) {
            subPayload.applicationFee = {
              amount: { currency: plan.currency, value: (feeCents / 100).toFixed(2) },
              description: 'Viniz commission',
            }
          }
          // IDEMPOTENCE (GYM-71) : ne JAMAIS recréer un abonnement Mollie sur retry —
          // sinon double abo = double débit récurrent. On considère l'abo déjà créé si
          // une ligne member_subscriptions active existe pour (member, gym, plan) ET porte
          // déjà un mollie_subscription_id.
          const { data: existingSub } = await supabase
            .from('member_subscriptions')
            .select('id, mollie_subscription_id')
            .eq('member_id', memberId)
            .eq('gym_id', gymId)
            .eq('plan_id', planId)
            .eq('status', 'active')
            .not('mollie_subscription_id', 'is', null)
            .maybeSingle()

          if (existingSub?.mollie_subscription_id) {
            console.log('[sub-webhook] subscription already exists — skip Mollie create (idempotent):', existingSub.mollie_subscription_id)
          } else {
            const subRes = await fetch(`https://api.mollie.com/v2/customers/${customerId}/subscriptions`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
              body: JSON.stringify(subPayload),
            })

            if (!subRes.ok) {
              // Échec critique : sans cet appel, le membre serait débité une fois sans
              // renouvellement ni trace. On NE marque PAS le paiement paid → 503 pour retry.
              await recordWebhookFailure(supabase, {
                functionName: FN, mollieId: molliePaymentId, paymentId: existingPayment?.id ?? null,
                gymId, stage: 'subscription_create',
                detail: { httpStatus: subRes.status, body: (await subRes.text()).slice(0, 500), customerId },
              })
              return new Response('subscription create failed', { status: 503 })
            }

            const subscription = await subRes.json() as { id: string; nextPaymentDate?: string }
            const startsAt = new Date()
            const endsAt = new Date(startsAt)
            endsAt.setMonth(endsAt.getMonth() + durationMonths)

            const { error: subInsertError } = await supabase.from('member_subscriptions').insert({
              gym_id: gymId, member_id: memberId, plan_id: planId,
              plan_name: plan.name, status: 'active',
              mollie_subscription_id: subscription.id, mollie_customer_id: customerId,
              amount: planAmount,
              starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(),
              max_payments: plan.duration_months, payments_count: 1,
              next_payment_at: subscription.nextPaymentDate ?? null,
            })

            if (subInsertError) {
              // ⚠️ FENÊTRE ÉTROITE (POINT AMBIGU) : l'abo Mollie EST créé mais son
              // enregistrement DB a échoué. On dead-letter AVEC le mollie_subscription_id
              // pour triage manuel. On renvoie 503 : le retry re-tentera, et l'idempotence
              // ci-dessus ne l'attrapera PAS (aucune ligne insérée) → risque de double abo.
              // Mitigation future : pré-réserver la ligne avant l'appel Mollie.
              await recordWebhookFailure(supabase, {
                functionName: FN, mollieId: molliePaymentId, paymentId: existingPayment?.id ?? null,
                gymId, stage: 'subscription_create',
                detail: { error: subInsertError.message, mollie_subscription_id: subscription.id, note: 'Mollie sub created but DB insert failed' },
              })
              return new Response('subscription insert failed', { status: 503 })
            }
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
        // Écriture critique (marque le 1er paiement paid) : erreur → dead-letter + 503.
        // Sûr vis-à-vis de l'idempotence : l'abo étant déjà créé et enregistré au-dessus,
        // un retry le retrouvera (existingSub) et ne recréera pas d'abo Mollie.
        let firstPaymentError: string | null = null
        if (planId) {
          const { error } = await supabase.from('payments').upsert({
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
          firstPaymentError = error?.message ?? null
        } else {
          // Sécurité : plan_id absent (colonne NOT NULL) — on ne peut pas créer la ligne.
          // On conserve l'ancien comportement (update ciblé, no-op si aucune ligne).
          const { error } = await supabase.from('payments').update({
            status: 'paid', paid_at: molliePayment.paidAt ?? null,
            payment_method: molliePayment.method ?? null,
            updated_at: new Date().toISOString(),
          }).eq('mollie_payment_id', molliePaymentId)
          firstPaymentError = error?.message ?? null
        }

        if (firstPaymentError) {
          await recordWebhookFailure(supabase, {
            functionName: FN, mollieId: molliePaymentId, paymentId: existingPayment?.id ?? null,
            gymId, stage: 'payment_upsert', detail: { error: firstPaymentError },
          })
          return new Response('payment write failed', { status: 503 })
        }

        const { data: profile } = await supabase
          .from('profiles').select('email, first_name, push_token').eq('id', memberId).single()

        if (RESEND_KEY && profile?.email && plan) {
          try {
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
              body: JSON.stringify({
                from: emailSender(await loadGymBranding(supabase, gymId as string)), to: profile.email,
                subject: `Abonnement activé — ${plan.name}`,
                html: `<p>Votre abonnement ${plan.name} est activé. ${(plan.price_cents / 100).toFixed(2)}€/mois × ${plan.duration_months ?? 1} mois.</p>`,
              }),
            })
          } catch (e) { console.error('[sub-webhook] email error:', e) }
        }

        if (profile?.push_token && plan) {
          try {
            // GYM-282 — passé en `fetch` pour porter le secret interne.
            await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-notification`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
                'X-Internal-Secret': Deno.env.get('INTERNAL_FUNCTIONS_SECRET') ?? '',
              },
              body: JSON.stringify({
                tokens: [profile.push_token],
                gym_id: gymId,
                title: '✅ Abonnement activé !',
                body: `${plan.name} — ${(plan.price_cents / 100).toFixed(2)}€/mois`,
                data: { type: 'subscription_activated' },
              }),
            })
          } catch (e) { console.error('[sub-webhook] push error:', e) }
        }

        // GYM-212 — facture du PREMIER paiement d'abonnement.
        // Idempotence : assurée par le court-circuit EXISTANT en tête de branche
        // (`existingPayment?.status === 'paid'` → return OK avant d'arriver ici). Un rejeu
        // Mollie n'atteint jamais ce point, le membre ne reçoit donc jamais deux factures.
        // Aucun garde réinventé. Placé après l'email et le push, comme dans GYM-206 : la
        // facture ne doit pas retarder l'accusé d'activation.
        {
          const invoicePaymentId = await resolvePaymentRowId(supabase, molliePaymentId, existingPayment?.id ?? null)
          if (invoicePaymentId) await sendInvoiceEmail(supabase, invoicePaymentId, memberId)
          else {
            console.error('[sub-webhook] facture non émise — ligne payments introuvable (non-blocking):',
              { mollie_payment_id: molliePaymentId, member_id: memberId, branch: 'first' })
          }
        }
      } else if (molliePayment.sequenceType === 'recurring') {
        // GYM-213 — idempotence : même court-circuit que la branche premier paiement, et
        // pour la même raison. Mollie rejoue ses webhooks sur timeout ou erreur réseau ;
        // sans cette sortie, un rejeu ré-exécutait TOUTE la branche, dont l'increment de
        // payments_count qui n'est pas idempotent.
        //
        // ⚠️ CE N'ÉTAIT PAS UN RISQUE THÉORIQUE : payments_count est comparé à max_payments
        // pour décider de la fin de l'abonnement. Un compteur gonflé par un rejeu clôturait
        // l'abonnement EN AVANCE — le membre perdait un mois d'accès qu'il avait payé.
        //
        // Le signal est le statut de la ligne payments LU AVANT TOUTE ÉCRITURE, et non
        // l'état de l'abonnement : « paiement déjà traité » et « abonnement déjà à jour »
        // sont deux questions différentes, et seule la première est fiable ici.
        if (existingPayment?.status === 'paid') {
          console.log('[sub-webhook] renewal already processed — idempotent skip:', molliePaymentId)
          return new Response('OK', { status: 200 })
        }

        console.log('[sub-webhook] recurring payment paid')
        const mollieSubscriptionId = molliePayment.subscriptionId ?? null

        const renewalPlan = planId ? await resolvePlan(supabase, gymId, planId) : null
        const planName = renewalPlan?.name ?? 'Renouvellement'

        // Écriture critique (euro encaissé) EN PREMIER — upsert idempotent (onConflict
        // mollie_payment_id). Erreur → dead-letter + 503. On la place avant le compteur pour
        // qu'un retry sur échec de paiement ne rejoue pas l'increment non idempotent ci-dessous.
        const { error: renewalPayError } = await supabase.from('payments').upsert({
          gym_id: gymId, member_id: memberId, mollie_payment_id: molliePaymentId,
          plan_id: planId, plan_name: `Renouvellement — ${planName}`,
          amount: molliePayment.amount ? parseFloat(molliePayment.amount.value) : 0,
          status: 'paid', payment_method: molliePayment.method ?? null,
          paid_at: molliePayment.paidAt ?? null, credits_granted: 0,
        }, { onConflict: 'mollie_payment_id' })

        if (renewalPayError) {
          await recordWebhookFailure(supabase, {
            functionName: FN, mollieId: molliePaymentId, paymentId: existingPayment?.id ?? null,
            gymId, stage: 'payment_upsert', detail: { branch: 'recurring', error: renewalPayError.message },
          })
          return new Response('renewal payment write failed', { status: 503 })
        }

        // Compteur d'échéances : increment NON idempotent en lui-même → mis à jour APRÈS le
        // paiement et journalisé sans 503 en cas d'erreur (un 503 ici rejouerait l'increment
        // au retry = double comptage).
        // GYM-213 — un rejeu Mollie ne peut plus l'atteindre : la branche sort en tête sur
        // existingPayment.status === 'paid'. L'ordre (paiement d'abord, compteur ensuite)
        // reste néanmoins la bonne défense pour un échec PARTIEL de ce même passage.
        if (mollieSubscriptionId) {
          const { data: sub } = await supabase
            .from('member_subscriptions').select('id, payments_count, max_payments')
            .eq('mollie_subscription_id', mollieSubscriptionId).maybeSingle()

          if (sub) {
            const nextCount = (sub.payments_count ?? 0) + 1
            const isFinal = sub.max_payments != null && nextCount >= sub.max_payments
            // GYM-252 — RÉACTIVATION AUTOMATIQUE. C'est ici, et nulle part ailleurs, que
            // se referme le cycle d'impayé : un prélèvement qui aboutit reprend le membre
            // là où il en était, sans geste du gérant ni du membre.
            //
            // ⚠️ LE STATUT SEUL NE SUFFIT PAS. `status: 'active'` était déjà écrit avant ce
            // lot et relèverait bien un `past_due` ou un `suspended` — mais en laissant
            // payment_failed_at renseigné. Le balayage quotidien, qui ne lit QUE
            // payment_failed_at et le statut, ne reverrait pas la ligne (elle n'est plus
            // past_due) ; en revanche le PROCHAIN échec repartirait avec isFirstFailure =
            // false et n'enverrait AUCUN courrier. Un impayé silencieux, à nouveau, mais
            // seulement au deuxième — le plus difficile à diagnostiquer. D'où la remise à
            // zéro explicite des quatre colonnes de suivi.
            const { error: subUpdError } = await supabase.from('member_subscriptions').update({
              payments_count: nextCount,
              status: isFinal ? 'completed' : 'active',
              payment_failed_at: null,
              payment_failed_count: 0,
              payment_suspended_at: null,
              last_failed_payment_id: null,
              updated_at: new Date().toISOString(),
            }).eq('id', sub.id)
            if (subUpdError) {
              // Surfacé mais non bloquant.
              // GYM-213 — l'ancien commentaire affirmait ici que status='completed' n'était
              // pas dans member_subscriptions_status_check et ferait échouer la DERNIÈRE
              // échéance. C'EST FAUX : vérifié en production ET en staging le 04/08, le CHECK
              // vaut (active, suspended, expired, cancelled, paused, completed, canceling) —
              // 'completed' y figure depuis GYM-151. Le commentaire décrivait un bug qui
              // n'existe plus ; il est supprimé plutôt que laissé à égarer le prochain lecteur.
              await recordWebhookFailure(supabase, {
                functionName: FN, mollieId: molliePaymentId, paymentId: existingPayment?.id ?? null,
                gymId, stage: 'subscription_counter', detail: { error: subUpdError.message, isFinal },
              })
            }
          }
        }

        // GYM-212 — facture de l'ÉCHÉANCE. C'est le chemin qui se répète : 12 factures
        // dues par an et par abonné.
        //
        // GYM-213 — le garde local qui protégeait cet appel a été RETIRÉ : le
        // court-circuit en tête de branche le rend inutile, puisqu'un rejeu ne parvient
        // plus jusqu'ici. Deux mécanismes pour la même garantie n'apportaient rien et
        // laissaient croire que l'appel avait besoin d'une protection propre.
        {
          const invoicePaymentId = await resolvePaymentRowId(supabase, molliePaymentId, existingPayment?.id ?? null)
          if (invoicePaymentId) await sendInvoiceEmail(supabase, invoicePaymentId, memberId)
          else {
            console.error('[sub-webhook] facture non émise — ligne payments introuvable (non-blocking):',
              { mollie_payment_id: molliePaymentId, member_id: memberId, branch: 'recurring' })
          }
        }
      }
    } else if (['failed', 'expired', 'canceled'].includes(molliePayment.status)) {
      const statusMap: Record<string, string> = { failed: 'failed', expired: 'expired', canceled: 'canceled' }
      // Inchangé : ne mord QUE sur un PREMIER paiement (create-subscription a inséré la
      // ligne avant le checkout, GYM-243). Pour une échéance, aucune ligne n'existe et
      // l'UPDATE porte sur 0 ligne — c'est justement pour ça que la suite existe.
      //
      // ⚠️ ON NE CRÉE PAS DE LIGNE `payments` POUR UNE ÉCHÉANCE ÉCHOUÉE, ET C'EST UN CHOIX.
      // /revenus lit `payments` sans filtrer le statut : y injecter des tentatives
      // refusées changerait la lecture du chiffre d'affaires de toutes les salles pour un
      // besoin de traçabilité. La trace vit sur member_subscriptions
      // (last_failed_payment_id + payment_failed_count), qui n'est lue par aucun calcul
      // d'argent. Décision à rouvrir si /revenus gagne un onglet « impayés » — c'est noté
      // dans la PR, avec le coût.
      const { error: statusError } = await supabase.from('payments').update({
        status: statusMap[molliePayment.status],
        updated_at: new Date().toISOString(),
      }).eq('mollie_payment_id', molliePaymentId)

      if (statusError) {
        await recordWebhookFailure(supabase, {
          functionName: FN, mollieId: molliePaymentId, paymentId: existingPayment?.id ?? null,
          gymId, stage: 'status_update', detail: { newStatus: statusMap[molliePayment.status], error: statusError.message },
        })
        return new Response('status update failed', { status: 503 })
      }

      // ── GYM-252 — L'ÉCHÉANCE EN ÉCHEC ────────────────────────────────────────────
      // Le discriminant est `sequenceType === 'recurring'`, avec `subscriptionId` en
      // second : Mollie renseigne le premier sur toute échéance, mais un paiement
      // rattaché à un abonnement porte de toute façon le second. Prendre les deux évite
      // qu'un impayé passe entre les mailles à cause d'un champ manquant — et un premier
      // paiement échoué (sequenceType 'first', sans subscriptionId) n'entre pas ici :
      // il n'y a pas encore d'abonnement à suspendre.
      const isRenewal = molliePayment.sequenceType === 'recurring' || !!molliePayment.subscriptionId
      if (isRenewal) {
        const ok = await handleRenewalFailure(supabase, {
          molliePaymentId,
          mollieSubscriptionId: molliePayment.subscriptionId ?? null,
          memberId,
          gymId,
          mollieStatus: molliePayment.status,
        })
        // 503 → Mollie rejoue. L'écriture d'état est idempotente (last_failed_payment_id),
        // le rejeu ne peut donc ni doubler le compteur ni renvoyer les courriers. Ne pas
        // rejouer laisserait au contraire un membre impayé avec un accès ouvert et aucune
        // trace : exactement le défaut corrigé par ce lot.
        if (!ok) return new Response('renewal failure handling failed', { status: 503 })
      }
    }

    return new Response('OK', { status: 200 })
  } catch (err) {
    // Erreur non rattrapée = échec de traitement → dead-letter + 503 pour retry Mollie.
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
      console.error('[sub-webhook] uncaught + failed to record:', e)
    }
    console.error('[sub-webhook] uncaught:', err)
    return new Response('internal error', { status: 503 })
  }
})
