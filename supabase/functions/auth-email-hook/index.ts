// GYM-262 — TOUS LES EMAILS D'AUTHENTIFICATION, BRANDÉS PAR TENANT.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// LE DÉFAUT QUE CE LOT CORRIGE
// ─────────────────────────────────────────────────────────────────────────────────────
// GoTrue n'a QU'UN jeu de gabarits par projet Supabase. Un seul « Confirm signup », un
// seul « Reset password », pour tout le monde. Conséquences déjà visibles :
//   · un nouveau GÉRANT qui s'inscrit sur Viniz reçoit « Bienvenue chez Dopamine » ;
//   · demain, un membre de la salle X recevra un email aux couleurs de la salle Y.
// Aucun réglage de dashboard ne résout ça : les gabarits GoTrue ne connaissent ni la
// salle, ni le rôle, ni l'intention d'inscription. C'est le dernier verrou avant
// l'ouverture publique du funnel.
//
// ⚠️ CE N'EST PAS LE MÊME PROBLÈME QUE GYM-238. GYM-238 a branché les emails MÉTIER
// (réservation, annulation, paiement…) sur l'identité de la salle : ces envois-là sont
// faits par NOS fonctions, avec notre clé Resend. Les emails d'AUTH, eux, ne passaient
// pas par nous du tout — c'est GoTrue qui les composait et les envoyait. Le Send Email
// Hook est le seul point d'interception qui existe.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// CE QUI SE PASSE SI CETTE FONCTION ÉCHOUE — À LIRE AVANT DE LA MODIFIER
// ─────────────────────────────────────────────────────────────────────────────────────
// 🔴 IL N'Y A AUCUN REPLI. Le hook est BLOQUANT : quand il est activé, GoTrue lui
// délègue l'envoi et ne se rabat JAMAIS sur ses propres gabarits.
//
//   « Errors are responses which contain status codes 400 and above. […] the error is
//     propagated from the hook to Supabase Auth and translated into an HTTP error which
//     is returned to your application. »
//   « Both HTTP Hooks and Postgres Hooks are run in a transaction […] HTTP Hooks should
//     complete in 5 seconds. »
//   — supabase.com/docs/guides/auth/auth-hooks (§ Error handling / § Timeouts),
//     consultée le 24/08/2026. Table « Email sending behavior » de
//     supabase.com/docs/guides/auth/auth-hooks/send-email-hook : « Email Provider
//     Enabled + Auth Hook Enabled → Auth Hook handles email sending (SMTP not used) ».
//
// Autrement dit : une exception non rattrapée ici ne dégrade pas l'email, elle fait
// ÉCHOUER L'INSCRIPTION ELLE-MÊME. D'où la construction en trois cercles :
//   1. rien de ce qui sert à DÉCORER l'email ne peut le faire échouer — la lecture du
//      profil et celle de la salle sont best-effort et retombent sur un gabarit neutre ;
//   2. tout le corps du handler est sous un try/catch global qui rend une réponse JSON
//      propre plutôt que de laisser filer une stack ;
//   3. seul un échec d'ENVOI est remonté en erreur — parce que rendre 200 sans avoir
//      envoyé créerait un compte que personne ne peut confirmer, un trou noir bien pire
//      qu'une inscription qui échoue franchement et que l'utilisateur peut retenter.
//
// ⚠️ BUDGET 5 SECONDES, RETRIES COMPRIS. On fait donc au plus DEUX lectures Postgres
// (profil, puis salle) et UN appel Resend, borné par un AbortController. Ajouter un
// aller-retour ici, c'est rapprocher chaque inscription du timeout.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// CE QUI N'EST **PAS** INTERCEPTÉ
// ─────────────────────────────────────────────────────────────────────────────────────
// `auth.admin.generateLink()` GÉNÈRE un lien sans envoyer : il ne déclenche pas le hook.
// Les deux parcours qui l'utilisent — admin-create-member (GYM-144) et invite-team-member
// (GYM-200) — composent et envoient déjà leur propre email et restent INCHANGÉS. Aucun
// doublon à craindre, et rien à dé-brancher chez eux.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
// Vérification de signature Standard Webhooks — la bibliothèque citée par la doc Supabase.
import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0'
import {
  loadGymBranding,
  emailSender,
  emailShell,
  escapeHtml,
  type GymBranding,
} from '../_shared/gym-branding.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
// Secret du hook, au format `v1,whsec_<base64>` fourni par le dashboard Supabase
// (Authentication → Hooks). Le préfixe doit être retiré avant d'être passé au vérificateur.
const HOOK_SECRET = Deno.env.get('SEND_EMAIL_HOOK_SECRET') ?? ''

