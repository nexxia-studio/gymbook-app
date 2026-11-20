// GYM-387 — « FAUT-IL DEMANDER SON TÉLÉPHONE À CE MEMBRE ? » Fonctions pures.
//
// 🔴 LA RÈGLE QUI COMPTE : L'ÉCRAN NE SORT QUE SUR UNE LECTURE RÉUSSIE. Même famille que
// GYM-385, où une lecture en échec était lue comme une absence : un profil pas encore
// chargé, une coupure réseau ou une ligne introuvable ne disent RIEN du téléphone. Les
// prendre pour « téléphone vide » enfermerait un membre en règle derrière un écran sans
// bouton « Plus tard », au moment précis où il n'a pas de réseau pour en sortir.
//
// ⚠️ CE FICHIER NE DOIT RIEN IMPORTER de l'app : il est chargé seul par ses tests.

export type EtatLectureProfil = 'non_charge' | 'charge' | 'erreur'

export interface ProfilContact {
  /** `profiles.role`. Seul `member` est concerné par l'obligation. */
  role: string | null
  phone: string | null
  /** Email de CONNEXION (`profiles.email`). Jamais modifié par ce lot. */
  email: string | null
  contactEmail: string | null
}

// 🔴 SEULS LES MEMBRES. Des comptes `gym_admin` sans téléphone se connectent à l'app membre
// (par email, en prod) : gérants, super-admins et coachs ne voient JAMAIS la porte. La
// règle est une liste BLANCHE — un rôle inconnu ou absent ne bloque personne.
export function doitCompleterProfil(
  profil: Pick<ProfilContact, 'phone' | 'role'> | null | undefined,
  etatLecture: EtatLectureProfil,
): boolean {
  if (etatLecture !== 'charge' || !profil) return false
  if (profil.role !== 'member') return false
  return !profil.phone || profil.phone.trim() === ''
}

const RELAIS_APPLE = '@privaterelay.appleid.com'

/** « Masquer mon adresse email » d'Apple : une adresse relais, pas celle du membre. */
export function estEmailRelaisApple(email: string | null | undefined): boolean {
  return (email ?? '').trim().toLowerCase().endsWith(RELAIS_APPLE)
}

/** Même motif que la contrainte `profiles_contact_email_format` — un refus de la base
 *  doit être annoncé AVANT l'aller-retour, pas découvert après. */
export function estEmailContactValide(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())
}
