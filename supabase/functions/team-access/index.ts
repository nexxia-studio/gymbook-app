// GYM-200 — Lecture et retrait des accès d'équipe (dashboard → onglet « Équipe »).
//
// Deux actions, toutes deux réservées à un gym_admin / super_admin de la salle :
//   list   → l'équipe de MA salle, avec le statut d'invitation (en attente / actif)
//   revoke → retirer l'accès dashboard d'un membre d'équipe
//
// Pourquoi une Edge Function et pas un simple appel PostgREST depuis le dashboard :
//   - `list` a besoin de auth.users.last_sign_in_at pour distinguer « invitation en
//     attente » de « compte actif ». Cette table n'est PAS exposée à PostgREST : seul le
//     service_role peut la lire, via l'Auth Admin API.
//   - `revoke` doit écrire profiles.role, colonne délibérément RETIRÉE du GRANT UPDATE de
//     `authenticated` par GYM-203 (c'était le vecteur d'élévation de privilège). Le
//     dégradé de rôle ne peut donc plus, par construction, venir du client.
//
// L'invitation elle-même vit dans invite-team-member (renvoi d'invitation compris).
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Rôles qui donnent accès au dashboard — c'est la définition de « l'équipe ».
// Aligner avec ProtectedRoute.ALLOWED_ROLES (GYM-145) et avec INVITABLE_ROLES
// d'invite-team-member le jour où 'coach' arrivera (GYM-176).
const TEAM_ROLES = ['gym_admin', 'super_admin']

// Rôles autorisés à administrer l'équipe.
const TEAM_MANAGER_ROLES = ['gym_admin', 'super_admin']

// Rôle appliqué à un accès retiré. Volontairement NON destructif : la personne reste
// rattachée à la salle en tant que membre, ce qui est réversible d'un simple ré-invite.
const REVOKED_ROLE = 'member'

