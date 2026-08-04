// GYM-204 — Levée d'une suspension no-show par le gérant (gym_admin / super_admin).
//
// POURQUOI CETTE FONCTION EXISTE. Le bouton « Lever la suspension » du dashboard écrivait
// suspended_until et noshow_count sur le profil D'UN AUTRE utilisateur, depuis le client,
// avec le jeton du gérant. Il N'A JAMAIS FONCTIONNÉ : la policy « Modifier son propre
// profil » n'autorise que id = auth.uid(), aucune ligne ne matchait, PostgREST renvoyait
// 0 LIGNE SANS ERREUR — et l'appelant ne testait pas `error`. Le gérant voyait un succès,
// rien ne se passait. Depuis GYM-203, l'échec est franc (42501) : suspended_until et
// noshow_count sont hors de la liste blanche des colonnes écrivables côté client.
// L'écriture passe donc ici, en service_role, après contrôle strict — modèle
// admin-update-member (GYM-129).
//
// DÉCISION PRODUIT (Antoine) : lever la suspension NE TOUCHE PAS au compteur de no-shows.
// Rendre l'accès et effacer l'ardoise sont deux gestes distincts. Pour annuler une absence
// elle-même, le chemin existe déjà (écran de pointage → mark_attendance_atomic, qui gère la
// symétrie complète : pénalité, compteur, recalcul de suspended_until).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

const MAX_REASON = 500

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
    // gym_id lu sur le PROFIL de l'appelant, JAMAIS du body : c'est ce qui empêche un gérant
    // d'agir sur la salle d'un autre en forgeant sa requête.
    if (!adminProfile.gym_id) return errorResponse(400, 'NO_GYM', 'Aucune salle associée à ce compte')

    // 2. Entrée.
    const body = await req.json() as { member_id?: string; reason?: string }
    const memberId = body.member_id
    if (!memberId) return errorResponse(400, 'MISSING_MEMBER_ID', 'member_id requis')

    // Motif OBLIGATOIRE : une levée de sanction est une décision, elle doit être justifiée
    // et retrouvable. Un espace ne compte pas pour un motif.
    const reason = (body.reason ?? '').trim()
    if (!reason) return errorResponse(400, 'REASON_REQUIRED', 'Un motif est obligatoire pour lever une suspension')
    if (reason.length > MAX_REASON) {
      return errorResponse(400, 'REASON_TOO_LONG', `Motif trop long (max ${MAX_REASON} caractères)`)
    }

    // 3. Charger la cible : doit appartenir à la salle de l'appelant, non supprimée.
    const { data: target } = await admin
      .from('profiles')
      .select('id, gym_id, role, deleted_at, suspended_until, noshow_count')
      .eq('id', memberId)
      .single()

    if (!target) return errorResponse(404, 'MEMBER_NOT_FOUND', 'Membre introuvable')
    if (target.gym_id !== adminProfile.gym_id) return errorResponse(403, 'WRONG_GYM', 'Membre hors de votre salle')
    if (target.role !== 'member') return errorResponse(403, 'NOT_A_MEMBER', 'Seuls les comptes membres sont concernés')
    if (target.deleted_at) return errorResponse(409, 'MEMBER_DELETED', 'Compte supprimé')

    // 4. Le membre doit réellement être sous le coup d'une suspension ACTIVE. Même lecture
    //    que create-booking : une date passée n'est plus une sanction, c'est un reliquat.
    const suspendedUntil = target.suspended_until as string | null
    const isSuspended = suspendedUntil !== null && new Date(suspendedUntil) > new Date()
    if (!isSuspended) {
      return errorResponse(409, 'NOT_SUSPENDED', "Ce membre n'est pas suspendu")
    }

    // 5. Écriture (service_role) — UNIQUEMENT suspended_until.
    //    noshow_count est délibérément épargné (cf. décision produit en tête de fichier).
    const { error: updateError } = await admin
      .from('profiles')
      .update({ suspended_until: null, updated_at: new Date().toISOString() })
      .eq('id', memberId)

    if (updateError) {
      console.error('[admin-lift-suspension] update failed:', updateError)
      return errorResponse(500, 'UPDATE_FAILED', 'Levée de la suspension impossible')
    }

    // 6. Journal — qui, quand, sur qui, quel motif, quelle valeur levée.
    //    gym_admin_actions porte une colonne `reason` dédiée : on l'utilise plutôt que de
    //    noyer le motif dans metadata. `created_at` fournit le quand (DEFAULT now()).
    //    Best-effort : la sanction est levée, on ne la remet pas parce que le journal a
    //    échoué — mais l'échec est loggé, jamais avalé.
    const { error: logError } = await admin.from('gym_admin_actions').insert({
      gym_id: adminProfile.gym_id,
      admin_id: user.id,
      target_id: memberId,
      action_type: 'noshow_penalty_lift',
      reason,
      metadata: {
        lifted_suspended_until: suspendedUntil,
        // Consigné pour la lecture du journal, PAS modifié : le compteur reste tel quel.
        noshow_count_unchanged: target.noshow_count ?? 0,
      },
    })

    if (logError) {
      console.error('[admin-lift-suspension] journal insert failed (non-blocking):', {
        member_id: memberId, admin_id: user.id, error: logError.message,
      })
    }

    // 7. Notification du membre — best-effort, comportement conservé de l'ancien parcours
    //    dashboard. Un échec de push ne doit pas transformer une levée réussie en erreur.
    try {
      const { data: profile } = await admin
        .from('profiles')
        .select('push_token')
        .eq('id', memberId)
        .single()

      if (profile?.push_token) {
        await admin.functions.invoke('send-notification', {
          body: {
            tokens: [profile.push_token],
            title: 'Suspension levée',
            body: 'Votre suspension a été levée par le gérant.',
            data: { type: 'suspension_lifted' },
          },
        })
      }
    } catch (e) {
      console.error('[admin-lift-suspension] push failed (non-blocking):', e)
    }

    return jsonResponse({
      success: true,
      member_id: memberId,
      lifted_suspended_until: suspendedUntil,
      noshow_count: target.noshow_count ?? 0,
    })
  } catch (err) {
    console.error('[admin-lift-suspension] uncaught:', err)
    return errorResponse(500, 'SERVER_ERROR', (err as Error).message)
  }
})
