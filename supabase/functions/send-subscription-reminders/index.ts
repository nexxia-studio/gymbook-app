// ╔═══════════════════════════════════════════════════════════════════════════════════════╗
// ║  GYM-116 (VOLET 2) — RAPPELS D'ÉCHÉANCE D'ABONNEMENT                                  ║
// ╚═══════════════════════════════════════════════════════════════════════════════════════╝
//
// Appelée par pg_cron toutes les heures via X-Internal-Secret, exactement comme
// `send-reminders` (GYM-32) dont cette fonction est le décalque : même garde en tête,
// même RPC de balayage, mêmes caches locaux, même marquage après envoi, mêmes erreurs
// isolées par élément.
//
// 🔴 CE QUI DIFFÈRE, ET C'EST TOUT : le sujet du rappel. Un cours a lieu dans 24 h ; un
// abonnement se TERMINE, et il ne se reconduit pas tout seul — l'audit GYM-321 l'a établi.
// Sans ce courrier, un membre perd son accès sans avoir jamais été prévenu.
//
// ⚠️ L'HEURE D'ENVOI N'EST PAS DÉCIDÉE ICI. Le cron passe toutes les heures et
// `get_pending_subscription_reminders()` ne rend des lignes qu'à 10 h LOCALE de la salle
// (voir la migration). Cette fonction n'a donc aucune notion d'horaire, et une salle dans
// un autre fuseau est servie correctement sans qu'une ligne change ici.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
// GYM-238 — chrome des emails composée depuis nexxia_gyms.
import { loadGymBranding, emailSender, emailShell, type GymBranding } from '../_shared/gym-branding.ts'
// GYM-246 — porte d'entrée unique du gating (GYM-245).
import { getEffectivePlan, hasFeature } from '../_shared/effective-plan.ts'

const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const INTERNAL_SECRET = Deno.env.get('INTERNAL_FUNCTIONS_SECRET') ?? ''

interface PendingSubscriptionReminder {
  subscription_id: string
  member_id: string
  gym_id: string
  plan_name: string | null
  ends_at: string
  days_remaining: number
  member_email: string | null
  member_first_name: string | null
  preferred_language: string | null
  push_token: string | null
  reminder_type: '14d' | '3d'
}

/**
 * Identité de salle, mise en cache LE TEMPS D'UNE EXÉCUTION — même raison que dans
 * `send-reminders` : le balayage n'est pas borné à une salle, et lire `nexxia_gyms` par
 * rappel ferait une requête par membre pour une donnée identique à toute la salle. Aucun
 * état ne survit à l'appel, donc aucune marque périmée au passage suivant.
 */
const brandingCache = new Map<string, GymBranding>()

async function brandingFor(supabase: SupabaseClient, gymId: string): Promise<GymBranding> {
  const hit = brandingCache.get(gymId)
  if (hit) return hit
  const b = await loadGymBranding(supabase, gymId)
  brandingCache.set(gymId, b)
  return b
}

/** `null` = résolution ÉCHOUÉE : c'est une panne, pas un refus. Voir l'appelant. */
const notificationsCache = new Map<string, boolean>()

async function notificationsAllowed(supabase: SupabaseClient, gymId: string): Promise<boolean | null> {
  const hit = notificationsCache.get(gymId)
  if (hit !== undefined) return hit
  const plan = await getEffectivePlan(supabase, gymId)
  if (!plan) return null
  const allowed = hasFeature(plan, 'notifications_enabled')
  notificationsCache.set(gymId, allowed)
  return allowed
}

// ═════════════════════════════════════════════════════════════════════════════════════
// i18n — fr / en
// ═════════════════════════════════════════════════════════════════════════════════════
// 🔴 LA LANGUE VIENT DE `profiles.preferred_language`, ET ELLE EXISTE DÉJÀ. La colonne est
// peuplée (`DEFAULT 'fr'`, posée par `handle_new_user`) : mesuré le 09/09, 92 membres en
// `fr` et 1 en `en`. Le cas anglais n'est donc pas théorique — c'est une personne réelle,
// qui recevrait aujourd'hui un courrier en français.
//
// ⚠️ C'EST LA PREMIÈRE i18n D'UN EMAIL SERVEUR de ce dépôt : les quatorze gabarits
// existants sont en français dur, et `auth-email-hook` ne porte ni `lang` ni `locale`.
// Le dictionnaire est donc ici, dans la seule forme qui n'ajoute aucune dépendance à une
// Edge Function — `packages/i18n` exigerait un bundler que ce dossier n'a pas.
//
// ⚠️ TOUTE AUTRE VALEUR RETOMBE SUR `fr`. `nl` et `de` existent dans l'app mobile mais pas
// dans les emails : mieux vaut un français lisible qu'une clé brute affichée telle quelle.
type Langue = 'fr' | 'en'