// Marge sous le budget de 5 s de GoTrue : au-delà, l'appel Resend est abandonné et l'échec
// est remonté comme ré-essayable, plutôt que de laisser GoTrue trancher par un timeout —
// un timeout côté GoTrue ne dit RIEN dans nos logs, un abandon ici est tracé.
const RESEND_TIMEOUT_MS = 3_000

// ─────────────────────────────────────────────────────────────────────────────────────
// L'IDENTITÉ VINIZ, EN DUR — ET POURQUOI C'EN EST LA BONNE PLACE
// ─────────────────────────────────────────────────────────────────────────────────────
// La règle « pas de données Dopamine en dur » vise les données de SALLE, qui varient d'un
// tenant à l'autre et se règlent au cockpit. Viniz n'est pas un tenant : c'est le produit.
// Son nom et ses couleurs sont de l'infrastructure, au même titre que LINKS_BASE ou que le
// domaine d'envoi vérifié — les écrire en base créerait une ligne « salle » fantôme que
// personne n'administre.
//
// ⚠️ LES JETONS SONT REMPLOYÉS DE L'EMAIL D'INVITATION GYM-200, à l'identique, pour que
// les deux emails Viniz que peut recevoir un même gérant se ressemblent :
//   secondaryColor #17102E = fond de l'en-tête   → le mot VINIZ s'y détache en lime
//   primaryColor   #C8FF3D = couleur du mot-marque
//   ctaBg/ctaFg    #4827B4 sur #C8FF3D           → le bouton violet de la marque
// `slug` vide est VOULU : aucun Universal Link membre n'a de sens ici, et tous les boutons
// de ces emails passent par `ctaUrl` (une URL GoTrue absolue), jamais par `ctaPath`.
//
// 🔴 GYM-303 — LE MOT-MARQUE RÉEL EST ARRIVÉ, ET C'EST LA LIGNE `logoUrl` QUI CHANGE.
//
// CE QUI BLOQUAIT, ET QUI NE BLOQUE PLUS. Ce hook affichait « VINIZ » en texte brut faute
// d'asset : le dépôt ne contenait que des icônes CARRÉES 512×512 sans transparence, qui
// auraient peint un carré sur l'en-tête sombre au lieu d'un logotype. Le SVG existait,
// mais Gmail et Outlook ne rendent pas les SVG, et le dépôt n'a aucun rastériseur.
//
// Les PNG sont maintenant dans `apps/links/public/brand/`, servis par un site statique
// public : voir le README de ce dossier pour les dimensions et la règle de régénération.
//
// ⚠️ LE `@2x` N'EST PAS UN CAPRICE. `headerHtml` rend le logo à `width="160"` EN DUR —
// Outlook ignore les largeurs relatives. Le 1x mesure 250 px : réduit à 160, il est flou
// sur tout écran à haute densité. Le `@2x` en fait 499, soit environ trois fois la taille
// rendue, pour 10 Ko.
//
// ⚠️ ET LE GARDE-FOU RESTE LA CEINTURE. `isUsablePng` n'affiche une `<img>` que si l'URL
// est en `https` ET finit par `.png` ; sinon il retombe sur le nom en texte, qui est
// correct. Ce hook est BLOQUANT sans repli — un gabarit cassé casse les inscriptions —
// donc la règle du fichier tient toujours : un logo cassé est pire qu'un texte juste.
//
// ⚠️ FOND TRANSPARENT, ET C'EST STRUCTUREL. Le fond de l'en-tête vient de
// `secondaryColor` (#17102E ici), pas du fichier : un PNG à fond opaque afficherait un
// rectangle par-dessus. Les deux PNG déposés ont bien un canal alpha.
const VINIZ_WORDMARK_PNG = 'https://links.viniz.app/brand/viniz-wordmark-lime@2x.png'

const VINIZ_BRANDING: GymBranding = {
  name: 'Viniz',
  slug: '',
  address: null,
  postalCode: null,
  city: null,
  email: null,
  phone: null,
  logoUrl: VINIZ_WORDMARK_PNG,
  primaryColor: '#C8FF3D',
  secondaryColor: '#17102E',
}
const VINIZ_CTA_BG = '#4827B4'
const VINIZ_CTA_FG = '#C8FF3D'

