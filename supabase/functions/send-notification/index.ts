import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// GYM-246 — porte d'entrée unique du gating (GYM-245).
import { getEffectivePlan, hasFeature } from '../_shared/effective-plan.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface PushMessage {
  to: string
  title: string
  body: string
  data: Record<string, unknown>
  sound: 'default' | null
  priority: 'default' | 'normal' | 'high'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { tokens, title, body, data, priority, gym_id: gymId } = await req.json() as {
      tokens: string | string[]
      title: string
      body: string
      data?: Record<string, unknown>
      priority?: 'default' | 'normal' | 'high'
      /**
       * GYM-246 — salle au nom de laquelle la notification part. OPTIONNEL : cette
       * fonction est un tuyau appelé par d'autres, et toutes ne savent pas à quelle salle
       * elles s'adressent. Fourni ⇒ la garde s'applique ; absent ⇒ on laisse passer, la
       * décision appartient à l'appelant qui, lui, connaît la salle.
       */
      gym_id?: string
    }

    // ── GYM-246 — garde serveur : notifications, si la salle est résolue ────────
    // ⚠️ null = PANNE DE RÉSOLUTION, jamais « aucun droit » : 503, rien n'est envoyé.
    if (gymId) {
      const admin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      )
      const effectivePlan = await getEffectivePlan(admin, gymId)
      if (!effectivePlan) {
        console.error('[send-notification] plan resolution failed, gym', gymId)
        return new Response(
          JSON.stringify({ ok: false, code: 'PLAN_RESOLUTION_FAILED' }),
          { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }
      if (!hasFeature(effectivePlan, 'notifications_enabled')) {
        console.log('[plan-gate] notifications off, gym', gymId)
        return new Response(
          JSON.stringify({ ok: true, sent: 0, failed: 0, skipped: 'notifications_disabled' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }
    }

    const recipients = Array.isArray(tokens) ? tokens : [tokens]
    const validTokens = recipients.filter(Boolean)

    if (validTokens.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, sent: 0, failed: 0, skipped: recipients.length }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const messages: PushMessage[] = validTokens.map((token) => ({
      to: token,
      title,
      body,
      data: data ?? {},
      sound: 'default',
      priority: priority ?? 'high',
    }))

    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
      },
      body: JSON.stringify(messages),
    })

    // Expo a répondu non-2xx (rate-limit, panne, payload invalide…) → échec explicite
    // avec le status HTTP, pas de faux positif.
    if (!response.ok) {
      const errorText = await response.text()
      console.error('[send-notification] Expo non-2xx:', response.status, errorText)
      return new Response(
        JSON.stringify({ ok: false, error: errorText, status: response.status }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const result = await response.json()

    // Compte les tickets ok/error + nettoie les tokens morts (DeviceNotRegistered).
    // `sent` = tickets réellement acceptés ('ok'). `failed` = tickets en erreur HORS
    // DeviceNotRegistered (déjà nettoyé, considéré traité, pas un échec à alerter).
    let sent = 0
    let failed = 0
    if (Array.isArray(result.data)) {
      const admin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      )

      for (let i = 0; i < result.data.length; i++) {
        const item = result.data[i]
        if (item.status === 'ok') {
          sent++
        } else if (item.status === 'error') {
          if (item.details?.error === 'DeviceNotRegistered') {
            await admin
              .from('profiles')
              .update({ push_token: null })
              .eq('push_token', validTokens[i])
          } else {
            failed++
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ ok: true, sent, failed, results: result.data }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
