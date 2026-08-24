// GYM-265 — L'ÉDITEUR DE LA PLATEFORME, EN UN SEUL ENDROIT.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// POURQUOI CE FICHIER EXISTE
// ─────────────────────────────────────────────────────────────────────────────────────
// L'identité de l'éditeur (Nexxia / Antoine Monie) était RECOPIÉE À LA MAIN dans chaque
// texte légal — six fois rien que dans legalContent.ts, autant côté mobile. Une adresse
// qui change, et il faut la retrouver dans des paragraphes de prose juridique : c'est
// exactement le mécanisme par lequel la commune de Dopamine est restée « Neupré » dans
// les emails pendant des mois après le déménagement (GYM-238).
//
// ⚠️ DEUX BLOCS DE VARIABLES, À NE JAMAIS CONFONDRE :
//   · ÉDITEUR (ce fichier)     = Nexxia. CONSTANTES, identiques pour toutes les salles.
//                                Ce n'est PAS une donnée de tenant : elle n'a rien à
//                                faire en base, personne ne l'administre au cockpit.
//   · SALLE (gymLegalIdentity) = les colonnes legal_* de nexxia_gyms, DYNAMIQUES, lues à
//                                l'affichage et propres à chaque salle.
//
// La règle « pas de données Dopamine en dur » vise le second bloc. Le premier est de
// l'identité produit, au même titre que le domaine d'envoi vérifié chez Resend.
export interface LegalEditor {
  /** Nom commercial de l'éditeur. Le point final fait partie du nom. */
  nomCommercial: string
  /** Personne physique qui exploite. */
  exploitant: string
  /** Forme d'exploitation — déterminante pour la rédaction des clauses (cf. PR). */
  statut: string
  /** Numéro d'entreprise belge (BCE), qui vaut aussi numéro de TVA. */
  bce: string
  /** Adresse d'établissement. */
  adresse: string
  /** Contact unique pour toutes les demandes légales et RGPD. */
  email: string
}

export const EDITEUR: LegalEditor = {
  nomCommercial: 'Nexxia.',
  exploitant: 'Antoine Monie',
  statut: 'personne physique (indépendant)',
  bce: 'BE 1024.997.119',
  // ⚠️ ADRESSE À CHANGER LE 01/09/2026 → « Rue Moraifosse 12, 4802 Heusy ».
  // C'est UNE seule valeur à modifier, ICI, et les trois documents légaux (CGU, CGV,
  // politique de confidentialité), en français comme en anglais, suivent automatiquement.
  // Ne PAS la recopier dans un texte : toute occurrence en dur est un futur mensonge.
  adresse: 'Rue Grande Bruyère 6 B1, 4840 Welkenraedt',
  email: 'support@viniz.app',
}

/** Marque de la plateforme éditée. Distincte du nom commercial de l'éditeur. */
export const PLATFORM_NAME = 'Viniz'

/**
 * Bloc d'identification complet, en une phrase — la forme qui revient dans les trois
 * documents (« qui est responsable », « qui édite », « qui contacter »).
 *
 * Le libellé du statut est traduit plutôt que recopié : `statut` porte la formulation
 * française, l'anglais en donne l'équivalent le plus proche. Les deux disent la même
 * chose juridique — un indépendant belge, pas une société.
 */
export function editorIdentityLine(lang: 'fr' | 'en'): string {
  const { nomCommercial, exploitant, bce, adresse } = EDITEUR
  return lang === 'en'
    ? `**${nomCommercial}** — ${exploitant}, a Belgian sole trader (natural person), company number **${bce}**, ${adresse}, Belgium`
    : `**${nomCommercial}** — ${exploitant}, ${EDITEUR.statut} de droit belge, BCE **${bce}**, ${adresse}, Belgique`
}
