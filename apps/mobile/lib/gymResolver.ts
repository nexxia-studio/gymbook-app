// GYM-102 (2/5) — « QUELLE SALLE SERT-ON ? », À UN SEUL ENDROIT.
//
// ═════════════════════════════════════════════════════════════════════════════════════
// 🔴 LA RÈGLE QUI COMMANDE TOUT CE FICHIER : DOPAMINE NE CHANGE PAS
// ═════════════════════════════════════════════════════════════════════════════════════
// L'app de production doit se comporter EXACTEMENT comme aujourd'hui. Le mode `single`
// n'est donc pas « un mode parmi deux » : c'est le comportement actuel, et le multi n'est
// qu'une branche que l'app de production n'emprunte jamais.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// COMMENT LE MODE EST DÉCIDÉ — ET POURQUOI IL EST DÉCLARÉ, PAS DÉDUIT
// ─────────────────────────────────────────────────────────────────────────────────────
// Le mode vient de `extra.gymMode`, alimenté par EXPO_PUBLIC_GYM_MODE, avec un repli sur
// `single`. Il ne se déduit plus de la présence de `gymId`.
//
// 🔴 LE REPLI EST `single`, DÉLIBÉRÉMENT. Oublier la variable doit produire le
// comportement de Dopamine — jamais un écran de recherche de salle chez ses membres.
// C'est le seul sens dans lequel l'oubli est sans danger, et c'est la raison d'être de
// cette forme.
//
// ⚠️ CE FICHIER A D'ABORD DÉDUIT LE MODE DE `extra.gymId`, ET LA VOIE S'EST FERMÉE.
// L'idée était : une salle figée par le build → single, aucune → multi. Deux faits
// constatés l'ont rendue inapplicable :
//   1. une variable ABSENTE traverse le `??` d'app.config.ts et rend l'uuid de Dopamine —
//      le mode `multi` n'était donc pas atteignable en ne posant rien ;
//   2. une variable VIDE est REFUSÉE par EAS, qui échoue à la validation d'eas.json
//      (« "…EXPO_PUBLIC_GYM_ID" is not allowed to be empty ») avant même de bâtir.
// Entre l'absence qui rend Dopamine et le vide qui refuse la build, `multi` était
// inatteignable par un profil EAS. La déduction ne pouvait pas survivre à ça.
//
// ⚠️ ET LE BUNDLE IDENTIFIER N'AURAIT PAS PU TRANCHER — alternative écartée, pas oubliée.
// `app.viniz.staging` sert DÉJÀ les deux modes : `preview-staging` en single,
// `preview-viniz` en multi. Un même identifiant Apple, deux comportements attendus : il
// n'y a rien à quoi une déduction pourrait se raccrocher. Son avantage — rien à poser,
// donc rien à oublier — est réel, mais il ne s'applique pas ici.
//
// ⚠️ LE REPLI `?? 'a0000000-…-000000000001'` D'APP.CONFIG.TS NE DOIT PAS BOUGER pour
// autant. Vérifié le 26/08 : EXPO_PUBLIC_GYM_ID n'est pas définie dans l'environnement EAS
// de production, et cet uuid est bien celui de Dopamine Performance Club en base de prod.
// C'est lui qui donne sa salle à l'app de Nico. Le mode ne s'y appuie plus ; la SALLE, si.
import Constants from 'expo-constants'
import AsyncStorage from '@react-native-async-storage/async-storage'

export type GymMode = 'single' | 'multi'

/** Salle figée par le build. Reste la source de la salle en mode `single`. */
const CONFIGURED_GYM_ID = (Constants.expoConfig?.extra?.gymId as string | undefined) ?? ''

/** Ce que le build a DÉCLARÉ. Toute valeur autre que 'multi' vaut 'single'. */
const DECLARED_MODE = (Constants.expoConfig?.extra?.gymMode as string | undefined) ?? 'single'

