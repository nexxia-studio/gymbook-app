// GYM-231 — Occupation d'un créneau, quand elle peut DÉPASSER la capacité.
//
// Le dépassement doit SE VOIR : le gérant doit savoir d'un coup d'œil quels cours il a
// surchargés. Trois écrans affichent l'occupation (carte de planning, grille calendrier,
// tiroir de créneau) et calculaient chacun leur pourcentage — trois `Math.round(booked /
// capacity * 100)` identiques, qu'un dépassement rend tous les trois faux de la même façon.
//
// ⚠️ LE CHIFFRE NE MENT PAS, LA BARRE NE CASSE PAS. Ce sont deux besoins opposés :
//   · « 13/12 » doit s'afficher tel quel — un compteur qui plafonne à « 12/12 » cacherait
//     précisément la décision qu'on veut rendre visible ;
//   · la barre de remplissage, elle, est une géométrie : au-delà de 100 % elle déborde de
//     son conteneur (ou se fait rogner par l'`overflow-hidden` du parent, ce qui revient à
//     afficher « plein » sans dire « trop plein »).
// D'où deux fonctions plutôt qu'une : le pourcentage est BORNÉ pour le rendu, et
// `isOverbooked` porte le signal que la borne vient d'effacer.

/**
 * Pourcentage de remplissage, borné à 100 — destiné à une largeur CSS, jamais à un texte.
 *
 * Borné aussi par le bas : une capacité à 0 ou négative n'existe pas en base
 * (time_slots_capacity_check), mais une division par zéro produirait `Infinity` puis un
 * `width: Infinity%` qui casse la mise en page au lieu de signaler la donnée aberrante.
 */
export function fillPercent(booked: number, capacity: number): number {
  if (!capacity || capacity <= 0) return 0
  return Math.min(100, Math.round((booked / capacity) * 100))
}

/** Le créneau porte-t-il plus d'inscrits que sa capacité ? */
export function isOverbooked(booked: number, capacity: number): boolean {
  return capacity > 0 && booked > capacity
}

/** Combien de places au-delà de la capacité. 0 si le créneau n'est pas en dépassement. */
export function overbookedBy(booked: number, capacity: number): number {
  return isOverbooked(booked, capacity) ? booked - capacity : 0
}
