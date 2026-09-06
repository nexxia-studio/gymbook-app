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
import { readCachedBrand, type GymBrand } from './theme/brand'
import { takeSignupIntent } from './signupIntent'
import { joinGym } from './gymJoin'
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
   * 🔴 GYM-294 — LA SEULE VALEUR AJOUTÉE PAR CE LOT, et elle décrit un geste, pas une
   * réconciliation. Le membre a ouvert un lien profond vers une ressource d'une AUTRE de
   * ses salles, l'app le lui a dit, et il a accepté de basculer.
   *
   * ⚠️ AUCUNE VALEUR EXISTANTE NE CONVENAIT, et c'est pour cela qu'on en ajoute une plutôt
   * que d'en emprunter une. `choice_accepted` décrit le choix fait AVANT connexion, à la
   * recherche de salle, et confirmé à l'ouverture de session : le confondre avec un geste
   * intentionnel en pleine session rendrait le premier illisible dans le tableau de bord,
   * au moment précis où il sert à diagnostiquer un parcours de connexion.
   *
   * L'événement reste `active_gym_reconciled` : c'est bien la salle active qui change, par
   * le même chemin sanctionné (`switch_active_gym`), et un second nom d'événement pour la
   * même conséquence obligerait à additionner deux séries pour compter les bascules.
   */
  | 'deep_link_accepted'
  /**
   * 🔴 GYM-293 — LE COMPTE VENAIT D'ÊTRE CRÉÉ, ET LE RATTACHEMENT A ABOUTI.
   *
   * Distinct de `choice_accepted`, qui décrit un membre DÉJÀ inscrit dont on soumet le choix
   * au serveur. Ici il n'y avait aucune adhésion : la salle n'a pas été CHOISIE parmi
   * plusieurs, elle a été REJOINTE. Les confondre rendrait impossible de mesurer combien
   * d'inscriptions aboutissent — le seul chiffre qui dise si ce parcours fonctionne.
   */
  | 'joined_after_signup'
  /** Le rattachement a échoué : salle pleine, quota, ou refus serveur. */
  | 'join_failed'

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

  // 🔴 GYM-300 (§2) — VISIBLE, PAS SEULEMENT DISTINCTE. Ne pas avoir PU LIRE les
  // adhésions et ne pas être MEMBRE sont deux faits différents : le premier ne réécrit
  // rien, ne déclasse rien, et arme une reprise (GYM-298). Il restait pourtant muet — le
  // membre attendait sans savoir qu'il attendait.
  //
  // ⚠️ L'ANNONCE EST FAITE ICI, PAS À CHAQUE `return`. Cinq sorties distinctes rendent
  // `unavailable` ; en annoncer quatre et oublier la cinquième donnerait un silence
  // résiduel impossible à repérer autrement qu'en le vivant. Le point de passage unique
  // est le seul endroit où l'exhaustivité se voit.
  if (outcome.status === 'unavailable') annonce({ kind: 'unreachable' })
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

// ═════════════════════════════════════════════════════════════════════════════════════
// 🔴 GYM-300 — L'AVIS AU MEMBRE : LA RÉCONCILIATION NE DÉCIDE PLUS EN SILENCE
// ═════════════════════════════════════════════════════════════════════════════════════
// Deux issues sur cinq changent ce que le membre voit sans qu'il ait rien demandé :
//
//   · `server_wins`  — il a choisi une salle, il en obtient une autre. Depuis GYM-292 le
//                      comportement est CORRECT (il n'y est pas inscrit) et pourtant il
//                      était MUET : la marque et les données changeaient sous ses yeux
//                      entre l'écran de connexion et l'accueil, sans un mot. Rien ne lui
//                      permettait de comprendre, ni de savoir quoi faire ensuite.
//   · `unavailable`  — ses adhésions n'ont pas pu être lues. GYM-298 réarme bien une
//                      reprise, mais en silence lui aussi : le membre attend sans savoir
//                      qu'il attend.
//
// ⚠️ CE N'EST PAS UNE SOURCE DE VÉRITÉ, C'EST UN MESSAGE. Comme `derniereIssue`, cet avis
// ne dit RIEN de la salle active — celle-ci reste écrite par le seul chemin sanctionné,
// `setActiveGymConfirmed`, sur confirmation serveur. Un écran qui lirait l'avis pour en
// déduire où il se trouve lirait la mauvaise donnée.
//
// ⚠️ ET IL SE CONSOMME UNE FOIS. `takeActiveGymNotice()` le rend ET l'efface : un avis
// re-servi à chaque montage d'écran deviendrait un bandeau qui poursuit le membre d'onglet
// en onglet pour un fait vieux de dix minutes.
export type ActiveGymNotice =
  /**
   * GYM-293 — le rattachement d'après-inscription a échoué. `code` vient du serveur
   * (GYM_FULL, GYM_RATE_LIMITED, GYM_NOT_FOUND…) : l'écran le traduit, il ne l'invente pas.
   */
  | { kind: 'join_failed'; code: string; requestedSlug: string }
  /**
   * Le choix n'a pas été retenu.
   *
   * 🔴 GYM-301 (2) — L'AVIS PORTE LA MARQUE, PLUS SEULEMENT LE NOM. L'écran dédié doit
   * s'afficher aux couleurs de la salle DEMANDÉE, et c'est ici — et nulle part ailleurs —
   * qu'elles sont encore atteignables : deux lignes plus bas, `writeSelectedGymSlug`
   * bascule le slug sur la salle du serveur, le fournisseur recharge, et le cache de
   * marque (une seule entrée) est écrasé. Capturer la marque AVANT évite à l'écran un
   * aller-retour réseau pour retrouver une donnée qu'on avait sous la main.
   *
   * `requested` est nul quand le cache ne connaissait pas la salle : l'écran retombe
   * alors sur la palette Viniz et une formulation sans nom.
   */
  | { kind: 'not_member'; requested: GymBrand | null; requestedSlug: string; landed: string }
  /** Les adhésions n'ont pas pu être lues : rien n'a été touché, une reprise est armée. */
  | { kind: 'unreachable' }

