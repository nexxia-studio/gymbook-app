// GYM-200 — Invitation d'un MEMBRE D'ÉQUIPE (accès dashboard) par un gérant.
//
// Contexte : inviter un gérant passait par Supabase Studio, qui ne transporte AUCUNE
// métadonnée. Le profil naissait donc sans gym_id, l'invité atterrissait sur /pending, et
// le cockpit devait poser rôle et salle à la main — impraticable au-delà du pilote et
// impossible à déléguer.
//
// Ici, l'invitation PORTE la salle et le rôle, scellés côté serveur :
//   generateLink(type:'invite', options.data) → user_metadata → handle_new_user() (GYM-150)
//   pose un profil COMPLET (gym_id, role, first_name, last_name) dès la création.
// L'invité arrive donc sur /welcome (page d'activation GYM-202) avec sa salle et son rôle
// déjà connus, les définit son mot de passe, et entre DIRECTEMENT sur le dashboard.
//
// ⚠️ PRINCIPE NON NÉGOCIABLE — le rôle est décidé par CELUI QUI INVITE :
//   - le gym_id vient TOUJOURS du profil de l'appelant, JAMAIS du body ;
//   - le rôle demandé est validé contre une liste fermée (INVITABLE_ROLES) ;
//   - l'invité ne peut rien redéclarer : AccountActivation.tsx affiche salle et rôle en
//     lecture seule et n'écrit ni role ni gym_id (GYM-202), et depuis GYM-203 le GRANT
//     UPDATE sur profiles ne comporte plus ces colonnes.
//
// Modèle suivi : admin-create-member (GYM-144) — mêmes contrôles d'appelant, même envoi
// Resend best-effort, mêmes formes de réponse.
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''

// Rôles qu'un gérant peut ATTRIBUER en invitant.
//
// 'coach' n'existe pas encore en base (GYM-176 : RLS, garde dashboard et permissions).
// Le jour où il existera, l'ajouter à ce seul tableau suffit — tout le reste de la
// fonction est déjà générique. Ne PAS ajouter 'super_admin' : c'est un rôle Nexxia, il ne
// s'attribue pas depuis le dashboard d'une salle.
const INVITABLE_ROLES = ['gym_admin'] as const
type InvitableRole = (typeof INVITABLE_ROLES)[number]

// Rôles autorisés à INVITER (et à administrer l'équipe).
const TEAM_MANAGER_ROLES = ['gym_admin', 'super_admin']

// Libellé humain du rôle, pour l'email. Ajouter l'entrée en même temps que le rôle.
const ROLE_LABEL_FR: Record<InvitableRole, string> = {
  gym_admin: 'gérant',
}