// Rôles qui font d'un compte un utilisateur du DASHBOARD, donc un destinataire Viniz —
// même s'il est rattaché à une salle. Un gérant reçoit du Viniz, pas du branding de sa
// propre salle : il travaille DANS l'outil, il n'en est pas le client final.
const PLATFORM_ROLES = ['gym_admin', 'super_admin']

// ─────────────────────────────────────────────────────────────────────────────────────
// PAYLOAD DU HOOK
// ─────────────────────────────────────────────────────────────────────────────────────
// Forme figée par la doc Supabase (§ Send Email Hook → Inputs / JSON Schema, consultée le
// 24/08/2026). Seuls les champs que nous LISONS sont typés : le reste du payload (aud,
// identities, app_metadata…) ne nous concerne pas et n'a pas à être maintenu ici.
interface HookUser {
  id: string
  email: string
  /** Présent sur un changement d'adresse : la NOUVELLE adresse demandée. */
  new_email?: string
  user_metadata?: Record<string, unknown>
}

interface HookEmailData {
  token: string
  token_hash: string
  redirect_to: string
  email_action_type: string
  site_url: string
  token_new: string
  token_hash_new: string
  old_email?: string
}

interface HookPayload {
  user: HookUser
  email_data: HookEmailData
}

// ─────────────────────────────────────────────────────────────────────────────────────
// RÉPONSES
// ─────────────────────────────────────────────────────────────────────────────────────
// ⚠️ `Content-Type: application/json` SUR TOUTES LES RÉPONSES, y compris les erreurs :
// « all responses, including error responses, need a Content-Type of application/json —
// not specifying the appropriate Content-Type will result in the function returning an
// error response » (doc auth-hooks, § Error handling).