let avisEnAttente: ActiveGymNotice | null = null
const abonnes = new Set<() => void>()

/**
 * L'avis en attente, s'il y en a un — ET IL EST CONSOMMÉ PAR CETTE LECTURE.
 *
 * ⚠️ APPELÉ DEUX FOIS, IL NE REND L'AVIS QU'UNE FOIS. C'est ce qui permet à plusieurs
 * écrans de s'abonner sans qu'aucun ne doive savoir si un autre a déjà affiché le message.
 */
export function takeActiveGymNotice(): ActiveGymNotice | null {
  const avis = avisEnAttente
  avisEnAttente = null
  return avis
}

/**
 * L'avis en attente, SANS le consommer.
 *
 * ⚠️ GYM-301 (2) — IL FAUT LES DEUX LECTURES, ET ELLES NE SE REMPLACENT PAS. Les deux
 * issues n'ont plus le même destinataire : `unreachable` s'affiche en bandeau sur
 * l'accueil, qui le CONSOMME ; `not_member` ouvre un écran dédié, et c'est cet écran qui
 * doit le consommer — s'il était consommé par l'accueil pour décider d'y aller, l'écran
 * arriverait les mains vides, sans nom de salle ni couleurs.
 */
export function peekActiveGymNotice(): ActiveGymNotice | null {
  return avisEnAttente
}

/**
 * S'abonner à l'arrivée d'un avis.
 *
 * ⚠️ IL FAUT UN ABONNEMENT, UNE LECTURE AU MONTAGE NE SUFFIT PAS. La réconciliation part
 * à l'ouverture de session et dure deux allers-retours ; l'accueil, lui, est monté bien
 * avant qu'elle ne tranche. Un écran qui se contenterait de lire à son montage ne verrait
 * jamais rien — c'est exactement le motif de `subscribeSelectedGymSlug` (GYM-288).
 */
export function subscribeActiveGymNotice(fn: () => void): () => void {
  abonnes.add(fn)
  return () => { abonnes.delete(fn) }
}

function annonce(avis: ActiveGymNotice): void {
  avisEnAttente = avis
  // Best-effort : un abonné qui lève ne doit pas faire échouer la réconciliation, dont le
  // travail — la salle active — est déjà fait et bien plus important que le bandeau.
  abonnes.forEach((fn) => { try { fn() } catch { /* le bandeau n'est pas critique */ } })
}

/**
 * 🔴 GYM-294 — LÈVE UN AVIS « PAS MEMBRE » DEPUIS L'EXTÉRIEUR DE LA RÉCONCILIATION.
 *
 * L'écran de refus de GYM-301 (`app/gym/not-member.tsx`) sait déjà tout faire : il se peint
 * aux couleurs de la salle demandée, propose de revenir se connecter, et de rejoindre sa
 * propre salle. Le lot GYM-294 rencontre exactement la même situation par un autre chemin —
 * un lien profond vers une salle où le membre n'est pas inscrit.
 *
 * ⚠️ ON RÉUTILISE L'ÉCRAN, ON NE LE RECOPIE PAS. Une seconde page de refus aurait divergé de
 * la première au premier changement de formulation — et c'est la page qui annonce une
 * mauvaise nouvelle, celle où une incohérence se remarque le plus.
 *
 * ⚠️ CETTE FONCTION N'ÉMET AUCUNE TÉLÉMÉTRIE, et c'est délibéré : `active_gym_reconciled`
 * décrit une RÉCONCILIATION d'ouverture de session. Ici rien n'est réconcilié — un lien a
 * été refusé, la salle active n'a pas bougé. L'émettre gonflerait le compteur de
 * `not_member` avec des événements qui ne viennent pas du parcours de connexion.
 */
