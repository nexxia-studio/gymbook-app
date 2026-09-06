// GYM-293b — LE NOM DE LA PLATEFORME, ET LE NOM DE L'APPLICATION.
//
// 🔴 CE N'EST PAS LA MÊME CHOSE QUE `CLUB_IDENTITY`, ET C'EST TOUT L'OBJET DE CE FICHIER.
// `CLUB_IDENTITY` désigne la SALLE qui vend les prestations ; ici on désigne l'ÉDITEUR de
// l'application et le nom sous lequel elle se présente. Les deux étaient confondus tant
// qu'il n'existait qu'un seul client : chez Dopamine, l'app s'appelle « Dopamine » et la
// salle s'appelle Dopamine. Chez une autre salle, l'app s'appelle Viniz et la salle non —
// et un texte qui confond les deux fait signer au membre les conditions d'un club où il
// n'a jamais mis les pieds.
import { GYM_MODE } from '../lib/gymResolver'
import { CLUB_IDENTITY } from './club'

/** La marque de la plateforme. Un nom propre : il ne se traduit pas. */
export const PLATFORM_NAME = 'Viniz'

/**
 * Le nom sous lequel l'application se présente dans les textes et les en-têtes.
 *
 * ⚠️ IL DÉPEND DU MODE, PAS DE LA SALLE. En `single`, l'app EST celle de Dopamine —
 * l'App Store la nomme ainsi, ses CGV la nomment ainsi, et rien ne doit changer. En
 * `multi`, c'est l'app Viniz, quelle que soit la salle affichée à l'intérieur.
 */
export const APP_NAME = GYM_MODE === 'multi' ? PLATFORM_NAME : CLUB_IDENTITY.name.split(' ')[0]
