// GYM-134 (Communications v1) — LES LOTS DE PUSH ET LE BILAN, SANS RÉSEAU NI BASE.
//
// Une communication part à toute une salle. L'ancienne boucle faisait UN appel à
// `send-notification` par membre ; Expo accepte jusqu'à 100 messages par requête, et
// `send-notification` les pousse tels quels. On envoie donc par lots de 100 jetons.
//
// ⚠️ `push_sent` NE MENT PAS (GYM-134, partie 1). Un membre est compté « envoyé » si son
// jeton a reçu un ticket `ok` d'Expo, pas parce qu'il a un jeton. Un lot refusé (plan sans
// notifications, panne Expo, jeton périmé) laisse ses membres à `false`.

export const TAILLE_LOT_EXPO = 100

export interface Destinataire {
  member_id: string
  push_token: string | null
}

/** Jeton utilisable : une chaîne non vide. */
export function jetonDe(d: Destinataire): string | null {
  const t = typeof d.push_token === 'string' ? d.push_token.trim() : ''
  return t === '' ? null : t
}

/**
 * Les jetons à pousser, SANS DOUBLON, découpés en lots.
 *
 * Deux comptes sur le même téléphone portent le même jeton : l'envoyer deux fois ferait
 * sonner l'appareil deux fois pour le même message.
 */
export function lotsDeJetons(destinataires: Destinataire[], taille = TAILLE_LOT_EXPO): string[][] {
  const uniques = [...new Set(destinataires.map(jetonDe).filter((t): t is string => t !== null))]
  const n = Math.max(1, Math.floor(taille))
  const lots: string[][] = []
  for (let i = 0; i < uniques.length; i += n) lots.push(uniques.slice(i, i + n))
  return lots
}

// GYM-391 — la lecture des tickets vit dans `_shared/notify.ts`, partagée avec les messages
// unitaires (réservation, annulation, paiement) : une seule règle pour `push_sent`.
import { jetonsAcceptes } from '../_shared/notify.ts'
export { jetonsAcceptes }

/** La réponse porte un ticket par jeton du lot : on peut la lire jeton par jeton. */
export function reponseExploitable(lot: string[], reponse: unknown): boolean {
  const r = reponse as { ok?: unknown; results?: unknown } | null
  return !!r && typeof r === 'object' && r.ok === true && Array.isArray(r.results) && r.results.length === lot.length
}

/** `send-notification` a répondu que le plan de la salle n'inclut pas les notifications. */
export function notificationsDesactivees(reponse: unknown): boolean {
  const r = reponse as { skipped?: unknown } | null
  return !!r && typeof r === 'object' && r.skipped === 'notifications_disabled'
}

/**
 * Faut-il relancer ce lot jeton par jeton ?
 *
 * Expo peut refuser un lot EN ENTIER (HTTP 400 : un jeton mal formé,
 * PUSH_TOO_MANY_EXPERIENCE_IDS si des jetons de deux projets Expo se mélangent). Un seul
 * jeton pourri priverait alors de push tous les autres membres du lot, alors que l'ancienne
 * boucle, un appel par membre, les isolait.
 *
 * Oui si la réponse n'est pas exploitable ET que le lot a plus d'un jeton. Non si le plan
 * n'inclut pas les notifications : la réponse serait la même pour chaque jeton.
 */
export function doitRelancerUnParUn(lot: string[], reponse: unknown): boolean {
  if (lot.length <= 1) return false
  if (notificationsDesactivees(reponse)) return false
  return !reponseExploitable(lot, reponse)
}

export interface IssueLot {
  /** Jetons acceptés par Expo, premier essai et relance confondus. */
  acceptes: string[]
  /** true si le lot a été relancé jeton par jeton. */
  relance: boolean
  /** Nombre d'appels faits à `send-notification` pour ce lot. */
  appels: number
}

/**
 * Envoie un lot, et le relance jeton par jeton s'il est refusé en entier.
 *
 * `envoyer` est le seul contact avec le réseau : elle pousse une liste de jetons et rend la
 * réponse de `send-notification` (ou `null` si l'appel a levé). Tout le reste est décidé
 * ici, sans réseau, donc éprouvable par le banc.
 */
export async function envoyerLot(
  lot: string[],
  envoyer: (jetons: string[]) => Promise<unknown>,
): Promise<IssueLot> {
  const premiere = await envoyer(lot)
  if (!doitRelancerUnParUn(lot, premiere)) {
    return { acceptes: jetonsAcceptes(lot, premiere), relance: false, appels: 1 }
  }
  const acceptes: string[] = []
  let appels = 1
  for (const jeton of lot) {
    const reponse = await envoyer([jeton])
    appels++
    // Le plan a pu changer entre-temps : inutile d'interroger les jetons restants.
    if (notificationsDesactivees(reponse)) break
    acceptes.push(...jetonsAcceptes([jeton], reponse))
  }
  return { acceptes, relance: true, appels }
}

export interface Bilan {
  /** Y : membres du segment. */
  recipient_count: number
  /** Membres qui ont un jeton push. */
  with_token: number
  /** Z : membres sans notifications activées (aucun jeton). */
  without_token: number
  /** X : membres dont le push a été accepté par Expo. */
  push_sent: number
  /** Membres avec jeton dont le push n'a pas été accepté. */
  push_failed: number
  /** `push_sent` par membre, pour `gym_communication_recipients` et `notifications`. */
  parMembre: { member_id: string; push_sent: boolean }[]
}

export function bilan(destinataires: Destinataire[], acceptes: Iterable<string>): Bilan {
  const ok = new Set(acceptes)
  const parMembre = destinataires.map((d) => {
    const jeton = jetonDe(d)
    return { member_id: d.member_id, push_sent: jeton !== null && ok.has(jeton) }
  })
  const withToken = destinataires.filter((d) => jetonDe(d) !== null).length
  const pushSent = parMembre.filter((m) => m.push_sent).length
  return {
    recipient_count: destinataires.length,
    with_token: withToken,
    without_token: destinataires.length - withToken,
    push_sent: pushSent,
    push_failed: withToken - pushSent,
    parMembre,
  }
}

/** Découpe une liste en paquets, pour les insertions groupées. */
export function paquets<T>(liste: T[], taille: number): T[][] {
  const n = Math.max(1, Math.floor(taille))
  const out: T[][] = []
  for (let i = 0; i < liste.length; i += n) out.push(liste.slice(i, i + n))
  return out
}
