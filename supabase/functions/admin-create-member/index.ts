// GYM-144 — Création d'un membre au comptoir par le gérant (gym_admin).
//
// Contexte métier : un client se présente à la salle, s'inscrit et paie sa carte
// de séances en cash / terminal carte sur place. Le gérant crée le compte membre
// (invitation par email pour définir le mot de passe) et, optionnellement,
// enregistre une carte de séances payée hors-ligne, créditée immédiatement.
//
// Sécurité :
//  - verify_jwt = true (config.toml). L'appelant doit être gym_admin/super_admin.
//  - Le gym_id vient du profil de l'APPELANT, jamais du body.
//  - auth.users créé UNIQUEMENT via l'Auth Admin API (jamais SQL direct) ; le
//    trigger handle_new_user() crée le profil à partir des user_metadata.
//  - Prix autoritatif serveur : le montant vient de gym_plans, jamais du client.
//  - Crédits attribués par le RPC atomique apply_paid_payment (GYM-71), jamais
//    par un INSERT credits direct.
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolvePlan } from '../_shared/plan-resolver.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''

type PaymentMethod = 'cash' | 'card_terminal'

interface CreateMemberRequest {
  first_name?: string
  last_name?: string
  email?: string
  phone?: string
  plan_id?: string
  payment_method?: PaymentMethod
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

// Validation email volontairement permissive (le vrai contrôle est côté GoTrue).
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

// Détecte l'erreur "email déjà utilisé" renvoyée par l'Auth Admin API (GoTrue).
function isDuplicateEmailError(err: { code?: string; status?: number; message?: string } | null): boolean {
  if (!err) return false
  if (err.code === 'email_exists' || err.code === 'user_already_exists') return true
  const msg = (err.message ?? '').toLowerCase()
  return msg.includes('already been registered') || msg.includes('already registered') || msg.includes('already exists')
}

// Email d'invitation brandé Dopamine (charte : fond #F5F4F0, header noir #111111,
// wordmark DOPAMINE en #C8F000, footer Neupré). Aligné sur send-communication.
function buildInviteEmailHtml(firstName: string | null, actionLink: string): string {
  const greeting = firstName ? `Bonjour ${firstName},` : 'Bonjour,'
  return `<div style="font-family:'DM Sans','Helvetica Neue',Arial,sans-serif;background:#F5F4F0;padding:40px 20px;"><div style="max-width:520px;margin:0 auto;"><div style="background:#111111;padding:24px;border-radius:16px 16px 0 0;text-align:center;"><span style="font-family:'Arial Black',Arial,sans-serif;color:#C8F000;font-size:24px;letter-spacing:2px;">DOPAMINE</span></div><div style="background:#FFFFFF;padding:32px 28px;border-radius:0 0 16px 16px;"><h2 style="margin:0 0 8px;color:#111111;font-size:20px;">Bienvenue chez Dopamine 💪</h2><p style="color:#9A9890;font-size:13px;margin:0 0 20px;">${greeting}</p><p style="color:#3D3B36;font-size:14px;line-height:1.6;margin:0 0 24px;">Ton compte Dopamine a été créé par la salle. Définis ton mot de passe pour accéder à l'app et retrouver tes réservations et ta carte de séances.</p><div style="text-align:center;margin:0 0 8px;"><a href="${actionLink}" style="display:inline-block;background:#C8F000;color:#111111;font-weight:bold;font-size:14px;text-decoration:none;padding:14px 28px;border-radius:12px;">Définir mon mot de passe →</a></div></div><p style="text-align:center;color:#9A9890;font-size:11px;margin:16px 0 0;">Dopamine Performance Club · Neupré</p></div></div>`
}

// Génère le lien de définition de mot de passe (type recovery) et l'envoie via Resend.
// Best-effort : le résultat (true/false) n'interrompt jamais la création du membre.
async function sendInviteEmail(
  admin: SupabaseClient,
  email: string,
  firstName: string | null,
): Promise<boolean> {
  try {
    const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email })
    if (error || !data) {
      console.error('[admin-create-member] generateLink failed:', error)
      return false
    }
    const actionLink = data.properties?.action_link
    if (!actionLink) return false
    if (!RESEND_KEY) {
      console.error('[admin-create-member] RESEND_API_KEY manquant — email non envoyé')
      return false
    }

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({
        from: 'Dopamine <noreply@viniz.app>',
        to: email,
        subject: 'Ton compte Dopamine est prêt — définis ton mot de passe',
        html: buildInviteEmailHtml(firstName, actionLink),
      }),
    })
    if (!resp.ok) {
      console.error('[admin-create-member] Resend refus:', resp.status, await resp.text())
      return false
    }
    return true
  } catch (e) {
    console.error('[admin-create-member] sendInviteEmail error:', e)
    return false
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabaseAdmin = createClient(supabaseUrl, serviceKey)

    // 1. Auth appelant + contrôle de rôle gym_admin / super_admin.
    const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    if (!token) return errorResponse(401, 'UNAUTHORIZED', 'Non authentifié')

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (authError || !user) return errorResponse(401, 'UNAUTHORIZED', 'Non authentifié')

    const { data: adminProfile } = await supabaseAdmin
      .from('profiles')
      .select('role, gym_id')
      .eq('id', user.id)
      .single()

    if (!adminProfile || (adminProfile.role !== 'gym_admin' && adminProfile.role !== 'super_admin')) {
      return errorResponse(403, 'FORBIDDEN', 'Réservé au gérant de la salle')
    }
    const gymId = adminProfile.gym_id as string | null
    if (!gymId) return errorResponse(400, 'NO_GYM', 'Aucune salle associée à ce compte')

    // 2. Entrée.
    const body = await req.json() as CreateMemberRequest
    const firstName = body.first_name?.trim() ?? ''
    const lastName = body.last_name?.trim() ?? ''
    const email = body.email?.trim().toLowerCase() ?? ''
    const phone = body.phone?.trim() || null
    const planId = body.plan_id?.trim() || null
    const paymentMethod = body.payment_method

    if (!firstName || !lastName || !email) {
      return errorResponse(400, 'MISSING_FIELDS', 'Prénom, nom et email sont requis')
    }
    if (!isValidEmail(email)) {
      return errorResponse(400, 'INVALID_EMAIL', 'Email invalide')
    }
    if (planId && paymentMethod !== 'cash' && paymentMethod !== 'card_terminal') {
      return errorResponse(400, 'INVALID_PAYMENT_METHOD', 'Méthode de paiement invalide')
    }

    // 3. Si une carte est demandée : résoudre le plan AVANT de créer le compte
    //    (échec de plan = rien créé). Prix/crédits autoritatifs serveur.
    let plan = null as Awaited<ReturnType<typeof resolvePlan>>
    if (planId) {
      plan = await resolvePlan(supabaseAdmin, gymId, planId)
      if (!plan) return errorResponse(404, 'PLAN_NOT_FOUND', 'Formule introuvable ou inactive')
      if (!plan.is_one_time) {
        // Les abonnements Mollie ne peuvent pas être créés manuellement au comptoir.
        return errorResponse(422, 'PLAN_NOT_ONE_TIME', 'Un abonnement récurrent ne peut pas être enregistré manuellement')
      }
      if (plan.credit_count == null || plan.credit_count <= 0) {
        return errorResponse(422, 'PLAN_MISCONFIGURED', 'Formule mal configurée (crédits invalides)')
      }
    }

    // 4. Création du compte via Auth Admin API. Le trigger handle_new_user()
    //    crée le profil (first_name/last_name/gym_id/role/phone) à partir des metadata.
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        first_name: firstName,
        last_name: lastName,
        gym_id: gymId,
        role: 'member',
        phone,
      },
    })

    if (createErr || !created?.user) {
      if (isDuplicateEmailError(createErr)) {
        return errorResponse(409, 'EMAIL_EXISTS', 'Un compte existe déjà avec cet email')
      }
      console.error('[admin-create-member] createUser failed:', createErr)
      return errorResponse(500, 'CREATE_FAILED', 'Création du compte impossible')
    }

    const userId = created.user.id

    // 5. Email d'invitation (best-effort — n'échoue jamais la création).
    const emailSent = await sendInviteEmail(supabaseAdmin, email, firstName)

    // 6. Carte de séances payée sur place (optionnelle).
    let paymentInfo: { id: string; status: string; credits: number } | undefined
    let warning: string | undefined

    if (plan) {
      const paymentRowId = crypto.randomUUID()
      const { error: insertErr } = await supabaseAdmin.from('payments').insert({
        id: paymentRowId,
        gym_id: gymId,
        member_id: userId,
        plan_id: plan.plan_id,
        plan_name: plan.name,
        amount: plan.price_cents / 100,
        currency: plan.currency,
        credits_granted: plan.credit_count,
        status: 'pending',
        // Paiement hors-ligne : pas de mollie_payment_id ni de checkout_url.
        // payment_method (cash / card_terminal) est posé par apply_paid_payment.
      })

      if (insertErr) {
        console.error('[admin-create-member] payment insert failed:', insertErr)
        warning = 'PAYMENT_NOT_RECORDED'
      } else {
        // Crédit atomique et idempotent (GYM-71) — c'est le RPC qui crédite.
        const { data: rpcResult, error: rpcErr } = await supabaseAdmin.rpc('apply_paid_payment', {
          p_payment_id: paymentRowId,
          p_payment_method: paymentMethod,
          p_paid_at: new Date().toISOString(),
        })
        if (rpcErr || (rpcResult !== 'applied' && rpcResult !== 'already_applied')) {
          console.error('[admin-create-member] apply_paid_payment failed:', rpcErr, rpcResult)
          warning = 'CREDITS_NOT_APPLIED'
          paymentInfo = { id: paymentRowId, status: 'pending', credits: 0 }
        } else {
          paymentInfo = { id: paymentRowId, status: 'paid', credits: plan.credit_count ?? 0 }
        }
      }
    }

    return jsonResponse({
      success: true,
      user_id: userId,
      email_sent: emailSent,
      ...(paymentInfo ? { payment: paymentInfo } : {}),
      ...(warning ? { warning } : {}),
    })
  } catch (err) {
    console.error('[admin-create-member] uncaught:', err)
    return errorResponse(500, 'SERVER_ERROR', (err as Error).message)
  }
})
