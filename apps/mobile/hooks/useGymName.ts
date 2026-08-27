// GYM-297 — LE NOM DE LA SALLE ACTIVE, À UN SEUL ENDROIT.
//
// ═════════════════════════════════════════════════════════════════════════════════════
// CE QUE CE HOOK REMPLACE
// ═════════════════════════════════════════════════════════════════════════════════════
// Trois en-têtes affichaient « Dopamine Performance Club » : /accueil l'écrivait EN DUR
// dans le JSX, /planning et /reservations le tiraient d'une clé i18n (`schedule.subtitle`,
// `bookings.subtitle`) — c'est-à-dire d'un fichier de traduction, l'endroit le plus
// improbable où chercher le nom d'un client. Un membre de Studio Yoga voyait donc le nom
// de Dopamine posé au-dessus de SON planning.
//
// ⚠️ LA SOURCE EST CELLE QUE GYM-292 A RÉPARÉE. `useGymProfile()` lit `nexxia_gyms.name`
// pour la salle ACTIVE, avec un cache indexé par salle et une relecture au changement de
// salle. Avant ce correctif, un hook qui aurait lu le nom ici aurait gardé celui de la
// salle quittée : la dépendance n'est pas fortuite, c'est ce qui rend ce lot possible.
//
// ⚠️ ET C'EST DÉJÀ LA SOURCE DES EMAILS. `supabase/functions/_shared/gym-branding.ts` lit
// `nexxia_gyms.name` depuis GYM-238, en production, pour Dopamine : « une donnée fausse
// écrite en dur ne se corrige nulle part ; lue en base, elle suit. » L'app disait encore
// le contraire de ses propres emails.
import { useGymProfile } from './useGymProfile'
import { CLUB_IDENTITY } from '../constants/club'

/**
 * Le nom affichable de la salle active.
 *
 * ⚠️ LE REPLI N'EST PAS DÉCORATIF, C'EST LA GARANTIE DU MODE SINGLE. Le nom arrive après
 * une requête ; pendant ce temps, un en-tête vide ferait « sauter » la mise en page de
 * l'app de Dopamine à chaque lancement — un changement visible, là où le cadrage exige
 * l'inverse. `CLUB_IDENTITY.name` vaut exactement le texte affiché aujourd'hui, donc le
 * chargement ne se voit pas.
 *
 * ⚠️ ET IL NE MENT PAS EN MULTI. Chez une autre salle, le repli s'affiche au plus le temps
 * d'une requête, puis cède au vrai nom — alors que l'ancien code, lui, affichait
 * « Dopamine » DÉFINITIVEMENT. Un repli transitoire vaut mieux qu'une erreur permanente.
 */
export function useGymName(): string {
  const profile = useGymProfile()
  return profile?.name ?? CLUB_IDENTITY.name
}

/**
 * Le nom découpé en DEUX LIGNES, pour l'en-tête de l'accueil.
 *
 * 🔴 CE DÉCOUPAGE REPRODUIT UNE COMPOSITION EXISTANTE, IL N'EN INVENTE PAS UNE.
 * L'accueil de Dopamine affiche « DOPAMINE » en gros et « Performance Club » en dessous.
 * Changer cela pour une ligne unique aurait modifié l'app de production — ce que le
 * cadrage interdit. Le premier mot devient donc la ligne de marque, le reste la ligne de
 * descriptif : sur « Dopamine Performance Club », le rendu est identique au pixel.
 *
 * ⚠️ ET C'EST UNE RÈGLE FAIBLE POUR LES AUTRES SALLES. « Studio Yoga Test 1 » donne
 * « STUDIO / Yoga Test 1 » — lisible, mais arbitraire. La vraie réponse serait une colonne
 * dédiée (`short_name`, ou un descriptif) que le gérant renseigne. Remonté au cockpit :
 * tant qu'elle n'existe pas, aucune règle automatique ne saura où couper le nom d'un
 * client qu'on ne connaît pas.
 *
 * Un nom d'un seul mot ne rend PAS de seconde ligne — pas de ligne vide, pas de
 * séparateur orphelin (règle GYM-229).
 */
export function useGymNameLines(): { marque: string; descriptif: string | null } {
  const nom = useGymName().trim()
  const espace = nom.indexOf(' ')
  if (espace <= 0) return { marque: nom, descriptif: null }
  return { marque: nom.slice(0, espace), descriptif: nom.slice(espace + 1).trim() || null }
}
