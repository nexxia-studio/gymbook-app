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
//
// ═════════════════════════════════════════════════════════════════════════════════════
// 🔴 GYM-292b — LA PREMIÈRE VERSION DISAIT CELA, ET FAISAIT L'INVERSE
// ═════════════════════════════════════════════════════════════════════════════════════
// Elle appelait `refreshProfile()` EN PREMIER, hors de la garde « écriture en vol » : la
// salle du serveur était donc adoptée AVANT même qu'on ait lu le choix du membre. La
// bascule qui suivait était une CORRECTION, pas une décision — visible à l'écran, et
// perdue dès qu'elle échouait. Pire, toute issue non-`ok` de `switchGym` — y compris une
// coupure réseau — retombait sur « le serveur fait foi » et RÉÉCRIVAIT le slug : une
// seconde sans réseau effaçait définitivement le choix.
//
// L'ordre est maintenant celui que la règle annonce :
//   1. lire le choix local  (avant tout réseau — c'est ce qu'on est venu défendre) ;
//   2. charger le profil    (sans la salle : la garde l'en empêche) ;
//   3. soumettre le choix   (AVANT toute adoption de `profiles.gym_id`) ;
//   4. le serveur ne gagne QUE sans choix local, ou sur refus EXPLICITE (PT403).
// Un incident réseau ne tranche rien et ne détruit rien.
import { useAuthStore } from '../stores/useAuthStore'
import { GYM_MODE, readSelectedGymSlug, writeSelectedGymSlug } from './gymResolver'
import { listMyGyms, switchGym } from './gymSwitch'
import { withActiveGymWrite } from './activeGymWrites'
import { captureEvent } from './analytics'

/** Ce que la réconciliation a fait — pour le journal et les tests. */
export type ReconcileOutcome =
  // ⚠️ `single` N'A PAS DE `reason`, ET C'EST VOULU. Il ne franchit jamais `journalise` :
  // rien n'est réconcilié, donc rien n'est mesuré. Lui inventer une raison obligerait à
  // ajouter au jeu fermé une huitième valeur qui n'apparaîtrait dans aucun événement — et
  // le lecteur du tableau de bord chercherait longtemps ce qu'elle veut dire.
  | { status: 'single' }
  | ({ reason: ReconcileReason } & (
  /** Choix local et serveur concordaient déjà. */
  | { status: 'aligned'; gymId: string }
  /** Le choix du membre a été accepté par le serveur : la salle active a changé. */
  | { status: 'switched'; gymId: string }
  /** Le membre n'est pas inscrit dans la salle choisie : le serveur a gardé la main. */
  | { status: 'server_wins'; gymId: string }
  /** Hors ligne ou serveur indisponible : rien n'a été touché. */
  | { status: 'unavailable' }
  ))

// ═════════════════════════════════════════════════════════════════════════════════════
// 🔴 GYM-300 — `reason` : CE QUI A MANQUÉ AU DIAGNOSTIC, ET CE QU'IL A COÛTÉ
// ═════════════════════════════════════════════════════════════════════════════════════
// GYM-292b avait ajouté `outcome` — c'était déjà énorme, mais insuffisant. `server_wins`
// dit que le serveur a gardé la main ; il ne dit PAS pourquoi, et les deux raisons
// possibles n'appellent pas du tout la même réaction :
//
//   · `not_member`      — on n'a même pas soumis : le slug choisi n'est pas dans les
//                         adhésions. C'est une décision prise PAR L'APP, sur sa lecture.
//   · `refused_pt403`   — on a soumis, et le SERVEUR a refusé. C'est sa décision à lui.
//
// La QA du 27/08 s'est arrêtée exactement là : 9 événements, 2 `server_wins`, et aucun
// moyen de savoir lequel des deux chemins avait été pris. Il a fallu interroger la base
// pour trancher — et découvrir que la prémisse de l'enquête était fausse. Une propriété
// de plus dans l'événement aurait donné la réponse en trente secondes.
//
// ⚠️ ENSEMBLE FERMÉ, et il le reste. Sept valeurs, aucune construite dynamiquement, aucun
// texte venu du serveur : c'est la convention GYM-273, et c'est aussi ce qui rend
// l'événement exploitable dans PostHog — une propriété à cardinalité libre n'est pas un
// filtre, c'est un champ de recherche.
export type ReconcileReason =
  /** Le choix a été soumis ET accepté : la salle active a changé. */
  | 'choice_accepted'
  /** Le slug choisi n'est pas dans les adhésions — rien n'a été soumis. */
  | 'not_member'
  /** Soumis, puis refusé par `switch_active_gym` (PT403). */
  | 'refused_pt403'
  /** `switch_active_gym` n'a pas rendu de verdict : réseau, ou erreur serveur. */
  | 'rpc_error'
  /** Les adhésions n'ont pas pu être lues, ou ne désignent aucune salle active. */
  | 'memberships_unavailable'
  /** Personne n'avait rien choisi : le serveur est la seule réponse possible. */
  | 'no_local_choice'
  /** Le choix ÉTAIT déjà la salle active. Rien à faire, et c'est le cas nominal. */
  | 'already_aligned'

