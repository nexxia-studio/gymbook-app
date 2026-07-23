// GYM-182 — Ajustement manuel de crédits par le gérant (gym_admin / super_admin).
//
// Le gérant OFFRE (ou retire) des crédits à un membre existant : parrainage, geste commercial,
// compensation. Les crédits offerts s'ajoutent au solde comme les autres (consommés en FIFO) mais
// SANS ligne de paiement — /revenus ne contient que de l'argent réel. Motif obligatoire, tracé
// dans credit_adjustments. Tout le travail (clamp, journal) est délégué à la RPC atomique
// adjust_member_credits_atomic (service_role). gym_id vient du profil de l'appelant, jamais du body.
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

    // 2. Entrée.
    const body = await req.json().catch(() => null) as
      | { member_id?: string; delta?: number; reason?: string }
      | null
    const memberId = body?.member_id
    const delta = body?.delta
    const reason = (body?.reason ?? '').trim()

    if (!memberId) return errorResponse(400, 'MISSING_MEMBER_ID', 'member_id requis')
    if (typeof delta !== 'number' || !Number.isInteger(delta) || delta === 0) {
      return errorResponse(400, 'INVALID_DELTA', 'delta doit être un entier non nul')
    }
    if (!reason) return errorResponse(400, 'REASON_REQUIRED', 'Motif obligatoire')

    // 3. Le membre visé appartient bien à la salle de l'appelant (jamais de gym_id du body).
    const { data: member } = await admin
      .from('profiles')
      .select('id, gym_id')
      .eq('id', memberId)
      .single()
    if (!member || member.gym_id !== gymId) {
      return errorResponse(403, 'MEMBER_NOT_IN_GYM', 'Membre hors de votre salle')
    }

    // 4. Ajustement atomique délégué à la RPC (clamp + journal). granted_by = appelant.
    const { data: result, error: rpcError } = await admin.rpc('adjust_member_credits_atomic', {
      p_member_id: memberId,
      p_gym_id: gymId,
      p_delta: delta,
      p_reason: reason,
      p_granted_by: user.id,
    })

    if (rpcError) {
      const msg = rpcError.message ?? ''
      if (msg.includes('INVALID_DELTA')) return errorResponse(400, 'INVALID_DELTA', 'delta doit être un entier non nul')
      if (msg.includes('REASON_REQUIRED')) return errorResponse(400, 'REASON_REQUIRED', 'Motif obligatoire')
      if (msg.includes('MEMBER_NOT_IN_GYM')) return errorResponse(403, 'MEMBER_NOT_IN_GYM', 'Membre hors de votre salle')
      console.error('[adjust-credits] adjust_member_credits_atomic failed:', rpcError)
      return errorResponse(500, 'ADJUST_FAILED', msg)
    }

    return jsonResponse({ ...result })
  } catch (err) {
    console.error('[adjust-credits] uncaught:', err)
    return errorResponse(500, 'SERVER_ERROR', (err as Error).message)
  }
})
