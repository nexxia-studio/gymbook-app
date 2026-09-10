// GYM-336 — Demande expresse d'exécution anticipée : lecture du body, côté SERVEUR.
//
// 🔴 CE MODULE EST LA SEULE PORTE D'ENTRÉE DE LA PREUVE, et il est partagé par les deux
// flux en ligne (create-payment, create-subscription) pour une raison précise : si chacun
// interprétait le body à sa façon, un achat de crédits et un abonnement pourraient
// enregistrer deux choses différentes pour un même geste du membre. Le consentement ne
// doit jamais dépendre du chemin emprunté — ni à l'écran, ni ici.
//
// ⚠️ LE CLIENT N'ENVOIE QU'UNE INTENTION, JAMAIS UNE PREUVE. Il transmet un booléen et la
// version du libellé qu'il a affiché ; c'est le serveur qui DATE. Accepter un horodatage
// fourni par l'appareil rendrait la preuve sans valeur — l'horloge d'un téléphone se règle
// à la main.
//
// ⚠️ CE MODULE NE CONCERNE QUE LA VENTE À DISTANCE. La vente au comptoir
// (_shared/counter-sale.ts, cash | card_terminal) est un contrat EN PRÉSENCE : l'art. VI.47
// CDE ne s'y applique pas, il n'y a aucun droit de rétractation, donc aucune demande
// d'exécution anticipée à recueillir. Ne pas l'y brancher.

/** Ce que les deux fonctions posent dans leur INSERT `payments`. */
export interface EarlyPerformanceConsent {
  early_performance_requested_at: string | null
  early_performance_consent_version: string | null
}

/**
 * Forme acceptée pour une version de libellé. Volontairement étroite : la valeur vient du
 * client et finit en base, dans une colonne à valeur probante. Un identifiant court et
 * sans surprise ('1', '2026-09', 'b4-v2') passe ; tout le reste est traité comme illisible.
 */
const VERSION_SHAPE = /^[A-Za-z0-9._-]{1,32}$/

/**
 * Version enregistrée quand le client affirme un consentement sans transmettre de version
 * exploitable. ON N'INVENTE PAS : écrire ici la version courante du serveur reviendrait à
 * certifier un libellé que ce client n'a peut-être jamais affiché. 'unknown' dit exactement
 * ce que l'on sait — un consentement a été donné, sur un texte qu'on ne peut pas nommer.
 */
export const UNKNOWN_CONSENT_VERSION = 'unknown'

/**
 * Lit la demande d'exécution anticipée dans le body d'une requête d'achat.
 *
 * 🔴 L'ABSENCE DU PARAMÈTRE N'EST PAS UNE ERREUR, ET NE DOIT PAS LE DEVENIR.
 *
 * Deux raisons, dont la seconde est décisive :
 *
 * 1. Les binaires mobiles DÉJÀ EN CIRCULATION n'envoient rien. Refuser l'achat couperait
 *    la vente pour tout membre n'ayant pas encore mis à jour — le dépôt connaît déjà ce
 *    raisonnement (cf. le commentaire PAYMENTS_DISABLED dans apps/mobile/lib/payments.ts).
 *
 * 2. SURTOUT : la demande d'exécution anticipée est un DROIT DU CONSOMMATEUR, pas une
 *    condition de vente. Un achat sans demande expresse est parfaitement valable — il
 *    laisse simplement au membre son droit de rétractation entier. Refuser la vente au
 *    motif que la case manque inventerait une obligation qui n'existe pas.
 *
 * Le paramètre absent produit donc NULL : « aucune demande au dossier ». C'est la
 * situation juridique exacte, celle que l'art. B4 des CGV décrit déjà depuis GYM-333b —
 * remboursement intégral. On n'est jamais moins protégé qu'aujourd'hui ; on l'est plus dès
 * que le membre coche.
 */
export function readEarlyPerformanceConsent(body: Record<string, unknown>): EarlyPerformanceConsent {
  // `=== true` et non une conversion en booléen : 'false', 0 ou 'oui' ne sont pas des
  // consentements. Seul le booléen vrai en est un.
  const requested = body.early_performance_consent === true

  if (!requested) {
    return { early_performance_requested_at: null, early_performance_consent_version: null }
  }

  const raw = body.early_performance_consent_version
  const version = typeof raw === 'string' && VERSION_SHAPE.test(raw) ? raw : UNKNOWN_CONSENT_VERSION

  return {
    // L'horloge du serveur, dans le même INSERT que la commande.
    early_performance_requested_at: new Date().toISOString(),
    early_performance_consent_version: version,
  }
}