function langueDe(pref: string | null): Langue {
  return (pref ?? '').toLowerCase().startsWith('en') ? 'en' : 'fr'
}

interface Textes {
  sujet: (salle: string, jours: number) => string
  titre: string
  corps: (salle: string, plan: string, date: string, jours: number) => string
  suite: string
  cta: string
  pushTitre: string
  pushCorps: (jours: number, date: string) => string
}

const TEXTES: Record<Langue, Textes> = {
  fr: {
    sujet: (salle, jours) =>
      jours <= 3
        ? `Ton abonnement ${salle} se termine dans ${jours} jour${jours > 1 ? 's' : ''}`
        : `Ton abonnement ${salle} se termine bientôt`,
    titre: 'Ton abonnement arrive à son terme',
    corps: (salle, plan, date, jours) =>
      `<p style="color:#6B6861;margin:0 0 12px;">Ton abonnement <strong>${plan}</strong> chez ${salle} ` +
      `prend fin le <strong>${date}</strong>, dans ${jours} jour${jours > 1 ? 's' : ''}.</p>`,
    // ⚠️ DIT CE QU'IL FAUT FAIRE, ET DIT AUSSI CE QUI SE PASSE SI ON NE FAIT RIEN.
    // Sans la seconde phrase, le membre peut croire à une reconduction automatique —
    // c'est précisément la croyance que ce lot existe pour corriger.
    suite:
      `<p style="color:#6B6861;margin:0 0 4px;">Il ne se renouvelle pas tout seul : ` +
      `pour continuer sans interruption, choisis ta formule depuis l'application.</p>` +
      `<p style="color:#9A9890;font-size:13px;margin:0;">Sans action de ta part, ton accès ` +
      `s'arrêtera simplement à cette date. Tes réservations déjà posées ne bougent pas.</p>`,
    cta: 'Choisir ma formule',
    pushTitre: 'Ton abonnement se termine',
    pushCorps: (jours, date) =>
      jours <= 3
        ? `Plus que ${jours} jour${jours > 1 ? 's' : ''} — jusqu'au ${date}`
        : `Il prend fin le ${date}. Renouvelle quand tu veux.`,
  },
  en: {
    sujet: (salle, jours) =>
      jours <= 3
        ? `Your ${salle} membership ends in ${jours} day${jours > 1 ? 's' : ''}`
        : `Your ${salle} membership ends soon`,
    titre: 'Your membership is coming to an end',
    corps: (salle, plan, date, jours) =>
      `<p style="color:#6B6861;margin:0 0 12px;">Your <strong>${plan}</strong> membership at ${salle} ` +
      `ends on <strong>${date}</strong>, in ${jours} day${jours > 1 ? 's' : ''}.</p>`,
    suite:
      `<p style="color:#6B6861;margin:0 0 4px;">It does not renew on its own: ` +
      `to continue without interruption, pick your plan in the app.</p>` +
      `<p style="color:#9A9890;font-size:13px;margin:0;">If you do nothing, your access ` +
      `simply stops on that date. Bookings you already made are unaffected.</p>`,
    cta: 'Choose my plan',
    pushTitre: 'Your membership is ending',
    pushCorps: (jours, date) =>
      jours <= 3
        ? `${jours} day${jours > 1 ? 's' : ''} left — until ${date}`
        : `It ends on ${date}. Renew whenever you like.`,
  },
}

/** Date longue, dans le fuseau de la salle et la langue du membre. */
function dateLongue(iso: string, langue: Langue): string {
  return new Date(iso).toLocaleDateString(langue === 'en' ? 'en-GB' : 'fr-BE', {
    timeZone: 'Europe/Brussels', day: 'numeric', month: 'long', year: 'numeric',
  })
}

