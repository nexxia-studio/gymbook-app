// GYM-252 — BALAYAGE QUOTIDIEN DES IMPAYÉS : la coupure d'accès au terme de la grâce.
//
// Appelée par pg_cron une fois par jour via X-Internal-Secret — même motif que
// send-reminders (*/15) et send-noshow-notification (*/30). ⚠️ AUCUN NOUVEAU SERVICE :
// c'est une Edge Function de plus sur le mécanisme existant, pas une infrastructure.
//
// ─────────────────────────────────────────────────────────────────────────────────
// POURQUOI UNE FONCTION ET PAS DU SQL DANS expire-subscriptions
// ─────────────────────────────────────────────────────────────────────────────────
// Le balayage doit ENVOYER DES COURRIERS. Postgres ne le peut pas, et une suspension
// muette serait exactement le défaut que ce lot corrige — un membre qui découvre qu'il
// n'a plus accès en se présentant à la salle. La bascule d'état, elle, reste en SQL
// (suspend_overdue_subscriptions) : c'est là qu'elle est atomique et idempotente.
//
// ─────────────────────────────────────────────────────────────────────────────────
// L'IDEMPOTENCE N'EST PAS ICI, ELLE EST DANS LE RPC
// ─────────────────────────────────────────────────────────────────────────────────
// `suspend_overdue_subscriptions` ne RETOURNE que les lignes qu'il a RÉELLEMENT
// basculées (RETURNING sur un UPDATE dont le WHERE exclut déjà 'suspended'). Cette
// fonction n'a donc aucun garde à réinventer : rejouer le balayage dix fois dans la
// journée rend un tableau vide et n'envoie rien. C'est le même principe que le
// `RETURNING` d'expire_subscriptions.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { loadGymBranding, emailSender, type GymBranding } from '../_shared/gym-branding.ts'
import {
  buildMemberSuspensionEmail,
  buildOwnerAlertEmail,
} from '../_shared/failed-renewal-emails.ts'

const FN = 'process-failed-renewals'

const INTERNAL_SECRET = Deno.env.get('INTERNAL_FUNCTIONS_SECRET') ?? ''
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''

/** Grâce avant coupure, en jours.
 *  ⚠️ MÊME VALEUR QUE `GRACE_DAYS` dans mollie-subscription-webhook (qui annonce la date
 *  de coupure au membre) ET que le défaut de suspend_overdue_subscriptions(p_grace_days).
 *  Les trois se citent mutuellement : une seule modifiée, et le courrier du J0 annoncerait
 *  une date que le balayage ne respecterait pas. */
const GRACE_DAYS = 3

interface OverdueRow {
  id: string
  member_id: string
  gym_id: string
  plan_name: string | null
  amount: number | null
  payment_failed_at: string | null
  payment_failed_count: number | null
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Envoi Resend best-effort, PAR LIGNE.
 *
 * ⚠️ UN ÉCHEC D'ENVOI NE DOIT PAS INTERROMPRE LE BALAYAGE. La suspension est déjà écrite
 * en base quand on arrive ici : lever ferait perdre les courriers de TOUS les membres
 * suivants, sans rien annuler pour autant. On journalise, on compte, on continue.
 */
async function sendMail(from: string, to: string, subject: string, html: string): Promise<boolean> {
  if (!RESEND_KEY) {
    console.error(`[${FN}] RESEND_API_KEY absent — email non envoyé:`, subject)
    return false
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({ from, to, subject, html }),
    })
    if (!res.ok) {
      console.error(`[${FN}] Resend refus:`, res.status, (await res.text()).slice(0, 300))
      return false
    }
    return true
  } catch (e) {
    console.error(`[${FN}] Resend threw:`, e)
    return false
  }
}

/**
 * Identité de salle, lue UNE FOIS par salle et par passage.
 *
 * Le balayage traite des lignes groupées par salle : sans cache, dix membres suspendus
 * dans la même salle produiraient dix lectures identiques de nexxia_gyms. La leçon est
 * inscrite en toutes lettres dans gym-branding.ts — « une seule lecture par envoi » ;
 * ici, l'unité est le passage.
 */
