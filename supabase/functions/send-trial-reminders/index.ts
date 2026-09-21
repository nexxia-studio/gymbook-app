// ╔═══════════════════════════════════════════════════════════════════════════════════════╗
// ║  GYM-250 — LES RELANCES DE FIN D'ESSAI, AU GÉRANT                                     ║
// ╚═══════════════════════════════════════════════════════════════════════════════════════╝
//
// Appelée par pg_cron toutes les heures via `X-Internal-Secret`, sur le motif de
// `send-subscription-reminders` (GYM-116) : même garde en tête, même RPC de balayage, même
// marquage après envoi, mêmes erreurs isolées par élément.
//
// ⚠️ L'HEURE D'ENVOI N'EST PAS DÉCIDÉE ICI. Le cron passe toutes les heures et
// `get_pending_trial_reminders()` ne rend des lignes qu'à 9 h LOCALE de la salle. Cette
// fonction n'a donc aucune notion d'horaire, et une salle dans un autre fuseau est servie
// correctement sans qu'une ligne change ici.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// 🔴 CE QUI DIFFÈRE DE TOUS LES AUTRES COURRIERS DU DÉPÔT : LE DESTINATAIRE
// ─────────────────────────────────────────────────────────────────────────────────────
// Les quatorze gabarits existants écrivent à un MEMBRE, au nom de SA salle. Celui-ci écrit
// au GÉRANT, au nom de la PLATEFORME. L'identité est donc `VINIZ_BRANDING`, jamais
// `loadGymBranding` : un courrier qui annonce la fin d'un essai Viniz ne peut pas être
// signé du nom de la salle qui en est l'objet — ce serait la salle s'écrivant à elle-même.
//
// C'est la même règle qu'`auth-email-hook` applique déjà (« un gérant travaille DANS
// l'outil, il n'en est pas le client final »), et les constantes sont désormais les
// mêmes : elles ont déménagé dans `_shared/gym-branding.ts` pour ce lot.
//
// ⚠️ AUCUN PUSH. Le gérant n'a pas l'application mobile — c'est l'app des MEMBRES. Le
// courrier est son seul canal, et c'est aussi pourquoi aucune garde de plan ne le
// conditionne : `notifications_enabled` gouverne les notifications aux membres d'une
// salle, pas les messages de la plateforme à son client. Une salle en Free qui arrive au
// bout de son essai doit précisément recevoir ce courrier-là.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  emailSender,
  emailShell,
  DASHBOARD_URL,
  VINIZ_BRANDING,
  VINIZ_CTA_BG,
  VINIZ_CTA_FG,
} from '../_shared/gym-branding.ts'

const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const INTERNAL_SECRET = Deno.env.get('INTERNAL_FUNCTIONS_SECRET') ?? ''

/** Onglet Réglages → Abonnement. Même chemin que `SUBSCRIPTION_TAB_PATH` côté dashboard. */
const LIEN_ABONNEMENT = `${DASHBOARD_URL}/settings?tab=subscription`

type Jalon = 'j3' | 'j0' | 'j7'

interface RelanceEnAttente {
  gym_id: string
  gym_name: string
  gym_slug: string
  admin_id: string
  admin_email: string
  admin_first_name: string | null
  langue: string
  trial_ends_at: string
  days_remaining: number
  stage: Jalon
}

// ═════════════════════════════════════════════════════════════════════════════════════
// i18n — fr / en
// ═════════════════════════════════════════════════════════════════════════════════════
// 🔴 LA LANGUE VIENT DU GÉRANT, PAS DE LA SALLE — et c'est la RPC qui l'a déjà tranché :
// `profiles.preferred_language`, à défaut `nexxia_gyms.default_language`, à défaut `fr`.
// Un gérant néerlandophone d'une salle configurée en français reçoit son courrier dans SA
// langue : c'est à lui que la plateforme écrit.
//
// ⚠️ TOUTE AUTRE VALEUR RETOMBE SUR `fr`, comme dans `send-subscription-reminders` : `nl`
// et `de` existent dans l'app mobile mais pas dans les emails, et mieux vaut un français
// lisible qu'une clé brute.
type Langue = 'fr' | 'en'

function langueDe(pref: string | null): Langue {
  return (pref ?? '').toLowerCase().startsWith('en') ? 'en' : 'fr'
}

