// Contact support / RGPD. ⚠️ ADRESSE À CONFIRMER (placeholder) — le domaine nexxia.net
// est celui des emails transactionnels (noreply@nexxia.net) ; l'adresse de support
// définitive doit être validée. Voir compte-rendu GYM-46.
export const SUPPORT_EMAIL = 'support@nexxia.net'

// Construit un lien mailto pré-rempli (encodage RFC 3986 : espaces en %20, sauts de
// ligne en %0A). Utilisé par l'écran "Exporter mes données".
export function buildMailto(to: string, subject: string, body: string): string {
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
