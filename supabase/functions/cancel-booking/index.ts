// Redeploy 2026-07-09 — force la prise en compte de la rotation INTERNAL_FUNCTIONS_SECRET (train n°2
// prod) : le CLI saute un bundle identique ("No change found"), ce marqueur force un nouveau déploiement.
// Aucun changement de logique.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// GYM-238 — chrome des emails composée depuis nexxia_gyms.
import { loadGymBranding, emailSender, emailShell, type GymBranding } from '../_shared/gym-branding.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// GYM-70c — horodatage d'application de la migration gym70b_credit_symmetry.
// Un booking créé AVANT ce cutoff n'a pas de debited_credit_id (traçage absent) → fallback legacy
// LIFO. Créé APRÈS sans traçage → réservé sous abonnement → aucun remboursement crédit.
// Valeur = version RÉELLE de gym70b dans schema_migrations de PROD (fcjupgvmjkqztxtwymdb),
// re-stampée par le MCP au déploiement du train n°1 : 20260708184950 → 2026-07-08T18:49:50Z.
const GYM70B_MIGRATION_CUTOFF = '2026-07-08T18:49:50Z'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function errorResponse(status: number, message: string, code?: string) {
  return jsonResponse({ error: true, code: code ?? 'ERROR', message }, status)
}

function emailHtml(gym: GymBranding, title: string, body: string, ctaText?: string, ctaHref?: string): string {
  const cta = ctaText
    ? `<a href="${ctaHref}" style="display:inline-block;background:#111111;color:#C8F000;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">${ctaText}</a>`
    : ''
  // GYM-238 — la chrome vient de la salle ; `cta` reste un bloc déjà composé par
  // l'appelant, donc il est passé dans le corps plutôt que via `ctaLabel`.
  return emailShell(gym, {
    title,
    width: 480,
    bodyHtml: body + (cta ? `<div style="margin-top:24px;">${cta}</div>` : ''),
  })
}