function dateLongue(iso: string, langue: Langue): string {
  return new Date(iso).toLocaleDateString(langue === 'en' ? 'en-GB' : 'fr-BE', {
    timeZone: 'Europe/Brussels', day: 'numeric', month: 'long', year: 'numeric',
  })
}

interface Textes {
  sujet: (salle: string, jours: number, date: string) => string
  titre: string
  emoji: string
  corps: (prenom: string, salle: string, date: string, jours: number) => string
  cta: string
}

// ─────────────────────────────────────────────────────────────────────────────────────
// 🔴 LE J-0 NOMME L'EXTINCTION. C'est la raison d'être de tout ce fichier.
// ─────────────────────────────────────────────────────────────────────────────────────
// Sans lui, le gérant apprend la fin de son essai par un membre qui n'arrive pas à payer —
// c'est ce qui est arrivé à Pace. Le courrier doit donc dire DEUX choses, et pas une :
//
//   ce qui CONTINUE : les abonnements et les crédits déjà vendus courent jusqu'à leur
//                     terme, les membres réservent, la salle encaisse au comptoir ;
//   ce qui S'ARRÊTE : la vente EN LIGNE, et elle seule.
//
// ⚠️ DIRE « votre essai est terminé » ET RIEN D'AUTRE serait pire que de ne rien dire : le
// gérant croirait avoir tout perdu, et le premier réflexe serait d'appeler ses membres
// pour les rassurer. C'est l'inverse du message.
const TEXTES: Record<Langue, Record<Jalon, Textes>> = {
  fr: {
    j3: {
      sujet: (salle, jours) =>
        `Il reste ${jours} jour${jours > 1 ? 's' : ''} d'essai à ${salle}`,
      titre: 'Votre essai se termine bientôt',
      emoji: '⏳',
      corps: (prenom, salle, date, jours) =>
        `<p style="color:#6B6861;margin:0 0 12px;">${prenom}</p>` +
        `<p style="color:#6B6861;margin:0 0 12px;">L'essai de <strong>${salle}</strong> se termine le <strong>${date}</strong>, ` +
        `dans ${jours} jour${jours > 1 ? 's' : ''}.</p>` +
        `<p style="color:#6B6861;margin:0 0 12px;">D'ici là, rien ne change. Après, votre salle repasse en formule Gratuite : ` +
        `vos membres gardent tout ce qu'ils ont déjà payé, mais vous ne pourrez plus encaisser en ligne.</p>` +
        `<p style="color:#6B6861;margin:0;">Choisir une formule prend deux minutes.</p>`,
      cta: 'Voir les formules',
    },
    j0: {
      sujet: (salle) => `L'essai de ${salle} se termine aujourd'hui`,
      titre: 'Votre essai se termine aujourd\'hui',
      emoji: '🔔',
      corps: (prenom, salle, date) =>
        `<p style="color:#6B6861;margin:0 0 12px;">${prenom}</p>` +
        `<p style="color:#6B6861;margin:0 0 16px;">L'essai de <strong>${salle}</strong> se termine aujourd'hui, ${date}.</p>` +
        `<p style="color:#17102E;margin:0 0 8px;"><strong>Ce qui ne change pas :</strong></p>` +
        `<p style="color:#6B6861;margin:0 0 16px;">Les abonnements et les crédits que vos membres ont déjà payés ` +
        `<strong>courent jusqu'à leur terme</strong>. Ils continuent de réserver normalement, et vous pouvez toujours ` +
        `vendre au comptoir et encaisser sur place.</p>` +
        `<p style="color:#17102E;margin:0 0 8px;"><strong>Ce qui s'arrête :</strong></p>` +
        `<p style="color:#6B6861;margin:0 0 16px;">Les <strong>nouvelles ventes en ligne</strong>. Vos membres ne pourront ` +
        `plus acheter un abonnement ou une séance depuis l'application tant qu'une formule n'est pas choisie.</p>` +
        `<p style="color:#6B6861;margin:0;">Tout redevient normal dès que vous en choisissez une.</p>`,
      cta: 'Choisir une formule',
    },
    j7: {
      sujet: (salle) => `${salle} ne peut plus encaisser en ligne`,
      titre: 'Une semaine sans vente en ligne',
      emoji: '💬',
      corps: (prenom, salle) =>
        `<p style="color:#6B6861;margin:0 0 12px;">${prenom}</p>` +
        `<p style="color:#6B6861;margin:0 0 12px;">Cela fait une semaine que <strong>${salle}</strong> ne peut plus ` +
        `encaisser en ligne. Vos membres gardent leurs abonnements et leurs crédits en cours — mais ils ne peuvent ` +
        `plus en acheter depuis l'application.</p>` +
        `<p style="color:#6B6861;margin:0;">Si quelque chose vous retient, répondez à ce message : on en parle. ` +
        `C'est le dernier courrier que nous vous enverrons à ce sujet.</p>`,
      cta: 'Voir les formules',
    },
  },
  en: {
    j3: {
      sujet: (salle, jours) =>
        `${jours} day${jours > 1 ? 's' : ''} left on ${salle}'s trial`,
      titre: 'Your trial ends soon',
      emoji: '⏳',
      corps: (prenom, salle, date, jours) =>
        `<p style="color:#6B6861;margin:0 0 12px;">${prenom}</p>` +
        `<p style="color:#6B6861;margin:0 0 12px;"><strong>${salle}</strong>'s trial ends on <strong>${date}</strong>, ` +
        `in ${jours} day${jours > 1 ? 's' : ''}.</p>` +
        `<p style="color:#6B6861;margin:0 0 12px;">Nothing changes until then. After that your gym returns to the Free plan: ` +
        `your members keep everything they have already paid for, but you will no longer be able to take payments online.</p>` +
        `<p style="color:#6B6861;margin:0;">Picking a plan takes two minutes.</p>`,
      cta: 'See the plans',
    },
    j0: {
      sujet: (salle) => `${salle}'s trial ends today`,
      titre: 'Your trial ends today',
      emoji: '🔔',
      corps: (prenom, salle, date) =>
        `<p style="color:#6B6861;margin:0 0 12px;">${prenom}</p>` +
        `<p style="color:#6B6861;margin:0 0 16px;"><strong>${salle}</strong>'s trial ends today, ${date}.</p>` +
        `<p style="color:#17102E;margin:0 0 8px;"><strong>What does not change:</strong></p>` +
        `<p style="color:#6B6861;margin:0 0 16px;">The memberships and credits your members have already paid for ` +
        `<strong>run to their term</strong>. They keep booking as usual, and you can still sell at the desk and take ` +
        `payment in person.</p>` +
        `<p style="color:#17102E;margin:0 0 8px;"><strong>What stops:</strong></p>` +
        `<p style="color:#6B6861;margin:0 0 16px;"><strong>New online sales.</strong> Your members will not be able to ` +
        `buy a membership or a session from the app until a plan is chosen.</p>` +
        `<p style="color:#6B6861;margin:0;">Everything returns to normal as soon as you pick one.</p>`,
      cta: 'Choose a plan',
    },
    j7: {
      sujet: (salle) => `${salle} cannot take online payments`,
      titre: 'A week without online sales',
      emoji: '💬',
      corps: (prenom, salle) =>
        `<p style="color:#6B6861;margin:0 0 12px;">${prenom}</p>` +
        `<p style="color:#6B6861;margin:0 0 12px;">It has been a week since <strong>${salle}</strong> could last take ` +
        `payments online. Your members keep their current memberships and credits — but they cannot buy new ones from ` +
        `the app.</p>` +
        `<p style="color:#6B6861;margin:0;">If something is holding you back, just reply to this message. ` +
        `This is the last email we will send you about it.</p>`,
      cta: 'See the plans',
    },
  },
}

