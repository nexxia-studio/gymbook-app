// Contact support / RGPD.
// provisoire — boîte dédiée SaaS à créer (cf. GYM-109)
export const SUPPORT_EMAIL = 'hello@nexxia.pro'

// Construit un lien mailto pré-rempli (encodage RFC 3986 : espaces en %20, sauts de
// ligne en %0A). Utilisé par l'écran "Exporter mes données".
export function buildMailto(to: string, subject: string, body: string): string {
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
