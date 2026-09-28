// ╔═══════════════════════════════════════════════════════════════════════════════════════╗
// ║  SURVEILLANCE DES RENOUVELLEMENTS SEPA — Slack apprend qu'une échéance a déraillé     ║
// ╚═══════════════════════════════════════════════════════════════════════════════════════╝
//
// LE 30/09, trois prélèvements automatiques partent pour la première fois de l'histoire du
// produit (Robin 120 €, Sarah 110 €, Faustin 120 €), puis deux le 01/10 et un le 04/10.
//
// 🔴 LE PIRE DES CAS N'EST PAS L'ÉCHEC, C'EST LE SILENCE. Un refus de banque se voit : le
// membre perd son accès et appelle. Un prélèvement qui n'arrive jamais ne se voit PAS — le
// membre garde son accès, n'est pas débité, et personne ne se plaint. C'est le motif
// `no_debit`, et c'est la raison d'être de ce lot.
//
// ⚠️ MÊME MOTIF QUE GYM-359, REPRIS ET NON RÉINVENTÉ : toute la décision est en SQL
// (`renewal_alerts_pending`). Cette fonction ne décide de RIEN — elle met en forme et elle
// poste. Les seuils, les règles et la mémoire des épisodes vivent dans la migration, où ils
// se relisent et se simulent sur les données réelles.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { DASHBOARD_URL } from '../_shared/gym-branding.ts'

const INTERNAL_SECRET = Deno.env.get('INTERNAL_FUNCTIONS_SECRET') ?? ''
const SLACK_WEBHOOK_URL = Deno.env.get('SLACK_WEBHOOK_URL') ?? ''

type Motif = 'no_debit' | 'past_due' | 'suspended' | 'chain_stalled'

interface Detail {
  statut: string
  membre: string | null
  formule: string | null
  montant: number | null
  echeance: string | null
  terme: string | null
  prenotifie_le: string | null
  echeances_payees: number | null
  echeances_prevues: number | null
  echecs: number | null
  premier_echec: string | null
  suspendu_le: string | null
  dernier_renouvellement: string | null
  retard_heures: number | null
  chain_detail: 'echeance_figee' | 'avis_non_reinitialise' | null
  // Présents seulement sur une résolution.
  ouverte_depuis?: string
  duree_heures?: number
}

interface Alerte {
  action: 'open' | 'resolved'
  motif: Motif
  gym_id: string
  gym_name: string
  gym_slug: string
  subscription_id: string
  mollie_subscription_id: string
  detail: Detail
}