async function envoyerEmail(r: RelanceEnAttente): Promise<void> {
  if (!RESEND_KEY) {
    console.warn('[send-trial-reminders] RESEND_API_KEY absente — aucun envoi')
    return
  }
  const langue = langueDe(r.langue)
  const t = TEXTES[langue][r.stage]
  const prenom = r.admin_first_name
    ? (langue === 'en' ? `Hi ${r.admin_first_name},` : `Bonjour ${r.admin_first_name},`)
    : (langue === 'en' ? 'Hi,' : 'Bonjour,')
  const date = dateLongue(r.trial_ends_at, langue)
  // `days_remaining` est NÉGATIF après le terme ; les gabarits J-0 et J+7 ne s'en servent
  // pas, seul le J-3 l'affiche et sa fenêtre est bornée à [1, 3] côté SQL.
  const jours = Math.max(r.days_remaining, 0)

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({
      from: emailSender(VINIZ_BRANDING),
      to: r.admin_email,
      subject: t.sujet(r.gym_name, jours, date),
      html: emailShell(VINIZ_BRANDING, {
        title: t.titre,
        emoji: t.emoji,
        width: 520,
        bodyHtml: t.corps(prenom, r.gym_name, date, jours),
        ctaLabel: t.cta,
        // ⚠️ `ctaUrl` ET NON `ctaPath` : `ctaPath` fabriquerait un Universal Link MEMBRE
        // à partir du slug de la salle, et `VINIZ_BRANDING.slug` est vide. Le gérant doit
        // atterrir sur SON dashboard.
        ctaUrl: LIEN_ABONNEMENT,
        ctaBg: VINIZ_CTA_BG,
        ctaFg: VINIZ_CTA_FG,
      }),
    }),
  })

  if (!res.ok) {
    // Remonté à l'appelant : c'est lui qui décide de ne PAS marquer le jalon.
    throw new Error(`resend ${res.status}`)
  }
}

