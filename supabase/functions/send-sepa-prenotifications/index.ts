// ╔═══════════════════════════════════════════════════════════════════════════════════════╗
// ║  🔴 GYM-334 — PRÉ-NOTIFICATION SEPA                                                   ║
// ╚═══════════════════════════════════════════════════════════════════════════════════════╝
//
// Décalque de `send-subscription-reminders` (GYM-116) : même garde de secret, même RPC de
// balayage, mêmes caches locaux, même marquage après envoi, mêmes erreurs isolées.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// POURQUOI CETTE FONCTION EXISTE
// ─────────────────────────────────────────────────────────────────────────────────────
// Mollie l'a confirmé par écrit le 09/09 : dans notre flux (OAuth + Application Fees) il
// n'envoie AUCUNE pré-notification, et l'obligation revient au marchand — la salle. Il
// recommande que la plateforme l'envoie EN SON NOM ET POUR SON COMPTE. C'est exactement ce
// que fait ce courrier : expéditeur au nom de la salle, chrome de la salle, et mention
// explicite que Mollie exécute le prélèvement pour son compte.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// 🔴 DEUX DIFFÉRENCES DE FOND AVEC `send-subscription-reminders`
// ─────────────────────────────────────────────────────────────────────────────────────
// 1. AUCUN PUSH, ET AUCUNE GARDE DE PLAN. Ce n'est pas un service de confort : c'est
//    l'information qui précède un débit sur le compte bancaire du membre. Elle relève du
//    même régime que la facture — ni le plan de la salle, ni les préférences de
//    notification du membre ne peuvent l'empêcher. C'est la scission décidée en GYM-116,
//    poussée jusqu'à son terme : ici il n'y a QUE le canal obligatoire.
//
// 2. LE RATTRAPAGE EST JOURNALISÉ COMME TEL. Une notification envoyée à moins de 14 jours
//    ne respecte pas le délai. On l'envoie quand même — ne rien envoyer est pire — mais
//    elle doit être VISIBLE dans les journaux, jamais silencieuse.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { loadGymBranding, emailSender, emailShell, type GymBranding } from '../_shared/gym-branding.ts'

const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const INTERNAL_SECRET = Deno.env.get('INTERNAL_FUNCTIONS_SECRET') ?? ''

/**
 * Identifiant créancier SEPA de Mollie, communiqué par écrit le 09/09.
 *
 * ⚠️ C'EST CELUI DE MOLLIE, PAS CELUI DE LA SALLE, et le courrier doit le dire ainsi.
 * Mollie prélève en tant que prestataire, pour le compte du marchand : présenter cet
 * identifiant comme celui de la salle serait faux, et le membre qui le retrouverait sur
 * son relevé bancaire ne pourrait pas rapprocher les deux.
 */
const MOLLIE_CREDITOR_ID = 'NL08ZZZ502057730000'

interface PendingPrenotification {
  subscription_id: string
  member_id: string
  gym_id: string
  plan_name: string | null
  amount: number | string | null
  next_payment_at: string
  days_remaining: number
  is_catchup: boolean
  member_email: string | null
  member_first_name: string | null
  preferred_language: string | null
}

/** Marque de salle, mise en cache le temps d'une exécution — cf. GYM-116. */
const brandingCache = new Map<string, GymBranding>()

async function brandingFor(supabase: SupabaseClient, gymId: string): Promise<GymBranding> {
  const hit = brandingCache.get(gymId)
  if (hit) return hit
  const b = await loadGymBranding(supabase, gymId)
  brandingCache.set(gymId, b)
  return b
}

// ═════════════════════════════════════════════════════════════════════════════════════
// i18n fr / en — même mécanique qu'en GYM-116 (profiles.preferred_language)
// ═════════════════════════════════════════════════════════════════════════════════════
type Langue = 'fr' | 'en'

function langueDe(pref: string | null): Langue {
  return (pref ?? '').toLowerCase().startsWith('en') ? 'en' : 'fr'
}