async function envoyerEmail(
  supabase: SupabaseClient,
  r: PendingSubscriptionReminder,
  langue: Langue,
): Promise<void> {
  if (!RESEND_KEY || !r.member_email) return
  const t = TEXTES[langue]
  const gym = await brandingFor(supabase, r.gym_id)
  const plan = r.plan_name ?? (langue === 'en' ? 'membership' : 'abonnement')
  const date = dateLongue(r.ends_at, langue)

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({
      from: emailSender(gym),
      to: r.member_email,
      subject: t.sujet(gym.name, r.days_remaining),
      // La chrome, le logo, les couleurs et le pied viennent de `nexxia_gyms` — rien de
      // Dopamine n'est écrit ici (GYM-238). Le bouton est un Universal Link : un schéma
      // `dopamine://` serait inerte dans tout client mail.
      html: emailShell(gym, {
        title: t.titre,
        width: 480,
        bodyHtml: t.corps(gym.name, plan, date, r.days_remaining) + t.suite,
        ctaLabel: t.cta,
        ctaPath: 'subscription',
      }),
    }),
  }).catch((e) => console.error('[send-subscription-reminders] email error:', e))
}

async function envoyerPush(
  supabaseUrl: string,
  serviceKey: string,
  r: PendingSubscriptionReminder,
  langue: Langue,
): Promise<void> {
  if (!r.push_token) return
  const t = TEXTES[langue]
  await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${serviceKey}`,
      // GYM-282 — le tuyau exige le secret interne.
      'X-Internal-Secret': INTERNAL_SECRET,
    },
    body: JSON.stringify({
      tokens: [r.push_token],
      // GYM-282 — `gym_id` est OBLIGATOIRE : c'est lui qui arme la garde de plan.
      gym_id: r.gym_id,
      title: t.pushTitre,
      body: t.pushCorps(r.days_remaining, dateLongue(r.ends_at, langue)),
      data: { type: 'subscription_ending', subscription_id: r.subscription_id },
    }),
  }).catch((e) => console.error('[send-subscription-reminders] push error:', e))
}

Deno.serve(async (req) => {
  const providedSecret = req.headers.get('X-Internal-Secret')
  if (!INTERNAL_SECRET || providedSecret !== INTERNAL_SECRET) {
    console.warn('[send-subscription-reminders] Unauthorized — invalid X-Internal-Secret')
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, serviceKey)

    const { data: rappels, error } = await supabase.rpc('get_pending_subscription_reminders')
    if (error) {
      console.error('[send-subscription-reminders] RPC error:', error)
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      })
    }

    let envoyes = 0
    for (const r of (rappels ?? []) as PendingSubscriptionReminder[]) {
      try {
        // ── GYM-246 — garde serveur : notifications, par salle ──────────────────────
        // Reprise mot pour mot de `send-reminders`. Un cron ne 403 pas, il passe son
        // tour, et le rappel n'est PAS marqué envoyé : rien n'est parti, et si la salle
        // repasse sur un plan qui les autorise avant la fin de la fenêtre, il partira.
        const autorise = await notificationsAllowed(supabase, r.gym_id)
        if (autorise === null) {
          // Panne de résolution : ne JAMAIS laisser passer, ne JAMAIS lire comme un refus.
          console.error('[send-subscription-reminders] plan resolution failed, gym', r.gym_id, '— rappel reporté')
          continue
        }
        if (!autorise) {
          console.log('[plan-gate] notifications off, gym', r.gym_id)
          continue
        }

        const langue = langueDe(r.preferred_language)

        // Email D'ABORD : c'est le canal qui atteint un membre sans l'app — le cas que ce
        // lot doit couvrir. Le push complète, il ne remplace pas.
        await envoyerEmail(supabase, r, langue)
        await envoyerPush(supabaseUrl, serviceKey, r, langue)

        // ⚠️ MARQUÉ APRÈS L'ENVOI, ET SEULEMENT ICI. C'est ce qui garantit qu'un rappel ne
        // part jamais deux fois — la fenêtre du jalon dure plusieurs jours et le cron
        // repasse toutes les heures.
        await supabase.rpc('mark_subscription_reminder_sent', {
          p_subscription_id: r.subscription_id,
          p_reminder_type: r.reminder_type,
        })

        envoyes++
      } catch (e) {
        // Une salle ou un membre en échec ne prive pas les autres de leur rappel.
        console.error('[send-subscription-reminders] error for subscription', r.subscription_id, e)
      }
    }

    console.log('[send-subscription-reminders] processed:', envoyes, 'of', rappels?.length ?? 0)
    return new Response(JSON.stringify({ sent: envoyes }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[send-subscription-reminders] uncaught:', err)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
})
