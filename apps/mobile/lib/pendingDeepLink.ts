// ╔═══════════════════════════════════════════════════════════════════════════════════════╗
// ║  🔴 GYM-371 — LE LIEN D'ARRIVÉE ÉTAIT PERDU AU DÉMARRAGE À FROID                     ║
// ╚═══════════════════════════════════════════════════════════════════════════════════════╝
//
// LE DÉFAUT, MESURÉ : app fermée, le membre touche un lien universel (ou revient d'un
// paiement) → l'app s'ouvre sur L'ACCUEIL. Le lien n'est pas mal routé : il est PERDU.
//
// LA CAUSE EST STRUCTURELLE, ET ELLE EST VOULUE AILLEURS. `LegalAcceptanceGate` (GYM-330)
// ne monte PAS `<Slot />` tant que le consentement n'est pas résolu : « le contournement
// n'est pas interdit, il est impossible ». Conséquence directe : au démarrage à froid,
// expo-router résout l'URL initiale alors qu'AUCUNE route n'existe encore. Il n'y a rien
// vers quoi naviguer, et le lien tombe.
//
// 🔴 CE DÉFAUT DEVIENT BLOQUANT AVEC GYM-369. Tant que le checkout vivait dans une vue
// intégrée, le retour était un cas de bord. Maintenant que le membre part DANS UNE AUTRE
// APPLICATION, le retour par lien est LE chemin nominal — et un chemin nominal qui se perd
// une fois sur deux n'est pas un chemin.
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// CE MODULE NE FAIT QU'UNE CHOSE : SE SOUVENIR, ET SE TAIRE
// ─────────────────────────────────────────────────────────────────────────────────────────
// ⚠️ IL N'AFFAIBLIT PAS LA PORTE, ET C'EST LE POINT QUI COMPTE. Le lien est mémorisé, il
// n'est PAS joué : rien n'est monté, rien n'est affiché, aucune route n'existe. Il ATTEND
// que la porte s'ouvre — et si le membre refuse les conditions, il n'est jamais joué du
// tout. La porte reste la seule chose qui décide.
//
// ⚠️ EN MÉMOIRE, PAS SUR LE DISQUE, ET C'EST DÉLIBÉRÉ. Un lien écrit sur disque survivrait
// à l'app : on rejouerait au lancement suivant — demain, la semaine prochaine — un retour
// de paiement périmé, sur un écran qui pollerait une ligne réglée depuis longtemps. Ce
// qu'on veut retenir ne dure que le temps d'un démarrage ; la mémoire du processus a
// exactement cette durée de vie.
let enAttente: string | null = null

/**
 * La porte est-elle ouverte ? Tant qu'elle l'est, expo-router reçoit et route les liens
 * lui-même : mémoriser ferait double emploi, et on rejouerait une navigation déjà faite.
 */
let porteOuverte = false

/**
 * Mémorise un lien entrant — l'URL initiale d'un démarrage à froid, ou une URL reçue
 * pendant que la porte est fermée (mise à jour des conditions, par exemple).
 *
 * ⚠️ SANS EFFET PORTE OUVERTE. Ce n'est pas une optimisation : c'est ce qui garantit qu'on
 * ne rejoue jamais un lien qu'expo-router a déjà honoré.
 */
export function memoriserLienEntrant(url: string | null | undefined): void {
  if (porteOuverte || !url) return
  enAttente = url
}

/**
 * La porte vient de s'ouvrir : rend le lien en attente (et l'oublie), puis cesse de
 * mémoriser. Appelé par `DeepLinkReplay`, qui n'est monté que sous la porte.
 */
export function ouvrirLaPorte(): string | null {
  porteOuverte = true
  const url = enAttente
  enAttente = null
  return url
}

/**
 * La porte se referme (déconnexion, nouvelle version des conditions en cours de session) :
 * on se remet à mémoriser. Sans ce pendant, un lien reçu pendant une re-demande de
 * consentement serait perdu comme avant.
 */
export function refermerLaPorte(): void {
  porteOuverte = false
  enAttente = null
}

/** Tests uniquement. */
export function __resetPendingDeepLink(): void {
  enAttente = null
  porteOuverte = false
}