async function sendEmail(gym: GymBranding, resendKey: string, to: string, subject: string, html: string) {
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
      // GYM-238 — nom d'expéditeur lu en base ; l'adresse reste le domaine vérifié Resend.
      body: JSON.stringify({ from: emailSender(gym), to, subject, html }),
    })
  } catch {
    // Non-blocking
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const resendKey = Deno.env.get('RESEND_API_KEY') ?? ''

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return errorResponse(401, 'Non authentifié', 'UNAUTHORIZED')

    const supabaseUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    })
    const admin = createClient(supabaseUrl, serviceKey)

    // 1. Auth
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
    if (authError || !user) return errorResponse(401, 'Non authentifié', 'UNAUTHORIZED')

    const { booking_id: bookingId } = await req.json() as { booking_id: string }
    if (!bookingId) return errorResponse(400, 'booking_id requis', 'MISSING_BOOKING_ID')

    console.log('[cancel-booking] Starting for booking:', bookingId, 'user:', user.id)

    // 2. Get booking
    const { data: booking, error: bookingError } = await admin
      .from('bookings')
      .select('id, member_id, slot_id, gym_id, status, debited_credit_id, booked_at')
      .eq('id', bookingId)
      .single()

    console.log('[cancel-booking] Booking found:', booking?.id, booking?.status, 'member_id:', booking?.member_id)
    if (bookingError) console.log('[cancel-booking] Booking query error:', bookingError)

    if (!booking) return errorResponse(404, 'Réservation introuvable', 'BOOKING_NOT_FOUND')
    if (booking.member_id !== user.id) {
      console.log('[cancel-booking] FORBIDDEN — booking.member_id', booking.member_id, '!== user.id', user.id)
      return errorResponse(403, 'Accès refusé', 'FORBIDDEN')
    }
    if (!['confirmed', 'waitlisted'].includes(booking.status)) {
      return errorResponse(400, 'Réservation non annulable', 'ALREADY_CANCELLED')
    }

    // GYM-238 — identité de la salle, lue UNE fois : cette fonction peut envoyer jusqu'à
    // deux emails (l'annulation, et l'avertissement ou la suspension qui l'accompagne).
    const gym = await loadGymBranding(admin, booking.gym_id as string)

    const wasWaitlisted = booking.status === 'waitlisted'

    // 3. Get slot
    const { data: slot, error: slotError } = await admin
      .from('time_slots')
      .select('id, starts_at, ends_at, gym_id, activities(name), coaches(name)')
      .eq('id', booking.slot_id)
      .single()

    if (slotError) console.log('[cancel-booking] Slot query error:', slotError)
    if (!slot) return errorResponse(404, 'Créneau introuvable', 'SLOT_NOT_FOUND')

    // 4. Calculate late cancel (only meaningful for confirmed bookings)
    //
    // GYM-218 — le délai était FIGÉ à 2 h. Il est désormais lu dans noshow_rules du gym :
    // « S'il décide de réduire à 1 h, ça doit être pris en compte » (Antoine, 06/08).
    // La colonne late_cancel_hours existait depuis l'origine et n'était lue NULLE PART
    // (GYM-198). Repli sur le DEFAULT du schéma (2) si la salle n'a pas de ligne — donc
    // comportement inchangé pour toute salle qui n'a rien configuré.
    const { data: rules } = await admin
      .from('noshow_rules')
      .select('late_cancel_hours')
      .eq('gym_id', booking.gym_id)
      .maybeSingle()

    // `?? 2` couvre les deux cas : pas de ligne, et ligne avec la colonne à NULL.
    const lateCancelHours = rules?.late_cancel_hours ?? 2

    const now = new Date()
    const slotStart = new Date(slot.starts_at)
    const hoursUntil = (slotStart.getTime() - now.getTime()) / (1000 * 60 * 60)
    const isLateCancellation = !wasWaitlisted && hoursUntil < lateCancelHours && hoursUntil > 0
    const isSlotPassed = slotStart < now

    // ============================================================
    // GYM-64/69 — Remboursement crédit si annulation éligible
    // Refund si : booking 'confirmed' + slot futur + > 2h avant (un crédit a réellement été débité)
    // Pas de refund si : 'waitlisted' (rien n'avait été débité), late cancel (< 2h), slot passé, ou abonnement actif
    // ============================================================
    const { data: activeSubscription } = await admin
      .from('member_subscriptions')
      .select('id')
      .eq('member_id', booking.member_id)
      .eq('gym_id', booking.gym_id)
      .eq('status', 'active')
      .maybeSingle()

    // GYM-70b — remboursement CIBLÉ sur la ligne réellement débitée (tracée à la réservation).
    // Éligibilité GYM-64 INCHANGÉE : jamais 'waitlisted', ni late cancel, ni slot passé, ni abonnement actif.
    const shouldRefund = !wasWaitlisted && !isLateCancellation && !isSlotPassed

    if (!activeSubscription && shouldRefund) {
      if (booking.debited_credit_id) {
        // Ciblage exact : la ligne débitée à la réservation.
        const { data: dc } = await admin
          .from('member_credits')
          .select('id, credits_used')
          .eq('id', booking.debited_credit_id)
          .maybeSingle()
        if (dc) {
          await admin
            .from('member_credits')
            .update({ credits_used: Math.max(0, dc.credits_used - 1), updated_at: new Date().toISOString() })
            .eq('id', dc.id)
        }
        // debited_credit_id → NULL : empêche tout double remboursement (idempotence de l'annulation).
        await admin.from('bookings').update({ debited_credit_id: null }).eq('id', bookingId)
        console.log('[cancel-booking] Crédit remboursé (ligne débitée tracée):', booking.debited_credit_id)
      } else if (booking.booked_at && new Date(booking.booked_at).getTime() < new Date(GYM70B_MIGRATION_CUTOFF).getTime()) {
        // Legacy (booking d'AVANT le cutoff GYM-70b, jamais tracé) : ligne la plus récente credits_used > 0 (LIFO).
        const { data: legacy } = await admin
          .from('member_credits')
          .select('id, credits_used')
          .eq('member_id', booking.member_id)
          .eq('gym_id', booking.gym_id)
          .gt('credits_used', 0)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (legacy) {
          await admin
            .from('member_credits')
            .update({ credits_used: Math.max(0, legacy.credits_used - 1), updated_at: new Date().toISOString() })
            .eq('id', legacy.id)
          console.log('[cancel-booking] Crédit remboursé (fallback legacy LIFO):', legacy.id)
        } else {
          console.warn('[cancel-booking] Aucune ligne crédit à rembourser (legacy sans crédit utilisé) — annulation poursuivie')
        }
      } else {
        // Post-cutoff SANS traçage → réservation payée par abonnement → AUCUN remboursement crédit.
        console.log('[cancel-booking] Pas de remboursement crédit (réservation sous abonnement post-migration)')
      }
    } else if (!activeSubscription) {
      console.log('[cancel-booking] Crédit non remboursé:',
        wasWaitlisted ? '(waitlist)' : isSlotPassed ? '(slot passé)' : isLateCancellation ? '(désistement tardif < 2h)' : '(non éligible)')
    }
    // ============================================================

    // 5a. Waitlist cancellation — simple path: cancel + reorder, no penalty, no promotion
    if (wasWaitlisted) {
      const { error: wlErr } = await admin.from('bookings').update({
        status: 'cancelled',
        cancelled_at: now.toISOString(),
        cancel_reason: 'member_left_waitlist',
        waitlist_position: null,
        waitlist_notified_at: null,
        waitlist_confirmation_deadline: null,
      }).eq('id', bookingId)

      if (wlErr) {
        console.log('[cancel-booking] Waitlist update error:', wlErr)
        return errorResponse(500, wlErr.message, 'UPDATE_FAILED')
      }

      await admin.rpc('reorder_waitlist', { p_slot_id: booking.slot_id })

      console.log('[cancel-booking] Waitlist cancelled + reordered')
      return jsonResponse({ cancelled: true, noshow: null })
    }

    // 5b. Confirmed cancellation (trigger trg_update_bookings_count maintains time_slots counts)
    const { error: updateErr } = await admin.from('bookings').update({
      status: 'cancelled',
      cancelled_at: now.toISOString(),
      is_late_cancel: isLateCancellation,
    }).eq('id', bookingId)

    if (updateErr) {
      console.log('[cancel-booking] Update error:', updateErr)
      return errorResponse(500, updateErr.message, 'UPDATE_FAILED')
    }

    // Les embeds to-one sont typés en TABLEAU par le client généré alors que PostgREST
    // renvoie un objet : le cast direct ne compilait pas — `deno check` échouait sur ces
    // deux lignes AVANT ce lot. On tolère les deux formes, comme partout ailleurs.
    const embedOne = <T,>(v: unknown): T | null =>
      Array.isArray(v) ? ((v[0] as T | undefined) ?? null) : ((v as T | null) ?? null)
    const activityName = embedOne<{ name: string }>(slot.activities)?.name ?? 'Cours'
    const coachName = embedOne<{ name: string }>(slot.coaches)?.name ?? ''
    // GYM-229 — pas de coach, pas de ligne. Une activité en accès libre (Open Gym) n'en a
    // aucun : un libellé « Coach » suivi d'un blanc n'informe de rien et se lit comme une
    // donnée manquante. Le bloc entier disparaît, libellé compris.
    // (Ces emails n'ont pas de version texte — Resend ne reçoit qu'un champ `html`.)
    const coachLine = coachName
      ? `<p style="color:#9A9890;">Coach: ${coachName}</p>`
      : ''
    const dateStr = slotStart.toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long' })
    const timeStr = slotStart.toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' })

    // Get profile for emails
    const { data: profile } = await admin
      .from('profiles')
      .select('id, email, first_name, gym_id')
      .eq('id', user.id)
      .single()

    let noshowResult: { level: string; count?: number; hours?: number; until?: string } | null = null

    // 7. GYM-218 — Sanction de l'annulation tardive : politique DU GYM, plus de seuils
    //    en dur. Les trois paliers (1 avertissement, 48 h, 336 h) et leur enchaînement
    //    étaient écrits ici ; ils vivent désormais dans public.apply_noshow_penalty, la
    //    MÊME règle que celle appliquée aux no-shows constatés (GYM-175). Réécrire
    //    l'escalade en TypeScript aurait créé une seconde implémentation, qui aurait
    //    divergé au premier ajustement — le défaut même que ce lot corrige.
    //
    //    La fonction est atomique : compteur, pénalité et suspension dans une seule
    //    transaction, là où ce bloc faisait trois écritures séparées.
    if (isLateCancellation && !isSlotPassed && profile) {
      const { data: penalty, error: penaltyError } = await admin.rpc('apply_noshow_penalty', {
        p_member_id: user.id,
        p_gym_id: profile.gym_id,
        p_booking_id: bookingId,
        // Libellé tel qu'il s'affichera dans l'historique, majuscule comprise : la
        // casse est décidée ICI, la fonction SQL ne la devine pas (cf. en-tête de
        // la migration gym218_apply_noshow_penalty).
        p_incident_label: 'Annulation tardive',
      })

      if (penaltyError) {
        // L'annulation elle-même est déjà enregistrée et la place rendue à la liste
        // d'attente : on ne la défait pas parce que la sanction a échoué. Mais l'échec
        // est LOGGÉ, jamais avalé (leçon GYM-204 : un silence a masqué un défaut des mois).
        console.error('[cancel-booking] apply_noshow_penalty failed:', penaltyError)
      } else {
        const p = penalty as {
          applied?: boolean
          type?: string | null
          count?: number
          suspension_hours?: number | null
          suspended_until?: string | null
        } | null

        if (p?.applied) {
          const isSuspension = p.type === 'suspension'
          noshowResult = isSuspension
            ? { level: 'suspension', count: p.count, hours: p.suspension_hours ?? undefined, until: p.suspended_until ?? undefined }
            : { level: 'warning', count: p.count }

          if (resendKey && profile.email) {
            // Les libellés d'e-mail sont dérivés de la sanction RÉELLEMENT appliquée :
            // annoncer « 48h » ou « 2 semaines » en dur mentirait dès qu'une salle
            // configure autre chose.
            const untilStr = p.suspended_until
              ? new Date(p.suspended_until).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
              : ''
            if (isSuspension) {
              await sendEmail(gym, resendKey, profile.email,
                // GYM-238 — l'objet portait « Dopamine » en dur : il porte le nom de la salle.
                `Compte suspendu — ${gym.name}`,
                emailHtml(gym, 'Compte suspendu',
                  `<p style="color:#6B6861;">Votre annulation pour <strong>${activityName}</strong> (${dateStr} à ${timeStr}) est intervenue moins de ${lateCancelHours}h avant le début du cours : elle est traitée comme une absence.</p><p style="color:#6B6861;">Votre compte est suspendu jusqu'au <strong>${untilStr}</strong>. Vous ne pourrez pas réserver pendant cette période.</p>`))
            } else {
              await sendEmail(gym, resendKey, profile.email,
                'Annulation tardive — avertissement',
                emailHtml(gym, 'Annulation tardive',
                  `<p style="color:#6B6861;">Votre annulation pour <strong>${activityName}</strong> (${dateStr} à ${timeStr}) est intervenue moins de ${lateCancelHours}h avant le début du cours : elle est traitée comme une absence, et la séance n'est pas re-créditée.</p><p style="color:#6B6861;">Ceci est un <strong>avertissement</strong>. En cas de récidive, votre compte pourra être suspendu.</p>`))
            }
          }
        } else {
          // Sous le 1er seuil de la salle : compteur incrémenté, aucune sanction.
          noshowResult = { level: 'none', count: p?.count }
        }
      }
    }

    // ═══ 8. GYM-281 — NOTIFIER AUTANT DE MEMBRES QU'IL Y A DE PLACES ═══════════════
    //
    // 🔴 CE QUE FAISAIT CE BLOC, ET POURQUOI UN SEUL MEMBRE ÉTAIT PRÉVENU :
    // il lisait le premier de la file avec
    //     .eq('status','waitlisted').order('waitlist_position').limit(1)
    // SANS filtrer `waitlist_notified_at`. La MÊME personne était donc re-notifiée à
    // chaque annulation, sa fenêtre de confirmation repoussée à chaque fois, et le
    // curseur n'avançait jamais. Mesuré au test de charge GYM-217 : 7 places libérées,
    // 8 membres en attente, 1 seul notifié.
    //
    // Toute cette logique est remplacée par UN appel. Ce n'est pas un déplacement de
    // code : la fonction SQL calcule le nombre de places RÉELLEMENT libres
    // (capacité − confirmés − fenêtres encore ouvertes), prend le verrou du créneau, et
    // délègue chaque notification à `notify_next_in_waitlist` — la brique qui existait
    // déjà, qui filtre bien `waitlist_notified_at IS NULL`, et dont `confirm-waitlist`
    // et le cron d'expiration se servent depuis GYM-108.
    //
    // ⚠️ L'ENVOI PASSE DÉSORMAIS PAR LE VAULT (notify_waitlist_url +
    // internal_functions_secret), et non plus par un fetch avec la variable
    // d'environnement. Les deux secrets sont présents — vérifié sur staging avant
    // d'écrire — et c'est déjà le chemin qu'empruntent confirm-waitlist et le cron.
    //
    // Best-effort, comme le bloc qu'il remplace : une notification manquée ne doit pas
    // faire échouer une annulation déjà écrite en base.
    const { data: notifyResult, error: notifyError } = await admin
      .rpc('notify_waitlist_for_free_seats', { p_slot_id: booking.slot_id })

    if (notifyError) {
      console.error('[cancel-booking] notify_waitlist_for_free_seats failed (non-blocking):',
        JSON.stringify({ slot_id: booking.slot_id, message: notifyError.message }))
    } else {
      console.log('[cancel-booking] waitlist notified:', JSON.stringify(notifyResult))
    }

    // 9. Cancellation confirmation email
    if (resendKey && profile?.email) {
      const lateWarning = isLateCancellation
        ? '<p style="color:#EF4444;font-weight:bold;margin-top:16px;">Annulation tardive détectée — voir avertissement séparé.</p>'
        : ''
      await sendEmail(gym, resendKey, profile.email,
        `Réservation annulée — ${activityName}`,
        emailHtml(gym, 'Réservation annulée',
          `<p style="color:#6B6861;"><strong>${activityName}</strong></p><p style="color:#6B6861;">${dateStr} à ${timeStr}</p>${coachLine}${lateWarning}`))
    }

    console.log('[cancel-booking] Success — late:', isLateCancellation, 'noshow:', noshowResult?.level ?? 'none')
    return jsonResponse({ cancelled: true, noshow: noshowResult })
  } catch (err) {
    console.error('[cancel-booking] Uncaught error:', err)
    return errorResponse(500, (err as Error).message ?? 'Erreur interne', 'INTERNAL_ERROR')
  }
})
