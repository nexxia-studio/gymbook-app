// GYM-226 — Inscription d'un membre à un cours FUTUR par le gérant (gym_admin / super_admin).
//
// POURQUOI UNE FONCTION DÉDIÉE PLUTÔT QUE create-booking.
// create-booking est le chemin LIBRE-SERVICE : le membre se réserve lui-même. Toute sa
// sécurité tient en une phrase — « le sujet de la réservation EST le porteur du jeton » —
// et chacune de ses gardes lit `user.id`. Ici l'acteur et le sujet sont deux personnes
// différentes : le gérant agit pour un tiers. Y greffer un `member_id` optionnel obligerait
// à faire diverger l'identité du sujet de celle de l'appelant dans une dizaine d'endroits
// d'une fonction qui est, à ce jour, LE SEUL chemin de réservation en production (iOS).
// Le dépôt tranche déjà ainsi : admin-create-member, admin-update-member, admin-sell-plan
// et admin-lift-suspension sont autant de fonctions `admin-*` distinctes de leur pendant
// membre, toutes en service_role, toutes avec gym_id lu sur le profil de l'appelant.
//
// ⚠️ SÉPARER LES FONCTIONS N'EST PAS ASSOUPLIR LES RÈGLES. Les gardes de create-booking
// sont rejouées ici UNE PAR UNE et DANS LE MÊME ORDRE, via _shared/booking-guards.ts (les
// quatre lectures sont littéralement le même code). Ce qui change relève de l'acteur, pas
// de la règle : contrôle de rôle en tête, et refus d'un créneau PASSÉ.
//
// ⚠️ CE N'EST PAS LE WALK-IN. mark-attendance action 'walkin' inscrit ET pointe présent un
// membre debout au comptoir, pour un cours en cours. L'appliquer à un cours de la semaine
// prochaine marquerait quelqu'un « présent » à un cours qui n'a pas eu lieu. Cette fonction
// ne pointe RIEN : elle crée une réservation, comme l'app membre le ferait.
//
// DÉCISION PRODUIT (Antoine, 14/08) : le plafond de réservations (GYM-196) S'APPLIQUE aussi
// quand c'est le gérant qui inscrit — « sinon la règle ne veut plus rien dire ». C'est la
// différence assumée avec le walk-in, qui l'omet volontairement (le membre y est
// physiquement présent). Le refus est explicite ; il n'existe aucun contournement silencieux.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  checkMemberQuota,
  countFutureConfirmedBookings,
  hasActiveSubscription,
  hasAvailableCredits,
} from '../_shared/booking-guards.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''

