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
//
// GYM-222 — L'ENCAISSEMENT N'HABITE PLUS ICI. Gardes de formule, ligne payments,
// apply_paid_payment et facture sont passés dans _shared/counter-sale.ts pour que la vente
// à un membre DÉJÀ INSCRIT (admin-sell-plan) soit le MÊME geste, et non un second
// encaissement qui divergerait. Ce qui reste ci-dessous est ce qui relève réellement de la
// création du compte : identité, auth.admin.createUser, email d'invitation.
// Le comportement de cette fonction est inchangé, y compris l'ordre : le plan est résolu
// AVANT createUser (échec de plan = aucun compte créé), l'encaissement n'a lieu qu'après.
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
// GYM-238 — chrome des emails composée depuis nexxia_gyms.
import { loadGymBranding, emailSender, emailShell, escapeHtml, type GymBranding } from '../_shared/gym-branding.ts'
import {
  collectCounterPayment,
  isPaymentMethod,
  resolveSellablePlan,
  type PaymentMethod,
} from '../_shared/counter-sale.ts'
import type { ResolvedPlan } from '../_shared/plan-resolver.ts'
// GYM-246 — porte d'entrée unique du gating (GYM-245).
import { getEffectivePlan } from '../_shared/effective-plan.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''

// GYM-170 — lien de téléchargement de l'app membre (invitation → activation).
// GYM-173 — URL publique App Store depuis l'approbation Apple : un membre ne doit plus
// passer par TestFlight (bêta fermée, places limitées, app tierce à installer).
//
// Le segment /be/ est OBLIGATOIRE, NE PAS le retirer en le croyant superflu : la
// distribution de l'app est limitée aux 42 pays européens. Sans code pays, Apple retombe
// sur la boutique US — où l'app n'existe pas — et renvoie une 404. L'erreur est invisible
// sur iPhone (la boutique du compte, belge, est utilisée) mais frappe tout membre qui
// ouvre l'email d'invitation depuis un navigateur desktop.
const APP_DOWNLOAD_URL = 'https://apps.apple.com/be/app/dopamine-performance-club/id6781670485'

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

// GYM-238 — Email d'invitation aux couleurs DE LA SALLE.
//
// ⚠️ ICI LE NOM N'ÉTAIT PAS QUE DANS LA CHROME, IL ÉTAIT DANS LE TEXTE : « Bienvenue chez
// Dopamine », « Ton compte Dopamine », « l'application Dopamine ». Une seconde salle aurait
// souhaité la bienvenue à ses membres au nom d'une salle concurrente. Corriger l'en-tête
// sans corriger la copie n'aurait rien réglé.
function buildInviteEmailHtml(gym: GymBranding, firstName: string | null, actionLink: string): string {
  const greeting = firstName ? `Bonjour ${firstName},` : 'Bonjour,'
  const gymName = escapeHtml(gym.name)
  return emailShell(gym, {
    title: `Bienvenue chez ${gym.name} 💪`,
    bodyHtml:
      `<p style="color:#9A9890;font-size:13px;margin:0 0 20px;">${greeting}</p>` +
      `<p style="color:#3D3B36;font-size:14px;line-height:1.6;margin:0 0 24px;">Ton compte ${gymName} a été créé par la salle. Définis ton mot de passe pour accéder à l'app et retrouver tes réservations et ta carte de séances.</p>` +
      `<div style="border-top:1px solid #E8E6E0;margin:24px 0 0;padding-top:20px;">` +
      `<p style="color:#111111;font-size:14px;font-weight:bold;margin:0 0 6px;">Prochaine étape</p>` +
      `<p style="color:#3D3B36;font-size:14px;line-height:1.6;margin:0 0 16px;">Réserve tes cours depuis l'application ${gymName}.</p>` +
      `<div style="text-align:center;"><a href="${APP_DOWNLOAD_URL}" style="display:inline-block;background:${gym.secondaryColor};color:${gym.primaryColor};font-weight:bold;font-size:14px;text-decoration:none;padding:12px 24px;border-radius:12px;">Télécharger l'app ${gymName} →</a></div></div>`,
    // Le lien d'activation est une URL Supabase déjà construite : `ctaUrl`, pas `ctaPath`.
    ctaLabel: 'Définir mon mot de passe →',
    ctaUrl: actionLink,
  })
}

