// GYM-252 — LES TROIS COURRIERS D'UN RENOUVELLEMENT EN ÉCHEC, EN UN SEUL ENDROIT.
//
// Ils partent de DEUX exécutants différents — le webhook Mollie (J0, au moment de
// l'échec) et le balayage quotidien (J+3, à la suspension). Écrire les gabarits chez
// chacun aurait suffi à les faire diverger au premier ajustement de ton : c'est la
// leçon de GYM-238, appliquée avant que la divergence n'existe.
//
// ⚠️ CE MODULE N'ENVOIE RIEN. Il compose du HTML. Chaque appelant garde son propre
// envoi Resend et sa propre sémantique d'erreur — best-effort côté webhook (un email
// ne doit jamais faire échouer un webhook de paiement), best-effort par ligne côté
// balayage. Même règle qu'à gym-branding.ts : on factorise ce qui se répète, pas ce
// qui se ressemble.
//
// ─────────────────────────────────────────────────────────────────────────────────
// 🔴 CE QUE CES EMAILS NE FONT PAS, ET POURQUOI
// ─────────────────────────────────────────────────────────────────────────────────
// AUCUN LIEN DE PAIEMENT DE RATTRAPAGE. C'est la conséquence directe de la doc Mollie
// (docs.mollie.com/docs/recurring-payments, 24/08/2026) :
//
//   « If your subscription payment does not succeed, Mollie may attempt it again
//     up to 5 times (once a day), depending on the failure reason. »
//
// Mollie retente SEUL. Proposer au membre de payer à la main en parallèle, c'est
// organiser le double débit : il paie, la tentative automatique aboutit le lendemain,
// et la salle doit rembourser. Le message informe et demande de vérifier le compte —
// il ne demande pas de payer.
import {
  emailShell,
  escapeHtml,
  type GymBranding,
} from './gym-branding.ts'

/**
 * URL du dashboard gérant. `DASHBOARD_URL` est déjà employée par d'autres fonctions
 * (admin-create-member) ; le repli évite un bouton mort si la variable manque —
 * `emailShell` masque alors le bouton plutôt que de pointer dans le vide.
 */
const OWNER_DASHBOARD_URL = (() => {
  const base = Deno.env.get('DASHBOARD_URL') ?? ''
  return base ? `${base.replace(/\/+$/, '')}/members` : ''
})()

/**
 * Chemin membre du bouton. 'bookings' ET NON 'subscription', DÉLIBÉRÉMENT :
 * apps/links/public/<slug>/ ne sert que `bookings` et `confirm-waitlist`, et
 * vercel.json ne réécrit rien. Un `ctaPath: 'subscription'` produirait un 404 —
 * exactement le bouton mort que GYM-238 a corrigé. Le membre atterrit donc sur une
 * page qui existe, et qui ouvre l'app.
 * 👉 À rebasculer sur 'subscription' le jour où apps/links sert cette page.
 */
const MEMBER_CTA_PATH = 'bookings'

const P = 'color:#3D3B36;font-size:14px;line-height:1.6;margin:0 0 16px;'
const MUTED = 'color:#9A9890;font-size:12px;line-height:1.6;margin:20px 0 0;'
const p = (html: string) => `<p style="${P}">${html}</p>`
const muted = (html: string) => `<p style="${MUTED}">${html}</p>`

/** Montant en euros, ou chaîne vide si inconnu — on ne rend jamais « undefined € ». */
function amountLabel(amount: number | null | undefined): string {
  return typeof amount === 'number' && Number.isFinite(amount)
    ? ` de ${amount.toFixed(2).replace('.', ',')} €`
    : ''
}

export interface RenewalEmail {
  subject: string
  html: string
}

/**
 * J0 — LE PRÉLÈVEMENT A ÉCHOUÉ, L'ACCÈS RESTE OUVERT.
 *
 * Le ton compte : à ce stade, le membre n'a rien fait de mal. Une carte expirée ou un
 * solde insuffisant ne sont pas une faute, et un premier courrier comminatoire fait
 * perdre des abonnés que la relance suivante aurait gardés. On annonce donc les DEUX
 * choses vraies : la banque a refusé, et l'accès n'est pas coupé.
 *
 * ⚠️ La date de coupure est ANNONCÉE. Un délai tu, c'est une suspension vécue comme
 * arbitraire trois jours plus tard.
 */
export function buildMemberFailureEmail(params: {
  branding: GymBranding
  firstName: string | null
  planName: string
  amount: number | null
  graceDays: number
  suspendOn: Date
}): RenewalEmail {
  const { branding, firstName, planName, amount, graceDays, suspendOn } = params
  const hello = firstName ? `Bonjour ${escapeHtml(firstName)},` : 'Bonjour,'
  const gym = escapeHtml(branding.name)
  const when = suspendOn.toLocaleDateString('fr-BE', {
    day: 'numeric', month: 'long', timeZone: 'Europe/Brussels',
  })

  return {
    subject: `Ton paiement n'est pas passé — ${branding.name}`,
    html: emailShell(branding, {
      title: 'Ton prélèvement a été refusé',
      emoji: '💳',
      bodyHtml:
        p(hello) +
        p(`Le prélèvement${amountLabel(amount)} pour ton abonnement <strong>${escapeHtml(planName)}</strong> chez ${gym} n'a pas abouti.`) +
        p("<strong>Ton accès reste ouvert</strong> : tes réservations sont maintenues et tu peux continuer à réserver normalement.") +
        p(`Notre prestataire de paiement représentera automatiquement le prélèvement dans les prochains jours. Il n'y a rien à payer à la main — vérifie simplement que ton compte est approvisionné et que tes coordonnées bancaires sont toujours valables.`) +
        p(`Sans régularisation d'ici au <strong>${when}</strong>, l'accès lié à l'abonnement sera suspendu. Tes séances prépayées, elles, resteront utilisables.`) +
        muted(`Un doute, un changement de banque, une question ? Écris à ${gym}, on règle ça ensemble.`),
      ctaLabel: 'Voir mon abonnement',
      ctaPath: MEMBER_CTA_PATH,
    }),
  }
}

