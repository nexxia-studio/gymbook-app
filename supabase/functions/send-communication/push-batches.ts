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

/**
 * Lit la réponse de `send-notification` pour UN lot et rend les jetons acceptés par Expo.
 *
 * `results` est la liste des tickets Expo, dans l'ordre des jetons envoyés. Tout ce qui
 * n'est pas exactement cette forme (réponse en erreur, garde de plan, longueur différente)
 * ne valide AUCUN jeton : dans le doute, on ne déclare pas un envoi.
 */
export function jetonsAcceptes(lot: string[], reponse: unknown): string[] {
  const r = reponse as { ok?: unknown; results?: unknown } | null
  if (!r || r.ok !== true || !Array.isArray(r.results) || r.results.length !== lot.length) return []
  return lot.filter((_, i) => (r.results as { status?: unknown }[])[i]?.status === 'ok')
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
