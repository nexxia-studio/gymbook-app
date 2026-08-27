// GYM-143 — Annulation d'un cours par le gérant (gym_admin / super_admin).
//
// Le gérant annule un créneau depuis /planning (coach malade, etc.). Cette fonction :
//  - vérifie que l'appelant gère bien la salle du créneau (gym_id jamais pris du body) ;
//  - refuse d'annuler un créneau déjà commencé / passé (422) ;
//  - délègue TOUT le travail transactionnel à cancel_slot_atomic (annulation, recrédit
//    exact, purge waitlist) — service_role ;
//  - notifie chaque inscrit (push Expo + email Resend brandé), best-effort et jamais
//    bloquant (pattern GYM-134 : une notification qui échoue n'annule pas l'annulation).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// GYM-238 — en-tête, pied, bouton et expéditeur composés depuis nexxia_gyms.
import { loadGymBranding, emailSender, emailShell, type GymBranding } from '../_shared/gym-branding.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''

interface AffectedMember {
  user_id: string
  email: string | null
  first_name: string | null
  push_token: string | null
  credit_refunded: boolean
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

function cancelEmailHtml(
  gym: GymBranding,
  firstName: string | null,
  activityName: string,
  dateStr: string,
  timeStr: string,
  reason: string | null,
  creditRefunded: boolean,
): string {
  const greeting = firstName ? `Bonjour ${firstName},` : 'Bonjour,'
  const reasonBlock = reason
    ? `<p style="color:#3D3B36;font-size:14px;line-height:1.6;margin:0 0 12px;">Motif : ${reason}</p>`
    : ''
  const creditBlock = creditRefunded
    ? `<p style="color:#3D3B36;font-size:14px;line-height:1.6;margin:0 0 12px;">Bonne nouvelle : ton crédit t'a été rendu, tu peux réserver un autre cours.</p>`
    : ''
  // GYM-238 — le corps seul ; l'en-tête (logo ou nom de la salle), le pied (adresse
  // composée en base) et le bouton sont rendus par la coquille partagée.
  return emailShell(gym, {
    emoji: '⚠️',
    title: 'Cours annulé',
    bodyHtml:
      `<p style="color:#9A9890;font-size:13px;margin:0 0 20px;">${greeting}</p>` +
      `<p style="color:#3D3B36;font-size:14px;line-height:1.6;margin:0 0 12px;">Ton cours <strong>${activityName}</strong> du ${dateStr} à ${timeStr} a été annulé.</p>` +
      reasonBlock + creditBlock,
    ctaLabel: 'Voir le planning →',
    // 🔴 ÉTAIT `dopamine://bookings` : inerte dans tout client mail. Universal Link.
    ctaPath: 'bookings',
  })
}

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
    const { slot_id: slotId, reason: rawReason } = await req.json() as { slot_id?: string; reason?: string }
    if (!slotId) return errorResponse(400, 'MISSING_SLOT_ID', 'slot_id requis')
    const reason = rawReason?.trim() || null

    // 3. Charger le créneau : appartenance au gym de l'appelant + contrôle temporel.
    const { data: slot } = await admin
      .from('time_slots')
      .select('id, gym_id, starts_at, status, activities(name)')
      .eq('id', slotId)
      .single()

    if (!slot) return errorResponse(404, 'SLOT_NOT_FOUND', 'Créneau introuvable')
    if (slot.gym_id !== adminProfile.gym_id) return errorResponse(403, 'WRONG_GYM', 'Créneau hors de votre salle')
    if (new Date(slot.starts_at) <= new Date()) {
      return errorResponse(422, 'SLOT_STARTED', 'Un créneau déjà commencé ou passé ne peut pas être annulé ici')
    }

    // L'embed to-one `activities(name)` est typé en tableau par le client généré ;
    // à l'exécution Supabase renvoie un objet unique → tolérer les deux formes.
    const act = slot.activities as unknown as { name: string } | { name: string }[] | null
    const activityName = (Array.isArray(act) ? act[0]?.name : act?.name) ?? 'Cours'

    // 4. Annulation atomique (recrédit exact + purge waitlist) déléguée au RPC.
    const { data: result, error: rpcError } = await admin.rpc('cancel_slot_atomic', {
      p_slot_id: slotId,
      p_reason: reason,
    })

    if (rpcError) {
      console.error('[cancel-slot] cancel_slot_atomic failed:', rpcError)
      return errorResponse(500, 'CANCEL_FAILED', rpcError.message)
    }

    // Déjà annulé (double-clic) → rien à notifier.
    if (result?.status === 'already_cancelled') {
      return jsonResponse({ ...result, notified: 0 })
    }

    // 5. Notifications best-effort (jamais bloquantes).
    const affected = (result?.affected_members ?? []) as AffectedMember[]
    const startDate = new Date(slot.starts_at)
    const dateStr = startDate.toLocaleDateString('fr-BE', {
      timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long',
    })
    const timeStr = startDate.toLocaleTimeString('fr-BE', {
      timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit',
    })

    // GYM-238 — UNE seule lecture de l'identité de la salle pour tout le lot d'emails,
    // hors de la boucle : la relire par destinataire ferait N requêtes pour une donnée qui
    // ne change pas d'un membre à l'autre.
    const gym = await loadGymBranding(admin, adminProfile.gym_id as string)

    let notified = 0
    for (const m of affected) {
      let reached = false

      // 5a. Push Expo (via send-notification, même canal que les autres fonctions).
      if (m.push_token) {
        try {
          const pushBody = `${activityName} du ${dateStr} à ${timeStr} est annulé.${m.credit_refunded ? ' Ton crédit t\'a été rendu.' : ''}`
          const resp = await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}`,
            // GYM-282 — le tuyau exige désormais le secret interne.
            'X-Internal-Secret': Deno.env.get('INTERNAL_FUNCTIONS_SECRET') ?? '' },
            body: JSON.stringify({
              tokens: [m.push_token],
              // GYM-282 — `gym_id` est OBLIGATOIRE : c'est lui qui arme la garde de plan.
              gym_id: slot.gym_id,
              title: 'Cours annulé',
              body: pushBody,
              data: { type: 'slot_cancelled', slot_id: slotId },
            }),
          })
          const pushResult = await resp.json().catch(() => null)
          if (pushResult?.ok === true && (pushResult?.sent ?? 0) >= 1) reached = true
        } catch (e) {
          console.error('[cancel-slot] push error:', m.user_id, e)
        }
      }

      // 5b. Email Resend brandé Dopamine.
      if (RESEND_KEY && m.email) {
        try {
          const resp = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
            body: JSON.stringify({
              from: emailSender(gym),
              to: m.email,
              subject: `Cours annulé — ${activityName} du ${dateStr}`,
              html: cancelEmailHtml(gym, m.first_name, activityName, dateStr, timeStr, reason, m.credit_refunded),
            }),
          })
          if (resp.ok) reached = true
          else console.error('[cancel-slot] email failed:', m.user_id, resp.status, await resp.text())
        } catch (e) {
          console.error('[cancel-slot] email error:', m.user_id, e)
        }
      }

      if (reached) notified++
    }

    return jsonResponse({ ...result, notified })
  } catch (err) {
    console.error('[cancel-slot] uncaught:', err)
    return errorResponse(500, 'SERVER_ERROR', (err as Error).message)
  }
})