interface InviteRequest {
  email?: string
  role?: string
  first_name?: string
  last_name?: string
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

// Validation permissive (le vrai contrôle est côté GoTrue).
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function isInvitableRole(role: string): role is InvitableRole {
  return (INVITABLE_ROLES as readonly string[]).includes(role)
}

// Détecte l'erreur « email déjà utilisé » renvoyée par l'Auth Admin API (GoTrue).
// Repris à l'identique d'admin-create-member : les codes GoTrue varient selon les versions.
function isDuplicateEmailError(err: { code?: string; status?: number; message?: string } | null): boolean {
  if (!err) return false
  if (err.code === 'email_exists' || err.code === 'user_already_exists') return true
  const msg = (err.message ?? '').toLowerCase()
  return msg.includes('already been registered') || msg.includes('already registered') || msg.includes('already exists')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// Email d'invitation brandé VINIZ (indigo #4827B4 / lime #C8FF3D), NOMMANT LA SALLE ET LE
// RÔLE. C'est très exactement ce que les templates Supabase — globaux au projet, sans
// variables métier — ne permettront jamais.
function buildInviteEmailHtml(params: {
  inviterName: string | null
  gymName: string
  roleLabel: string
  firstName: string | null
  actionLink: string
  isResend: boolean
}): string {
  const { inviterName, gymName, roleLabel, firstName, actionLink, isResend } = params
  const greeting = firstName ? `Bonjour ${escapeHtml(firstName)},` : 'Bonjour,'
  const gym = escapeHtml(gymName)
  const intro = inviterName
    ? `${escapeHtml(inviterName)} t'invite à rejoindre <strong>${gym}</strong> sur Viniz en tant que <strong>${escapeHtml(roleLabel)}</strong>.`
    : `Tu es invité·e à rejoindre <strong>${gym}</strong> sur Viniz en tant que <strong>${escapeHtml(roleLabel)}</strong>.`
  const reminder = isResend
    ? `<p style="color:#9A9890;font-size:12px;line-height:1.6;margin:0 0 20px;">Ce message remplace l'invitation précédente : seul ce nouveau lien est valide.</p>`
    : ''

  return `<div style="font-family:'DM Sans','Helvetica Neue',Arial,sans-serif;background:#F5F4F0;padding:40px 20px;"><div style="max-width:520px;margin:0 auto;"><div style="background:#17102E;padding:24px;border-radius:16px 16px 0 0;text-align:center;"><span style="font-family:'Arial Black',Arial,sans-serif;color:#C8FF3D;font-size:24px;letter-spacing:2px;">VINIZ</span></div><div style="background:#FFFFFF;padding:32px 28px;border-radius:0 0 16px 16px;"><h2 style="margin:0 0 8px;color:#17102E;font-size:20px;">Rejoins l'équipe de ${gym}</h2><p style="color:#9A9890;font-size:13px;margin:0 0 20px;">${greeting}</p><p style="color:#3D3B36;font-size:14px;line-height:1.6;margin:0 0 8px;">${intro}</p><p style="color:#3D3B36;font-size:14px;line-height:1.6;margin:0 0 24px;">Active ton compte pour choisir ton mot de passe et accéder au tableau de bord.</p>${reminder}<div style="text-align:center;margin:0 0 8px;"><a href="${actionLink}" style="display:inline-block;background:#4827B4;color:#C8FF3D;font-weight:bold;font-size:14px;text-decoration:none;padding:14px 28px;border-radius:12px;">Activer mon compte →</a></div><p style="color:#9A9890;font-size:12px;line-height:1.6;margin:20px 0 0;">Si tu n'attendais pas cette invitation, ignore simplement cet email : aucun compte ne sera activé sans cette action.</p></div><p style="text-align:center;color:#9A9890;font-size:11px;margin:16px 0 0;">${gym} · propulsé par Viniz</p></div></div>`
}

// Envoi Resend — BEST-EFFORT, comme admin-create-member : un échec d'envoi ne doit pas
// faire échouer l'invitation (le compte existe), mais il est REMONTÉ dans la réponse
// (email_sent:false) pour que le dashboard puisse proposer un renvoi. Un compte à moitié
// créé sans que personne ne le sache est précisément ce qu'on veut éviter.
async function sendInviteEmail(params: {
  actionLink: string
  email: string
  firstName: string | null
  inviterName: string | null
  gymName: string
  roleLabel: string
  isResend: boolean
}): Promise<boolean> {
  try {
    if (!RESEND_KEY) {
      console.error('[invite-team-member] RESEND_API_KEY manquant — email non envoyé')
      return false
    }
    const subject = params.isResend
      ? `Nouvelle invitation — rejoins ${params.gymName} sur Viniz`
      : `${params.gymName} t'invite à rejoindre son équipe sur Viniz`

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({
        from: 'Viniz <noreply@viniz.app>',
        to: params.email,
        subject,
        html: buildInviteEmailHtml(params),
      }),
    })
    if (!resp.ok) {
      console.error('[invite-team-member] Resend refus:', resp.status, await resp.text())
      return false
    }
    return true
  } catch (e) {
    console.error('[invite-team-member] sendInviteEmail error:', e)
    return false
  }
}