/** Date lisible par un humain pressé, sur l'horloge de Bruxelles. */
function quand(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('fr-BE', {
    timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

function euros(n: number | null | undefined): string {
  if (n == null) return '—'
  return `${Number(n).toFixed(2).replace('.', ',')} €`
}

/** Un retard en heures se lit mal au-delà d'une journée. */
function duree(heures: number | null | undefined): string {
  if (heures == null) return '—'
  const h = Math.round(heures)
  if (h < 48) return `${h} h`
  return `${Math.floor(h / 24)} j ${h % 24} h`
}

/**
 * Ce que chaque motif RACONTE — et il faut que ce soit la première phrase lue, pas une
 * étiquette technique. Qui lit `#gymbook-payments` à 23 h doit savoir en une ligne s'il
 * doit se lever.
 */
const MOTIFS: Record<Motif, { emoji: string; titre: string; gravite: string }> = {
  no_debit: {
    emoji: '🔴',
    titre: 'prélèvement attendu, jamais arrivé',
    // 🔴 C'est le seul motif dont personne ne se plaindra jamais : le membre garde son
    // accès et n'est pas débité. Sans cette alerte, on l'apprendrait au prélèvement
    // suivant — un mois plus tard, avec deux mois à rattraper.
    gravite: "Ni encaissement, ni refus : Mollie n'a rien dit. Le membre garde son accès et n'est pas débité.",
  },
  past_due: {
    emoji: '⚠️',
    titre: 'refus de banque',
    gravite: "L'accès reste ouvert pendant la grâce de 3 jours, puis il se coupe.",
  },
  suspended: {
    emoji: '🔴',
    titre: 'accès coupé après la grâce',
    gravite: "La grâce de 3 jours s'est écoulée sans régularisation : le membre n'entre plus.",
  },
  chain_stalled: {
    emoji: '🔴',
    titre: "l'argent est rentré, la chaîne est bloquée",
    // 🔴 Le plus insidieux des quatre : tout a l'air normal. C'est un défaut de
    // CONFORMITÉ — la prochaine échéance partira sans avis SEPA préalable.
    gravite: "La prochaine échéance partira SANS avis SEPA. C'est un défaut de conformité, pas un incident de caisse.",
  },
}

/**
 * Le message d'ENTRÉE en incident.
 *
 * ⚠️ IL DOIT SUFFIRE À AGIR SANS OUVRIR LA BASE : qui, quelle formule, combien, quelle
 * échéance, depuis combien de temps, et où aller.
 *
 * ⚠️ CANAL INTERNE : le NOM du membre y est acceptable, et il est nécessaire — sans lui,
 * personne ne peut le rappeler. En revanche AUCUN email et AUCUN identifiant Mollie :
 * l'identifiant d'abonnement sert de clé d'épisode EN BASE, il n'a rien à faire dans un
 * canal d'équipe où il n'aide personne.
 */
function blocsOuverture(a: Alerte): unknown[] {
  const d = a.detail
  const m = MOTIFS[a.motif]

  const faits: string[] = []
  if (a.motif === 'no_debit') {
    faits.push(`*Échéance*\n${quand(d.echeance)} — en retard de ${duree(d.retard_heures)}`)
  } else if (a.motif === 'past_due') {
    faits.push(`*Premier refus*\n${quand(d.premier_echec)} (${d.echecs ?? 0} tentative${(d.echecs ?? 0) > 1 ? 's' : ''})`)
  } else if (a.motif === 'suspended') {
    faits.push(`*Suspendu le*\n${quand(d.suspendu_le)}`)
  } else {
    faits.push(`*Encaissé le*\n${quand(d.dernier_renouvellement)}`)
    faits.push(d.chain_detail === 'echeance_figee'
      ? `*Ce qui n'a pas bougé*\nL'échéance, restée au ${quand(d.echeance)}`
      : `*Ce qui n'a pas bougé*\nL'avis SEPA, marqué envoyé le ${quand(d.prenotifie_le)}`)
  }
  faits.push(`*Échéances*\n${d.echeances_payees ?? '?'} / ${d.echeances_prevues ?? '?'}`)
  faits.push(`*Terme*\n${quand(d.terme)}`)

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${m.emoji} ${a.gym_name} — ${m.titre}`, emoji: true },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${d.membre ?? 'membre inconnu'}* — ${d.formule ?? 'formule inconnue'}, *${euros(d.montant)}*\n${m.gravite}`,
      },
    },
    { type: 'section', fields: faits.slice(0, 4).map((text) => ({ type: 'mrkdwn', text })) },
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
 * 🔴 SANS LUI, ON NE SAURAIT JAMAIS SI C'EST RÉPARÉ — et un `past_due` qui devient
 * `suspended` se lirait comme deux incidents sans lien au lieu d'une escalade.
 *
 * ⚠️ « RÉSOLU » NE VEUT PAS DIRE « PAYÉ », et le message ne doit pas le laisser croire : le
 * statut courant est dit tel quel. Un `past_due` qui se referme parce que l'abonnement est
 * passé `suspended` n'est pas une bonne nouvelle.
 */
function blocsResolution(a: Alerte): unknown[] {
  const d = a.detail
  const m = MOTIFS[a.motif]
  const bonneNouvelle = d.statut === 'active'

  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${bonneNouvelle ? '✅' : '↪️'} ${a.gym_name} — ${m.titre} : terminé`,
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${d.membre ?? 'membre inconnu'}* — ${d.formule ?? ''}\n`
          + `Épisode clos après *${duree(d.duree_heures)}*. Statut courant : *${d.statut}*.`
          + (bonneNouvelle
            ? `\nProchaine échéance : ${quand(d.echeance)}.`
            : `\n⚠️ Ce n'est pas un retour à la normale : le motif a disparu parce que l'abonnement a changé d'état.`),
      },
    },
  ]
}