async function brandingFor(
  supabase: SupabaseClient,
  cache: Map<string, GymBranding>,
  gymId: string,
): Promise<GymBranding> {
  const hit = cache.get(gymId)
  if (hit) return hit
  const branding = await loadGymBranding(supabase, gymId)
  cache.set(gymId, branding)
  return branding
}

Deno.serve(async (req) => {
  const providedSecret = req.headers.get('X-Internal-Secret')
  if (!INTERNAL_SECRET || providedSecret !== INTERNAL_SECRET) {
    console.warn(`[${FN}] Unauthorized — invalid X-Internal-Secret`)
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // ── LA BASCULE D'ÉTAT, en un seul UPDATE atomique ──────────────────────────────
    // Elle coupe l'accès par le MÊME chemin que l'expiration : 'suspended' ne figure
    // dans aucun prédicat « ouvre des droits », donc le membre est traité comme un
    // non-abonné. Ce n'est pas un drapeau qu'il faudrait ensuite penser à lire quelque
    // part — c'est le prédicat lui-même qui change de réponse.
    const { data, error } = await supabase.rpc('suspend_overdue_subscriptions', {
      p_grace_days: GRACE_DAYS,
    })

    if (error) {
      console.error(`[${FN}] RPC error:`, error)
      return jsonResponse({ error: error.message }, 500)
    }

    const rows = (data ?? []) as OverdueRow[]
    if (rows.length === 0) {
      console.log(`[${FN}] aucun abonnement à suspendre`)
      return jsonResponse({ suspended: 0, member_emails: 0, owner_emails: 0 })
    }

    console.log(`[${FN}] ${rows.length} abonnement(s) suspendu(s) pour impayé`)

    const brandingCache = new Map<string, GymBranding>()
    let memberEmails = 0
    let ownerEmails = 0

    for (const row of rows) {
      try {
        const branding = await brandingFor(supabase, brandingCache, row.gym_id)
        const from = emailSender(branding)
        const planName = row.plan_name ?? 'Abonnement'
        const amount = typeof row.amount === 'number' ? row.amount : null

        const { data: profile } = await supabase
          .from('profiles')
          .select('email, first_name, last_name')
          .eq('id', row.member_id)
          .maybeSingle()

        // ── 2e courrier membre ────────────────────────────────────────────────────
        if (profile?.email) {
          const mail = buildMemberSuspensionEmail({
            branding,
            firstName: profile.first_name ?? null,
            planName,
            amount,
          })
          if (await sendMail(from, profile.email, mail.subject, mail.html)) memberEmails++
        } else {
          // ⚠️ L'accès EST coupé même sans email : la bascule précède l'envoi et ne
          // dépend pas de lui. Le signaler bruyamment, c'est la seule façon qu'un
          // membre injoignable ne devienne pas une suspension inexpliquée au comptoir.
          console.error(`[${FN}] membre sans email — suspension NON notifiée:`, row.member_id)
        }

        // ── Alerte gérant ─────────────────────────────────────────────────────────
        if (branding.email) {
          const memberName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ')
            || profile?.email || row.member_id
          const alert = buildOwnerAlertEmail({
            branding,
            memberName,
            memberEmail: profile?.email ?? null,
            planName,
            amount,
            stage: 'suspended',
            failedCount: row.payment_failed_count ?? 1,
            graceDays: GRACE_DAYS,
          })
          if (await sendMail(from, branding.email, alert.subject, alert.html)) ownerEmails++
        } else {
          console.warn(`[${FN}] nexxia_gyms.email absent — alerte gérant non envoyée, gym`, row.gym_id)
        }
      } catch (e) {
        // Une ligne qui échoue n'emporte pas les suivantes. La suspension, elle, tient :
        // elle a été écrite par le RPC, en dehors de cette boucle.
        console.error(`[${FN}] notification échouée pour l'abonnement ${row.id} (non-bloquant):`, e)
      }
    }

    console.log(`[${FN}] terminé — suspendus: ${rows.length}, emails membre: ${memberEmails}, emails gérant: ${ownerEmails}`)
    return jsonResponse({ suspended: rows.length, member_emails: memberEmails, owner_emails: ownerEmails })
  } catch (err) {
    console.error(`[${FN}] uncaught:`, err)
    return jsonResponse({ error: err instanceof Error ? err.message : 'Erreur interne' }, 500)
  }
})
