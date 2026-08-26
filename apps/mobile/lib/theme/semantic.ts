// GYM-286a — 🔴 LES COULEURS QUI NE SUIVENT JAMAIS LA MARQUE.
//
// ═════════════════════════════════════════════════════════════════════════════════════
// POURQUOI CE MODULE N'EST PAS DANS `resolveTheme`
// ═════════════════════════════════════════════════════════════════════════════════════
// `resolveTheme` répond à « que devient l'app aux couleurs de CETTE salle ». Ici, la
// réponse est : rien. Une salle dont la primaire est rouge ne doit pas rendre ses
// messages d'erreur invisibles, et une salle verte ne doit pas transformer son message
// de succès en décoration. Le rouge d'erreur n'est pas une couleur de marque qu'on
// aurait oublié de rendre configurable — c'est un SIGNAL, et un signal qui change de
// sens d'un client à l'autre n'est plus un signal.
//
// Ces valeurs ne passent donc NI par la marque, NI par le garde-fou de contraste : elles
// sont posées, fixes, identiques chez Dopamine et chez toute salle.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// 🔴 CHAQUE VALEUR EST RECOPIÉE À L'IDENTIQUE DU CODE QU'ELLE REMPLACE
// ─────────────────────────────────────────────────────────────────────────────────────
// C'est la règle de non-régression de GYM-286, appliquée aux signaux : le jeton vaut la
// valeur en dur, au caractère près, sinon l'écran migré ne rend plus comme avant.
//
// ⚠️ ET C'EST POURQUOI CE MODULE NE FUSIONNE RIEN. L'app emploie aujourd'hui QUATRE
// rouges distincts (#EF4444, #DC2626, #E53935, #FF6B6B), TROIS orangés (#F97316,
// #EA580C, #EF9F27) et deux ambres. Les ramener à un seul rouge serait un progrès — et
// un changement de pixels sur des écrans que ce lot n'a pas le droit de toucher. La
// fusion est une décision de charte : elle est listée à l'arbitrage dans
// docs/GYM-286-inventaire.md, et ce fichier ne porte que les valeurs DOMINANTES, celles
// dont le rôle ne se discute pas.
//
// ⚠️ RÈGLE POUR GYM-286b : un littéral qui n'est pas EXACTEMENT la valeur d'un jeton
// ci-dessous NE SE MIGRE PAS. Il remonte à l'arbitrage. Approcher #DC2626 par
// `SEMANTIC.danger` (#EF4444) serait exactement la régression d'un pixel que le lot
// interdit — et la plus difficile à voir en relecture.

/**
 * Les signaux de l'interface. Fixes, non thématisables.
 *
 * ⚠️ `as const` N'EST PAS DÉCORATIF : il empêche qu'un écran réaffecte un signal en
 * passant. Ces valeurs se lisent, elles ne se calculent pas.
 */
export const SEMANTIC = {
  /**
   * Erreur, destruction, refus. 19 emplois recensés — le signal le plus répandu de
   * l'app : icône de suppression, alerte, échec, cœur d'un favori retiré.
   */
  danger: '#EF4444',
  /**
   * Alerte, attente, ce qui n'est pas encore perdu. 7 emplois : place bientôt pleine,
   * plafond de réservations atteint, compte à rebours d'une liste d'attente.
   */
  warning: '#F97316',
  /** Succès, validation, disponibilité. 4 emplois. */
  success: '#22C55E',
  /**
   * ÉTAT DÉSACTIVÉ — la piste d'un interrupteur éteint.
   *
   * ⚠️ IL LUI FAUT SON PROPRE JETON, ET PAS `border`. Les deux sont des gris clairs
   * voisins (#E5E5E5 contre #E8E6E0) mais ils ne disent pas la même chose : l'un est un
   * séparateur, qui suit les surfaces, l'autre est l'ABSENCE d'un état, qui doit rester
   * lisible comme telle quelle que soit la salle. Les confondre reviendrait à faire
   * dépendre « ce réglage est éteint » de la charte d'un client.
   */
  disabledTrack: '#E5E5E5',
  /** ÉTAT DÉSACTIVÉ — une icône de règle non encore satisfaite. */
  disabledInk: '#C9C7C0',
  /**
   * GYM-286b — L'ENCRE POSÉE SUR `danger`.
   *
   * 🔴 ELLE NE PEUT PAS ÊTRE `tokens.onBackground`, MÊME SI LES DEUX VALENT #FFFFFF CHEZ
   * DOPAMINE. C'est le piège P-6 du document, sur un cas où il fait de vrais dégâts : une
   * salle au fond clair reçoit un `onBackground` SOMBRE. La bannière d'erreur, elle,
   * reste rouge quoi qu'il arrive — poser une encre sombre dessus donnerait du gris
   * foncé sur rouge, 2,3:1, illisible précisément au moment où l'app a quelque chose
   * d'important à dire.
   *
   * Un fond fixe appelle une encre fixe. C'est la même règle que pour `danger` lui-même,
   * appliquée à ce qu'on écrit dessus.
   */
  onDanger: '#FFFFFF',
} as const

export type SemanticToken = keyof typeof SEMANTIC
