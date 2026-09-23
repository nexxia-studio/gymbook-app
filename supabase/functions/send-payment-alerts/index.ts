// ╔═══════════════════════════════════════════════════════════════════════════════════════╗
// ║  GYM-359 — SLACK APPREND QU'UNE SALLE N'ENCAISSE PLUS                                 ║
// ╚═══════════════════════════════════════════════════════════════════════════════════════╝
//
// L'INCIDENT : du 17 au 23/09, six membres de Dopamine ont tenté 19 achats, tous échoués.
// UN SEUL l'a signalé. Antoine l'a découvert six jours plus tard en lisant la base à la
// main. ~680 € en attente.
//
// 🔴 LE COCKPIT PERMET DE CHERCHER, IL NE PRÉVIENT PAS. Un tableau de bord répond à qui
// l'ouvre ; une alerte va chercher celui qui ne l'a pas ouvert. C'est une différence de
// nature, pas de degré.
//
// Appelée par pg_cron toutes les heures via `X-Internal-Secret`, sur le motif de
// `send-subscription-reminders` et `send-trial-reminders`.
//
// ⚠️ TOUTE LA DÉCISION EST EN SQL (`payment_alerts_pending`). Cette fonction ne décide de
// RIEN : elle met en forme et elle poste. Les seuils, les règles et la mémoire des épisodes
// vivent dans la migration, où ils se relisent et se simulent sur les données réelles.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { DASHBOARD_URL } from '../_shared/gym-branding.ts'

const INTERNAL_SECRET = Deno.env.get('INTERNAL_FUNCTIONS_SECRET') ?? ''
const SLACK_WEBHOOK_URL = Deno.env.get('SLACK_WEBHOOK_URL') ?? ''

interface Membre { nom: string; tentatives: number; montant: number }

interface Detail {
  echecs: number
  succes: number
  montant: number
  premiere: string | null
  derniere: string | null
  membres_bloques: number
  regle_a: boolean
  regle_b: boolean
  membres: Membre[]
  formules: string[]
  // Présents seulement sur une résolution.
  duree_minutes?: number
  echecs_episode?: string
  dernier_succes?: { membre: string; montant: number; quand: string } | null
}

interface Alerte {
  action: 'open' | 'resolved'
  gym_id: string
  gym_name: string
  gym_slug: string
  detail: Detail
}