interface TeamRequest {
  action?: string
  member_id?: string
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

interface TeamProfile {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  role: string
}

// Statut d'invitation : une personne qui ne s'est JAMAIS connectée n'a pas encore activé
// son compte. last_sign_in_at n'existe que dans auth.users → Auth Admin API.
// Un échec de lecture ne doit pas faire échouer la liste : on retombe sur `null`
// (« statut inconnu ») plutôt que d'annoncer à tort « en attente ».
async function isPending(admin: SupabaseClient, userId: string): Promise<boolean | null> {
  try {
    const { data, error } = await admin.auth.admin.getUserById(userId)
    if (error || !data?.user) return null
    return data.user.last_sign_in_at == null
  } catch {
    return null
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(supabaseUrl, serviceKey)

    // 1. Appelant : authentifié, gym_admin ou super_admin.
    const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    if (!token) return errorResponse(401, 'UNAUTHORIZED', 'Non authentifié')

    const { data: { user }, error: authError } = await admin.auth.getUser(token)
    if (authError || !user) return errorResponse(401, 'UNAUTHORIZED', 'Non authentifié')

    const { data: callerProfile } = await admin
      .from('profiles')
      .select('role, gym_id')
      .eq('id', user.id)
      .single()

    if (!callerProfile || !TEAM_MANAGER_ROLES.includes(callerProfile.role)) {
      return errorResponse(403, 'FORBIDDEN', 'Réservé au gérant de la salle')
    }

    // gym_id du PROFIL de l'appelant, jamais du body — même règle que partout ailleurs.
    const gymId = callerProfile.gym_id as string | null
    if (!gymId) return errorResponse(400, 'NO_GYM', 'Aucune salle associée à ce compte')

    const body = await req.json().catch(() => ({})) as TeamRequest
    const action = body.action ?? 'list'

    // ─────────────────────────────────────────────────────────────────────────
    // LIST
    // ─────────────────────────────────────────────────────────────────────────
    if (action === 'list') {
      const { data: rows, error: listErr } = await admin
        .from('profiles')
        .select('id, email, first_name, last_name, role')
        .eq('gym_id', gymId)
        .in('role', TEAM_ROLES)
        .is('deleted_at', null)
        .order('created_at')

      if (listErr) {
        console.error('[team-access] list failed:', listErr)
        return errorResponse(500, 'LIST_FAILED', 'Lecture de l\'équipe impossible')
      }

      const members = await Promise.all(((rows ?? []) as TeamProfile[]).map(async (m) => ({
        id: m.id,
        email: m.email,
        first_name: m.first_name,
        last_name: m.last_name,
        role: m.role,
        pending: await isPending(admin, m.id),
        is_self: m.id === user.id,
      })))

      return jsonResponse({ success: true, members })
    }

    // ─────────────────────────────────────────────────────────────────────────
    // REVOKE
    // ─────────────────────────────────────────────────────────────────────────
    if (action === 'revoke') {
      const memberId = body.member_id?.trim()
      if (!memberId) return errorResponse(400, 'MISSING_MEMBER_ID', 'member_id requis')

      // Un gérant ne peut pas retirer SON PROPRE accès : il se verrouillerait dehors.
      if (memberId === user.id) {
        return errorResponse(409, 'CANNOT_REVOKE_SELF', 'Vous ne pouvez pas retirer votre propre accès')
      }

      const { data: target } = await admin
        .from('profiles')
        .select('id, gym_id, role, deleted_at')
        .eq('id', memberId)
        .single()

      if (!target) return errorResponse(404, 'MEMBER_NOT_FOUND', 'Compte introuvable')
      if (target.gym_id !== gymId) return errorResponse(403, 'WRONG_GYM', 'Compte hors de votre salle')
      if (target.deleted_at) return errorResponse(409, 'MEMBER_DELETED', 'Compte supprimé')
      if (!TEAM_ROLES.includes(target.role)) {
        return errorResponse(409, 'NOT_TEAM_MEMBER', 'Ce compte n\'a pas d\'accès dashboard')
      }

      // Ne jamais laisser une salle sans aucun gérant : plus personne ne pourrait inviter.
      // Compté sur la salle entière, pas sur la liste affichée (qui peut être périmée).
      if (target.role === 'gym_admin') {
        const { count } = await admin
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('gym_id', gymId)
          .eq('role', 'gym_admin')
          .is('deleted_at', null)
        if ((count ?? 0) <= 1) {
          return errorResponse(409, 'LAST_ADMIN', 'Impossible de retirer le dernier gérant de la salle')
        }
      }

      // a) Retrait de l'accès dashboard. On DÉGRADE le rôle au lieu de supprimer le compte :
      //    la personne reste membre de la salle, et l'opération est réversible.
      const { error: roleErr } = await admin
        .from('profiles')
        .update({ role: REVOKED_ROLE })
        .eq('id', memberId)

      if (roleErr) {
        console.error('[team-access] revoke role update failed:', roleErr)
        return errorResponse(500, 'REVOKE_FAILED', 'Retrait de l\'accès impossible')
      }

      // b) Détachement de la fiche coach — SANS LA SUPPRIMER.
      //    ⚠️ SYMÉTRIE GYM-200 §4 : des créneaux passés peuvent référencer ce coach
      //    (time_slots.coach_id). Une suppression, même en cascade, effacerait l'historique
      //    du planning : « qui a animé ce cours ? » n'aurait plus de réponse. On remet donc
      //    seulement profile_id à NULL : la fiche survit, détachée de tout compte, et le
      //    gérant peut la réaffecter ou la désactiver depuis l'onglet Coachs.
      const { error: coachErr } = await admin
        .from('coaches')
        .update({ profile_id: null })
        .eq('profile_id', memberId)
        .eq('gym_id', gymId)

      // Best-effort : l'accès est déjà retiré, c'est ce qui compte pour la sécurité.
      if (coachErr) console.error('[team-access] coach detach failed:', coachErr)

      return jsonResponse({
        success: true,
        member_id: memberId,
        ...(coachErr ? { warning: 'COACH_NOT_DETACHED' } : {}),
      })
    }

    return errorResponse(400, 'INVALID_ACTION', 'Action inconnue')
  } catch (err) {
    console.error('[team-access] uncaught:', err)
    return errorResponse(500, 'SERVER_ERROR', (err as Error).message)
  }
})
