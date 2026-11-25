// GYM-190 — L'EMAIL « TON ABONNEMENT S'ARRÊTE », ENVOYÉ QUAND LA SALLE ARRÊTE UN ABONNEMENT.
//
// ⚠️ CE MODULE N'ENVOIE RIEN. Il compose un objet et du HTML ; `admin-stop-subscription`
// garde son envoi Resend et sa règle « au mieux, jamais bloquant ». Même découpage que
// `failed-renewal-emails.ts`.
//
// ⚠️ LA DATE DE FIN SE LIT DANS LE FUSEAU DE LA SALLE. `ends_at` vaut le début d'un jour
// dans ce fuseau, donc 22:00 ou 23:00 UTC LA VEILLE : formatée sans `timeZone`, elle
// annoncerait un jour trop tôt. `formatEndDate` est le seul formatage de ce message, pour
// l'email comme pour la notification.
//
// REGISTRE : tutoiement, comme les emails membres de `failed-renewal-emails.ts` et comme
// tous les textes de `notify.ts`.
// LANGUE : `profiles.preferred_language`, fr ou en, même mécanique que
// `send-subscription-reminders` (GYM-116). Toute autre valeur retombe sur le français.
//
// AUCUN TIRET LONG NI DEMI-CADRATIN dans l'objet ou le corps : le banc le vérifie.
import { emailShell, escapeHtml, type GymBranding } from './gym-branding.ts'

export type Langue = 'fr' | 'en'

export function langueDe(pref: string | null | undefined): Langue {
  return (pref ?? '').toLowerCase().startsWith('en') ? 'en' : 'fr'
}

/** Le DEFAULT de `nexxia_gyms.timezone` : repli quand le fuseau manque ou est inconnu. */
const DEFAULT_TIME_ZONE = 'Europe/Brussels'

/** Date longue (« 15 décembre 2026 ») dans le fuseau de la salle. */
export function formatEndDate(iso: string, timeZone: string | null | undefined, langue: Langue = 'fr'): string {
  const format = (tz: string) =>
    new Date(iso).toLocaleDateString(langue === 'en' ? 'en-GB' : 'fr-BE', {
      timeZone: tz, day: 'numeric', month: 'long', year: 'numeric',
    })
  try {
    return format(timeZone || DEFAULT_TIME_ZONE)
  } catch {
    // Fuseau inconnu de l'environnement : celui du schéma, jamais une date sans fuseau.
    return format(DEFAULT_TIME_ZONE)
  }
}

/**
 * Chemin membre du bouton : 'bookings' et non 'subscription', pour la raison écrite dans
 * `failed-renewal-emails.ts` (apps/links ne sert pas de page « subscription » : le bouton
 * mènerait à une page introuvable).
 */
const MEMBER_CTA_PATH = 'bookings'

const P = 'color:#3D3B36;font-size:14px;line-height:1.6;margin:0 0 16px;'
const MUTED = 'color:#9A9890;font-size:12px;line-height:1.6;margin:20px 0 0;'
const p = (html: string) => `<p style="${P}">${html}</p>`
const muted = (html: string) => `<p style="${MUTED}">${html}</p>`

export interface SubscriptionStoppedEmail {
  subject: string
  html: string
}

export function buildSubscriptionStoppedEmail(params: {
  branding: GymBranding
  firstName: string | null
  planName: string | null
  /** `ends_at` de l'abonnement, ISO. */
  endsAt: string
  /** Fuseau de la salle (`nexxia_gyms.timezone`). */
  timeZone: string | null | undefined
  /** Réservations réellement annulées par l'arrêt. */
  cancelledBookings: number
  langue?: Langue
}): SubscriptionStoppedEmail {
  const { branding, cancelledBookings: n } = params
  const langue = params.langue ?? 'fr'
  const date = formatEndDate(params.endsAt, params.timeZone, langue)
  const firstName = params.firstName?.trim() || null
  const plan = params.planName?.trim() || null
  const gym = escapeHtml(branding.name)
  const planHtml = plan ? `<strong>${escapeHtml(plan)}</strong> ` : ''

  if (langue === 'en') {
    return {
      subject: `Your ${plan ? `${plan} ` : ''}membership ends on ${date}`,
      html: emailShell(branding, {
        title: 'Your membership is ending',
        bodyHtml:
          p(firstName ? `Hello ${escapeHtml(firstName)},` : 'Hello,') +
          p(`Your ${planHtml}membership at ${gym} ends on <strong>${date}</strong>.`) +
          p('<strong>No further payment will be taken.</strong>') +
          (n > 0
            ? p(n === 1
              ? '1 booking scheduled after that date has been cancelled.'
              : `${n} bookings scheduled after that date have been cancelled.`)
            : '') +
          p('To come back, you will need to sign up for a new plan.') +
          muted(`Any question? Get in touch with ${gym}.`),
        ctaLabel: 'Open the app',
        ctaPath: MEMBER_CTA_PATH,
      }),
    }
  }

  return {
    subject: `Ton abonnement ${plan ? `${plan} ` : ''}s'arrête le ${date}`,
    html: emailShell(branding, {
      title: "Ton abonnement s'arrête",
      bodyHtml:
        p(firstName ? `Bonjour ${escapeHtml(firstName)},` : 'Bonjour,') +
        p(`Ton abonnement ${planHtml}chez ${gym} s'arrête le <strong>${date}</strong>.`) +
        p('<strong>Aucun autre prélèvement ne sera effectué.</strong>') +
        (n > 0
          ? p(n === 1
            ? '1 réservation prévue après cette date a été annulée.'
            : `${n} réservations prévues après cette date ont été annulées.`)
          : '') +
        p('Pour revenir, il faudra souscrire une nouvelle formule.') +
        muted(`Une question ? Écris à ${gym}.`),
      ctaLabel: "Ouvrir l'application",
      ctaPath: MEMBER_CTA_PATH,
    }),
  }
}