/** Montant en toutes lettres de la devise, tel qu'il sera débité. */
function formatMontant(amount: number | string | null, langue: Langue): string {
  const n = typeof amount === 'number' ? amount : parseFloat(String(amount ?? '0'))
  return new Intl.NumberFormat(langue === 'en' ? 'en-GB' : 'fr-BE', {
    style: 'currency', currency: 'EUR',
  }).format(Number.isFinite(n) ? n : 0)
}

function formatDate(iso: string, langue: Langue): string {
  return new Date(iso).toLocaleDateString(langue === 'en' ? 'en-GB' : 'fr-BE', {
    timeZone: 'Europe/Brussels', day: 'numeric', month: 'long', year: 'numeric',
  })
}

/**
 * ⚠️ TON SOBRE, ET C'EST UNE CONTRAINTE DE FOND. Ce courrier annonce un débit : il informe,
 * il ne vend rien. Aucun superlatif, aucune incitation, aucun bouton d'achat — un membre
 * qui reçoit une relance commerciale déguisée en avis de prélèvement a toutes les raisons
 * de contester le prélèvement lui-même.
 */
function corpsEmail(
  langue: Langue,
  gym: GymBranding,
  plan: string,
  montant: string,
  date: string,
): { sujet: string; titre: string; html: string } {
  if (langue === 'en') {
    return {
      sujet: `Upcoming direct debit — ${montant} on ${date}`,
      titre: 'Notice of upcoming direct debit',
      html:
        `<p style="color:#6B6861;margin:0 0 12px;">This is an advance notice of the direct debit ` +
        `for your <strong>${plan}</strong> membership at ${gym.name}.</p>` +
        `<table style="width:100%;border-collapse:collapse;margin:0 0 16px;">` +
        `<tr><td style="padding:6px 0;color:#6B6861;">Amount</td><td style="padding:6px 0;text-align:right;color:#111111;"><strong>${montant}</strong></td></tr>` +
        `<tr><td style="padding:6px 0;color:#6B6861;">Debit date</td><td style="padding:6px 0;text-align:right;color:#111111;"><strong>${date}</strong></td></tr>` +
        `<tr><td style="padding:6px 0;color:#6B6861;">Creditor identifier</td><td style="padding:6px 0;text-align:right;color:#6B6861;">${MOLLIE_CREDITOR_ID}</td></tr>` +
        `</table>` +
        `<p style="color:#6B6861;margin:0 0 8px;">The debit is executed by <strong>Mollie B.V.</strong> ` +
        `on behalf of ${gym.name}, under the SEPA mandate you signed when you subscribed. ` +
        `No new authorisation is required.</p>` +
        `<p style="color:#9A9890;font-size:13px;margin:0;">Please make sure your account holds ` +
        `sufficient funds on that date. For any question about this debit, contact ${gym.name} directly.</p>`,
    }
  }
  return {
    sujet: `Prélèvement à venir — ${montant} le ${date}`,
    titre: 'Avis de prélèvement à venir',
    html:
      `<p style="color:#6B6861;margin:0 0 12px;">Ceci est l'avis préalable du prélèvement ` +
      `de votre abonnement <strong>${plan}</strong> chez ${gym.name}.</p>` +
      `<table style="width:100%;border-collapse:collapse;margin:0 0 16px;">` +
      `<tr><td style="padding:6px 0;color:#6B6861;">Montant</td><td style="padding:6px 0;text-align:right;color:#111111;"><strong>${montant}</strong></td></tr>` +
      `<tr><td style="padding:6px 0;color:#6B6861;">Date du prélèvement</td><td style="padding:6px 0;text-align:right;color:#111111;"><strong>${date}</strong></td></tr>` +
      `<tr><td style="padding:6px 0;color:#6B6861;">Identifiant créancier</td><td style="padding:6px 0;text-align:right;color:#6B6861;">${MOLLIE_CREDITOR_ID}</td></tr>` +
      `</table>` +
      `<p style="color:#6B6861;margin:0 0 8px;">Le prélèvement est exécuté par <strong>Mollie B.V.</strong> ` +
      `pour le compte de ${gym.name}, en vertu du mandat SEPA que vous avez signé lors de votre ` +
      `souscription. Aucune nouvelle autorisation ne vous est demandée.</p>` +
      `<p style="color:#9A9890;font-size:13px;margin:0;">Veillez à disposer de la provision ` +
      `nécessaire à cette date. Pour toute question sur ce prélèvement, contactez directement ${gym.name}.</p>`,
  }
}

