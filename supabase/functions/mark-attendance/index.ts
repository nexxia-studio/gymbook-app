// GYM-174 — Pointage des présences par le gérant (gym_admin / super_admin).
//
// INVERSION : non pointé = présent. Le gérant pointe depuis /planning. Deux actions :
//   - 'mark'   : change le statut d'UNE réservation ('attended' | 'no_show' | 'excused')
//                via mark_attendance_atomic (crédit + pénalités atomiques). Si la RPC
//                applique une SUSPENSION, on notifie le membre (push Expo + email Resend
//                brandé Dopamine), best-effort et jamais bloquant (pattern cancel-slot).
//   - 'walkin' : inscription à la volée d'un membre présent au comptoir → create_booking_atomic
//                (capacité/crédit/abonnement) puis mark_attendance_atomic(..,'attended').
//
// gym_id n'est JAMAIS pris du body : il vient du profil de l'appelant (isolation multi-tenant).
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''

type AttendanceStatus = 'attended' | 'no_show' | 'excused'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function errorResponse(status: number, code: string, message?: string) {
  return jsonResponse({ error: true, code, message: message ?? code }, status)
}

function suspensionEmailHtml(
  firstName: string | null,
  activityName: string,
  dateStr: string,
  untilStr: string,
  isLong: boolean,
): string {
  const greeting = firstName ? `Bonjour ${firstName},` : 'Bonjour,'
  const durationLabel = isLong ? '2 semaines' : '48h'
  return `<div style="font-family:'DM Sans','Helvetica Neue',Arial,sans-serif;background:#F5F4F0;padding:40px 20px;"><div style="max-width:520px;margin:0 auto;"><div style="background:#111111;padding:24px;border-radius:16px 16px 0 0;text-align:center;"><span style="font-family:'Arial Black',Arial,sans-serif;color:#C8F000;font-size:24px;letter-spacing:2px;">DOPAMINE</span></div><div style="background:#FFFFFF;padding:32px 28px;border-radius:0 0 16px 16px;"><div style="font-size:28px;margin-bottom:12px;">⚠️</div><h2 style="margin:0 0 8px;color:#111111;font-size:20px;">Compte suspendu ${durationLabel}</h2><p style="color:#9A9890;font-size:13px;margin:0 0 20px;">${greeting}</p><p style="color:#3D3B36;font-size:14px;line-height:1.6;margin:0 0 12px;">Une absence a été enregistrée pour ton cours <strong>${activityName}</strong> du ${dateStr}. Suite à tes absences répétées, ton compte est suspendu jusqu'au <strong>${untilStr}</strong>.</p><p style="color:#3D3B36;font-size:14px;line-height:1.6;margin:0 0 12px;">Tu ne pourras pas réserver de cours pendant cette période. Pour toute question, contacte l'accueil de ta salle.</p></div><p style="text-align:center;color:#9A9890;font-size:11px;margin:16px 0 0;">Dopamine Performance Club · Neupré</p></div></div>`
}