/**
 * Consigne un échec de TRANSPORT.
 *
 * ⚠️ SOUS UN AUTRE `function_name` QUE LES ÉPISODES, et ce n'est pas un détail :
 * `renewal_alerts_pending` cherche une ligne ouverte `function_name = 'renewal-alerts'`
 * pour savoir si un épisode est déjà signalé. Une panne Slack rangée là serait prise pour
 * un épisode en cours, et empêcherait la VRAIE alerte de partir — le silence, encore.
 */
async function consignerEchecSlack(
  // deno-lint-ignore no-explicit-any
  supabase: any, gymId: string, mollieSubId: string, motif: string, detail: unknown,
): Promise<void> {
  await supabase.from('webhook_failures').insert({
    function_name: 'renewal-alerts-slack',
    stage: motif,
    mollie_id: mollieSubId,
    gym_id: gymId,
    detail: { error: String(detail) },
  })
}

Deno.serve(async (req) => {
  const providedSecret = req.headers.get('X-Internal-Secret')
  if (!INTERNAL_SECRET || providedSecret !== INTERNAL_SECRET) {
    console.warn('[send-renewal-alerts] Unauthorized — invalid X-Internal-Secret')
    return new Response('Unauthorized', { status: 401 })
  }

  // ⚠️ PAS DE WEBHOOK, PAS DE PLANTAGE. Le secret est posé par le cockpit ; tant qu'il ne
  // l'est pas, cette fonction doit sortir proprement. Une alerte muette ne doit pas casser
  // le cron ni remplir les journaux d'erreurs — sans quoi on remplacerait un silence par
  // du bruit.
  if (!SLACK_WEBHOOK_URL) {
    console.warn('[send-renewal-alerts] SLACK_WEBHOOK_URL absent — rien envoyé, rien marqué')
    return new Response(JSON.stringify({ skipped: 'no_webhook' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data, error } = await supabase.rpc('renewal_alerts_pending')
    if (error) {
      console.error('[send-renewal-alerts] RPC error:', error)
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
        ? `${a.gym_name} — ${a.detail.membre ?? 'un membre'} : ${MOTIFS[a.motif].titre}`
        : `${a.gym_name} — ${a.detail.membre ?? 'un membre'} : ${MOTIFS[a.motif].titre}, terminé`

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
          console.error(`[send-renewal-alerts] Slack ${res.status} pour ${a.gym_name}/${a.motif} : ${corps.slice(0, 200)}`)
          await consignerEchecSlack(supabase, a.gym_id, a.mollie_subscription_id, a.motif, `slack ${res.status}`)
          echecs++
          continue
        }
      } catch (e) {
        // Réseau : même traitement. Ne rien marquer, laisser le cron réessayer.
        console.error('[send-renewal-alerts] envoi Slack impossible :', e)
        await consignerEchecSlack(supabase, a.gym_id, a.mollie_subscription_id, a.motif, e)
        echecs++
        continue
      }

      // ⚠️ MARQUÉ APRÈS L'ENVOI, ET SEULEMENT APRÈS. Le risque résiduel est un doublon si le
      // marquage échoue derrière un envoi réussi. C'est le bon sens de l'arbitrage : un
      // doublon se lit, un silence ne se lit pas.
      const { error: markErr } = await supabase.rpc('renewal_alert_mark', {
        p_mollie_subscription_id: a.mollie_subscription_id,
        p_motif: a.motif,
        p_action: a.action,
        p_gym_id: a.gym_id,
        p_detail: a.detail,
      })
      if (markErr) console.error('[send-renewal-alerts] marquage :', markErr)
      envoyes++
    }

    console.log(`[send-renewal-alerts] à envoyer: ${alertes.length} · envoyés: ${envoyes} · échecs: ${echecs}`)
    return new Response(JSON.stringify({ pending: alertes.length, sent: envoyes, failed: echecs }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[send-renewal-alerts] fatal:', err)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
})