// Génère le lien de définition de mot de passe (type recovery) et l'envoie via Resend.
// Best-effort : le résultat (true/false) n'interrompt jamais la création du membre.
async function sendInviteEmail(
  admin: SupabaseClient,
  // GYM-238 — la salle qui invite. Passée plutôt que relue : l'appelant a déjà lu et
  // validé `gymId` sur le profil du gérant.
  gymId: string,
  email: string,
  firstName: string | null,
): Promise<boolean> {
  try {
    const gym = await loadGymBranding(admin, gymId)
    // redirectTo explicite vers la page publique /reset-password du dashboard (GYM-157),
    // sinon le lien retombe sur la Site URL par défaut du projet Supabase. Aucune constante
    // partagée d'URL dashboard n'existe côté functions → env DASHBOARD_URL avec fallback.
    const dashboardUrl = Deno.env.get('DASHBOARD_URL') ?? 'https://gymbook-app.vercel.app'
    const { data, error } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo: `${dashboardUrl}/reset-password` },
    })
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
        from: emailSender(gym),
        to: email,
        // L'objet portait « Dopamine » en dur — premier mot que voit le destinataire.
        subject: `Ton compte ${gym.name} est prêt — définis ton mot de passe`,
        html: buildInviteEmailHtml(gym, firstName, actionLink),
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
    if (planId && !isPaymentMethod(paymentMethod)) {
      return errorResponse(400, 'INVALID_PAYMENT_METHOD', 'Méthode de paiement invalide')
    }

    // ── GYM-246 — garde serveur : plafond de membres ────────────────────────────
    // Placée après la validation d'entrée (un champ manquant mérite son propre message)
    // et AVANT la résolution de formule et la création du compte : rien n'est créé, rien
    // n'est encaissé sur un refus.
    //
    // ⚠️ null = PANNE DE RÉSOLUTION, jamais « aucun droit » : 503, aucune écriture.
    const effectivePlan = await getEffectivePlan(supabaseAdmin, gymId)
    if (!effectivePlan) {
      return errorResponse(503, 'PLAN_RESOLUTION_FAILED', 'Plan indisponible — réessayez dans un instant')
    }

    const maxMembers = effectivePlan.limits.max_members
    if (maxMembers !== null) {
      // Périmètre du compte : les MEMBRES actifs de cette salle. Les gérants et coachs
      // relèvent de max_admins, les comptes supprimés ne consomment pas de place.
      const { count, error: countErr } = await supabaseAdmin
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('gym_id', gymId)
        .eq('role', 'member')
        .is('deleted_at', null)

      if (countErr || count === null) {
        // Compter est une PRÉCONDITION du refus : sans le compte, on ne sait pas si la
        // limite est atteinte. Laisser passer ouvrirait la porte à l'infini, refuser
        // punirait une salle en règle — dans les deux cas on trancherait sans savoir.
        console.error('[admin-create-member] member count failed:', countErr)
        return errorResponse(503, 'PLAN_RESOLUTION_FAILED', 'Plan indisponible — réessayez dans un instant')
      }

      if (count >= maxMembers) {
        // ⚠️ RÈGLE DE RÉTROGRADATION : on bloque les NOUVEAUX ajouts, on ne supprime
        // jamais l'existant. Une salle à 60 membres passée sur un plan à 50 garde ses 60 ;
        // elle ne peut simplement plus en ajouter. D'où `>=` sur le compte courant et
        // aucune action sur les profils déjà là.
        // `current` et `max` alimentent l'upsell GYM-247 : « 50 / 50 » se lit, « limite
        // atteinte » non.
        return jsonResponse({
          error: true,
          code: 'PLAN_MEMBER_LIMIT',
          message: 'Limite de membres atteinte pour votre plan Viniz',
          current: count,
          max: maxMembers,
        }, 403)
      }
    }

    // 3. Si une carte est demandée : résoudre le plan AVANT de créer le compte
    //    (échec de plan = rien créé). Prix/crédits autoritatifs serveur.
    //    GYM-222 — gardes de formule partagées (PLAN_NOT_FOUND / PLAN_NOT_ONE_TIME /
    //    PLAN_MISCONFIGURED, dérogation once_per_member incluse) : mêmes codes, mêmes
    //    statuts qu'avant, mais un seul exemplaire pour les deux chemins d'encaissement.
    let plan: ResolvedPlan | null = null
    if (planId) {
      const resolved = await resolveSellablePlan(supabaseAdmin, gymId, planId)
      if (resolved.refusal) {
        return errorResponse(resolved.refusal.status, resolved.refusal.code, resolved.refusal.message)
      }
      plan = resolved.plan
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
    const emailSent = await sendInviteEmail(supabaseAdmin, gymId, email, firstName)

    // 6. Carte de séances payée sur place (optionnelle).
    let paymentInfo: {
      id: string; status: string; credits: number
      delivered?: string; subscription_id?: string
    } | undefined
    let warning: string | undefined
    let invoiceSent = false

    if (plan) {
      // GYM-222 — encaissement partagé : ligne payments + apply_paid_payment (crédits OU
      // abonnement selon la nature du plan) + facture GYM-167. Le membre reçoit donc deux
      // emails : invitation + facture.
      //
      // 🔴 UN ÉCHEC RESTE UN AVERTISSEMENT ICI, PAS UNE ERREUR : le compte vient d'être
      // créé et l'email d'invitation est parti — renvoyer une erreur ferait croire au
      // gérant que rien n'a eu lieu et le pousserait à recréer le membre. Le chemin
      // « membre existant » (admin-sell-plan) tranche l'inverse : il n'a rien à préserver.
      const outcome = await collectCounterPayment(supabaseAdmin, {
        gymId,
        memberId: userId,
        plan,
        paymentMethod: paymentMethod as PaymentMethod,
        logPrefix: '[admin-create-member]',
      })
      paymentInfo = outcome.warning === 'PAYMENT_NOT_RECORDED' ? undefined : outcome.payment
      warning = outcome.warning
      invoiceSent = outcome.invoiceSent
    }

    return jsonResponse({
      success: true,
      user_id: userId,
      email_sent: emailSent,
      ...(paymentInfo ? { payment: paymentInfo } : {}),
      ...(paymentInfo?.status === 'paid' ? { invoice_sent: invoiceSent } : {}),
      ...(warning ? { warning } : {}),
    })
  } catch (err) {
    console.error('[admin-create-member] uncaught:', err)
    return errorResponse(500, 'SERVER_ERROR', (err as Error).message)
  }
})
