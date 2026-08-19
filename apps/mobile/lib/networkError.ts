// GYM-240 — Distinguer une COUPURE RÉSEAU d'un REFUS SERVEUR.
//
// CE QUE SENTRY REMONTAIT. « Edge Function returned a non-2xx status code », avec
// `mechanism = onunhandledrejection` — alors qu'AUCUNE Edge Function n'avait été appelée
// (vérifié dans les logs Supabase). Le message est celui que supabase-js fabrique par
// défaut ; la cause réelle était une perte de connexion : bascule Wi-Fi/4G, tunnel, app
// mise en arrière-plan pendant un poll.
//
// ⚠️ LE COÛT N'EST PAS L'ERREUR, C'EST LE BRUIT. Sentry est le seul canal de surveillance
// du produit. Une alerte qui crie pour une coupure de métro finit par noyer celle qui
// signale une vraie panne, et c'est alors la vraie qu'on rate.
//
// ⚠️⚠️ CE MODULE NE DOIT JAMAIS AVALER UN REFUS SERVEUR. Un 402 « crédit épuisé » ou un
// 500 doivent continuer de remonter : les taire serait bien pire que le bruit qu'on
// supprime — on masquerait des refus que le membre subit sans comprendre. D'où un
// prédicat DÉLIBÉRÉMENT ÉTROIT : on ne reconnaît que l'absence de réponse.

/**
 * L'échec vient-il du RÉSEAU, et non du serveur ?
 *
 * VRAI uniquement quand aucune réponse HTTP n'a été obtenue. Les trois formes observées :
 *  · `TypeError: Network request failed` — le fetch de React Native, cas le plus fréquent ;
 *  · `AbortError` / `TimeoutError` — requête coupée avant réponse (arrière-plan, timeout) ;
 *  · un objet supabase-js sans `status` NI `context`, signature d'un fetch qui n'a jamais
 *    abouti (une erreur d'Edge Function, elle, porte toujours un `context: Response`).
 *
 * ⚠️ TOUT CE QUI PORTE UN STATUT HTTP EST EXCLU D'OFFICE, y compris 502/503/504 : une
 * passerelle qui répond est un serveur qui répond, et son refus doit rester visible.
 */
export function isNetworkError(err: unknown): boolean {
  if (!err) return false

  const e = err as {
    name?: string
    message?: string
    status?: number
    context?: unknown
  }

  // Un statut HTTP OU un corps de réponse => le serveur a parlé. Ce n'est pas une coupure.
  if (typeof e.status === 'number') return false
  if (e.context !== undefined && e.context !== null) return false

  if (e.name === 'AbortError' || e.name === 'TimeoutError') return true

  const msg = (e.message ?? '').toLowerCase()
  return (
    msg.includes('network request failed') ||
    msg.includes('network error') ||
    msg.includes('failed to fetch') ||
    msg.includes('connection') && msg.includes('lost')
  )
}

/**
 * Exécute une lecture réseau et RANGE l'échec dans la bonne case.
 *
 * · coupure réseau  -> `{ offline: true }`, l'appelant affiche « connexion perdue » ;
 * · refus serveur   -> l'erreur est RELANCÉE, elle doit remonter comme avant ;
 * · succès          -> `{ offline: false, data }`.
 *
 * ⚠️ POURQUOI UN ENVELOPPEUR ET PAS UN `try/catch` À CHAQUE APPEL. Le défaut d'origine
 * n'est pas qu'un catch manquait quelque part : c'est qu'une fonction `async` passée à
 * `setInterval` renvoie une promesse que PERSONNE n'attend. Son rejet ne peut être capturé
 * ni par le `setInterval`, ni par l'appelant — il part directement en
 * `onunhandledrejection`. L'enveloppeur oblige à décider, au point d'appel, ce qu'on fait
 * de l'échec.
 */
export async function runNetworkSafe<T>(
  fn: () => Promise<T>,
): Promise<{ offline: true } | { offline: false; data: T }> {
  try {
    return { offline: false, data: await fn() }
  } catch (err) {
    if (isNetworkError(err)) return { offline: true }
    throw err
  }
}