/**
 * Aligne la salle active du serveur et le choix local, une fois la session ouverte.
 *
 * ⚠️ IDEMPOTENTE ET SANS EFFET DE BORD EN CAS D'ÉCHEC. Appelée deux fois, elle ne bascule
 * qu'une fois ; hors ligne, elle ne touche à rien — surtout pas au slug, dont l'effacement
 * ferait perdre au membre la marque de sa salle pour une simple coupure réseau.
 */
/**
 * 🔴 GYM-292b — CE QUI MANQUAIT LE PLUS : SAVOIR CE QUI S'EST PASSÉ.
 *
 * La réconciliation décide en silence, à l'ouverture de session, entre le choix du membre
 * et l'état du serveur. Quand elle se trompait, RIEN ne le disait : ni journal, ni
 * événement, ni écran. Le défaut n'a été vu que parce qu'un humain a comparé des couleurs
 * sur trois appareils, et il a fallu relire tout le chemin pour deviner laquelle des six
 * branches avait été prise. C'est ce silence qui a coûté le plus cher, pas le défaut.
 *
 * ⚠️ AUCUNE DONNÉE PERSONNELLE : un statut d'un ensemble FERMÉ, et un booléen disant s'il
 * y avait un choix local. Pas de slug, pas d'identifiant de salle, pas d'email — la
 * convention de GYM-273, qui interdit déjà le texte libre venu du serveur.
 */
function journalise(outcome: ReconcileOutcome, avaitUnChoix: boolean): ReconcileOutcome {
  if (outcome.status === 'single') return outcome
  captureEvent('active_gym_reconciled', {
    outcome: outcome.status,
    had_local_choice: avaitUnChoix,
    // GYM-300 — la propriété qui a manqué le 27/08. Voir `ReconcileReason`.
    reason: outcome.reason,
  })
  derniereIssue = outcome.status
  return outcome
}

// ═════════════════════════════════════════════════════════════════════════════════════
// 🔴 GYM-300 (§2) — UNE LECTURE QUI ÉCHOUE N'EST PAS UN REFUS D'ADHÉSION
// ═════════════════════════════════════════════════════════════════════════════════════
// C'est la règle que le cockpit a posée, et elle mérite d'être dite dans le code plutôt
// que seulement dans un ticket : « ne pas avoir PU LIRE les adhésions » et « ne pas être
// MEMBRE » sont deux faits différents, et les confondre fait perdre au membre la salle
// qu'il a choisie pour une simple coupure réseau.
//
// La distinction tient à un endroit et un seul : `listMyGyms()` rend un statut à trois
// valeurs (`ok` / `offline` / `error`), et TOUT ce qui n'est pas `ok` sort par
// `memberships_unavailable` — jamais par `server_wins`. Le slug n'est pas réécrit, la
// salle n'est pas abaissée, et GYM-298 réarme une reprise.
//
// ⚠️ CET INVARIANT NE SE RELIT PAS, IL SE MESURE. `scripts/verify-course-salle-active.mjs`
// rejoue les branches et refuse tout `server_wins` dont la raison n'est pas l'une des deux
// qui l'autorisent. Une refonte qui reviendrait en arrière casserait le script, pas la
// recette d'un mardi.
const RAISONS_QUI_DONNENT_LA_MAIN_AU_SERVEUR: ReconcileReason[] = ['not_member', 'refused_pt403']

