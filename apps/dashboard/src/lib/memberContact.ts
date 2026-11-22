// GYM-387 — quel email MONTRER au gérant pour un membre.
//
// `profiles.email` est l'email de CONNEXION. Avec « Se connecter avec Apple », c'est souvent
// une adresse relais (@privaterelay.appleid.com) : l'afficher comme un vrai email pousse le
// gérant à l'utiliser — et à croire qu'il a écrit au membre. On montre donc, dans l'ordre :
//   1. l'email de contact donné par le membre ;
//   2. sinon l'email de connexion, s'il est réel ;
//   3. sinon RIEN — l'appelant affiche « Email masqué (Apple) ».
//
// ⚠️ Fonction pure, sans import : chargée seule par src/tests/member-contact.test.ts.

const RELAIS_APPLE = '@privaterelay.appleid.com'

export function isAppleRelayEmail(email: string | null | undefined): boolean {
  return (email ?? '').trim().toLowerCase().endsWith(RELAIS_APPLE)
}

/** L'adresse à afficher, ou `null` quand il n'y a qu'une adresse relais Apple. */
export function displayEmail(m: { email: string | null; contactEmail: string | null }): string | null {
  const contact = m.contactEmail?.trim()
  if (contact) return contact
  const login = m.email?.trim()
  if (!login || isAppleRelayEmail(login)) return null
  return login
}

export function hasPhone(m: { phone: string | null }): boolean {
  return !!m.phone && m.phone.trim() !== ''
}
