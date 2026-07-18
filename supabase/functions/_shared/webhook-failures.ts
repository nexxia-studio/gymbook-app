import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export interface WebhookFailure {
  functionName: string
  mollieId: string | null
  paymentId?: string | null
  gymId?: string | null
  stage: string
  detail?: Record<string, unknown>
}

/**
 * Dead-letter d'un échec de traitement webhook (GYM-71).
 *
 * Best-effort et NON bloquant : ne throw jamais — un échec d'enregistrement ne
 * doit pas empêcher le webhook de renvoyer son 503 (et donc le retry Mollie).
 * Écrit dans public.webhook_failures (accès service_role) et, si configuré,
 * envoie un email d'alerte minimaliste via Resend.
 */
export async function recordWebhookFailure(
  supabase: SupabaseClient,
  { functionName, mollieId, paymentId, gymId, stage, detail = {} }: WebhookFailure,
): Promise<void> {
  console.error('[webhook-failure]', functionName, stage, mollieId, detail)

  // 1. Insertion dead-letter (best-effort).
  try {
    const { error } = await supabase.from('webhook_failures').insert({
      function_name: functionName,
      mollie_id: mollieId,
      payment_id: paymentId ?? null,
      gym_id: gymId ?? null,
      stage,
      detail,
    })
    if (error) console.error('[webhook-failure] insert error (non-blocking):', error)
  } catch (e) {
    console.error('[webhook-failure] insert threw (non-blocking):', e)
  }

  // 2. Email d'alerte (best-effort) — uniquement si ALERT_EMAIL + RESEND_API_KEY définis.
  const alertEmail = Deno.env.get('ALERT_EMAIL')
  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!alertEmail || !resendKey) return

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: 'Viniz Alerts <noreply@viniz.app>',
        to: alertEmail,
        subject: `[Viniz] Webhook failure — ${functionName}/${stage}`,
        text: `Webhook failure détecté.\n\n`
          + `Fonction : ${functionName}\n`
          + `Stage    : ${stage}\n`
          + `Mollie ID: ${mollieId ?? '(none)'}\n`
          + `Payment  : ${paymentId ?? '(none)'}\n`
          + `Gym      : ${gymId ?? '(none)'}\n\n`
          + `Detail   : ${JSON.stringify(detail, null, 2)}`,
      }),
    })
  } catch (e) {
    console.error('[webhook-failure] alert email threw (non-blocking):', e)
  }
}
