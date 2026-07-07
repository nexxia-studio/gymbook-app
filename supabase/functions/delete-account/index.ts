// GYM-46 — Suppression de compte in-app (obligation Apple 5.1.1(v)).
// Principe RGPD × conservation comptable :
//   - ANONYMISER le profil (PII scrubbée) — le profil N'EST PAS supprimé.
//   - CONSERVER le transactionnel (payments, bookings) = obligation comptable.
//   - SUPPRIMER l'accès + libérer l'email + effacer les données santé (Art. 9 RGPD).
//
// ⚠️ Décision d'archi importante (voir constats) : on N'APPELLE PAS auth.admin.deleteUser().
// profiles.id → auth.users(id) est ON DELETE CASCADE, et payments/bookings/member_credits/
// member_subscriptions/medical_notes → profiles(id) sont EUX AUSSI CASCADE. Supprimer le user
// auth effacerait donc en cascade TOUT le transactionnel — l'inverse du besoin. On neutralise
// donc le compte auth (email scrubbé vers un placeholder + bannissement + mot de passe
// aléatoire) : l'email d'origine redevient libre, l'accès est coupé, le transactionnel survit.
//
// L'appelant supprime SON compte : member_id = JWT, jamais de body. Fonction idempotente
// (re-jouable après échec partiel) : chaque étape re-vérifie l'état.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getValidMollieToken } from '../_shared/mollie-token.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const IS_TEST_MODE = Deno.env.get('MOLLIE_TEST_MODE') === 'true'
const MOLLIE_TEST_API_KEY = Deno.env.get('MOLLIE_TEST_API_KEY') ?? ''

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function errorResponse(status: number, message: string, code?: string) {
  return jsonResponse({ error: true, code: code ?? 'ERROR', message }, status)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return errorResponse(401, 'Non authentifié', 'UNAUTHORIZED')

    // Pattern maison : client user (JWT) pour l'identité, client admin (service role) pour les écrits.
    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const admin = createClient(supabaseUrl, serviceKey)

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
    if (authError || !user) return errorResponse(401, 'Non authentifié', 'UNAUTHORIZED')

    // member_id = JWT UNIQUEMENT (jamais depuis le body).
    const memberId = user.id

    const { data: profile } = await admin
      .from('profiles')
      .select('id, gym_id, avatar_url, deleted_at')
      .eq('id', memberId)
      .single()

    if (!profile) return errorResponse(404, 'Profil introuvable', 'PROFILE_NOT_FOUND')

    // Idempotence : déjà anonymisé → succès sans retraiter.
    if (profile.deleted_at) {
      console.log('[delete-account] already deleted', JSON.stringify({ member_id: memberId, gym_id: profile.gym_id }))
      return jsonResponse({ success: true, already: true })
    }

    const nowIso = new Date().toISOString()

    // ── 1. Abonnement actif → annulation Mollie D'ABORD (même chemin que cancel-subscription :
    //     token maison + endpoint DELETE /customers/{c}/subscriptions/{s}). Contrat plus strict
    //     ici : tout échec Mollie → 409, on ne supprime JAMAIS un compte avec un prélèvement vivant.
    const { data: activeSubs } = await admin
      .from('member_subscriptions')
      .select('id, gym_id, mollie_subscription_id, mollie_customer_id')
      .eq('member_id', memberId)
      .eq('status', 'active')

    for (const sub of activeSubs ?? []) {
      if (sub.mollie_subscription_id && sub.mollie_customer_id) {
        let token: string | null
        if (IS_TEST_MODE) {
          token = MOLLIE_TEST_API_KEY || null
        } else {
          token = await getValidMollieToken(admin, sub.gym_id)
        }
        if (!token) {
          return errorResponse(409, 'Annulation de l\'abonnement impossible (Mollie indisponible)', 'SUBSCRIPTION_CANCEL_FAILED')
        }
        const delRes = await fetch(
          `https://api.mollie.com/v2/customers/${sub.mollie_customer_id}/subscriptions/${sub.mollie_subscription_id}`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
        )
        // 404 = déjà annulé côté Mollie → acceptable. Tout autre échec → on stoppe.
        if (!delRes.ok && delRes.status !== 404) {
          console.error('[delete-account] Mollie cancel failed', JSON.stringify({ member_id: memberId, status: delRes.status }))
          return errorResponse(409, 'Annulation de l\'abonnement échouée — réessayez plus tard', 'SUBSCRIPTION_CANCEL_FAILED')
        }
      }
      await admin.from('member_subscriptions').update({
        status: 'canceled',
        cancelled_at: nowIso,
        cancellation_reason: 'account_deleted',
        updated_at: nowIso,
      }).eq('id', sub.id)
    }

    // ── 2. Réservations futures confirmées → annulation via la fonction cancel-booking EXISTANTE
    //     (JWT du membre forwardé) : remboursements ciblés + promotions waitlist réutilisés tels quels.
    const { data: futureBookings } = await admin
      .from('bookings')
      .select('id, time_slots!inner(starts_at)')
      .eq('member_id', memberId)
      .eq('status', 'confirmed')
      .gte('time_slots.starts_at', nowIso)

    let bookingsCancelled = 0
    for (const b of futureBookings ?? []) {
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/cancel-booking`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': authHeader,
            'apikey': anonKey,
          },
          body: JSON.stringify({ booking_id: b.id }),
        })
        if (res.ok) bookingsCancelled++
        else console.error('[delete-account] cancel-booking non-ok', JSON.stringify({ member_id: memberId, status: res.status }))
      } catch (_e) {
        console.error('[delete-account] cancel-booking error (non-blocking)', JSON.stringify({ member_id: memberId }))
      }
    }

    // ── 3. Effacer les données de santé (Art. 9 RGPD — aucune base de conservation) + avatar,
    //     puis anonymiser le profil selon les colonnes RÉELLES. gym_id CONSERVÉ (intégrité stats).
    await admin.from('medical_notes').delete().eq('member_id', memberId)

    if (profile.avatar_url) {
      try {
        // profile/edit.tsx upload sous `${user.id}/<ts>.<ext>` dans le bucket 'avatars'.
        const { data: files } = await admin.storage.from('avatars').list(memberId)
        if (files && files.length > 0) {
          await admin.storage.from('avatars').remove(files.map((f) => `${memberId}/${f.name}`))
        }
      } catch (_e) {
        // Bucket absent (ex. staging) ou erreur storage → non bloquant.
        console.error('[delete-account] avatar cleanup skipped (non-blocking)', JSON.stringify({ member_id: memberId }))
      }
    }

    await admin.from('profiles').update({
      first_name: 'Compte',
      last_name: 'supprimé',
      // email est NOT NULL et copie du PII → scrubbé vers un placeholder non identifiant.
      email: `deleted-${memberId}@deleted.invalid`,
      phone: null,
      date_of_birth: null,
      gender: null,
      avatar_url: null,
      address_line: null,
      street_name: null,
      street_number: null,
      city: null,
      postal_code: null,
      country: null,
      emergency_contact_name: null,
      emergency_contact_phone: null,
      push_token: null,
      notification_preferences: null,
      deleted_at: nowIso,
      deletion_requested_at: nowIso,
      updated_at: nowIso,
    }).eq('id', memberId)

    // ── 4. Crédits restants → soldés (credits_used = credits_total), PAS supprimés (traçabilité).
    //     credits_remaining est une colonne générée (total - used) → devient 0.
    const { data: credits } = await admin
      .from('member_credits')
      .select('id, credits_total')
      .eq('member_id', memberId)
    for (const c of credits ?? []) {
      await admin.from('member_credits').update({
        credits_used: c.credits_total,
        updated_at: nowIso,
      }).eq('id', c.id)
    }

    // ── 5. Neutraliser le compte auth (PAS de deleteUser → cascade destructrice, cf. en-tête).
    //     Email scrubbé (l'email d'origine redevient libre), mot de passe aléatoire, bannissement.
    const randomPassword = `${crypto.randomUUID()}${crypto.randomUUID()}`
    const { error: authErr } = await admin.auth.admin.updateUserById(memberId, {
      email: `deleted-${memberId}@deleted.invalid`,
      email_confirm: true,
      password: randomPassword,
      ban_duration: '876000h', // ~100 ans = bannissement effectif
      user_metadata: {},
      app_metadata: { account_deleted: true, deleted_at: nowIso },
    })
    if (authErr) {
      // Profil déjà anonymisé ; l'appel est ré-jouable pour finir la neutralisation auth.
      console.error('[delete-account] auth neutralize failed', JSON.stringify({ member_id: memberId, status: (authErr as { status?: number }).status ?? null }))
      return errorResponse(500, 'Anonymisation effectuée mais neutralisation du compte incomplète — réessayez', 'AUTH_NEUTRALIZE_FAILED')
    }

    // ── 6. Log structuré SANS PII.
    console.log('[delete-account] done', JSON.stringify({
      member_id: memberId,
      gym_id: profile.gym_id,
      subscriptions_cancelled: activeSubs?.length ?? 0,
      future_bookings_cancelled: bookingsCancelled,
      credits_settled: credits?.length ?? 0,
    }))

    return jsonResponse({ success: true })
  } catch (err) {
    return errorResponse(500, (err as Error).message ?? 'Erreur interne', 'INTERNAL_ERROR')
  }
})
