// Identité légale du Club (la salle vendeuse des prestations).
//
// Décision Antoine 14/07 : l'identité du Club dans les textes légaux est TOUJOURS
// interpolée depuis cette constante, jamais écrite en dur dans la prose —
// préparation du multi-tenant (GYM-121).
//
// Valeurs Dopamine pour le déploiement actuel. Les champs `bce`, `vat`, `address`,
// `email` sont prêts mais VIDES : l'entité légale de Dopamine est en attente (NICO —
// entité introuvable à la BCE au 14/07, cf. registre CGV art. 1). Tant qu'ils sont
// vides, les textes renvoient à « l'écran d'informations du Club » dans l'app.
export interface ClubIdentity {
  /** Dénomination commerciale affichée. */
  name: string
  /** Commune du siège / d'exploitation. */
  commune: string
  /** Numéro d'entreprise (BCE) — vide tant que l'entité n'est pas constituée. */
  bce: string
  /** Numéro de TVA — vide en attente. */
  vat: string
  /** Adresse complète du siège — vide en attente. */
  address: string
  /** Email de contact direct du Club — vide en attente (le support passe par Viniz). */
  email: string
}

export const CLUB_IDENTITY: ClubIdentity = {
  name: 'Dopamine Performance Club',
  commune: 'Neupré',
  bce: '',
  vat: '',
  address: '',
  email: '',
}
