// GYM-166 — Politique de mot de passe, MIROIR CLIENT de la politique Supabase Auth
// (Lowercase, uppercase letters, digits and symbols + longueur minimale). Un seul point
// de vérité pour l'affichage des règles, la validation à la soumission et le mapping des
// erreurs serveur — évite qu'un mot de passe accepté côté client soit rejeté côté serveur
// avec un message flou.

export interface PasswordRule {
  id: string
  test: (pwd: string) => boolean
}

// minLength : 8 (politique serveur) côté membre ; 12 conservé là où c'est déjà imposé
// (inscription). Les règles de caractères sont identiques partout.
export function passwordRules(minLength = 8): PasswordRule[] {
  return [
    { id: 'length', test: (p) => p.length >= minLength },
    { id: 'lowercase', test: (p) => /[a-z]/.test(p) },
    { id: 'uppercase', test: (p) => /[A-Z]/.test(p) },
    { id: 'digit', test: (p) => /[0-9]/.test(p) },
    // Permissif : tout ce qui n'est ni lettre ni chiffre (ne pas rejeter un symbole que
    // le serveur accepterait — jeu ouvert plutôt qu'une liste fermée).
    { id: 'special', test: (p) => /[^A-Za-z0-9]/.test(p) },
  ]
}

export function validatePassword(pwd: string, minLength = 8): { valid: boolean; failed: string[] } {
  const failed = passwordRules(minLength).filter((r) => !r.test(pwd)).map((r) => r.id)
  return { valid: failed.length === 0, failed }
}

// Mappe une erreur serveur Supabase → clé i18n actionnable (auth.password_errors.*).
// Filet 'generic' en dernier recours pour l'inattendu.
export function mapPasswordError(message: string | null | undefined): string {
  const m = (message ?? '').toLowerCase()
  if (m.includes('different from the old') || m.includes('should be different') || m.includes('same_password')) {
    return 'auth.password_errors.same_as_old'
  }
  if (m.includes('at least') && m.includes('character')) return 'auth.password_errors.too_short'
  if (m.includes('should contain') || m.includes('weak') || m.includes('meet') || m.includes('requirement')) {
    return 'auth.password_errors.weak'
  }
  if (
    m.includes('session') || m.includes('expired') || m.includes('jwt') ||
    m.includes('token') || m.includes('auth session missing') || m.includes('not authenticated')
  ) {
    return 'auth.password_errors.expired'
  }
  return 'auth.password_errors.generic'
}