// GYM-200 §2 — DÉCISION PRODUIT : tout gérant est aussi un coach potentiel. On crée donc
// son entrée `coaches` dès l'invitation, mais INACTIVE : il l'activera lui-même s'il anime
// réellement des cours. L'inverse n'est pas vrai — un coach n'est pas forcément gérant, et
// rien ici ne crée de compte à partir d'une fiche coach.
//
// Best-effort : l'invitation reste valide si l'insertion échoue (warning dans la réponse).
async function createCoachEntry(
  admin: SupabaseClient,
  params: { gymId: string; profileId: string; firstName: string; lastName: string; email: string },
): Promise<boolean> {
  try {
    // coaches.name est NOT NULL — repli sur la partie locale de l'email si l'invitation
    // n'a pas transporté de nom (les deux champs sont optionnels côté body).
    const name = `${params.firstName} ${params.lastName}`.trim() || params.email.split('@')[0]
    const { error } = await admin.from('coaches').insert({
      gym_id: params.gymId,
      profile_id: params.profileId,
      name,
      active: false,
    })
    if (error) {
      console.error('[invite-team-member] coach insert failed:', error)
      return false
    }
    return true
  } catch (e) {
    console.error('[invite-team-member] coach insert threw:', e)
    return false
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
      .select('role, gym_id, first_name, last_name')
      .eq('id', user.id)
      .single()

    if (!callerProfile || !TEAM_MANAGER_ROLES.includes(callerProfile.role)) {
      return errorResponse(403, 'FORBIDDEN', 'Réservé au gérant de la salle')
    }

    // ⚠️ LE point de sécurité : gym_id vient du PROFIL de l'appelant. Le body n'a aucun
    // moyen de l'influencer — il n'est même pas lu.
    const gymId = callerProfile.gym_id as string | null
    if (!gymId) return errorResponse(400, 'NO_GYM', 'Aucune salle associée à ce compte')

    // 2. Entrée.
    const body = await req.json() as InviteRequest
    const email = body.email?.trim().toLowerCase() ?? ''
    const requestedRole = body.role?.trim() ?? ''
    const firstName = body.first_name?.trim() ?? ''
    const lastName = body.last_name?.trim() ?? ''

    if (!email) return errorResponse(400, 'MISSING_FIELDS', 'Email requis')
    if (!isValidEmail(email)) return errorResponse(400, 'INVALID_EMAIL', 'Email invalide')
    if (!isInvitableRole(requestedRole)) {
      return errorResponse(400, 'INVALID_ROLE', 'Rôle non attribuable depuis le dashboard')
    }

    // 3. Nom de la salle — il figure dans l'email, c'est tout l'intérêt d'un envoi Resend.
    const { data: gym } = await admin
      .from('nexxia_gyms')
      .select('name')
      .eq('id', gymId)
      .single()
    const gymName = gym?.name ?? 'votre salle'

    const inviterName = [callerProfile.first_name, callerProfile.last_name]
      .filter(Boolean).join(' ').trim() || null
    const roleLabel = ROLE_LABEL_FR[requestedRole]
    const dashboardUrl = Deno.env.get('DASHBOARD_URL') ?? 'https://gymbook-app.vercel.app'
    // Page d'activation GYM-202. Le lien y dépose la session ; AccountActivation.tsx
    // reconnaît l'arrivée sur la seule présence d'un access_token dans le fragment, ce qui
    // couvre aussi bien type=invite (1re invitation) que type=recovery (renvoi ci-dessous).
    const redirectTo = `${dashboardUrl}/welcome`

    // 4. Compte déjà existant ? On distingue trois cas AVANT de tenter quoi que ce soit,
    //    pour renvoyer une erreur lisible plutôt qu'un échec GoTrue opaque.
    const { data: existing } = await admin
      .from('profiles')
      .select('id, gym_id, role')
      .eq('email', email)
      .maybeSingle()

    if (existing) {
      if (existing.gym_id !== gymId) {
        // Compte rattaché à une AUTRE salle (ou à aucune) : on ne le capture pas.
        return errorResponse(409, 'EMAIL_EXISTS', 'Un compte existe déjà avec cet email')
      }

      const { data: target } = await admin.auth.admin.getUserById(existing.id)
      if (target?.user?.last_sign_in_at) {
        return errorResponse(409, 'ALREADY_ACTIVE', 'Ce compte est déjà actif')
      }

      // Invitation encore en attente → RENVOI. type 'recovery' et non 'invite' : GoTrue
      // refuse une invitation sur un utilisateur existant. Le lien rouvre une session et
      // ramène sur /welcome, où l'activation se termine normalement.
      const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: { redirectTo },
      })
      const resendLink = link?.properties?.action_link
      if (linkErr || !resendLink) {
        console.error('[invite-team-member] generateLink (resend) failed:', linkErr)
        return errorResponse(500, 'LINK_FAILED', 'Génération du lien impossible')
      }

      const resent = await sendInviteEmail({
        actionLink: resendLink,
        email,
        firstName: firstName || null,
        inviterName,
        gymName,
        roleLabel: ROLE_LABEL_FR[existing.role as InvitableRole] ?? roleLabel,
        isResend: true,
      })

      return jsonResponse({
        success: true,
        resent: true,
        user_id: existing.id,
        email_sent: resent,
        ...(resent ? {} : { warning: 'EMAIL_NOT_SENT' }),
      })
    }

    // 5. Création du compte + lien d'invitation en UN appel.
    //    generateLink(type:'invite') crée l'utilisateur SANS envoyer l'email Supabase (c'est
    //    la différence avec inviteUserByEmail) : on garde donc la main sur le contenu, tout
    //    en scellant salle et rôle dans les user_metadata que handle_new_user() recopie.
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'invite',
      email,
      options: {
        data: {
          first_name: firstName,
          last_name: lastName,
          gym_id: gymId,
          role: requestedRole,
        },
        redirectTo,
      },
    })

    if (linkErr || !link?.user || !link.properties?.action_link) {
      if (isDuplicateEmailError(linkErr)) {
        return errorResponse(409, 'EMAIL_EXISTS', 'Un compte existe déjà avec cet email')
      }
      console.error('[invite-team-member] generateLink (invite) failed:', linkErr)
      return errorResponse(500, 'CREATE_FAILED', 'Création du compte impossible')
    }

    const invitedId = link.user.id
    const actionLink = link.properties.action_link

    // 6. Entrée coach inactive (§2) — best-effort.
    const coachCreated = requestedRole === 'gym_admin'
      ? await createCoachEntry(admin, { gymId, profileId: invitedId, firstName, lastName, email })
      : true

    // 7. Email d'invitation — best-effort, mais le résultat est remonté.
    const emailSent = await sendInviteEmail({
      actionLink,
      email,
      firstName: firstName || null,
      inviterName,
      gymName,
      roleLabel,
      isResend: false,
    })

    const warnings = [
      ...(emailSent ? [] : ['EMAIL_NOT_SENT']),
      ...(coachCreated ? [] : ['COACH_NOT_CREATED']),
    ]

    return jsonResponse({
      success: true,
      user_id: invitedId,
      email_sent: emailSent,
      ...(warnings.length ? { warning: warnings.join(',') } : {}),
    })
  } catch (err) {
    console.error('[invite-team-member] uncaught:', err)
    return errorResponse(500, 'SERVER_ERROR', (err as Error).message)
  }
})
