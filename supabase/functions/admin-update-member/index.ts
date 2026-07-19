// GYM-129 — Édition de l'identité d'un membre par le gérant (gym_admin / super_admin).
//
// Correction au comptoir d'une faute de frappe : prénom / nom / téléphone UNIQUEMENT.
// JAMAIS email / role / gym_id (sécurité auth — hors périmètre v1). Écriture via
// service_role après contrôle strict : la cible est un 'member' du gym de l'appelant.
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

const MAX_NAME = 100
const MAX_PHONE = 30
// Format téléphone souple : chiffres, espaces, + - . ( ) — pas de lettres.
const PHONE_RE = /^[0-9+\-.\s()]{4,30}$/

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
    const body = await req.json() as {
      member_id?: string
      first_name?: string
      last_name?: string
      phone?: string
    }
    const memberId = body.member_id
    if (!memberId) return errorResponse(400, 'MISSING_MEMBER_ID', 'member_id requis')

    // 3. Construire l'update UNIQUEMENT à partir des 3 champs autorisés (email/role/gym_id
    //    ignorés même si envoyés).
    const updates: Record<string, string | null> = {}

    if (body.first_name !== undefined) {
      const v = body.first_name.trim()
      if (!v || v.length > MAX_NAME) return errorResponse(400, 'INVALID_FIRST_NAME', 'Prénom invalide')
      updates.first_name = v
    }
    if (body.last_name !== undefined) {
      const v = body.last_name.trim()
      if (!v || v.length > MAX_NAME) return errorResponse(400, 'INVALID_LAST_NAME', 'Nom invalide')
      updates.last_name = v
    }
    if (body.phone !== undefined) {
      const v = body.phone.trim()
      if (v === '') {
        updates.phone = null // autoriser l'effacement du téléphone
      } else if (v.length > MAX_PHONE || !PHONE_RE.test(v)) {
        return errorResponse(400, 'INVALID_PHONE', 'Téléphone invalide')
      } else {
        updates.phone = v
      }
    }

    if (Object.keys(updates).length === 0) {
      return errorResponse(400, 'NO_FIELDS', 'Aucun champ à modifier')
    }

    // 4. Charger la cible : doit être un membre du gym de l'appelant, non supprimé.
    const { data: target } = await admin
      .from('profiles')
      .select('id, gym_id, role, deleted_at')
      .eq('id', memberId)
      .single()

    if (!target) return errorResponse(404, 'MEMBER_NOT_FOUND', 'Membre introuvable')
    if (target.gym_id !== adminProfile.gym_id) return errorResponse(403, 'WRONG_GYM', 'Membre hors de votre salle')
    if (target.role !== 'member') return errorResponse(403, 'NOT_A_MEMBER', 'Seuls les comptes membres sont modifiables ici')
    if (target.deleted_at) return errorResponse(409, 'MEMBER_DELETED', 'Compte supprimé')

    // 5. Écriture (service_role) — colonnes autorisées uniquement.
    updates.updated_at = new Date().toISOString()
    const { data: updated, error: updateError } = await admin
      .from('profiles')
      .update(updates)
      .eq('id', memberId)
      .select('id, first_name, last_name, phone')
      .single()

    if (updateError) {
      console.error('[admin-update-member] update failed:', updateError)
      return errorResponse(500, 'UPDATE_FAILED', 'Mise à jour impossible')
    }

    return jsonResponse({ success: true, member: updated })
  } catch (err) {
    console.error('[admin-update-member] uncaught:', err)
    return errorResponse(500, 'SERVER_ERROR', (err as Error).message)
  }
})