/** Exportée pour le script de vérification : la liste fermée, lisible depuis l'extérieur. */
export function serverWinsReasons(): ReconcileReason[] {
  return [...RAISONS_QUI_DONNENT_LA_MAIN_AU_SERVEUR]
}

// ═════════════════════════════════════════════════════════════════════════════════════
// GYM-298 — LA REPRISE, ET CE QU'ELLE N'EST PAS
// ═════════════════════════════════════════════════════════════════════════════════════
// 🔴 CE N'EST PAS UNE NOUVELLE SOURCE DE VÉRITÉ. `derniereIssue` ne dit rien de la SALLE :
// elle dit si la dernière tentative de réconciliation a ABOUTI. La salle reste écrite par
// le seul chemin sanctionné — `setActiveGymConfirmed`, sur confirmation serveur.
//
// CE QU'ELLE CORRIGE. Depuis GYM-292b, une coupure réseau ne détruit plus le choix : la
// réconciliation rend `unavailable` et ne touche à rien. C'est le bon comportement — mais
// elle n'était rejouée qu'à l'ouverture de session suivante. Un membre hors ligne au
// lancement restait donc sans salle, donc sans données, JUSQU'À RELANCER L'APP — alors
// que son réseau était peut-être revenu depuis longtemps. Le correctif de 292b avait
// remplacé une perte définitive par une attente indéfinie.
//
// ⚠️ ARMÉE PAR `unavailable` SEULEMENT. Les quatre autres issues sont des DÉCISIONS, pas
// des incidents : rejouer après un `server_wins` relancerait un `switch_active_gym` que le
// serveur vient de refuser, à chaque retour de veille, indéfiniment.
let derniereIssue: ReconcileOutcome['status'] | null = null

/**
 * `true` quand la dernière réconciliation a échoué faute de serveur — donc quand il vaut
 * la peine de réessayer. `false` après toute issue tranchée, et avant la première
 * tentative : au démarrage c'est l'ouverture de session qui déclenche, pas la reprise.
 */
export function activeGymNeedsRetry(): boolean {
  return derniereIssue === 'unavailable'
}

/** Remise à zéro — tests uniquement. */
export function __resetReconcileState(): void {
  derniereIssue = null
}

