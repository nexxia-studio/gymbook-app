// GYM-292 — 🔴 LA RÉCONCILIATION, À L'OUVERTURE DE SESSION. LE CHEMIN QUI MANQUAIT.
//
// ═════════════════════════════════════════════════════════════════════════════════════
// LE DÉFAUT QUE CE MODULE CORRIGE
// ═════════════════════════════════════════════════════════════════════════════════════
// Choisir une salle dans la recherche n'écrivait qu'un SLUG LOCAL — celui qui commande la
// marque. Le serveur ne l'apprenait jamais : `switch_active_gym` n'était appelé nulle part
// sur ce chemin. L'app affichait donc les couleurs de la salle choisie et les données de
// la salle que le serveur, lui, tenait pour active.
//
// Rien ne le signalait, parce que `gym_id` restait `null` après la connexion en mode
// multi : les écrans de données s'abstenaient de requêter, et le désaccord ne se voyait
// pas. Il éclatait à la première ouverture du Profil — le seul écran qui appelait
// `refreshProfile()` au montage. Le membre voyait alors thème ET données basculer d'un
// coup, sans avoir rien fait.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// POURQUOI LA VALIDATION NE PEUT PAS AVOIR LIEU À LA SÉLECTION
// ─────────────────────────────────────────────────────────────────────────────────────
// ⚠️ LA SÉLECTION SE FAIT AVANT LA CONNEXION. `switch_active_gym` s'appuie sur
// `auth.uid()` ; sans session, elle n'a personne à basculer. On ne peut donc pas valider
// le choix au moment où il est fait — la première occasion est l'ouverture de session.
// C'est précisément ce que fait ce module, et c'est pour cela qu'il vit ici et non dans
// l'écran de recherche.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// LA RÈGLE D'ARBITRAGE, ET POURQUOI ELLE PENCHE DE CE CÔTÉ
// ─────────────────────────────────────────────────────────────────────────────────────
// Le membre a choisi une salle ; le serveur en tient une autre pour active. Deux réponses
// possibles, et une seule respecte le geste :
//
//   🔴 LE CHOIX DU MEMBRE L'EMPORTE — SI LE SERVEUR L'ACCEPTE. On tente
//      `switch_active_gym` sur la salle choisie. Elle est refusée (PT403) s'il n'y est pas
//      inscrit : la vérité du rattachement reste en base, l'app ne la devine pas.
//
//   Sinon, LE SERVEUR FAIT FOI et le slug local est CORRIGÉ. C'est la règle de GYM-288,
//   inchangée — elle s'applique simplement à l'heure, au lieu d'attendre le Profil.
//
// ⚠️ L'ORDRE INVERSE AURAIT ÉTÉ PLUS SIMPLE ET FAUX. Faire toujours gagner le serveur
// éviterait un appel réseau — et rendrait la recherche de salle inutile : un membre de
// trois salles serait ramené à la même à chaque lancement, quoi qu'il choisisse.
import { useAuthStore } from '../stores/useAuthStore'
import { GYM_MODE, readSelectedGymSlug, writeSelectedGymSlug } from './gymResolver'
import { listMyGyms, switchGym } from './gymSwitch'

/** Ce que la réconciliation a fait — pour le journal et les tests. */
export type ReconcileOutcome =
  /** Mode `single` : rien à réconcilier, la salle vient du build. */
  | { status: 'single' }
  /** Choix local et serveur concordaient déjà. */
  | { status: 'aligned'; gymId: string }
  /** Le choix du membre a été accepté par le serveur : la salle active a changé. */
  | { status: 'switched'; gymId: string }
  /** Le membre n'est pas inscrit dans la salle choisie : le serveur a gardé la main. */
  | { status: 'server_wins'; gymId: string }
  /** Hors ligne ou serveur indisponible : rien n'a été touché. */
  | { status: 'unavailable' }

/**
 * Aligne la salle active du serveur et le choix local, une fois la session ouverte.
 *
 * ⚠️ IDEMPOTENTE ET SANS EFFET DE BORD EN CAS D'ÉCHEC. Appelée deux fois, elle ne bascule
 * qu'une fois ; hors ligne, elle ne touche à rien — surtout pas au slug, dont l'effacement
 * ferait perdre au membre la marque de sa salle pour une simple coupure réseau.
 */
export async function reconcileActiveGym(): Promise<ReconcileOutcome> {
  if (GYM_MODE === 'single') return { status: 'single' }

  // ── 1. CE QUE LE SERVEUR TIENT POUR VRAI ────────────────────────────────────────────
  // `refreshProfile` pose `profiles.gym_id` dans le store. C'est CE seul appel qui manquait
  // au démarrage : sans lui, `gym_id` restait `null` et l'app n'affichait aucune donnée.
  await useAuthStore.getState().refreshProfile()

  const memberships = await listMyGyms()
  if (memberships.status !== 'ok') {
    // Hors ligne : on garde ce qui est affiché. `refreshProfile` a peut-être déjà posé la
    // salle depuis le cache de session ; sinon l'app reste en attente, ce qui est honnête.
    return { status: 'unavailable' }
  }

  const active = memberships.gyms.find((g) => g.isActive)
  const slugLocal = await readSelectedGymSlug()

  // ── 2. AUCUN CHOIX LOCAL ────────────────────────────────────────────────────────────
  // Premier lancement après une connexion directe (lien profond, restauration de session).
  // Le serveur est la seule réponse, et le slug est posé pour que la marque suive.
  if (!slugLocal) {
    if (!active) return { status: 'unavailable' }
    await writeSelectedGymSlug(active.slug)
    return { status: 'aligned', gymId: active.gymId }
  }

  // ── 3. LE CHOIX CONCORDE DÉJÀ ───────────────────────────────────────────────────────
  if (active && active.slug === slugLocal) {
    return { status: 'aligned', gymId: active.gymId }
  }

  // ── 4. LE CHOIX DIFFÈRE — ON LE SOUMET AU SERVEUR ───────────────────────────────────
  const choisie = memberships.gyms.find((g) => g.slug === slugLocal)
  if (choisie) {
    const res = await switchGym(choisie)
    if (res.status === 'ok') return { status: 'switched', gymId: choisie.gymId }
    // Refusée ou injoignable : on retombe sur la branche « le serveur fait foi » ci-dessous.
  }

  // ── 5. LE SERVEUR FAIT FOI, ET LE SLUG EST CORRIGÉ ──────────────────────────────────
  // Le membre a choisi une salle où il n'est pas inscrit — cas nominal : il a cherché une
  // salle, puis s'est connecté avec un compte qui n'y appartient pas. On ne l'y enferme
  // pas, et on ne lui montre pas non plus la marque d'une salle dont il ne verra jamais
  // les données : les deux moitiés disent la même chose, celle du serveur.
  if (!active) return { status: 'unavailable' }
  await writeSelectedGymSlug(active.slug)
  return { status: 'server_wins', gymId: active.gymId }
}
