// GYM-129 — Édition de l'identité d'un membre par le gérant (gym_admin / super_admin).
//
// Correction au comptoir d'une faute de frappe : prénom / nom / téléphone UNIQUEMENT.
// JAMAIS email / role / gym_id (sécurité auth — hors périmètre v1). Écriture via
// service_role après contrôle strict : la cible est un 'member' du gym de l'appelant.
//
// GYM-224 — s'y ajoute `access_badge_code`, le code du badge physique qui ouvre la porte.
//
// ⚠️ POURQUOI ICI ET PAS DEPUIS LE DASHBOARD EN DIRECT. La liste blanche de GYM-203 a
// ramené le GRANT UPDATE de `authenticated` sur `profiles` à 24 colonnes ; access_badge_code
// n'en fait pas partie, délibérément — un membre ne modifie pas son propre code d'accès. Or
// le jeton du GÉRANT est lui aussi `authenticated` : le dashboard ne PEUT donc pas écrire
// cette colonne par PostgREST, et un PATCH la mentionnant serait rejeté en entier. Cette
// fonction, en service_role, est le seul chemin possible — et c'est déjà celui que le dépôt
// retient pour toute écriture du gérant sur le profil d'un tiers. Étendre plutôt que doubler :
// les gardes (rôle, appartenance à la salle de l'appelant, cible non supprimée) sont
// exactement celles dont le badge a besoin.
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

// GYM-224 — le code est une RÉFÉRENCE lue sur un badge, pas une saisie libre. La borne est
// large (les lecteurs vont de 4 chiffres à un UID Mylar de 20 caractères) mais elle existe :
// sans elle, un copier-coller malheureux stockerait une page entière dans la colonne.
const MAX_BADGE_CODE = 64

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
      access_badge_code?: string
    }
    const memberId = body.member_id
    if (!memberId) return errorResponse(400, 'MISSING_MEMBER_ID', 'member_id requis')

    // 3. Construire l'update UNIQUEMENT à partir des 4 champs autorisés (email/role/gym_id
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

    // GYM-224 — code du badge.
    //
    // ⚠️ CHAÎNE VIDE → NULL, jamais ''. L'index unique partiel ne filtre que les NULL :
    // deux membres « sans badge » stockés à '' entreraient en collision, et le second
    // enregistrement serait refusé sans raison compréhensible. Même parti que `phone`
    // ci-dessus, pour la même raison — effacer, c'est revenir à l'absence de valeur.
    if (body.access_badge_code !== undefined) {
      const v = body.access_badge_code.trim()
      if (v === '') {
        updates.access_badge_code = null
      } else if (v.length > MAX_BADGE_CODE) {
        return errorResponse(400, 'INVALID_BADGE_CODE', 'Code de badge invalide')
      } else {
        updates.access_badge_code = v
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

    // 4b. GYM-224 — le code est-il DÉJÀ porté par quelqu'un d'autre dans cette salle ?
    //
    // ⚠️ ON NE LAISSE PAS L'INDEX UNIQUE PARLER. Sa violation remonte un message Postgres
    // (« duplicate key value violates unique constraint idx_profiles_… ») qui n'apprend rien
    // au gérant : ni QUE le code est déjà pris, ni PAR QUI. Or c'est précisément ce qu'il a
    // besoin de savoir, quelqu'un devant lui — c'est la leçon de GYM-219, où « impossible
    // d'ajouter ce membre » obligeait à tester un second membre pour deviner la cause.
    // On nomme donc le porteur actuel.
    //
    // La recherche est bornée à la salle de l'appelant : deux salles peuvent utiliser la
    // même numérotation, et lui révéler un homonyme d'une autre salle serait une fuite.
    if (typeof updates.access_badge_code === 'string') {
      const { data: holder } = await admin
        .from('profiles')
        .select('id, first_name, last_name')
        .eq('gym_id', adminProfile.gym_id)
        .eq('access_badge_code', updates.access_badge_code)
        .neq('id', memberId) // réenregistrer SON PROPRE code n'est pas un conflit
        .is('deleted_at', null)
        .maybeSingle()

      if (holder) {
        return jsonResponse({
          error: true,
          code: 'BADGE_CODE_TAKEN',
          message: 'Ce code de badge est déjà attribué',
          // Le prénom suffit à identifier au comptoir et évite d'exposer la fiche entière.
          holder_first_name: holder.first_name ?? null,
        }, 409)
      }
    }

    // 5. Écriture (service_role) — colonnes autorisées uniquement.
    updates.updated_at = new Date().toISOString()
    const { data: updated, error: updateError } = await admin
      .from('profiles')
      .update(updates)
      .eq('id', memberId)
      .select('id, first_name, last_name, phone, access_badge_code')
      .single()

    if (updateError) {
      // GYM-224 — le contrôle 4b laisse une fenêtre : deux gérants attribuant le même code
      // au même instant passent tous deux la lecture avant que l'un n'écrive. L'index
      // tranche, et c'est très bien — mais son 23505 doit ressortir avec LE MÊME code
      // métier que le refus anticipé, pas en 500. Le porteur n'est pas relu ici : la course
      // est rarissime, et un aller-retour de plus pour nommer quelqu'un ne vaut pas le coup.
      if (updateError.code === '23505') {
        return jsonResponse({
          error: true,
          code: 'BADGE_CODE_TAKEN',
          message: 'Ce code de badge est déjà attribué',
          holder_first_name: null,
        }, 409)
      }
      console.error('[admin-update-member] update failed:', updateError)
      return errorResponse(500, 'UPDATE_FAILED', 'Mise à jour impossible')
    }

    return jsonResponse({ success: true, member: updated })
  } catch (err) {
    console.error('[admin-update-member] uncaught:', err)
    return errorResponse(500, 'SERVER_ERROR', (err as Error).message)
  }
})