/**
 * Le mode, décidé À LA COMPILATION et jamais ensuite. Une constante, pas un état : un
 * mode qui pourrait changer en cours de session obligerait chaque écran à se demander
 * dans lequel il tourne.
 *
 * ⚠️ SEUL 'multi' OUVRE LE MODE MULTI. Une faute de frappe, une valeur inattendue, une
 * clé absente : tout retombe sur `single`. Un mode mal orthographié ne doit pas ouvrir
 * l'écran de recherche de salle chez les membres de Dopamine.
 */
export const GYM_MODE: GymMode = DECLARED_MODE.trim().toLowerCase() === 'multi' ? 'multi' : 'single'

/**
 * Salle figée du build, en mode `single`. `null` en multi.
 *
 * ⚠️ CONFIGURATION IMPOSSIBLE, TRAITÉE PLUTÔT QUE SUBIE : `single` SANS salle résoluble.
 * Le mode et la salle viennent maintenant de deux variables distinctes, donc rien
 * n'empêche mécaniquement de déclarer l'un sans l'autre. Si cela arrive, l'app n'a aucune
 * salle à servir : chaque requête rendrait zéro ligne, sans erreur pour le dire — le
 * genre de panne qu'on cherche des heures ailleurs.
 *
 * On replie donc sur Dopamine, la seule salle qu'un build `single` ait jamais servie, ET
 * ON LE DIT. Le journal est ici la moitié utile : le repli évite l'app muette, le message
 * évite qu'on croie la configuration correcte.
 */
const DOPAMINE_GYM_ID = 'a0000000-0000-0000-0000-000000000001'

function resolveFixedGymId(): string | null {
  if (GYM_MODE !== 'single') return null
  if (CONFIGURED_GYM_ID.trim() !== '') return CONFIGURED_GYM_ID
  console.warn(
    '[gymResolver] Configuration impossible : mode « single » déclaré sans extra.gymId ' +
    'résoluble. Repli sur la salle Dopamine. Vérifier EXPO_PUBLIC_GYM_ID dans le profil ' +
    'EAS — un build « single » sans salle ne peut rien servir.',
  )
  return DOPAMINE_GYM_ID
}

export const FIXED_GYM_ID: string | null = resolveFixedGymId()

// ─────────────────────────────────────────────────────────────────────────────────────
// PERSISTANCE (livrable D)
// ─────────────────────────────────────────────────────────────────────────────────────
// ⚠️ AsyncStorage ET NON SecureStore. Un slug de salle est PUBLIC — il s'affiche dans une
// URL, dans un email, sur la page de la salle. Le mettre au trousseau lui donnerait le
// coût d'un secret (chiffrement, lectures refusées écran verrouillé — cf. GYM-269) pour
// une donnée qui n'en est pas un. Le trousseau reste réservé au jeton de session.
const STORAGE_KEY = 'viniz.selected_gym_slug'

// ─────────────────────────────────────────────────────────────────────────────────────
// GYM-288 — QUI PRÉVIENT L'APP QUAND LE CHOIX CHANGE ?
// ─────────────────────────────────────────────────────────────────────────────────────
// ⚠️ SANS CE MÉCANISME, LE RETOUR EN ARRIÈRE NE MARCHE QU'EN APPARENCE. `app/_layout.tsx`
// lit le slug UNE FOIS au montage, pour en tirer la marque. Il n'est jamais démonté. Donc
// tout choix fait ENSUITE — la première sélection comme un changement d'avis — restait
// invisible pour lui : l'app gardait la marque d'avant jusqu'au prochain redémarrage.
//
// C'est aussi ce qui rendait le défaut de ce ticket difficile à voir : effacer le slug
// sans prévenir personne aurait ramené le membre à la recherche, puis lui aurait réappliqué
// les couleurs de la salle qu'il venait de quitter.
type SlugListener = (slug: string | null) => void
const listeners = new Set<SlugListener>()

/** S'abonne aux changements du slug choisi. Rend la fonction de désabonnement. */
export function subscribeSelectedGymSlug(fn: SlugListener): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

function notify(slug: string | null): void {
  for (const fn of listeners) fn(slug)
}

