import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export interface WebhookFailure {
  functionName: string
  mollieId: string | null
  paymentId?: string | null
  gymId?: string | null
  stage: string
  detail?: Record<string, unknown>
}

// GYM-245 — plafond de temps par canal d'alerte. `recordWebhookFailure` est AWAITÉE avant
// que le webhook ne renvoie sa réponse : sans plafond, un Resend ou un Slack qui pend
// bloquerait le webhook jusqu'à ce que la plateforme le tue, et Mollie retenterait. Les
// deux canaux partent en parallèle, le surcoût est donc borné à ~3 s au pire, pas 2×3 s.
const ALERT_TIMEOUT_MS = 3000

/** Slack tronque au-delà de ~3000 car. par bloc ; on coupe bien avant, une alerte se lit. */
const DETAIL_MAX_CHARS = 1800

/**
 * GYM-245 — clés à caviarder AVANT envoi Slack. Un canal Slack est moins protégé qu'une
 * base : les identifiants techniques (UUID, id Mollie) suffisent au diagnostic, jamais
 * l'identité du membre. Aucun appelant actuel ne place ces clés dans `detail` — c'est une
 * ceinture pour les appelants à venir, pas une correction.
 *
 * ⚠️ Ne s'applique QU'À Slack. L'email part vers ALERT_EMAIL, une boîte contrôlée, et son
 * format reste inchangé.
 */
const PII_KEYS = /^(e?_?mail|name|first_?name|last_?name|full_?name|phone|phone_?number|push_?token|address)$/i

function redactPii(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => redactPii(v, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = PII_KEYS.test(k) ? '[redacted]' : redactPii(v, depth + 1)
  }
  return out
}

