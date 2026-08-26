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
// COMMENT LE MODE EST DÉDUIT — ET POURQUOI PAS COMME LE TICKET LE DISAIT
// ─────────────────────────────────────────────────────────────────────────────────────
// Le cadrage demandait de déduire le mode de « la présence d'EXPO_PUBLIC_GYM_ID ».
// ⚠️ APPLIQUÉ TEL QUEL, CELA AURAIT BASCULÉ DOPAMINE EN MULTI. Vérifié le 26/08 avec
// `eas env:list production` : l'environnement EAS de production ne définit PAS
// EXPO_PUBLIC_GYM_ID. L'app de production tient son gym_id du REPLI écrit dans
// app.config.ts (`process.env.EXPO_PUBLIC_GYM_ID ?? '<uuid Dopamine>'`). Tester la
// variable directement aurait donc rendu `multi` sur le binaire de Nico — c'est-à-dire un
// écran de recherche de salle à l'ouverture, exactement la régression interdite.
//
// LE DISCRIMINANT EST DONC `extra.gymId`, un cran plus loin dans la MÊME chaîne : c'est
// la valeur qu'app.config.ts calcule à partir de cette variable. Aucune variable
// supplémentaire n'est introduite — la contrainte du cadrage est respectée, seul le point
// de lecture change.
//
// ⚠️ ET LE MULTI RESTE ATTEIGNABLE SANS TROISIÈME VARIABLE : `??` ne se déclenche que sur
// null/undefined, donc `EXPO_PUBLIC_GYM_ID=""` traverse et donne `extra.gymId === ''`.
// Vérifié en exécutant `expo config --json` dans les trois cas :
//     variable absente      → 'a0000000-…'  (repli)      → single
//     variable = ""         → ''                          → MULTI
//     variable = <uuid>     → <uuid>                      → single
// Un profil EAS white-label posera donc `EXPO_PUBLIC_GYM_ID: ""`. Le choix du profil
// appartient au lot 5 ; ce fichier se contente d'en tirer la conséquence.
import Constants from 'expo-constants'
import AsyncStorage from '@react-native-async-storage/async-storage'

export type GymMode = 'single' | 'multi'

/** Valeur brute posée par app.config.ts. `''` = build white-label, sans salle figée. */
const CONFIGURED_GYM_ID = (Constants.expoConfig?.extra?.gymId as string | undefined) ?? ''

/**
 * Le mode, décidé À LA COMPILATION et jamais ensuite. Une constante, pas un état : un
 * mode qui pourrait changer en cours de session obligerait chaque écran à se demander
 * dans lequel il tourne.
 */
export const GYM_MODE: GymMode = CONFIGURED_GYM_ID.trim() !== '' ? 'single' : 'multi'

/** Salle figée du build, en mode `single`. `null` en multi. */
export const FIXED_GYM_ID: string | null = GYM_MODE === 'single' ? CONFIGURED_GYM_ID : null

// ─────────────────────────────────────────────────────────────────────────────────────
// PERSISTANCE (livrable D)
// ─────────────────────────────────────────────────────────────────────────────────────
// ⚠️ AsyncStorage ET NON SecureStore. Un slug de salle est PUBLIC — il s'affiche dans une
// URL, dans un email, sur la page de la salle. Le mettre au trousseau lui donnerait le
// coût d'un secret (chiffrement, lectures refusées écran verrouillé — cf. GYM-269) pour
// une donnée qui n'en est pas un. Le trousseau reste réservé au jeton de session.
const STORAGE_KEY = 'viniz.selected_gym_slug'

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