/** Slug choisi avant connexion. `null` si aucun choix — l'écran de recherche s'affiche. */
export async function readSelectedGymSlug(): Promise<string | null> {
  if (GYM_MODE === 'single') return null
  try {
    const v = await AsyncStorage.getItem(STORAGE_KEY)
    return v && v.trim() !== '' ? v : null
  } catch {
    // Stockage indisponible (mode privé, quota) : on retombe sur l'écran de recherche.
    // Un choix perdu se refait en deux gestes ; une exception non gérée casse l'écran.
    return null
  }
}

export async function writeSelectedGymSlug(slug: string): Promise<void> {
  if (GYM_MODE === 'single') return
  try {
    await AsyncStorage.setItem(STORAGE_KEY, slug)
    notify(slug)
  } catch {
    /* best-effort : le membre reverra l'écran au prochain lancement, sans plus */
  }
}

/**
 * Purge à la DÉCONNEXION.
 *
 * ⚠️ Sans elle, le membre suivant sur le même appareil — un proche, un poste partagé —
 * arriverait directement dans la salle du précédent. Ce n'est pas une fuite de données
 * (le slug est public), c'est une confusion d'identité de marque : il croirait ouvrir
 * SON app.
 */
export async function clearSelectedGymSlug(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY)
    notify(null)
  } catch {
    /* best-effort */
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────
// 🔴 LA PRIORITÉ — CELLE QUI PRODUIT DES BUGS IRREPRODUCTIBLES SI ELLE N'EST PAS ÉCRITE
// ─────────────────────────────────────────────────────────────────────────────────────
// Deux sources peuvent désigner une salle, et elles peuvent diverger :
//
//   1. LE PROFIL SERVEUR (`profiles.gym_id`, la salle ACTIVE de GYM-283) — source de
//      VÉRITÉ dès que le membre est connecté ;
//   2. LE STOCKAGE LOCAL — un choix fait AVANT connexion, sur cet appareil seulement.
//
// LE PROFIL GAGNE TOUJOURS QUAND IL EXISTE. Le stockage local ne sert qu'à savoir quelle
// marque afficher à quelqu'un qui n'est pas encore identifié.
//
// Le cas qui fait diverger les deux : un membre choisit la salle A sur son téléphone,
// puis se connecte avec un compte dont la salle active est B — parce qu'il a basculé
// depuis un autre appareil. Faire gagner le local afficherait la salle A tout en lisant
// les données de B : un écran qui ment, et un bug que personne ne saurait reproduire
// puisqu'il dépend de l'historique local de l'appareil.
//
// ⚠️ ON NE RÉÉCRIT PAS LE LOCAL AVEC LA VALEUR DU PROFIL. Le local mémorise un CHOIX DE
// VISITEUR ; l'écraser avec la salle active d'un compte ferait de la déconnexion un
// changement de salle silencieux — et de toute façon il est purgé à la déconnexion.
export interface ResolvedGym {
  /** Salle à servir. `null` en multi tant que rien n'a été choisi ni aucune session ouverte. */
  gymId: string | null
  /** Slug connu, quand la résolution est passée par lui (multi, avant connexion). */
  slug: string | null
  /** D'où vient la réponse — utile en journal, et pour ne pas se poser la question deux fois. */
  source: 'build' | 'profile' | 'local' | 'none'
}

/**
 * Résout la salle à servir.
 *
 * `profileGymId` est passé par l'appelant plutôt que lu ici : ce module ne doit dépendre
 * ni du store d'authentification ni de Supabase, sans quoi il deviendrait impossible de
 * l'utiliser depuis l'écran de lancement — celui qui tourne AVANT que la session ne soit
 * chargée.
 */
export async function resolveGym(profileGymId: string | null): Promise<ResolvedGym> {
  // Mode single : la salle est celle du build, point. Aucune lecture, aucun écran.
  if (GYM_MODE === 'single') {
    return { gymId: FIXED_GYM_ID, slug: null, source: 'build' }
  }

  // Connecté → le serveur tranche (cf. la note de priorité ci-dessus).
  if (profileGymId) {
    return { gymId: profileGymId, slug: null, source: 'profile' }
  }

  const slug = await readSelectedGymSlug()
  if (slug) return { gymId: null, slug, source: 'local' }

  return { gymId: null, slug: null, source: 'none' }
}