async function envoyer(
  supabase: SupabaseClient,
  r: PendingPrenotification,
  langue: Langue,
): Promise<void> {
  if (!RESEND_KEY || !r.member_email) return
  const gym = await brandingFor(supabase, r.gym_id)
  const plan = r.plan_name ?? (langue === 'en' ? 'membership' : 'abonnement')
  const { sujet, titre, html } = corpsEmail(
    langue, gym, plan,
    formatMontant(r.amount, langue),
    formatDate(r.next_payment_at, langue),
  )

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({
      // ⚠️ EXPÉDITEUR AU NOM DE LA SALLE. C'est elle le marchand et le créancier
      // économique ; Mollie recommande explicitement l'envoi « au nom et pour le compte »
      // du marchand. Un courrier signé Viniz désignerait le mauvais interlocuteur.
      from: emailSender(gym),
      to: r.member_email,
      subject: sujet,
      // ⚠️ AUCUN BOUTON D'ACTION. `emailShell` en pose un si on lui donne un `ctaPath` :
      // on ne lui en donne pas. Il n'y a rien à faire, et proposer un lien transformerait
      // un avis en sollicitation.
      html: emailShell(gym, { title: titre, width: 480, bodyHtml: html }),
    }),
  }).catch((e) => console.error('[send-sepa-prenotifications] email error:', e))
}

Deno.serve(async (req) => {
  const providedSecret = req.headers.get('X-Internal-Secret')
  if (!INTERNAL_SECRET || providedSecret !== INTERNAL_SECRET) {
    console.warn('[send-sepa-prenotifications] Unauthorized — invalid X-Internal-Secret')
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, serviceKey)

    const { data: avis, error } = await supabase.rpc('get_pending_sepa_prenotifications')
    if (error) {
      console.error('[send-sepa-prenotifications] RPC error:', error)
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      })
    }

    let envoyes = 0
    let rattrapages = 0
    for (const r of (avis ?? []) as PendingPrenotification[]) {
      try {
        // 🔴 LE RATTRAPAGE EST DIT, PAS SUBI. Un envoi à moins de 14 jours ne respecte pas
        // le délai : il doit laisser une trace explicite, sans quoi personne ne saura
        // jamais que l'obligation n'a pas été tenue pour ce membre-là.
        if (r.is_catchup) {
          rattrapages++
          console.warn(
            '[send-sepa-prenotifications] RATTRAPAGE — délai de 14 jours NON respecté :',
            r.days_remaining, 'jour(s) avant prélèvement · abonnement', r.subscription_id,
          )
        }

        await envoyer(supabase, r, langueDe(r.preferred_language))

        // ⚠️ MARQUÉ APRÈS L'ENVOI. La colonne est remise à NULL au prélèvement suivant
        // (mollie-subscription-webhook) : c'est ce couple qui fait qu'une notification
        // vaut pour UNE échéance et pas pour l'abonnement entier.
        await supabase.rpc('mark_sepa_prenotification_sent', { p_subscription_id: r.subscription_id })

        envoyes++
      } catch (e) {
        console.error('[send-sepa-prenotifications] error for subscription', r.subscription_id, e)
      }
    }

    console.log('[send-sepa-prenotifications] processed:', envoyes, 'of', avis?.length ?? 0,
      '· rattrapages:', rattrapages)
    return new Response(JSON.stringify({ sent: envoyes, catchup: rattrapages }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[send-sepa-prenotifications] uncaught:', err)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
})