/** Succès : GoTrue attend un 200 au corps vide. */
function okResponse(): Response {
  return new Response(JSON.stringify({}), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Erreur, au format que GoTrue sait relire : `{ error: { http_code, message } }`.
 *
 * `retryable` pose 429 + `retry-after`, les deux conditions exigées par la doc pour qu'une
 * tentative supplémentaire ait lieu (« Return a retry-able error by attaching a
 * appropriate status code (429, 503) and a non-empty retry-after header »). GoTrue en
 * accorde jusqu'à trois, dans la même enveloppe de 5 s.
 */
function errorResponse(httpCode: number, message: string, retryable = false): Response {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (retryable) headers['retry-after'] = 'true'
  return new Response(JSON.stringify({ error: { http_code: httpCode, message } }), {
    status: retryable ? 429 : httpCode,
    headers,
  })
}

// ─────────────────────────────────────────────────────────────────────────────────────
// À QUI PARLE-T-ON ?
// ─────────────────────────────────────────────────────────────────────────────────────
type Audience =
  /** Gérant / utilisateur du dashboard → marque VINIZ. */
  | { kind: 'viniz' }
  /** Membre d'une salle → marque de CETTE salle. */
  | { kind: 'gym'; branding: GymBranding }
  /** Aucun contexte exploitable → VINIZ neutre, sans promesse sur le compte. */
  | { kind: 'neutral' }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function metaString(meta: Record<string, unknown> | undefined, key: string): string | null {
  const v = meta?.[key]
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null
}

/**
 * Lit `profiles` en service_role. BEST-EFFORT : ne lève jamais.
 *
 * ⚠️ LE PROFIL EXISTE DÉJÀ QUAND CET EMAIL PART. `handle_new_user()` (GYM-150) est un
 * trigger sur l'INSERT dans auth.users : la ligne profiles est écrite AVANT que GoTrue
 * n'appelle ce hook pour l'email de confirmation. On peut donc s'y fier dès le signup, et
 * pas seulement sur les parcours d'un compte déjà installé.
 */
async function readProfile(
  admin: SupabaseClient,
  userId: string,
): Promise<{ role: string | null; gymId: string | null }> {
  try {
    const { data } = await admin
      .from('profiles')
      .select('role, gym_id')
      .eq('id', userId)
      .maybeSingle()
    const row = (data ?? {}) as Record<string, unknown>
    return {
      role: typeof row.role === 'string' ? row.role : null,
      gymId: typeof row.gym_id === 'string' ? row.gym_id : null,
    }
  } catch (e) {
    console.error('[auth-email-hook] lecture profil impossible:', e)
    return { role: null, gymId: null }
  }
}

/**
 * Choisit la marque de l'email. Ne lève jamais — au pire, `neutral`.
 *
 * ORDRE NON COMMUTATIF, et c'est le cœur du ticket :
 *   1. profil PLATEFORME (gym_admin / super_admin) → Viniz. Ce test passe AVANT le
 *      rattachement à une salle, parce qu'un gérant EN A UN : le tester après enverrait à
 *      tous les gérants du Dopamine-branded, exactement le défaut d'origine.
 *   2. `signup_intent = 'gym_owner'` → Viniz. Indispensable au signup libre : à cet
 *      instant `handle_new_user()` a posé role='member' et gym_id=NULL (il ne sait rien de
 *      l'intention), la promotion n'arrivera qu'après création de la salle. Sans ce test,
 *      le tout premier email d'un futur gérant serait neutre.
 *   3. rattachement à une salle → marque de la salle.
 *   4. rien → Viniz neutre.
 *
 * ⚠️ FRONTIÈRE DE CONFIANCE : `user_metadata` est ÉCRIT PAR LE CLIENT et modifiable par
 * l'utilisateur — c'est pourquoi la règle du dépôt interdit de s'en servir pour autoriser
 * quoi que ce soit. Ici il ne sert qu'à CHOISIR UN GABARIT, et seulement en second choix
 * derrière le profil (colonne serveur, scellée par invite-team-member et verrouillée par
 * le GRANT de GYM-203). Le pire cas est cosmétique : un inscrit qui déclarerait le gym_id
 * d'une autre salle recevrait SON PROPRE email aux couleurs de celle-ci. Aucune donnée de
 * cette salle ne fuit — `loadGymBranding` ne ramène que ce qui est déjà public sur la page
 * de la salle (nom, adresse, contact, logo, couleurs).
 */
async function resolveAudience(admin: SupabaseClient, user: HookUser): Promise<Audience> {
  try {
    const meta = user.user_metadata
    const profile = await readProfile(admin, user.id)

    if (profile.role && PLATFORM_ROLES.includes(profile.role)) return { kind: 'viniz' }
    if (metaString(meta, 'signup_intent') === 'gym_owner') return { kind: 'viniz' }

    // Le profil d'abord (serveur), la métadonnée ensuite (client) — jamais l'inverse.
    const metaGymId = metaString(meta, 'gym_id')
    const gymId = profile.gymId ?? (metaGymId && UUID_RE.test(metaGymId) ? metaGymId : null)
    if (!gymId) return { kind: 'neutral' }

    const branding = await loadGymBranding(admin, gymId)
    // `loadGymBranding` retombe sur le nom du produit quand la ligne est illisible. Dans ce
    // cas la « salle » n'apporte plus rien : autant assumer un email neutre plutôt que d'en
    // envoyer un qui parle d'une salle sans jamais la nommer.
    if (branding.name === 'Viniz') return { kind: 'neutral' }
    return { kind: 'gym', branding }
  } catch (e) {
    // Un email neutre part toujours ; c'est ce cercle-là qui garantit qu'une inscription
    // n'échoue pas parce qu'une lecture de décor a mal tourné.
    console.error('[auth-email-hook] résolution de marque impossible, repli neutre:', e)
    return { kind: 'neutral' }
  }
}

/** La coquille à employer pour cette audience. */
function brandingOf(a: Audience): GymBranding {
  return a.kind === 'gym' ? a.branding : VINIZ_BRANDING
}

/** Nom à faire apparaître dans le CORPS du message. */
function brandNameOf(a: Audience): string {
  return a.kind === 'gym' ? a.branding.name : 'Viniz'
}

// ─────────────────────────────────────────────────────────────────────────────────────
// LES LIENS — LE POINT OÙ UN BEL EMAIL DEVIENT INUTILE S'IL EST FAUX
// ─────────────────────────────────────────────────────────────────────────────────────
/**
 * Reconstruit EXACTEMENT le lien que GoTrue aurait mis dans son propre gabarit :
 *
 *   {SUPABASE_URL}/auth/v1/verify?token=<token_hash>&type=<action>&redirect_to=<url>
 *
 * ⚠️ CE FORMAT N'EST PAS UN CHOIX, C'EST CELUI QUE LE DASHBOARD SAIT CONSOMMER. GoTrue
 * consomme le jeton puis REDIRIGE vers `redirect_to` en déposant la session dans le
 * FRAGMENT (`#access_token=…&type=signup`). Or c'est précisément ce fragment que lisent :
 *   · lib/signupLink.ts   → `type=signup`   → /signup/confirmed (GYM-248)
 *   · lib/inviteLink.ts   → `type=invite`   → /welcome, AccountActivation (GYM-202)
 *   · ResetPassword.tsx   → `type=recovery` → /reset-password (GYM-157)
 * Fabriquer une URL « à nous » vers ces pages produirait un lien qui s'ouvre et ne fait
 * RIEN : pas de session dans le fragment, donc pas d'activation possible. Le même piège
 * qu'à GYM-238 avec `dopamine://` — un bouton qui ne fait rien est pire que pas de bouton.
 *
 * `redirect_to` vient du payload signé : c'est la valeur que l'appelant a passée
 * (emailRedirectTo / redirectTo, explicite dans les quatre parcours du dépôt) et que
 * GoTrue a DÉJÀ validée contre sa liste d'URL autorisées. Repli sur `site_url` si vide.
 */
function verifyUrl(data: HookEmailData, tokenHash: string, type: string): string {
  const params = new URLSearchParams({
    token: tokenHash,
    type,
    redirect_to: data.redirect_to || data.site_url,
  })
  return `${SUPABASE_URL}/auth/v1/verify?${params.toString()}`
}

// ─────────────────────────────────────────────────────────────────────────────────────
// GABARITS FR
// ─────────────────────────────────────────────────────────────────────────────────────
// Le CORPS dépend du type d'email ; la CHROME (en-tête, couleurs, pied, expéditeur) vient
// de l'audience. Les deux sont donc composés séparément : c'est la leçon de GYM-238 —
// une coquille, des corps — appliquée telle quelle plutôt que dupliquée en quinze
// gabarits (5 types × 3 marques) qui divergeraient au premier ajustement.

const P = 'color:#3D3B36;font-size:14px;line-height:1.6;margin:0 0 16px;'
const MUTED = 'color:#9A9890;font-size:12px;line-height:1.6;margin:20px 0 0;'

const p = (html: string) => `<p style="${P}">${html}</p>`
const muted = (html: string) => `<p style="${MUTED}">${html}</p>`

/** Rappel d'expiration, commun à tous les liens à usage unique. */
const EXPIRY_NOTE = muted(
  "Ce lien est à usage unique et expire après un court délai. S'il ne fonctionne plus, relance simplement l'opération depuis l'application.",
)

/** « Tu n'as rien demandé ? » — obligatoire sur tout email déclenchable par un tiers. */
const IGNORE_NOTE = muted(
  "Si tu n'es pas à l'origine de cette demande, ignore cet email : rien ne se passera sans cette confirmation.",
)

interface Message {
  subject: string
  title: string
  emoji?: string
  bodyHtml: string
  ctaLabel?: string
  ctaUrl?: string
}

/**
 * Compose le message. `link` est nul pour les types qui n'en portent pas (code à saisir,
 * notifications d'information) — le gabarit s'adapte plutôt que de rendre un bouton mort.
 */
function buildMessage(
  action: string,
  audience: Audience,
  data: HookEmailData,
  user: HookUser,
  link: string | null,
): Message {
  const brand = escapeHtml(brandNameOf(audience))
  const isGym = audience.kind === 'gym'
  const isViniz = audience.kind === 'viniz'

  switch (action) {
    // ── 1. INSCRIPTION ──────────────────────────────────────────────────────────────
    case 'signup': {
      if (isViniz) {
        return {
          subject: 'Confirme ton adresse pour activer ton compte Viniz',
          title: 'Bienvenue sur Viniz',
          emoji: '👋',
          bodyHtml:
            p("Il ne reste qu'une étape : confirmer ton adresse email pour activer ton compte.") +
            p('Tu pourras ensuite créer ta salle, définir tes créneaux et ouvrir les réservations à tes membres.') +
            EXPIRY_NOTE,
          ctaLabel: 'Confirmer mon adresse',
          ctaUrl: link ?? undefined,
        }
      }
      if (isGym) {
        return {
          subject: `Confirme ton adresse — ${brandNameOf(audience)}`,
          title: `Bienvenue chez ${brandNameOf(audience)}`,
          emoji: '🏋️',
          bodyHtml:
            p(`Ton compte ${brand} est presque prêt. Confirme ton adresse email pour l'activer.`) +
            p('Tu pourras ensuite réserver tes cours et suivre tes séances depuis l\'application.') +
            EXPIRY_NOTE,
          ctaLabel: 'Confirmer mon adresse',
          ctaUrl: link ?? undefined,
        }
      }
      return {
        subject: 'Confirme ton adresse email',
        title: 'Confirme ton adresse email',
        emoji: '✉️',
        bodyHtml:
          p('Confirme ton adresse email pour activer ton compte.') + EXPIRY_NOTE + IGNORE_NOTE,
        ctaLabel: 'Confirmer mon adresse',
        ctaUrl: link ?? undefined,
      }
    }

    // ── 2. RÉINITIALISATION DE MOT DE PASSE ─────────────────────────────────────────
    case 'recovery': {
      const where = isGym ? ` de ton compte ${brand}` : isViniz ? ' de ton compte Viniz' : ''
      return {
        subject: 'Réinitialise ton mot de passe',
        title: 'Nouveau mot de passe',
        emoji: '🔐',
        bodyHtml:
          p(`Une réinitialisation du mot de passe${where} a été demandée. Choisis-en un nouveau en suivant le lien ci-dessous.`) +
          EXPIRY_NOTE +
          muted("Si tu n'as pas fait cette demande, ignore cet email : ton mot de passe actuel reste valable."),
        ctaLabel: 'Choisir un nouveau mot de passe',
        ctaUrl: link ?? undefined,
      }
    }

    // ── 3. LIEN DE CONNEXION ────────────────────────────────────────────────────────
    case 'magiclink': {
      return {
        subject: 'Ton lien de connexion',
        title: 'Connexion',
        emoji: '🔗',
        bodyHtml:
          p(`Suis le lien ci-dessous pour te connecter${isGym ? ` à ${brand}` : ''}.`) +
          EXPIRY_NOTE +
          IGNORE_NOTE,
        ctaLabel: 'Me connecter',
        ctaUrl: link ?? undefined,
      }
    }

    // ── 4. INVITATION ───────────────────────────────────────────────────────────────
    // ⚠️ Ce chemin ne se déclenche QUE si un jour un parcours appelle
    // `admin.inviteUserByEmail()`. Les deux invitations existantes du dépôt passent par
    // `generateLink()` + envoi maison et n'atteignent jamais ce hook (cf. entête).
    case 'invite': {
      return {
        subject: isGym
          ? `Tu es invité·e à rejoindre ${brandNameOf(audience)}`
          : 'Tu es invité·e à rejoindre Viniz',
        title: isGym ? `Rejoins ${brandNameOf(audience)}` : 'Rejoins Viniz',
        emoji: '🎉',
        bodyHtml:
          p(`Un compte t'attend${isGym ? ` chez ${brand}` : ' sur Viniz'}. Active-le pour choisir ton mot de passe.`) +
          EXPIRY_NOTE +
          muted("Si tu n'attendais pas cette invitation, ignore cet email : aucun compte ne sera activé sans cette action."),
        ctaLabel: 'Activer mon compte',
        ctaUrl: link ?? undefined,
      }
    }

    // ── 5. CHANGEMENT D'ADRESSE ─────────────────────────────────────────────────────
    case 'email_change': {
      const target = escapeHtml(user.new_email ?? user.email)
      return {
        subject: 'Confirme ta nouvelle adresse email',
        title: "Changement d'adresse email",
        emoji: '📧',
        bodyHtml:
          p(`Une demande de changement d'adresse vers <strong>${target}</strong> a été enregistrée${isGym ? ` sur ton compte ${brand}` : ''}.`) +
          p('Confirme-la en suivant le lien ci-dessous. Tant que la confirmation n\'est pas faite, ton adresse actuelle reste active.') +
          EXPIRY_NOTE +
          muted("Si tu n'as pas demandé ce changement, ignore cet email et change ton mot de passe par précaution."),
        ctaLabel: 'Confirmer le changement',
        ctaUrl: link ?? undefined,
      }
    }

    // ── Code à saisir (pas de lien) ─────────────────────────────────────────────────
    case 'reauthentication': {
      return {
        subject: `${data.token} est ton code de vérification`,
        title: 'Code de vérification',
        emoji: '🔢',
        bodyHtml:
          p('Saisis ce code pour confirmer ton identité :') +
          `<p style="font-family:'Courier New',monospace;font-size:28px;letter-spacing:6px;color:#111111;margin:0 0 16px;"><strong>${escapeHtml(data.token)}</strong></p>` +
          muted('Ce code expire après un court délai. Ne le communique à personne.'),
      }
    }

    // ── Filet : tout type ajouté par GoTrue après l'écriture de cette fonction ───────
    // ⚠️ NE JAMAIS RENDRE 200 SANS ENVOYER pour un type inconnu : GoTrue considérerait
    // l'email comme parti et l'utilisateur attendrait un message qui n'existe pas. On
    // envoie un message honnête, avec le lien s'il y en a un.
    default: {
      console.warn(`[auth-email-hook] type d'email non spécialisé: ${action}`)
      return {
        subject: isGym ? `${brandNameOf(audience)} — action sur ton compte` : 'Action sur ton compte',
        title: 'Action sur ton compte',
        emoji: '🔔',
        bodyHtml:
          p(`Une action vient d'être effectuée sur ton compte${isGym ? ` ${brand}` : ''}.`) +
          (link ? p('Suis le lien ci-dessous pour la finaliser.') + EXPIRY_NOTE : '') +
          IGNORE_NOTE,
        ctaLabel: link ? 'Continuer' : undefined,
        ctaUrl: link ?? undefined,
      }
    }
  }
}

/** Assemble corps + coquille aux couleurs de l'audience. */
function renderHtml(audience: Audience, m: Message): string {
  const b = brandingOf(audience)
  return emailShell(b, {
    title: m.title,
    emoji: m.emoji,
    bodyHtml: m.bodyHtml,
    ctaLabel: m.ctaLabel,
    ctaUrl: m.ctaUrl,
    // Le bouton violet de la marque, uniquement hors salle : une salle garde SA paire.
    ctaBg: audience.kind === 'gym' ? undefined : VINIZ_CTA_BG,
    ctaFg: audience.kind === 'gym' ? undefined : VINIZ_CTA_FG,
  })
}

// ─────────────────────────────────────────────────────────────────────────────────────
// ENVOI
// ─────────────────────────────────────────────────────────────────────────────────────
/** Distingue un incident passager (à ré-essayer) d'un refus définitif. */
class SendError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message)
    this.name = 'SendError'
  }
}