/**
 * J+3 — L'ACCÈS ABONNEMENT EST SUSPENDU.
 *
 * ⚠️ CE COURRIER DOIT DIRE CE QUI MARCHE ENCORE, pas seulement ce qui s'arrête. Un
 * membre qui croit avoir tout perdu ne revient pas ; or ses réservations déjà faites
 * tiennent, et ses crédits prépayés restent consommables — ce sont deux produits
 * distincts, et l'impayé sur l'un ne confisque pas l'autre. Le taire ferait passer
 * pour une punition ce qui n'est qu'une suspension de l'abonnement.
 */
export function buildMemberSuspensionEmail(params: {
  branding: GymBranding
  firstName: string | null
  planName: string
  amount: number | null
}): RenewalEmail {
  const { branding, firstName, planName, amount } = params
  const hello = firstName ? `Bonjour ${escapeHtml(firstName)},` : 'Bonjour,'
  const gym = escapeHtml(branding.name)

  return {
    subject: `Ton abonnement est suspendu — ${branding.name}`,
    html: emailShell(branding, {
      title: 'Abonnement suspendu',
      emoji: '⏸️',
      bodyHtml:
        p(hello) +
        p(`Le prélèvement${amountLabel(amount)} de ton abonnement <strong>${escapeHtml(planName)}</strong> n'a toujours pas abouti. L'accès lié à l'abonnement est donc <strong>suspendu</strong>.`) +
        p('<strong>Ce qui continue de fonctionner :</strong>') +
        `<ul style="${P}"><li>Les réservations que tu as déjà faites sont maintenues — rien n'est annulé.</li><li>Tes séances prépayées restent utilisables : tu peux continuer à réserver en les consommant.</li></ul>` +
        p("Dès qu'un prélèvement aboutit, ton abonnement est réactivé <strong>automatiquement</strong>, sans démarche de ta part.") +
        muted(`Si ton moyen de paiement a changé, ou si tu préfères régler autrement, contacte ${gym} : c'est le plus rapide.`),
      ctaLabel: 'Voir mon abonnement',
      ctaPath: MEMBER_CTA_PATH,
    }),
  }
}

/**
 * ALERTE GÉRANT — le seul courrier qui parle d'argent qui manque.
 *
 * ⚠️ IL PART À CHAQUE ÉTAPE (échec puis suspension) parce que ce sont deux décisions
 * différentes pour le gérant : au J0 il peut appeler son membre et éviter la coupure ;
 * au J+3 il doit savoir qu'un client a perdu l'accès dans SA salle. N'en envoyer qu'un
 * seul obligerait à choisir entre prévenir trop tôt et prévenir trop tard.
 *
 * Marque VINIZ volontairement absente : cet email vient de la salle, et le gérant le
 * lit dans la même boîte que ses autres courriers de salle.
 */
export function buildOwnerAlertEmail(params: {
  branding: GymBranding
  memberName: string
  memberEmail: string | null
  planName: string
  amount: number | null
  stage: 'failed' | 'suspended'
  failedCount: number
  graceDays: number
}): RenewalEmail {
  const { branding, memberName, memberEmail, planName, amount, stage, failedCount, graceDays } = params
  const who = escapeHtml(memberName)
  const contact = memberEmail ? muted(`Contact : ${escapeHtml(memberEmail)}`) : ''

  if (stage === 'suspended') {
    return {
      subject: `Accès suspendu pour impayé — ${memberName}`,
      html: emailShell(branding, {
        title: 'Un membre a perdu son accès abonnement',
        emoji: '⚠️',
        bodyHtml:
          p(`Le renouvellement de <strong>${who}</strong> (${escapeHtml(planName)}${amountLabel(amount)}) n'a pas abouti après ${graceDays} jours de délai.`) +
          p("Son accès <strong>abonnement</strong> est suspendu. Ses réservations existantes sont maintenues et ses séances prépayées restent utilisables.") +
          p(`${failedCount} tentative${failedCount > 1 ? 's' : ''} de prélèvement ${failedCount > 1 ? 'ont' : 'a'} échoué. La réactivation est automatique dès qu'un paiement aboutit.`) +
          contact,
        ctaLabel: 'Ouvrir le tableau de bord',
        ctaUrl: OWNER_DASHBOARD_URL,
      }),
    }
  }

  return {
    subject: `Renouvellement échoué — ${memberName}`,
    html: emailShell(branding, {
      title: "Un prélèvement n'est pas passé",
      emoji: '💳',
      bodyHtml:
        p(`Le renouvellement de <strong>${who}</strong> (${escapeHtml(planName)}${amountLabel(amount)}) a été refusé par sa banque.`) +
        p(`Son accès reste ouvert pendant <strong>${graceDays} jours</strong>. Le prestataire de paiement représentera automatiquement le prélèvement ; le membre a été prévenu.`) +
        p("Sans régularisation à l'issue de ce délai, l'accès abonnement sera suspendu automatiquement.") +
        contact,
      ctaLabel: 'Ouvrir le tableau de bord',
      ctaUrl: OWNER_DASHBOARD_URL,
    }),
  }
}
