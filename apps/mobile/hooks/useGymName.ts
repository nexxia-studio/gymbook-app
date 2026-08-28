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
import { useTheme } from '../lib/theme/ThemeProvider'
import { CLUB_IDENTITY } from '../constants/club'
import { PLATFORM_NAME } from '../constants/platform'
import { GYM_MODE } from '../lib/gymResolver'

/**
 * 🔴 GYM-299 — LE NOM COURT DE LA SALLE ACTIVE, OU `null`.
 *
 * Il vient de la MARQUE (`public_gym_branding`), pas du profil : c'est le canal que le
 * fournisseur de thème relit à chaque changement de salle, celui par lequel un changement
 * fait au dashboard apparaît sans relancer l'app. Voir `lib/theme/brand.ts`.
 *
 * ⚠️ TOUJOURS `null` EN MODE SINGLE, ET C'EST LA GARANTIE DE NON-RÉGRESSION. Le
 * fournisseur ne charge AUCUNE marque en single — `brand` y vaut `null` par construction,
 * pas par accident de données. L'app de Dopamine ne peut donc pas se mettre à afficher un
 * nom court, quoi qu'on écrive un jour dans sa ligne en base.
 */
function useGymShortName(): string | null {
  const { brand } = useTheme()
  // Une chaîne vide n'est pas un nom court : elle viderait l'en-tête au lieu de le remplir.
  const court = brand?.shortName?.trim()
  return court ? court : null
}

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
  // 🔴 GYM-293b — LE DERNIER REPLI EST LA PLATEFORME, PLUS UN CLIENT.
  //
  // ⚠️ EN SINGLE, LA PHRASE CI-DESSUS RESTE VRAIE MOT POUR MOT : `useContextGymName()` y
  // rend déjà `CLUB_IDENTITY.name` faute de profil, et ne rend jamais `null`. Le `??`
  // ci-dessous n'y est donc jamais atteint — le chargement de l'app de Dopamine est
  // inchangé, sans en-tête vide ni bascule de nom.
  //
  // 🔴 EN MULTI, IL CORRIGE UN ÉTAT QUE LE COMMENTAIRE PRÉCÉDENT CROYAIT IMPOSSIBLE. « Un
  // repli transitoire vaut mieux qu'une erreur permanente » supposait qu'une salle finit
  // toujours par arriver. C'est faux pour un COMPTE SANS SALLE — le filet de sécurité de
  // GYM-293, quand le rattachement échoue : là, aucune salle n'arrive jamais, et le
  // « transitoire » devenait définitif. L'app affichait alors « Dopamine Performance Club »
  // à un membre qui n'a aucun rapport avec ce club, en en-tête de tous ses écrans.
  return useContextGymName() ?? PLATFORM_NAME
}

/**
 * 🔴 GYM-293b — LE NOM DE LA SALLE DE CONTEXTE, OU `null` — ET SURTOUT JAMAIS « DOPAMINE ».
 *
 * ⚠️ `useGymName()` NE CONVIENT PAS AVANT LA CONNEXION, et c'est un défaut qu'on ne voit
 * qu'en multi. Son repli `CLUB_IDENTITY.name` est là pour couvrir le TEMPS D'UNE REQUÊTE
 * chez Dopamine (voir plus haut) ; mais sur l'écran d'INSCRIPTION, le membre n'est par
 * définition pas connecté : `useGymProfile()` ne rend jamais rien, et le repli n'était donc
 * pas transitoire — il était l'état permanent. Un candidat de Studio Yoga créait son compte
 * sous l'en-tête « DOPAMINE PERFORMANCE CLUB », en multi, à chaque fois.
 *
 * La marque, elle, est chargée AVANT la connexion — c'est même sa raison d'être : c'est
 * `public_gym_branding(slug)` qui habille l'écran de connexion aux couleurs de la salle
 * choisie. Le nom voyage par ce canal ; il suffit de le lire.
 *
 * ⚠️ `null` EST UNE RÉPONSE, PAS UN ÉCHEC. Aucune salle de contexte, c'est l'état d'un
 * compte sans salle — un filet de sécurité, jamais un état nominal. L'appelant doit alors
 * dire quelque chose de NEUTRE ; lui rendre un nom de client à la place serait exactement
 * la faute qu'on corrige.
 *
 * ⚠️ EN SINGLE, LE COMPORTEMENT EST INCHANGÉ — repli compris. `brand` y vaut `null` par
 * construction (le fournisseur ne charge aucune marque), donc cette fonction rend ce que
 * `useGymName()` rendait déjà, y compris pendant le chargement.
 */
export function useContextGymName(): string | null {
  // Les trois lectures sont inconditionnelles : l'ordre des hooks ne dépend d'aucune donnée.
  const profil = useGymProfile()
  const { brand } = useTheme()
  const nom = profil?.name ?? brand?.name ?? null
  if (GYM_MODE !== 'multi') return nom ?? CLUB_IDENTITY.name
  return nom
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
 *
 * ═════════════════════════════════════════════════════════════════════════════════════
 * 🔴 GYM-299 — UN NOM COURT REMPLACE LA DÉCOUPE, IL NE LA NOURRIT PAS
 * ═════════════════════════════════════════════════════════════════════════════════════
 * Le commentaire ci-dessus annonçait la suite : « la vraie réponse serait une colonne
 * dédiée que le gérant renseigne ». Elle existe. Quand elle est remplie, la règle faible
 * s'efface — on ne DÉCOUPE PAS un nom court. Le gérant qui écrit « Yoga Club » a déjà
 * tranché ; le couper en « YOGA / Club » défferait son choix pour appliquer une heuristique
 * dont il vient précisément de nous dispenser.
 *
 * Il s'affiche donc SEUL, sur la ligne de marque, dans le style de la ligne principale.
 * Pas de seconde ligne : il n'y a plus de reste à mettre dessous.
 */
export function useGymNameLines(): { marque: string; descriptif: string | null } {
  const court = useGymShortName()
  const nom = useGymName().trim()
  if (court) return { marque: court, descriptif: null }
  const espace = nom.indexOf(' ')
  if (espace <= 0) return { marque: nom, descriptif: null }
  return { marque: nom.slice(0, espace), descriptif: nom.slice(espace + 1).trim() || null }
}

/**
 * Le nom à poser dans une bande d'EN-TÊTE : le nom court s'il existe, sinon le complet.
 *
 * ⚠️ POURQUOI PAS `useGymName()` DIRECTEMENT. Ce hook-là sert aussi ailleurs qu'en en-tête
 * — l'objet d'un mail d'export de données, la phrase qui explique les notifications. Un
 * nom court y serait déplacé : « Yoga Club » convient au-dessus d'un planning, pas dans un
 * document qu'on archive ou une mention à valeur d'information. Le champ promet au gérant
 * un nom « affiché dans l'app (en-tête) » ; ce hook est la frontière de cette promesse.
 */
export function useGymHeaderName(): string {
  // ⚠️ LES DEUX HOOKS SONT APPELÉS INCONDITIONNELLEMENT. Écrit `court ?? useGymName()`,
  // le second ne s'exécuterait QUE si le nom court est absent : l'ordre des hooks
  // changerait d'un rendu à l'autre, au moment précis où le gérant renseigne ou vide son
  // nom court. C'est la faute que les règles des hooks interdisent, et elle ne se voit pas
  // à la relecture — elle se manifeste par un plantage au changement de valeur.
  const court = useGymShortName()
  const complet = useGymName()
  return court ?? complet
}