export async function reconcileActiveGym(): Promise<ReconcileOutcome> {
  if (GYM_MODE === 'single') return { status: 'single' }

  // 🔴 TOUTE LA RÉCONCILIATION EST « EN VOL » (GYM-292b). C'était le trou : `refreshProfile`
  // s'exécutait EN DEHORS de la garde, donc le compteur valait 0 et la salle du serveur
  // était adoptée sans condition — avant même qu'on ait regardé le choix du membre.
  // Sous la garde, `refreshProfile` charge le PROFIL (nom, avatar, badge) sans toucher à
  // la salle : c'est exactement ce qu'on veut ici, et c'est déjà ce que la garde fait.
  return withActiveGymWrite(async () => {
    // ── 1. LE CHOIX D'ABORD, AVANT TOUT RÉSEAU ──────────────────────────────────────
    // ⚠️ IL ÉTAIT LU EN TROISIÈME, APRÈS DEUX ALLERS-RETOURS. Toute la fenêtre entre
    // l'ouverture de session et cette lecture était une occasion de le perdre — et la
    // suite l'ÉCRASAIT alors avec la salle du serveur, rendant la perte définitive.
    // Il se lit maintenant en premier : c'est la donnée qu'on est venu défendre.
    const slugLocal = await readSelectedGymSlug()

    // ── 2. LE PROFIL, SANS LA SALLE ─────────────────────────────────────────────────
    // Nom, avatar, badge : nécessaires à l'app. `gym_id` n'est PAS adopté — la garde
    // ci-dessus l'en empêche, et c'est le point de tout ce correctif.
    await useAuthStore.getState().refreshProfile()

    const memberships = await listMyGyms()
    if (memberships.status !== 'ok') {
      // Hors ligne : ON NE TOUCHE À RIEN. Ni la salle, ni le slug. Le choix survit à une
      // coupure réseau ; la prochaine ouverture de session réessaiera.
      return journalise({ status: 'unavailable', reason: 'memberships_unavailable' }, slugLocal !== null)
    }
    const active = memberships.gyms.find((g) => g.isActive)

    // ── 3. AUCUN CHOIX LOCAL — LE SERVEUR EST LA SEULE RÉPONSE ──────────────────────
    // Connexion directe, lien profond, restauration de session : personne n'a rien choisi.
    if (!slugLocal) {
      if (!active) {
        return journalise({ status: 'unavailable', reason: 'memberships_unavailable' }, false)
      }
      useAuthStore.getState().setActiveGymConfirmed(active.gymId)
      await writeSelectedGymSlug(active.slug)
      return journalise({ status: 'aligned', reason: 'no_local_choice', gymId: active.gymId }, false)
    }

    const choisie = memberships.gyms.find((g) => g.slug === slugLocal)

    // ── 4. LE CHOIX EST DÉJÀ LA SALLE ACTIVE ────────────────────────────────────────
    // Rien à basculer : on pose la salle confirmée par le serveur et on s'arrête.
    if (choisie?.isActive) {
      useAuthStore.getState().setActiveGymConfirmed(choisie.gymId)
      return journalise({ status: 'aligned', reason: 'already_aligned', gymId: choisie.gymId }, true)
    }

    // ── 5. LE CHOIX DÉSIGNE UNE SALLE OÙ LE MEMBRE N'EST PAS INSCRIT ────────────────
    // `my_gym_memberships()` lit `member_gyms`, la table de VÉRITÉ du rattachement : si le
    // slug n'y figure pas, `switch_active_gym` répondrait PT403. On s'épargne l'aller-retour
    // et on applique le même verdict — le serveur garde la main, le slug est corrigé.
    if (!choisie) {
      if (!active) {
        return journalise({ status: 'unavailable', reason: 'memberships_unavailable' }, true)
      }
      useAuthStore.getState().setActiveGymConfirmed(active.gymId)
      await writeSelectedGymSlug(active.slug)
      return journalise(
        { status: 'server_wins', reason: 'not_member', gymId: active.gymId }, true,
      )
    }

    // ── 6. LE CHOIX EST LÉGITIME ET DIFFÈRE — ON LE SOUMET ──────────────────────────
    // 🔴 C'EST ICI, ET AVANT TOUTE ADOPTION DE `profiles.gym_id`. L'ordre inverse — adopter
    // puis corriger — faisait basculer l'app sur la salle du serveur le temps de deux
    // allers-retours, et la laissait là dès que la correction échouait pour n'importe
    // quelle raison.
    const res = await switchGym(choisie)
    if (res.status === 'ok') {
      return journalise({ status: 'switched', reason: 'choice_accepted', gymId: choisie.gymId }, true)
    }

    // ── 7. REFUS EXPLICITE DU SERVEUR — ET LUI SEUL FAIT CÉDER LE CHOIX ─────────────
    // ⚠️ SEUL `not_a_member` (PT403) donne la main au serveur. L'appartenance a pu être
    // retirée entre la liste et la bascule ; c'est un refus, pas un incident.
    if (res.status === 'not_a_member') {
      if (!active) {
        return journalise({ status: 'unavailable', reason: 'memberships_unavailable' }, true)
      }
      useAuthStore.getState().setActiveGymConfirmed(active.gymId)
      await writeSelectedGymSlug(active.slug)
      return journalise(
        { status: 'server_wins', reason: 'refused_pt403', gymId: active.gymId }, true,
      )
    }

    // ── 8. INCIDENT RÉSEAU — ON NE DÉTRUIT PAS LE CHOIX ────────────────────────────
    // 🔴 C'ÉTAIT LE DÉFAUT LE PLUS COÛTEUX : toute issue non-`ok`, y compris une simple
    // coupure, retombait sur « le serveur fait foi » ET RÉÉCRIVAIT LE SLUG. Une seconde
    // sans réseau effaçait DÉFINITIVEMENT le choix du membre — il ne pouvait plus le
    // retrouver qu'en repassant par la recherche. Un incident ne tranche rien.
    return journalise({ status: 'unavailable', reason: 'rpc_error' }, true)
  })
}