Deno.serve(async (req) => {
  const providedSecret = req.headers.get('X-Internal-Secret')
  if (!INTERNAL_SECRET || providedSecret !== INTERNAL_SECRET) {
    console.warn('[send-trial-reminders] Unauthorized — invalid X-Internal-Secret')
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data, error } = await supabase.rpc('get_pending_trial_reminders')
    if (error) {
      console.error('[send-trial-reminders] RPC error:', error)
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      })
    }

    const relances = (data ?? []) as RelanceEnAttente[]

    // ═══════════════════════════════════════════════════════════════════════════════════
    // 🔴 UNE LIGNE PAR GÉRANT, UN JALON PAR SALLE — LE REGROUPEMENT EST L'INVARIANT
    // ═══════════════════════════════════════════════════════════════════════════════════
    // Dopamine a TROIS `gym_admin`. Marquer le jalon après chaque envoi aurait posé la
    // marque au premier et privé les deux autres de leur courrier. On regroupe donc par
    // (salle, jalon) : les trois emails partent, PUIS la marque est posée une fois.
    const groupes = new Map<string, RelanceEnAttente[]>()
    for (const r of relances) {
      const cle = `${r.gym_id}:${r.stage}`
      const lot = groupes.get(cle)
      if (lot) lot.push(r)
      else groupes.set(cle, [r])
    }

    let envoyes = 0
    let jalons = 0

    for (const [cle, lot] of groupes) {
      let auMoinsUn = false
      for (const r of lot) {
        try {
          await envoyerEmail(r)
          envoyes++
          auMoinsUn = true
        } catch (e) {
          // Un destinataire en échec ne prive pas les autres — ni de leur courrier, ni du
          // marquage : le jalon appartient à la SALLE, pas à un gérant.
          console.error('[send-trial-reminders] envoi échoué, gérant', r.admin_id, e)
        }
      }

      // ⚠️ LE JALON N'EST MARQUÉ QUE SI AU MOINS UN COURRIER EST PARTI. Zéro envoi = panne
      // Resend ou clé absente : ne rien marquer laisse le cron rattraper à l'heure
      // suivante, et les fenêtres SQL sont assez larges (J-0 : trois jours) pour que le
      // rattrapage aboutisse.
      if (!auMoinsUn) {
        console.error('[send-trial-reminders] aucun envoi pour', cle, '— jalon NON marqué')
        continue
      }

      const [gymId, stage] = cle.split(':')
      // La RPC est elle-même idempotente (`WHERE ... IS NULL`) : elle rend `false` si la
      // marque était déjà posée. Deux exécutions concurrentes ne repoussent donc pas
      // l'horodatage, et la seconde n'enverra plus rien au passage suivant.
      const { data: pose } = await supabase.rpc('mark_trial_reminder_sent', {
        p_gym_id: gymId, p_stage: stage,
      })
      if (pose) jalons++
      else console.warn('[send-trial-reminders] jalon déjà marqué pour', cle)
    }

    console.log('[send-trial-reminders] emails:', envoyes, '· jalons posés:', jalons,
                '· lignes rendues:', relances.length)
    return new Response(JSON.stringify({ sent: envoyes, milestones: jalons }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[send-trial-reminders] fatal:', err)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
})
