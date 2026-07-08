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
// L'appelant supprime SON compte : member_id = JWT, jamais de body.
//
// GYM-118 — Fonction idempotente AVEC RESUME : l'anonymisation profil (étapes 1-4) et la
// neutralisation auth (étape 5) peuvent réussir séparément. L'early-return « déjà supprimé » exige
// les DEUX (profil anonymisé ET auth neutralisée) ; sinon on reprend l'étape manquante. Le mot de
// passe de neutralisation respecte la policy GoTrue (min. 1 minuscule/MAJUSCULE/chiffre/spécial) —
// un UUID seul (hex minuscule) était rejeté en 422 weak_password.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getValidMollieToken } from '../_shared/mollie-token.ts'
import { getActiveEngagement } from '../_shared/subscription-engagement.ts'

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

    // ── GYM-118 — Idempotence AVEC resume : ne renvoyer 'déjà supprimé' QUE si le profil est
    //    anonymisé ET l'auth neutralisée. Un échec 422 antérieur (weak_password) pouvait laisser le
    //    profil anonymisé mais le compte auth VIVANT tout en annonçant success → le retry doit finir.
    let resumeAuthOnly = false
    if (profile.deleted_at) {
      const { data: authData } = await admin.auth.admin.getUserById(memberId)
      const authNeutralized =
        (authData?.user?.app_metadata as { account_deleted?: boolean } | undefined)?.account_deleted === true
      if (authNeutralized) {
        console.log('[delete-account] already deleted (profil + auth)', JSON.stringify({ member_id: memberId, gym_id: profile.gym_id }))
        return jsonResponse({ success: true, already: true })
      }
      // Profil anonymisé mais auth vivante → SAUTER les étapes 1-4 (déjà faites / idempotentes /
      // sans objet) et REPRENDRE à l'étape 5 uniquement.
      resumeAuthOnly = true
      console.log('[delete-account] resume — profil anonymisé, auth NON neutralisée → reprise étape 5', JSON.stringify({ member_id: memberId }))
    }

    const nowIso = new Date().toISOString()
    // Compteurs (restent à 0 en cas de resume : les étapes 1-4 ne sont pas re-jouées).
    let subsCount = 0
    let bookingsCancelled = 0
    let creditsCount = 0

    if (!resumeAuthOnly) {
      // ── GYM-113 — ENGAGEMENT FERME : la durée souscrite est due. Suppression BLOQUÉE tant qu'un
      //    abonnement court (status 'active'/'canceling' + ends_at futur). Guard SERVEUR = vérité :
      //    tient même si l'UI mobile est contournée. AVANT toute écriture / anonymisation.
      const engagement = await getActiveEngagement(admin, memberId, profile.gym_id as string)
      if (engagement) {
        console.log('[delete-account] blocked — subscription engaged', JSON.stringify({ member_id: memberId, ends_at: engagement.endsAt }))
        return jsonResponse({
          error: true,
          code: 'SUBSCRIPTION_ENGAGED',
          ends_at: engagement.endsAt,
          message: 'Suppression impossible : abonnement engagé jusqu\'au terme.',
        }, 409)
      }

      // ── 1. Filet défensif SEPA (GYM-113, aligné cancel-subscription : Mollie D'ABORD, fail-closed).
      //     POURQUOI cette étape survit au guard engagement : le guard bloque déjà tout abo
      //     'active'/'canceling' au terme FUTUR. Restent ici les abos au terme PASSÉ (engagement échu)
      //     — dont d'éventuels 'canceling' MENTEURS historiques (status = annulé mais Mollie ne l'a
      //     jamais réellement été). On ne peut PAS anonymiser un compte dont le SEPA prélève encore :
      //     tout échec Mollie (hors 404) → ABORT 502, aucune écriture.
      const { data: staleSubs } = await admin
        .from('member_subscriptions')
        .select('id, gym_id, mollie_subscription_id, mollie_customer_id')
        .eq('member_id', memberId)
        .in('status', ['active', 'canceling'])

      for (const sub of staleSubs ?? []) {
        if (sub.mollie_subscription_id && sub.mollie_customer_id) {
          let token: string | null
          if (IS_TEST_MODE) {
            token = MOLLIE_TEST_API_KEY || null
          } else {
            token = await getValidMollieToken(admin, sub.gym_id)
          }
          // Sans token, impossible de confirmer l'annulation → ABORT sans anonymiser.
          if (!token) {
            return errorResponse(502, 'Annulation de l\'abonnement impossible (Mollie indisponible) — réessayez', 'MOLLIE_CANCEL_FAILED')
          }
          const delRes = await fetch(
            `https://api.mollie.com/v2/customers/${sub.mollie_customer_id}/subscriptions/${sub.mollie_subscription_id}`,
            { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
          )
          // 404 = déjà annulé côté Mollie → convergent. Tout autre échec → ABORT 502 (aucune anonymisation).
          if (!delRes.ok && delRes.status !== 404) {
            console.error('[delete-account] Mollie cancel failed — abort', JSON.stringify({ member_id: memberId, status: delRes.status }))
            return errorResponse(502, 'Annulation de l\'abonnement échouée — réessayez plus tard', 'MOLLIE_CANCEL_FAILED')
          }
        }
        await admin.from('member_subscriptions').update({
          status: 'canceled',
          cancelled_at: nowIso,
          cancellation_reason: 'account_deleted',
          updated_at: nowIso,
        }).eq('id', sub.id)
      }
      subsCount = staleSubs?.length ?? 0

      // ── 2. Réservations futures confirmées → annulation via cancel-booking EXISTANTE (JWT forwardé) :
      //     remboursements ciblés + promotions waitlist réutilisés tels quels.
      const { data: futureBookings } = await admin
        .from('bookings')
        .select('id, time_slots!inner(starts_at)')
        .eq('member_id', memberId)
        .eq('status', 'confirmed')
        .gte('time_slots.starts_at', nowIso)

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

      // ── 3. Effacer les données de santé (Art. 9 RGPD) + avatar, puis anonymiser le profil selon
      //     les colonnes RÉELLES. gym_id CONSERVÉ (intégrité stats gym).
      await admin.from('medical_notes').delete().eq('member_id', memberId)

      if (profile.avatar_url) {
        try {
          // profile/edit.tsx upload sous `${user.id}/<ts>.<ext>` dans le bucket 'avatars'.
          const { data: files } = await admin.storage.from('avatars').list(memberId)
          if (files && files.length > 0) {
            await admin.storage.from('avatars').remove(files.map((f) => `${memberId}/${f.name}`))
          }
        } catch (_e) {
          console.error('[delete-account] avatar cleanup skipped (non-blocking)', JSON.stringify({ member_id: memberId }))
        }
      }

      await admin.from('profiles').update({
        first_name: 'Compte',
        last_name: 'supprimé',
        // email NOT NULL + copie du PII → MÊME placeholder que l'auth (étape 5), cohérence des scrubs.
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
      creditsCount = credits?.length ?? 0
    }

    // ── 5. Neutraliser le compte auth (PAS de deleteUser → cascade destructrice, cf. en-tête).
    //     GYM-118 — mot de passe conforme à la policy GoTrue : le préfixe 'Aa1!' garantit chaque
    //     classe (minuscule/MAJUSCULE/chiffre/spécial) — un UUID seul (hex minuscule) était rejeté
    //     en 422 weak_password. Tronqué à 72 caractères (limite bcrypt) — sinon 400 "Password cannot
    //     be longer than 72 characters". Email scrubbé vers le MÊME placeholder que profiles.email
    //     (étape 3) ; domaine .invalid accepté par GoTrue (repro : la 422 portait sur le password).
    const randomPassword = `Aa1!${crypto.randomUUID()}${crypto.randomUUID()}`.slice(0, 72)
    const { error: authErr } = await admin.auth.admin.updateUserById(memberId, {
      email: `deleted-${memberId}@deleted.invalid`,
      email_confirm: true,
      password: randomPassword,
      ban_duration: '876000h', // ~100 ans = bannissement effectif
      user_metadata: {},
      app_metadata: { account_deleted: true, deleted_at: nowIso },
    })
    if (authErr) {
      // GYM-118 — logguer le body d'erreur GoTrue (status + code + message, sans PII) pour diagnostic.
      const e = authErr as { status?: number; code?: string; message?: string }
      console.error('[delete-account] auth neutralize failed', JSON.stringify({
        member_id: memberId, status: e.status ?? null, code: e.code ?? null, message: e.message ?? null,
      }))
      // Profil déjà anonymisé ; l'appel est ré-jouable (resume) pour finir la neutralisation auth.
      return errorResponse(500, 'Anonymisation effectuée mais neutralisation du compte incomplète — réessayez', 'AUTH_NEUTRALIZE_FAILED')
    }

    // ── 6. Log structuré SANS PII.
    console.log('[delete-account] done', JSON.stringify({
      member_id: memberId,
      gym_id: profile.gym_id,
      resume_auth_only: resumeAuthOnly,
      subscriptions_cancelled: subsCount,
      future_bookings_cancelled: bookingsCancelled,
      credits_settled: creditsCount,
    }))

    return jsonResponse({ success: true })
  } catch (err) {
    return errorResponse(500, (err as Error).message ?? 'Erreur interne', 'INTERNAL_ERROR')
  }
})