/** Date lisible par un humain pressé, sur l'horloge de Bruxelles. */
function quand(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('fr-BE', {
    timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

function euros(n: number): string {
  return `${Number(n).toFixed(2).replace('.', ',')} €`
}

/**
 * Le message d'ENTRÉE en incident.
 *
 * ⚠️ IL DOIT SUFFIRE À AGIR SANS OUVRIR LA BASE — c'est le cahier des charges, et c'est ce
 * qui a manqué pendant six jours : la salle, QUI est bloqué et combien de fois, sur quelles
 * formules, combien d'argent, depuis quand, et où aller.
 *
 * ⚠️ CANAL INTERNE : les NOMS des membres y sont acceptables, et ils sont nécessaires — sans
 * eux, personne ne peut rappeler qui que ce soit. En revanche AUCUN email et AUCUN
 * identifiant Mollie : ils n'aident à rien ici et n'ont rien à faire dans un canal d'équipe.
 */
function blocsOuverture(a: Alerte): unknown[] {
  const d = a.detail
  const membres = d.membres
    .map((m) => `• *${m.nom}* — ${m.tentatives} tentative${m.tentatives > 1 ? 's' : ''} · ${euros(m.montant)}`)
    .join('\n') || '—'

  // Quelle règle a parlé : ce n'est pas un détail d'implémentation, ça oriente le regard.
  // « un membre bloqué » alors que la salle vend encore désigne UN CHEMIN d'achat ; « la
  // salle n'encaisse plus » désigne la salle entière.
  const motif = d.regle_b
    ? `${d.echecs} échecs et *aucun paiement* en 24 h`
    : `${d.membres_bloques} membre${d.membres_bloques > 1 ? 's' : ''} qui ${d.membres_bloques > 1 ? 'échouent' : 'échoue'} sans jamais aboutir`
      + (d.succes > 0 ? ` — la salle encaisse encore par ailleurs (${d.succes} paiement${d.succes > 1 ? 's' : ''})` : '')

  return [
    { type: 'header', text: { type: 'plain_text', text: `🔴 ${a.gym_name} — des achats n'aboutissent pas`, emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: `*${motif}.*\n*${euros(d.montant)}* en jeu.` } },
    { type: 'section', text: { type: 'mrkdwn', text: `*Membres concernés*\n${membres}` } },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Formules*\n${d.formules.length ? d.formules.join(', ') : '—'}` },
        { type: 'mrkdwn', text: `*Période*\n${quand(d.premiere)} → ${quand(d.derniere)}` },
      ],
    },
    {
      type: 'actions',
      elements: [{
        type: 'button',
        text: { type: 'plain_text', text: 'Ouvrir la fiche salle', emoji: true },
        // Route du cockpit lot 2 : /cockpit/:gymId.
        url: `${DASHBOARD_URL}/cockpit/${a.gym_id}`,
      }],
    },
  ]
}

/**
 * Le message de RETOUR À LA NORMALE.
 *
 * 🔴 SANS LUI, ON NE SAURAIT JAMAIS SI C'EST RÉPARÉ — et la prochaine alerte se lirait
 * comme la continuation de la précédente. C'est la moitié qui manque à la plupart des
 * systèmes d'alerte, et celle qui fait qu'on finit par ne plus les lire.
 */
function blocsResolution(a: Alerte): unknown[] {
  const d = a.detail
  const s = d.dernier_succes
  const duree = d.duree_minutes ?? 0
  const lisible = duree >= 120 ? `${Math.round(duree / 60)} h` : `${duree} min`

  return [
    { type: 'header', text: { type: 'plain_text', text: `✅ ${a.gym_name} — les achats repassent`, emoji: true } },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Épisode clos après *${lisible}* (${d.echecs_episode ?? '?'} échecs au moment de l'alerte).`
          + (s ? `\nDernier paiement abouti : *${s.membre}*, ${euros(s.montant)}, ${quand(s.quand)}.` : ''),
      },
    },
  ]
}

/**
 * Consigne un échec de TRANSPORT.
 *
 * ⚠️ SOUS UN AUTRE `function_name` QUE LES ÉPISODES, et ce n'est pas un détail :
 * `payment_alerts_pending` cherche une ligne ouverte `function_name = 'payment-alerts'`
 * pour savoir si un épisode est déjà signalé. Une panne Slack rangée là serait prise pour
 * un épisode en cours, et empêcherait la VRAIE alerte de partir — le silence, encore.
 */
async function consignerEchecSlack(
  // deno-lint-ignore no-explicit-any
  supabase: any, gymId: string, action: string, detail: unknown,
): Promise<void> {
  await supabase.from('webhook_failures').insert({
    function_name: 'payment-alerts-slack',
    stage: action,
    gym_id: gymId,
    detail: { error: String(detail) },
  })
}

Deno.serve(async (req) => {
  const providedSecret = req.headers.get('X-Internal-Secret')
  if (!INTERNAL_SECRET || providedSecret !== INTERNAL_SECRET) {
    console.warn('[send-payment-alerts] Unauthorized — invalid X-Internal-Secret')
    return new Response('Unauthorized', { status: 401 })
  }

  // ⚠️ PAS DE WEBHOOK, PAS DE PLANTAGE. Le secret est posé par le cockpit ; tant qu'il ne
  // l'est pas, cette fonction doit sortir proprement. Une alerte muette ne doit pas casser
  // le cron ni remplir les journaux d'erreurs — sans quoi on remplacerait un silence par
  // du bruit.
  if (!SLACK_WEBHOOK_URL) {
    console.warn('[send-payment-alerts] SLACK_WEBHOOK_URL absent — rien envoyé, rien marqué')
    return new Response(JSON.stringify({ skipped: 'no_webhook' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data, error } = await supabase.rpc('payment_alerts_pending')
    if (error) {
      console.error('[send-payment-alerts] RPC error:', error)
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      })
    }

    const alertes = (data ?? []) as Alerte[]
    let envoyes = 0
    let echecs = 0

    for (const a of alertes) {
      const blocks = a.action === 'open' ? blocsOuverture(a) : blocsResolution(a)
      // `text` est le repli des notifications (mobile, listes) : sans lui Slack affiche
      // « This content can't be displayed ».
      const texte = a.action === 'open'
        ? `${a.gym_name} — des achats n'aboutissent pas (${a.detail.echecs} échecs, ${euros(a.detail.montant)})`
        : `${a.gym_name} — les achats repassent`

      try {
        const res = await fetch(SLACK_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: texte, blocks }),
        })

        if (!res.ok) {
          // 🔴 ON NE MARQUE PAS. La ligne d'épisode reste à ouvrir : le passage suivant du
          // cron réessaiera, et l'alerte finira par partir. Marquer ici la perdrait pour
          // toujours — c'est exactement le silence que ce lot supprime.
          const corps = await res.text().catch(() => '')
          console.error(`[send-payment-alerts] Slack ${res.status} pour ${a.gym_name} : ${corps.slice(0, 200)}`)
          await consignerEchecSlack(supabase, a.gym_id, a.action, `slack ${res.status}`)
          echecs++
          continue
        }
      } catch (e) {
        // Réseau : même traitement. Ne rien marquer, laisser le cron réessayer.
        console.error('[send-payment-alerts] envoi Slack impossible :', e)
        await consignerEchecSlack(supabase, a.gym_id, a.action, e)
        echecs++
        continue
      }

      // ⚠️ MARQUÉ APRÈS L'ENVOI, ET SEULEMENT APRÈS. Le risque résiduel est un doublon si le
      // marquage échoue derrière un envoi réussi. C'est le bon sens de l'arbitrage : un
      // doublon se lit, un silence ne se lit pas.
      const { error: markErr } = await supabase.rpc('payment_alert_mark', {
        p_gym_id: a.gym_id, p_action: a.action, p_detail: a.detail,
      })
      if (markErr) console.error('[send-payment-alerts] marquage :', markErr)
      envoyes++
    }

    console.log(`[send-payment-alerts] à envoyer: ${alertes.length} · envoyés: ${envoyes} · échecs: ${echecs}`)
    return new Response(JSON.stringify({ pending: alertes.length, sent: envoyes, failed: echecs }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[send-payment-alerts] fatal:', err)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
})
