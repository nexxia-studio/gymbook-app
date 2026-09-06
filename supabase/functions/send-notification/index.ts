import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// GYM-246 — porte d'entrée unique du gating (GYM-245).
import { getEffectivePlan, hasFeature } from '../_shared/effective-plan.ts'
// GYM-282 — la garde serveur-à-serveur, partagée. Voir `_shared/internal-auth.ts`.
import { hasInternalSecret, internalUnauthorized } from '../_shared/internal-auth.ts'

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

  // ═══════════════════════════════════════════════════════════════════════════════════
  // 🔴 GYM-282 — CETTE FONCTION EST UN TUYAU, ELLE N'EST PLUS PUBLIQUEMENT JOIGNABLE.
  // ═══════════════════════════════════════════════════════════════════════════════════
  // `verify_jwt = true` vérifiait qu'un JWT existe, pas que son porteur a le droit. Or le
  // corps accepte `tokens` — des jetons Expo FOURNIS PAR L'APPELANT — et les pousse tels
  // quels : n'importe quel membre connecté, de n'importe quelle salle, pouvait faire partir
  // une notification vers n'importe quel jeton qu'il connaissait, avec le titre et le corps
  // de son choix.
  //
  // ⚠️ LA GARDE VIENT AVANT TOUTE LECTURE DU CORPS. Analyser le JSON d'un appelant non
  // authentifié, c'est lui offrir une surface d'analyse gratuite — et un message d'erreur
  // de parsing qui lui apprend qu'il a atteint la fonction.
  //
  // ⚠️ ET ELLE ARRIVE APRÈS LE PREFLIGHT CORS, à dessein : un OPTIONS n'a pas d'en-tête
  // personnalisé, le refuser casserait les appels légitimes sans rien protéger.
  if (!hasInternalSecret(req)) return internalUnauthorized('send-notification')

  try {
    const { tokens, title, body, data, priority, gym_id: gymId } = await req.json() as {
      tokens: string | string[]
      title: string
      body: string
      data?: Record<string, unknown>
      priority?: 'default' | 'normal' | 'high'
      /**
       * 🔴 GYM-282 — DEVENU OBLIGATOIRE. Il était optionnel « parce que toutes les
       * fonctions ne savent pas à quelle salle elles s'adressent » — et l'omettre
       * DÉSACTIVAIT la garde de plan de GYM-246. C'était la seule vérification de cette
       * fonction, et un appelant pouvait s'en dispenser en ne renseignant rien.
       *
       * Vérifié : les dix appelants du dépôt connaissent tous leur salle. L'exception que
       * l'optionalité protégeait n'existait pas.
       */
      gym_id: string
    }

    // 🔴 GYM-282 — SANS SALLE, ON N'ENVOIE RIEN. Le refus est explicite plutôt que
    // silencieux : un appelant qui oublie `gym_id` doit le savoir au premier essai, pas
    // découvrir six mois plus tard que ses notifications contournaient le gating.
    if (!gymId) {
      console.error('[send-notification] gym_id manquant')
      return new Response(
        JSON.stringify({ ok: false, code: 'GYM_ID_REQUIRED' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── GYM-246 — garde serveur : notifications, si la salle est résolue ────────
    // ⚠️ null = PANNE DE RÉSOLUTION, jamais « aucun droit » : 503, rien n'est envoyé.
    {
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