// Notifie best-effort le membre suspendu (push + email). Ne lève jamais.
async function notifySuspension(
  admin: SupabaseClient,
  supabaseUrl: string,
  serviceKey: string,
  bookingId: string,
  penaltyType: string,
  expiresAt: string | null,
) {
  try {
    const { data: booking } = await admin
      .from('bookings')
      .select('member_id, time_slots(starts_at, activities(name))')
      .eq('id', bookingId)
      .single()
    if (!booking) return

    const { data: profile } = await admin
      .from('profiles')
      .select('email, first_name, push_token')
      .eq('id', booking.member_id)
      .single()
    if (!profile) return

    // L'embed to-one est typé en tableau par le client généré ; à l'exécution Supabase
    // renvoie un objet unique → passer par unknown puis tolérer les deux formes.
    const rawSlot = booking.time_slots as unknown as
      | { starts_at: string; activities: { name: string } | { name: string }[] | null }
      | { starts_at: string; activities: { name: string } | { name: string }[] | null }[]
      | null
    const slot = Array.isArray(rawSlot) ? rawSlot[0] ?? null : rawSlot
    const act = slot?.activities ?? null
    const activityName = (Array.isArray(act) ? act[0]?.name : act?.name) ?? 'Cours'
    const dateStr = slot?.starts_at
      ? new Date(slot.starts_at).toLocaleDateString('fr-BE', {
          timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long',
        })
      : '—'
    const untilStr = expiresAt
      ? new Date(expiresAt).toLocaleDateString('fr-BE', {
          timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
        })
      : '—'
    const isLong = penaltyType === 'suspension_2w'

    if (profile.push_token) {
      await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({
          tokens: [profile.push_token],
          title: `Compte suspendu ${isLong ? '2 semaines' : '48h'} ⚠️`,
          body: `Absence enregistrée — ${activityName}. Suspendu jusqu'au ${untilStr}.`,
          data: { type: 'noshow_penalty', booking_id: bookingId },
        }),
      }).catch((e) => console.error('[mark-attendance] push error:', e))
    }

    if (RESEND_KEY && profile.email) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
        body: JSON.stringify({
          from: 'Dopamine Performance Club <noreply@viniz.app>',
          to: profile.email,
          subject: `Compte suspendu ${isLong ? '2 semaines' : '48h'} — Dopamine`,
          html: suspensionEmailHtml(profile.first_name, activityName, dateStr, untilStr, isLong),
        }),
      }).catch((e) => console.error('[mark-attendance] email error:', e))
    }
  } catch (e) {
    console.error('[mark-attendance] notifySuspension uncaught:', e)
  }
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
    const gymId = adminProfile.gym_id as string

    const body = await req.json().catch(() => null) as
      | { action?: string; booking_id?: string; status?: string; slot_id?: string; member_id?: string }
      | null
    if (!body?.action) return errorResponse(400, 'MISSING_ACTION', 'action requise (mark | walkin)')

    // ────────────────────────────────────────────────────────────────────────
    // ACTION 'mark' — changer le statut d'une réservation existante.
    // ────────────────────────────────────────────────────────────────────────
    if (body.action === 'mark') {
      const bookingId = body.booking_id
      const status = body.status as AttendanceStatus | undefined
      if (!bookingId) return errorResponse(400, 'MISSING_BOOKING_ID', 'booking_id requis')
      if (!status || !['attended', 'no_show', 'excused'].includes(status)) {
        return errorResponse(400, 'INVALID_STATUS', "status doit être 'attended', 'no_show' ou 'excused'")
      }

      // Appartenance : la réservation doit être dans la salle de l'appelant.
      const { data: booking } = await admin
        .from('bookings')
        .select('id, gym_id, status')
        .eq('id', bookingId)
        .single()
      if (!booking) return errorResponse(404, 'BOOKING_NOT_FOUND', 'Réservation introuvable')
      if (booking.gym_id !== gymId) return errorResponse(403, 'WRONG_GYM', 'Réservation hors de votre salle')

      const { data: result, error: rpcError } = await admin.rpc('mark_attendance_atomic', {
        p_booking_id: bookingId,
        p_new_status: status,
      })

      if (rpcError) {
        const msg = rpcError.message ?? ''
        if (msg.includes('INVALID_SOURCE_STATUS')) {
          return errorResponse(422, 'INVALID_SOURCE_STATUS', 'Cette réservation ne peut pas être pointée (annulée / liste d\'attente)')
        }
        if (msg.includes('INVALID_STATUS')) return errorResponse(400, 'INVALID_STATUS', msg)
        if (msg.includes('BOOKING_NOT_FOUND')) return errorResponse(404, 'BOOKING_NOT_FOUND', 'Réservation introuvable')
        console.error('[mark-attendance] mark_attendance_atomic failed:', rpcError)
        return errorResponse(500, 'MARK_FAILED', msg)
      }

      // Notification best-effort UNIQUEMENT si une suspension vient d'être appliquée.
      const penalty = (result?.penalty ?? null) as
        | { action?: string; type?: string; expires_at?: string | null }
        | null
      if (penalty?.action === 'applied' && penalty.expires_at) {
        await notifySuspension(admin, supabaseUrl, serviceKey, bookingId, penalty.type ?? 'suspension_48h', penalty.expires_at)
      }

      return jsonResponse({ ...result })
    }

    // ────────────────────────────────────────────────────────────────────────
    // ACTION 'walkin' — inscrire un membre présent au comptoir puis le pointer présent.
    // ────────────────────────────────────────────────────────────────────────
    if (body.action === 'walkin') {
      const slotId = body.slot_id
      const memberId = body.member_id
      if (!slotId || !memberId) return errorResponse(400, 'MISSING_PARAMS', 'slot_id et member_id requis')

      // 1. Le membre doit appartenir à la salle de l'appelant.
      const { data: member } = await admin
        .from('profiles')
        .select('id, gym_id, role')
        .eq('id', memberId)
        .single()
      if (!member || member.gym_id !== gymId) {
        return errorResponse(403, 'WRONG_GYM', 'Membre hors de votre salle')
      }

      // 2. Le créneau : appartenance + non annulé + pas terminé depuis longtemps.
      const { data: slot } = await admin
        .from('time_slots')
        .select('id, gym_id, status, ends_at')
        .eq('id', slotId)
        .single()
      if (!slot) return errorResponse(404, 'SLOT_NOT_FOUND', 'Créneau introuvable')
      if (slot.gym_id !== gymId) return errorResponse(403, 'WRONG_GYM', 'Créneau hors de votre salle')
      if (slot.status === 'cancelled') return errorResponse(422, 'SLOT_CANCELLED', 'Créneau annulé')
      if (new Date(slot.ends_at) < new Date(Date.now() - 24 * 60 * 60 * 1000)) {
        return errorResponse(422, 'SLOT_TOO_OLD', 'Créneau terminé depuis trop longtemps')
      }

      // 3. Réservation existante ? confirmed/waitlisted → déjà inscrit ; cancelled → réactiver.
      const { data: existingRows } = await admin
        .from('bookings')
        .select('id, status')
        .eq('member_id', memberId)
        .eq('slot_id', slotId)
        .limit(1)
      const existing = existingRows?.[0] ?? null
      if (existing?.status === 'confirmed' || existing?.status === 'waitlisted') {
        return errorResponse(409, 'ALREADY_BOOKED', 'Membre déjà inscrit à ce créneau')
      }
      // Déjà pointé (attended/no_show/excused) → on repointe simplement présent.
      if (existing && ['attended', 'no_show', 'excused'].includes(existing.status)) {
        const { data: remark, error: remarkErr } = await admin.rpc('mark_attendance_atomic', {
          p_booking_id: existing.id,
          p_new_status: 'attended',
        })
        if (remarkErr) return errorResponse(500, 'MARK_FAILED', remarkErr.message)
        return jsonResponse({ status: 'walkin', booking_id: existing.id, attendance: remark, reused: true })
      }

      // 4. Abonnement actif ? (détermine le débit crédit dans la RPC).
      const { data: activeSub } = await admin
        .from('member_subscriptions')
        .select('id')
        .eq('member_id', memberId)
        .eq('gym_id', gymId)
        .eq('status', 'active')
        .maybeSingle()

      // 5. Création atomique (capacité + débit crédit).
      const { data: created, error: createErr } = await admin.rpc('create_booking_atomic', {
        p_member_id: memberId,
        p_slot_id: slotId,
        p_gym_id: gymId,
        p_has_subscription: !!activeSub,
        p_existing_booking_id: existing?.status === 'cancelled' ? existing.id : null,
      })

      if (createErr) {
        if ((createErr.message ?? '').includes('NO_CREDIT')) {
          return errorResponse(402, 'NO_CREDIT', 'Aucun crédit disponible pour ce membre')
        }
        console.error('[mark-attendance] create_booking_atomic failed:', createErr)
        return errorResponse(500, 'BOOKING_FAILED', createErr.message)
      }
      if (created?.status === 'full') {
        return errorResponse(409, 'FULL', 'Créneau complet')
      }

      // 6. Pointer présent immédiatement.
      const { data: attendance, error: markErr } = await admin.rpc('mark_attendance_atomic', {
        p_booking_id: created.booking_id,
        p_new_status: 'attended',
      })
      if (markErr) {
        console.error('[mark-attendance] walk-in mark failed:', markErr)
        return errorResponse(500, 'MARK_FAILED', markErr.message)
      }

      return jsonResponse({ status: 'walkin', booking_id: created.booking_id, attendance })
    }

    return errorResponse(400, 'UNKNOWN_ACTION', `Action inconnue : ${body.action}`)
  } catch (err) {
    console.error('[mark-attendance] uncaught:', err)
    return errorResponse(500, 'SERVER_ERROR', (err as Error).message)
  }
})
