// GYM-32 — Rappels automatiques avant cours
// Appelée par pg_cron toutes les 15 min via X-Internal-Secret.
//
// TODO GYM-61 : lire gym_reminder_settings pour les intervalles et canaux configurés
// Actuellement hardcodé : 24h (email + push) / 2h (push uniquement)
//
// Shape retourné par get_pending_reminders() (confirmé prod) :
//   booking_id, member_id, gym_id, slot_id, slot_starts_at,
//   activity_name, coach_name, member_email, member_first_name, push_token, reminder_type
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// GYM-238 — chrome des emails composée depuis nexxia_gyms.
import { loadGymBranding, emailSender, emailShell, type GymBranding } from '../_shared/gym-branding.ts'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
// GYM-246 — porte d'entrée unique du gating (GYM-245).
import { getEffectivePlan, hasFeature } from '../_shared/effective-plan.ts'

const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const INTERNAL_SECRET = Deno.env.get('INTERNAL_FUNCTIONS_SECRET') ?? ''

interface PendingReminder {
  booking_id: string
  member_id: string
  gym_id: string
  slot_id: string
  slot_starts_at: string
  activity_name: string | null
  coach_name: string | null
  member_email: string | null
  member_first_name: string | null
  push_token: string | null
  reminder_type: '24h' | '2h'
}

/**
 * GYM-238 — identité de salle, mise en cache LE TEMPS D'UNE EXÉCUTION.
 *
 * ⚠️ SPÉCIFICITÉ DE CETTE FONCTION : c'est un cron qui traite un LOT de rappels, et
 * `get_pending_reminders` ne borne pas les résultats à une salle. Lire nexxia_gyms par
 * rappel ferait une requête par membre à prévenir, pour une donnée identique à tous ceux
 * de la même salle. Le cache est local à l'appel — aucun état ne survit à l'exécution,
 * donc aucun risque de servir une marque périmée au prochain passage du cron.
 */
const brandingCache = new Map<string, GymBranding>()

async function brandingFor(supabase: SupabaseClient, gymId: string): Promise<GymBranding> {
  const hit = brandingCache.get(gymId)
  if (hit) return hit
  const b = await loadGymBranding(supabase, gymId)
  brandingCache.set(gymId, b)
  return b
}

/**
 * GYM-246 — notifications autorisées ? Mis en cache LE TEMPS D'UNE EXÉCUTION, exactement
 * comme brandingCache ci-dessus et pour la même raison : `get_pending_reminders` ne borne
 * pas ses résultats à une salle, et résoudre le plan par rappel ferait un aller-retour par
 * membre à prévenir pour une réponse identique à toute la salle.
 *
 * `null` en valeur = résolution ÉCHOUÉE pour cette salle sur cette exécution. On ne la met
 * pas en cache comme un « non » : c'est une panne, et elle est retentée au passage suivant.
 */
const notificationsCache = new Map<string, boolean>()

async function notificationsAllowed(supabase: SupabaseClient, gymId: string): Promise<boolean | null> {
  const hit = notificationsCache.get(gymId)
  if (hit !== undefined) return hit
  const plan = await getEffectivePlan(supabase, gymId)
  if (!plan) return null
  const allowed = hasFeature(plan, 'notifications_enabled')
  notificationsCache.set(gymId, allowed)
  return allowed
}

async function sendReminderEmail(supabase: SupabaseClient, reminder: PendingReminder, dateStr: string, timeStr: string) {
  if (!RESEND_KEY || !reminder.member_email) return
  const activityName = reminder.activity_name ?? 'Cours'
  // GYM-229 — pas de coach, pas de ligne. Une activité en accès libre (Open Gym) n'en a
  // aucun : « Coach : — » n'informe de rien et se lit comme une donnée manquante. Le bloc
  // entier disparaît, libellé compris. (Cet email n'a pas de version texte.)
  // get_pending_reminders joint coaches en LEFT JOIN : coach_name arrive à NULL, le rappel
  // lui-même n'est jamais perdu.
  const coachLine = reminder.coach_name
    ? `<p style="color:#6B6861;">Coach : ${reminder.coach_name}</p>`
    : ''
  const gym = await brandingFor(supabase, reminder.gym_id)
  const html = emailShell(gym, {
    title: 'Rappel — votre cours demain',
    width: 480,
    bodyHtml: `<p style="color:#6B6861;">Vous avez un cours demain : <strong>${activityName}</strong> le ${dateStr} à ${timeStr}.</p>${coachLine}`,
    ctaLabel: 'Voir ma réservation',
    // 🔴 ÉTAIT `dopamine://bookings` : inerte dans tout client mail.
    ctaPath: 'bookings',
  })
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({
      from: emailSender(gym),
      to: reminder.member_email,
      subject: `Rappel — ${activityName} demain à ${timeStr}`,
      html,
    }),
  }).catch((e) => console.error('[send-reminders] email error:', e))
}