/**
 * Envoi Resend, en fetch brut comme les quatorze autres fonctions du dépôt (le paquet npm
 * n'apporterait rien et alourdirait un démarrage à froid déjà compté dans les 5 s).
 *
 * ⚠️ ICI, ET SEULEMENT ICI, ON A LE DROIT D'ÉCHOUER. Rendre 200 sans avoir envoyé
 * fabriquerait un compte impossible à confirmer, sans trace côté utilisateur.
 */
async function sendEmail(params: {
  from: string
  to: string
  subject: string
  html: string
}): Promise<void> {
  if (!RESEND_KEY) {
    // Configuration absente : définitif, un ré-essai ne changerait rien.
    throw new SendError('RESEND_API_KEY manquant', false)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), RESEND_TIMEOUT_MS)
  let resp: Response
  try {
    resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
      body: JSON.stringify(params),
      signal: controller.signal,
    })
  } catch (e) {
    // Réseau coupé ou budget dépassé → passager par nature.
    throw new SendError(`Resend injoignable: ${e instanceof Error ? e.message : String(e)}`, true)
  } finally {
    clearTimeout(timer)
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => '')
    // 429 (quota) et 5xx (panne) repassent ; un 4xx métier (adresse invalide, domaine non
    // vérifié) ne repassera jamais tout seul et doit remonter tel quel.
    const retryable = resp.status === 429 || resp.status >= 500
    throw new SendError(`Resend ${resp.status}: ${body.slice(0, 300)}`, retryable)
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  // Aucun CORS : ce point d'entrée n'est appelé que par GoTrue, en serveur à serveur.
  if (req.method !== 'POST') {
    return errorResponse(405, 'Méthode non autorisée')
  }

  try {
    // ── 1. AUTHENTICITÉ ───────────────────────────────────────────────────────────
    // `verify_jwt = false` est OBLIGATOIRE (config.toml) : GoTrue n'envoie pas de JWT, la
    // passerelle refuserait l'appel avant même d'atteindre ce code. La signature Standard
    // Webhooks est donc la SEULE authentification de cette fonction — sans elle, n'importe
    // qui pourrait faire partir des emails signés de nos salles. Elle est vérifiée en
    // premier, avant toute lecture de base.
    if (!HOOK_SECRET) {
      console.error('[auth-email-hook] SEND_EMAIL_HOOK_SECRET absent — appel refusé')
      return errorResponse(500, 'Hook mal configuré')
    }

    const raw = await req.text()
    let payload: HookPayload
    try {
      // Le secret arrive sous la forme `v1,whsec_<base64>` ; le vérificateur attend le
      // base64 seul.
      const wh = new Webhook(HOOK_SECRET.replace('v1,whsec_', ''))
      payload = wh.verify(raw, Object.fromEntries(req.headers)) as HookPayload
    } catch (e) {
      console.error('[auth-email-hook] signature invalide:', e)
      return errorResponse(401, 'Signature du hook invalide')
    }

    const { user, email_data: data } = payload
    if (!user?.id || !data?.email_action_type) {
      return errorResponse(400, 'Payload incomplet')
    }

    const action = data.email_action_type
    console.log(`[auth-email-hook] ${action} pour ${user.id}`)

    // ── 2. MARQUE ─────────────────────────────────────────────────────────────────
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const audience = await resolveAudience(admin, user)
    const branding = brandingOf(audience)
    const from = emailSender(branding)
    console.log(`[auth-email-hook] marque retenue: ${audience.kind} (${branding.name})`)

    // ── 3. DESTINATAIRE(S) ET LIEN(S) ─────────────────────────────────────────────
    // Le cas général : un email, un jeton.
    // Le changement d'adresse : jusqu'à DEUX, avec une inversion de nommage documentée.
    if (action === 'email_change') {
      // 🔴 PIÈGE DOCUMENTÉ PAR SUPABASE, À NE PAS « CORRIGER » :
      //   « The token hash field names are reversed due to backward compatibility.
      //     token_hash_new → use with the current email address (user.email) and token ;
      //     token_hash → use with the new email address (user.new_email) and token_new.
      //     Do not assume the _new suffix refers to the new email address. »
      //   — doc Send Email Hook, § Email change behavior and token hash mapping (24/08/2026)
      // Intervertir les deux enverrait à chaque destinataire un lien que GoTrue refusera :
      // deux emails parfaits, deux liens morts.
      const newEmail = user.new_email ?? ''
      const secureChange = !!data.token_hash_new && !!newEmail && newEmail !== user.email

      const recipients: Array<{ to: string; tokenHash: string }> = secureChange
        ? [
            { to: user.email, tokenHash: data.token_hash_new },
            { to: newEmail, tokenHash: data.token_hash },
          ]
        : [{ to: newEmail || user.email, tokenHash: data.token_hash }]

      for (const r of recipients) {
        const msg = buildMessage(action, audience, data, user, verifyUrl(data, r.tokenHash, action))
        await sendEmail({ from, to: r.to, subject: msg.subject, html: renderHtml(audience, msg) })
      }
      return okResponse()
    }

    // Les types « code » et les notifications n'ont pas de jeton de vérification : pas de
    // lien plutôt qu'un lien fabriqué qui ne mènerait nulle part.
    const link = data.token_hash ? verifyUrl(data, data.token_hash, action) : null
    const msg = buildMessage(action, audience, data, user, link)
    await sendEmail({
      from,
      to: user.email,
      subject: msg.subject,
      html: renderHtml(audience, msg),
    })

    return okResponse()
  } catch (e) {
    // ── FILET GLOBAL ──────────────────────────────────────────────────────────────
    // Rien ne doit sortir d'ici sous forme d'exception : une stack non rattrapée devient
    // un 500 sans `Content-Type: application/json`, que GoTrue retraduit en « Internal
    // Server Error » opaque côté application — et l'inscription échoue sans qu'on sache
    // pourquoi. Toute sortie est un JSON lisible et journalisé.
    if (e instanceof SendError) {
      console.error('[auth-email-hook] envoi échoué:', e.message, '(retryable:', e.retryable, ')')
      return errorResponse(500, `Envoi de l'email impossible: ${e.message}`, e.retryable)
    }
    console.error('[auth-email-hook] erreur inattendue:', e)
    return errorResponse(500, e instanceof Error ? e.message : 'Erreur inattendue')
  }
})