/** JSON.stringify ne doit jamais faire lever cette fonction (référence circulaire, BigInt…). */
function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return '(detail non sérialisable)'
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`
}

/**
 * Email d'alerte (best-effort). Format INCHANGÉ depuis GYM-71.
 * Ne lève jamais ; n'empêche jamais l'envoi Slack.
 */
async function sendAlertEmail(f: WebhookFailure & { detail: Record<string, unknown> }): Promise<void> {
  const alertEmail = Deno.env.get('ALERT_EMAIL')
  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!alertEmail || !resendKey) {
    console.warn('[webhook-failure] ALERT_EMAIL/RESEND_API_KEY absent — pas d\'email d\'alerte')
    return
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
      signal: AbortSignal.timeout(ALERT_TIMEOUT_MS),
      body: JSON.stringify({
        from: 'Viniz Alerts <noreply@viniz.app>',
        to: alertEmail,
        subject: `[Viniz] Webhook failure — ${f.functionName}/${f.stage}`,
        text: `Webhook failure détecté.\n\n`
          + `Fonction : ${f.functionName}\n`
          + `Stage    : ${f.stage}\n`
          + `Mollie ID: ${f.mollieId ?? '(none)'}\n`
          + `Payment  : ${f.paymentId ?? '(none)'}\n`
          + `Gym      : ${f.gymId ?? '(none)'}\n\n`
          + `Detail   : ${safeJson(f.detail)}`,
      }),
    })
    // Resend répond 4xx sans lever : sans ce test, un email refusé passait pour envoyé.
    if (!res.ok) {
      console.error('[webhook-failure] alert email rejected (non-blocking):', res.status,
        truncate(await res.text().catch(() => ''), 300))
    }
  } catch (e) {
    console.error('[webhook-failure] alert email threw (non-blocking):', e)
  }
}

/**
 * GYM-245 — alerte Slack (best-effort) sur le canal dédié aux défauts (#viniz-bugs).
 *
 * POURQUOI EN PLUS DE L'EMAIL : le défaut du 21/08 sur le chemin de l'argent
 * (mollie-subscription-webhook, stage 'token') n'a été découvert que parce qu'un email
 * était parti. Une boîte se consulte quand on y pense ; un canal se lit d'un coup d'œil
 * et se partage. Les deux canaux sont indépendants — l'un qui tombe n'empêche pas l'autre.
 *
 * Ne lève jamais ; n'empêche jamais l'envoi de l'email.
 */
async function sendSlackAlert(f: WebhookFailure & { detail: Record<string, unknown> }): Promise<void> {
  const slackUrl = Deno.env.get('SLACK_ALERT_WEBHOOK_URL')
  if (!slackUrl) {
    // Comportement retenu pour ALERT_EMAIL : absent = on n'envoie pas, on n'échoue pas.
    // C'est ce qui permet à staging de tourner sans ce secret.
    console.warn('[webhook-failure] SLACK_ALERT_WEBHOOK_URL absent — pas d\'alerte Slack')
    return
  }

  // ⚠️ Le gym_id manquant n'est PAS masqué : c'est lui qui a permis de diagnostiquer le
  // 21/08 (« Gym: (none) » disait que la salle n'avait jamais été résolue). On l'affiche
  // explicitement, et signalé, parce que son absence est une information.
  const gymField = f.gymId ? `\`${f.gymId}\`` : '⚠️ `(none)`'
  const detailText = truncate(safeJson(redactPii(f.detail)), DETAIL_MAX_CHARS)

  try {
    const res = await fetch(slackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(ALERT_TIMEOUT_MS),
      body: JSON.stringify({
        // Repli texte : c'est lui qui s'affiche dans la notification push du téléphone.
        // Le stage y vient en tête, c'est l'information la plus discriminante.
        text: `🔴 ${f.stage} — ${f.functionName}`,
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: truncate(`🔴 ${f.stage} — ${f.functionName}`, 150), emoji: true },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Mollie ID*\n\`${f.mollieId ?? '(none)'}\`` },
              { type: 'mrkdwn', text: `*Payment*\n\`${f.paymentId ?? '(none)'}\`` },
              { type: 'mrkdwn', text: `*Gym*\n${gymField}` },
            ],
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `*Detail*\n\`\`\`${detailText}\`\`\`` },
          },
        ],
      }),
    })
    // Un webhook Slack révoqué ou mal formé répond 4xx en texte brut, sans lever.
    if (!res.ok) {
      console.error('[webhook-failure] slack alert rejected (non-blocking):', res.status,
        truncate(await res.text().catch(() => ''), 300))
    }
  } catch (e) {
    console.error('[webhook-failure] slack alert threw (non-blocking):', e)
  }
}

/**
 * Dead-letter d'un échec de traitement webhook (GYM-71).
 *
 * Best-effort et NON bloquant : ne throw JAMAIS — elle est appelée DEPUIS des chemins
 * déjà en échec, et une exception ici masquerait le défaut d'origine par un second.
 *
 * Trois effets, strictement indépendants :
 *   1. écriture dans public.webhook_failures — la seule trace DURABLE, elle prime ;
 *   2. email d'alerte via Resend, si ALERT_EMAIL + RESEND_API_KEY ;
 *   3. GYM-245 — message Slack, si SLACK_ALERT_WEBHOOK_URL.
 *
 * Les alertes 2 et 3 partent EN PARALLÈLE et chacune avale ses propres erreurs : un canal
 * qui tombe n'empêche ni l'autre canal, ni l'écriture dead-letter, ni le 503 du webhook.
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

  // 2 + 3. Alertes, en parallèle. allSettled ne rejette jamais, et chaque canal avale
  // déjà ses erreurs : double ceinture, pour tenir la promesse « ne lève jamais ».
  const failure = { functionName, mollieId, paymentId, gymId, stage, detail }
  try {
    await Promise.allSettled([sendAlertEmail(failure), sendSlackAlert(failure)])
  } catch (e) {
    console.error('[webhook-failure] alerting threw (non-blocking):', e)
  }
}