interface BookMemberRequest {
  slot_id?: string
  member_id?: string
  /** Le gérant a VU que le cours est complet et accepte la liste d'attente (cf. FULL). */
  allow_waitlist?: boolean
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

// L'embed to-one (activities, coaches) est typé en TABLEAU par le client généré ; à
// l'exécution PostgREST renvoie un objet unique. Même contournement que mark-attendance :
// passer par unknown, puis tolérer les deux formes.
function embeddedName(rel: unknown, fallback: string): string {
  const value = rel as { name?: string } | { name?: string }[] | null
  const one = Array.isArray(value) ? value[0] ?? null : value
  return one?.name ?? fallback
}

// Confirmation au membre — MÊME courrier que le libre-service (create-booking).
//
// ⚠️ L'EMAIL N'EST PAS UN DÉTAIL SUR CE CHEMIN. GYM-226 existe pour les membres qui ne
// peuvent PAS utiliser l'app (Android, publication à ~3 semaines) : ils n'ont ni écran de
// réservation ni notification push. Le mail est leur seule trace de l'inscription.
// Best-effort et jamais bloquant : la réservation est faite, un mail perdu ne l'annule pas.
async function notifyMember(
  supabaseUrl: string,
  serviceKey: string,
  member: { email: string | null; first_name: string | null; push_token: string | null },
  activityName: string,
  coachName: string,
  startsAt: string,
) {
  const startDate = new Date(startsAt)
  const dateStr = startDate.toLocaleDateString('fr-BE', {
    timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long',
  })
  const timeStr = startDate.toLocaleTimeString('fr-BE', {
    timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit',
  })

  if (member.push_token) {
    await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({
        tokens: [member.push_token],
        title: 'Inscription confirmée',
        body: `${activityName} — ${dateStr} à ${timeStr}. Inscrit par ta salle.`,
        data: { type: 'booking_confirmed' },
      }),
    }).catch((e) => console.error('[admin-book-member] push error:', e))
  }

  if (RESEND_KEY && member.email) {
    const greeting = member.first_name ? `Bonjour ${member.first_name},` : 'Bonjour,'
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({
        from: 'Dopamine <noreply@viniz.app>',
        to: member.email,
        subject: `Réservation confirmée — ${activityName}`,
        html: `<div style="font-family:'DM Sans','Helvetica Neue',Arial,sans-serif;background:#F5F4F0;padding:40px 20px;"><div style="max-width:480px;margin:0 auto;"><div style="background:#111111;padding:24px;border-radius:16px 16px 0 0;text-align:center;"><span style="font-family:'Arial Black',Arial,sans-serif;color:#C8F000;font-size:24px;letter-spacing:2px;">DOPAMINE</span></div><div style="background:#FFFFFF;padding:32px 24px;border-radius:0 0 16px 16px;"><h2 style="margin:0 0 16px;color:#111111;">Réservation confirmée</h2><p style="color:#9A9890;font-size:13px;margin:0 0 16px;">${greeting}</p><p style="color:#3D3B36;font-size:14px;line-height:1.6;margin:0 0 16px;">Ta salle t'a inscrit à ce cours :</p><p style="color:#6B6861;margin:0 0 8px;"><strong>${activityName}</strong></p><p style="color:#6B6861;margin:0 0 4px;">${dateStr} à ${timeStr}</p><p style="color:#9A9890;margin:0 0 24px;">Coach: ${coachName}</p><p style="color:#9A9890;font-size:12px;margin:0;">Tu ne peux pas venir ? Préviens l'accueil de ta salle.</p></div></div></div>`,
      }),
    }).catch((e) => console.error('[admin-book-member] email error:', e))
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(supabaseUrl, serviceKey)

    // ── GARDE 0 (propre au chemin gérant) — auth appelant + rôle. ──────────────
    // Absente de create-booking, où l'appelant EST le sujet. Ici elle est la première
    // chose vérifiée : sans elle, n'importe quel membre inscrirait n'importe qui.
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
    // gym_id lu sur le PROFIL de l'appelant, JAMAIS du body : isolation multi-tenant
    // (même règle que mark-attendance et admin-lift-suspension).
    if (!adminProfile.gym_id) return errorResponse(400, 'NO_GYM', 'Aucune salle associée à ce compte')
    const gymId = adminProfile.gym_id as string

    const body = await req.json().catch(() => null) as BookMemberRequest | null
    const slotId = body?.slot_id
    const memberId = body?.member_id
    if (!slotId) return errorResponse(400, 'MISSING_SLOT_ID', 'slot_id requis')
    if (!memberId) return errorResponse(400, 'MISSING_MEMBER_ID', 'member_id requis')

    // ── GARDE 1 — le sujet : membre de CETTE salle, non supprimé. ──────────────
    // Équivalent du « profil introuvable » de create-booking, doublé des contrôles
    // d'appartenance qu'un chemin agissant sur un tiers impose (modèle admin-lift-suspension).
    const { data: member } = await admin
      .from('profiles')
      .select('id, gym_id, role, deleted_at, suspended_until, first_name, last_name, email, push_token')
      .eq('id', memberId)
      .single()

    if (!member) return errorResponse(404, 'MEMBER_NOT_FOUND', 'Membre introuvable')
    if (member.gym_id !== gymId) return errorResponse(403, 'WRONG_GYM', 'Membre hors de votre salle')
    if (member.role !== 'member') return errorResponse(403, 'NOT_A_MEMBER', 'Seuls les comptes membres sont concernés')
    if (member.deleted_at) return errorResponse(409, 'MEMBER_DELETED', 'Compte supprimé')

    // ── GARDE 2 — suspension no-show (create-booking étape 3, à l'identique). ──
    // ⚠️ ON NE CONTOURNE PAS. Le refus est ferme, et il porte l'échéance pour que le
    // dashboard puisse proposer le geste NOMMÉ ET TRACÉ qui existe déjà :
    // admin-lift-suspension (GYM-204, motif obligatoire + journal gym_admin_actions).
    // Lever puis inscrire, c'est deux décisions dont l'une laisse une trace — pas un trou.
    const suspendedUntil = member.suspended_until as string | null
    if (suspendedUntil !== null && new Date(suspendedUntil) > new Date()) {
      return jsonResponse({
        error: true,
        code: 'SUSPENDED',
        message: 'Membre suspendu pour no-show',
        suspended_until: suspendedUntil,
      }, 403)
    }

    // ── GARDE 3 — le créneau (create-booking étape 4, à l'identique). ──────────
    const { data: slot } = await admin
      .from('time_slots')
      // bookings_count : occupation courante, consignée au journal (cf. plus bas). Lue ici,
      // AVANT l'insert, sinon le trigger trg_update_bookings_count l'aura déjà incrémentée.
      .select('id, gym_id, starts_at, ends_at, capacity, bookings_count, status, activities(name), coaches(name)')
      .eq('id', slotId)
      .single()

    if (!slot) return errorResponse(404, 'SLOT_NOT_FOUND', 'Créneau introuvable')
    if (slot.gym_id !== gymId) return errorResponse(403, 'WRONG_GYM', 'Créneau hors de votre salle')
    if (slot.status === 'cancelled') return errorResponse(422, 'SLOT_CANCELLED', 'Créneau annulé')
    // Créneau PASSÉ : refus net. Ce n'est pas ce geste-ci qu'il faut, c'est le walk-in
    // (mark-attendance) — inscrire quelqu'un « pour plus tard » à un cours déjà tenu
    // produirait une réservation qui ne sera jamais pointée. Même garde que
    // create-booking (SLOT_PAST), sur la même comparaison.
    if (new Date(slot.starts_at) < new Date()) {
      return errorResponse(422, 'SLOT_PAST', 'Créneau déjà passé')
    }

    // ── GARDE 4 — quota de membres du plan Viniz (create-booking étape 4b). ────
    const quotaCheck = await checkMemberQuota(admin, gymId)
    if (!quotaCheck.allowed) {
      return errorResponse(403, quotaCheck.reason ?? 'FORBIDDEN', 'Limite de membres atteinte sur ce plan Viniz')
    }

    // ── GARDE 5 — déjà inscrit ? (create-booking étape 5, à l'identique). ──────
    const { data: existingRows } = await admin
      .from('bookings')
      .select('id, status')
      .eq('member_id', memberId)
      .eq('slot_id', slotId)
      .limit(1)

    const existingBooking = existingRows?.[0] ?? null

    if (existingBooking?.status === 'confirmed') {
      return errorResponse(409, 'ALREADY_BOOKED', 'Membre déjà inscrit à ce créneau')
    }
    if (existingBooking?.status === 'waitlisted') {
      return errorResponse(409, 'ALREADY_WAITLISTED', "Membre déjà en liste d'attente")
    }
    // Un créneau futur ne peut pas porter de réservation pointée : seul 'cancelled'
    // subsiste ici, et il sera RÉACTIVÉ (pas dupliqué) par la RPC.

    // ── GARDE 6 — plafond de réservations à venir (GYM-196). ───────────────────
    // ⚠️ APPLIQUÉE ICI, contrairement au walk-in qui l'omet volontairement. Décision
    // produit d'Antoine : la règle vaut aussi quand c'est le gérant qui inscrit. Le
    // plafond vient du gym DU CRÉNEAU et a déjà été lu par checkMemberQuota — aucune
    // requête supplémentaire. `limit` est renvoyé pour que le dashboard nomme le nombre.
    const maxActiveBookings = quotaCheck.maxActiveBookings
    if (maxActiveBookings !== null) {
      const futureCount = await countFutureConfirmedBookings(admin, memberId)
      if (futureCount >= maxActiveBookings) {
        return jsonResponse({
          error: true,
          code: 'MAX_BOOKINGS_REACHED',
          message: `Maximum ${maxActiveBookings} réservations simultanées`,
          limit: maxActiveBookings,
        }, 400)
      }
    }

    // ── GARDE 7 — abonnement OU crédit (GYM-63, create-booking à l'identique). ─
    const activeSubscription = await hasActiveSubscription(admin, memberId, gymId)
    const creditsAvailable = await hasAvailableCredits(admin, memberId, gymId)

    if (!activeSubscription && !creditsAvailable) {
      // Refus explicite. Le geste suivant existe et le dashboard l'enchaîne : vendre une
      // formule depuis la fiche membre (admin-sell-plan, GYM-222).
      return jsonResponse({
        error: true,
        code: 'PAYMENT_REQUIRED',
        message: 'Abonnement ou crédit requis pour réserver ce cours',
      }, 402)
    }

    // ── CAPACITÉ + INSERTION + DÉBIT — create_booking_atomic (GYM-70). ─────────
    // Verrou FOR UPDATE sur la ligne du créneau, COUNT live des confirmées sous verrou,
    // insertion ou réactivation, débit FIFO du crédit dans LA MÊME transaction
    // (NO_CREDIT annule tout). Aucun de ces contrôles n'est rejoué ici : la RPC est
    // l'autorité sur la dernière place.
    const { data: rpcResult, error: rpcError } = await admin.rpc('create_booking_atomic', {
      p_member_id: memberId,
      p_slot_id: slotId,
      p_gym_id: gymId,
      p_has_subscription: activeSubscription,
      p_existing_booking_id: existingBooking?.status === 'cancelled' ? existingBooking.id : null,
    })

    if (rpcError) {
      const msg = rpcError.message ?? ''
      // Course rare : le dernier crédit consommé entre la garde 7 et la RPC.
      if (msg.includes('NO_CREDIT')) {
        return errorResponse(402, 'NO_CREDIT', 'Aucun crédit disponible pour ce membre')
      }
      if (msg.includes('SLOT_NOT_FOUND')) {
        return errorResponse(404, 'SLOT_NOT_FOUND', 'Créneau introuvable')
      }
      console.error('[admin-book-member] create_booking_atomic failed:', rpcError)
      return errorResponse(500, 'BOOKING_FAILED', msg)
    }

    // ── COMPLET → on PROPOSE la liste d'attente, on ne l'impose jamais. ────────
    // Différence assumée avec create-booking, qui bascule en liste d'attente sans rien
    // demander : là-bas le membre décide pour lui-même et voit sa position. Ici le gérant
    // décide POUR QUELQU'UN D'AUTRE — inscrire d'office en liste d'attente quelqu'un qui
    // croit avoir sa place serait lui promettre un cours qu'il n'a pas. Premier appel :
    // refus porteur de la position qu'il OCCUPERAIT. Second appel, si le gérant confirme :
    // allow_waitlist = true.
    if (rpcResult?.status === 'full') {
      const { count: waitlistCount } = await admin
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('slot_id', slotId)
        .eq('status', 'waitlisted')

      const position = (waitlistCount ?? 0) + 1

      if (!body?.allow_waitlist) {
        return jsonResponse({
          error: true,
          code: 'FULL',
          message: 'Créneau complet',
          waitlist_position: position,
        }, 409)
      }

      // Chemin liste d'attente — AUCUN débit de crédit (comme create-booking : le crédit
      // ne part qu'à la confirmation du siège, via promote_waitlist_atomic).
      let booking
      let insertErr
      if (existingBooking?.status === 'cancelled') {
        const res = await admin
          .from('bookings')
          .update({
            status: 'waitlisted', waitlist_position: position,
            cancelled_at: null, cancel_reason: null, is_late_cancel: false,
          })
          .eq('id', existingBooking.id)
          .select()
          .single()
        booking = res.data; insertErr = res.error
      } else {
        const res = await admin
          .from('bookings')
          .insert({
            member_id: memberId, slot_id: slotId, gym_id: gymId,
            status: 'waitlisted', waitlist_position: position,
            idempotency_key: `${memberId}-${slotId}`,
          })
          .select()
          .single()
        booking = res.data; insertErr = res.error
      }

      if (insertErr) {
        console.error('[admin-book-member] waitlist insert failed:', insertErr)
        return errorResponse(500, 'BOOKING_FAILED', insertErr.message)
      }

      return jsonResponse({ booking, status: 'waitlisted', position })
    }

    // ── CONFIRMÉ ──────────────────────────────────────────────────────────────
    const activityName = embeddedName(slot.activities, 'Cours')
    const coachName = embeddedName(slot.coaches, '')

    // Journal — inscrire quelqu'un consomme son crédit : le geste doit être retrouvable,
    // au même titre qu'une vente au comptoir ou qu'une levée de suspension.
    // Best-effort : la réservation est faite, on ne la défait pas parce que le journal a
    // échoué — mais l'échec est loggé, jamais avalé.
    //
    // ⚠️ action_type EST CONTRAINT PAR UN CHECK EN BASE (vérifié en production) :
    //   booking_create, booking_cancel, booking_checkin, subscription_freeze,
    //   subscription_credit_add, subscription_cancel, subscription_extend,
    //   noshow_penalty_lift, session_gift, profile_update, password_reset,
    //   push_notification_send.
    // Toute autre valeur fait ÉCHOUER l'insert — et ici l'échec est best-effort, donc
    // SILENCIEUX : la trace serait perdue sans que personne ne le voie. C'est exactement
    // ce qui serait arrivé avec 'booking_created_by_admin'.
    //
    // 'booking_create' convient sans élargir le CHECK : toute ligne de gym_admin_actions
    // vient PAR NATURE du gérant (admin_id est NOT NULL), un suffixe _by_admin n'ajouterait
    // rien. Ce qui distingue cette inscription-ci vit dans `metadata`, à quoi la colonne
    // sert — même usage que admin-lift-suspension.
    const { error: logError } = await admin.from('gym_admin_actions').insert({
      gym_id: gymId,
      admin_id: user.id,
      target_id: memberId,
      action_type: 'booking_create',
      metadata: {
        // Redondant avec target_id, et c'est voulu : la ligne se lit seule, sans avoir à
        // savoir que « la cible d'une inscription » désigne le membre inscrit.
        member_id: memberId,
        slot_id: slotId,
        booking_id: rpcResult.booking_id,
        starts_at: slot.starts_at,
        // Occupation AU MOMENT DE L'INSCRIPTION, relevée avant l'insert : c'est ce qui
        // permet de relire la décision plus tard (« le gérant a-t-il inscrit quelqu'un
        // dans un cours déjà plein à 9/10 ? »). Après coup, la donnée est perdue — le
        // compteur aura bougé.
        capacity: slot.capacity,
        booked_before: slot.bookings_count ?? null,
        credit_debited: rpcResult.credit_debited ?? false,
      },
    })
    if (logError) {
      console.error('[admin-book-member] journal insert failed (non-blocking):', {
        member_id: memberId, admin_id: user.id, error: logError.message,
      })
    }

    await notifyMember(
      supabaseUrl, serviceKey,
      {
        email: member.email as string | null,
        first_name: member.first_name as string | null,
        push_token: member.push_token as string | null,
      },
      activityName, coachName, slot.starts_at as string,
    ).catch((e) => console.error('[admin-book-member] notifyMember uncaught:', e))

    return jsonResponse({
      status: 'confirmed',
      booking_id: rpcResult.booking_id,
      credit_debited: rpcResult.credit_debited ?? false,
      activity: activityName,
      coach: coachName,
      starts_at: slot.starts_at,
    })
  } catch (err) {
    console.error('[admin-book-member] uncaught:', err)
    return errorResponse(500, 'SERVER_ERROR', (err as Error).message)
  }
})