export function raiseNotMemberNotice(avis: {
  requested: GymBrand | null
  requestedSlug: string
  landed: string
}): void {
  annonce({ kind: 'not_member', ...avis })
}

/** Remise à zéro — tests uniquement. */
export function __resetActiveGymNotice(): void {
  avisEnAttente = null
  abonnes.clear()
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
      // ═════════════════════════════════════════════════════════════════════════════
      // 🔴 GYM-293 — MÊME ÉTAT APPARENT, DEUX INTENTIONS OPPOSÉES.
      // ═════════════════════════════════════════════════════════════════════════════
      // « Un slug choisi, aucune adhésion » se lit de deux façons, et la marque de signup
      // est la SEULE chose qui les sépare :
      //
      //   · choix de CONNEXION → « tu n'es pas membre de cette salle ». Refus de GYM-301,
      //     et il est juste : le membre s'est trompé de salle.
      //   · choix de SIGNUP    → « tu viens de créer ton compte ici ». Le rattachement n'a
      //     pas encore eu lieu, et c'est exactement ce qu'il reste à faire.
      //
      // Sans elle, on afficherait « tu n'es pas membre » à quelqu'un qui vient de s'inscrire
      // chez cette salle-là — le pire message au pire moment.
      //
      // ⚠️ LA MARQUE SE CONSOMME ICI, réussite ou échec. La laisser ferait retenter un
      // rattachement à chaque ouverture de session, longtemps après l'inscription.
      const vientDuSignup = await takeSignupIntent()
      if (vientDuSignup) {
        const join = await joinGym(slugLocal)
        if (join.status === 'ok') {
          // Le serveur a rattaché ET posé la salle active si elle était vide : on adopte ce
          // qu'il vient de confirmer, par le même chemin sanctionné que partout ailleurs.
          useAuthStore.getState().setActiveGymConfirmed(join.gymId)
          return journalise(
            { status: 'switched', reason: 'joined_after_signup', gymId: join.gymId }, true,
          )
        }
        // ⚠️ ÉCHEC = ON NE TOUCHE À RIEN, ET ON LE DIT. Salle pleine, quota, refus : le
        // compte existe, sans salle. C'est un état INCOMPLET, jamais un état mi-créé — rien
        // n'a été écrit à moitié. L'écran dédié explique, avec le code que le serveur a rendu.
        annonce({ kind: 'join_failed', code: join.code, requestedSlug: slugLocal })
        return journalise({ status: 'unavailable', reason: 'join_failed' }, true)
      }

      if (!active) {
        return journalise({ status: 'unavailable', reason: 'memberships_unavailable' }, true)
      }
      // 🔴 GYM-300 (3a) — LE NOM DE LA SALLE DEMANDÉE, S'IL EST CONNU. Ici `choisie` est
      // `undefined` : on ne dispose QUE du slug, et un slug n'est pas un nom. Le cache de
      // marque, lui, a été rempli par la recherche juste avant la connexion
      // (`app/gym/select.tsx` appelle `fetchBrand` avant de naviguer) — c'est une lecture
      // LOCALE, aucun aller-retour ajouté sur un chemin déjà long.
      //
      // ⚠️ ET S'IL EST INCONNU, ON NE MET PAS LE SLUG À LA PLACE : le membre n'a jamais vu
      // « studio-test-staging », et lui montrer un identifiant technique au moment où on
      // lui explique une bascule ajouterait de la confusion à la confusion.
      const demandee = await readCachedBrand(slugLocal)
      useAuthStore.getState().setActiveGymConfirmed(active.gymId)
      await writeSelectedGymSlug(active.slug)
      annonce({ kind: 'not_member', requested: demandee, requestedSlug: slugLocal, landed: active.name })
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
      // Ici le nom est SÛR : `choisie` vient des adhésions, et le refus est postérieur à
      // la soumission — l'appartenance a été retirée entre la liste et la bascule.
      useAuthStore.getState().setActiveGymConfirmed(active.gymId)
      await writeSelectedGymSlug(active.slug)
      // Ici la marque n'est pas en cache sous la main (le choix venait des adhésions, pas
      // de la recherche) : on la relit, et l'écran retombera sur Viniz si elle manque.
      annonce({
        kind: 'not_member',
        requested: await readCachedBrand(choisie.slug),
        requestedSlug: choisie.slug,
        landed: active.name,
      })
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