async function sendReminderPush(supabaseUrl: string, serviceKey: string, reminder: PendingReminder, timeStr: string) {
  if (!reminder.push_token) return
  const activityName = reminder.activity_name ?? 'Cours'
  const is24h = reminder.reminder_type === '24h'
  const title = is24h ? 'Rappel cours 🏋️' : "C'est bientôt ! 🏃"
  const body = is24h ? `${activityName} à ${timeStr}` : `Votre cours commence dans 2h — ${activityName}`
  await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}`,
            // GYM-282 — le tuyau exige désormais le secret interne.
            'X-Internal-Secret': Deno.env.get('INTERNAL_FUNCTIONS_SECRET') ?? '' },
    body: JSON.stringify({
      tokens: [reminder.push_token],
      // GYM-282 — `gym_id` est OBLIGATOIRE : c'est lui qui arme la garde de plan.
      gym_id: reminder.gym_id,
      title,
      body,
      data: { type: 'booking_reminder', booking_id: reminder.booking_id },
    }),
  }).catch((e) => console.error('[send-reminders] push error:', e))
}

Deno.serve(async (req) => {
  const providedSecret = req.headers.get('X-Internal-Secret')
  if (!INTERNAL_SECRET || providedSecret !== INTERNAL_SECRET) {
    console.warn('[send-reminders] Unauthorized — invalid X-Internal-Secret')
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, serviceKey)

    const { data: reminders, error } = await supabase.rpc('get_pending_reminders')
    if (error) {
      console.error('[send-reminders] RPC error:', error)
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      })
    }

    let sent = 0
    for (const r of (reminders ?? []) as PendingReminder[]) {
      try {
        // ── GYM-246 — garde serveur : notifications, par salle ──────────────────
        // Un cron ne 403 pas, il passe son tour. Le rappel n'est PAS marqué envoyé :
        // rien n'est parti, et si la salle repasse sur un plan qui les autorise avant
        // la fin de la fenêtre, le rappel part encore. `mark_reminder_sent` mentirait.
        const allowed = await notificationsAllowed(supabase, r.gym_id)
        if (allowed === null) {
          // Panne de résolution : ne JAMAIS laisser passer, ne JAMAIS lire comme un refus.
          // On saute ce rappel sans le marquer — il sera retenté au prochain passage. Le
          // reste du lot continue : une salle en panne ne doit pas priver les autres.
          console.error('[send-reminders] plan resolution failed, gym', r.gym_id, '— rappel reporté')
          continue
        }
        if (!allowed) {
          console.log('[plan-gate] notifications off, gym', r.gym_id)
          continue
        }

        const startDate = new Date(r.slot_starts_at)
        const dateStr = startDate.toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long' })
        const timeStr = startDate.toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' })

        if (r.reminder_type === '24h') {
          await sendReminderEmail(supabase, r, dateStr, timeStr)
          await sendReminderPush(supabaseUrl, serviceKey, r, timeStr)
        } else if (r.reminder_type === '2h') {
          await sendReminderPush(supabaseUrl, serviceKey, r, timeStr)
        }

        await supabase.rpc('mark_reminder_sent', {
          p_booking_id: r.booking_id,
          p_reminder_type: r.reminder_type,
        })

        sent++
      } catch (e) {
        console.error('[send-reminders] error for booking', r.booking_id, e)
      }
    }

    console.log('[send-reminders] processed:', sent, 'of', reminders?.length ?? 0)
    return new Response(JSON.stringify({ sent }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[send-reminders] uncaught:', err)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
})
