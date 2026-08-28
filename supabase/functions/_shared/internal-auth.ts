// GYM-282 — LA GARDE DES FONCTIONS INTERNES, ET SA COMPARAISON EN TEMPS CONSTANT.
//
// ═════════════════════════════════════════════════════════════════════════════════════
// CE QUE `verify_jwt = true` NE FAIT PAS
// ═════════════════════════════════════════════════════════════════════════════════════
// Il vérifie qu'un JWT EXISTE et qu'il est signé. Pas que son porteur a le DROIT. Toute
// fonction qui s'en contente est donc appelable par n'importe quel utilisateur connecté —
// n'importe quel membre de n'importe quelle salle.
//
// Le projet a déjà un motif pour les appels SERVEUR-À-SERVEUR : un secret partagé porté en
// en-tête `X-Internal-Secret`. Ce module en fait une brique, pour deux raisons.
//
// 🔴 1. LA COMPARAISON DOIT ÊTRE EN TEMPS CONSTANT. Les huit fonctions qui portent
// aujourd'hui ce motif comparent avec `!==`. Sur un secret, un `!==` s'arrête au premier
// octet qui diffère : le temps de réponse dépend alors du nombre d'octets corrects, et cette
// différence — quelques microsecondes — suffit en principe à reconstruire le secret octet par
// octet. C'est un risque théorique sur une Edge Function (le bruit réseau domine largement),
// mais il ne coûte rien à supprimer, et l'écrire une fois évite de le re-décider huit fois.
//
// 2. UN SEUL ENDROIT À CORRIGER. Un motif recopié dans huit fichiers est un motif qui
// divergera : c'est déjà arrivé au nom de l'en-tête ailleurs dans ce dépôt.
//
// ⚠️ AUCUNE VALEUR DE SECRET N'APPARAÎT ICI, ni dans aucun fichier du dépôt. Le nom de la
// variable d'environnement est public, sa valeur est posée au déploiement par le cockpit.

/** Le nom de la variable — PAS sa valeur. */
export const INTERNAL_SECRET_ENV = 'INTERNAL_FUNCTIONS_SECRET'

/** L'en-tête que portent les appels serveur-à-serveur du projet. */
export const INTERNAL_SECRET_HEADER = 'X-Internal-Secret'

/**
 * Comparaison à temps constant : le temps dépend de la LONGUEUR, jamais du contenu.
 *
 * ⚠️ ON COMPARE TOUJOURS TOUS LES OCTETS, même après une différence — c'est tout l'objet.
 * Un `return false` anticipé annulerait la propriété qu'on cherche.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  // Les longueurs, elles, fuitent : c'est admis et sans portée ici — la longueur d'un secret
  // n'aide pas à le deviner, et la masquer demanderait de hacher, donc d'introduire une
  // dépendance et un coût pour rien.
  if (ea.length !== eb.length) return false
  let diff = 0
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i]
  return diff === 0
}

/**
 * `true` si la requête porte le secret interne attendu.
 *
 * ⚠️ UN SECRET NON CONFIGURÉ REFUSE TOUT, il n'ouvre pas la porte. Si la variable est
 * absente, `expected` vaut la chaîne vide : sans ce test explicite, un appelant envoyant une
 * chaîne vide passerait — la garde serait désactivée par une variable OUBLIÉE, ce qui est
 * précisément le scénario contre lequel elle existe.
 */
export function hasInternalSecret(req: Request): boolean {
  const expected = Deno.env.get(INTERNAL_SECRET_ENV) ?? ''
  if (!expected) return false
  const provided = req.headers.get(INTERNAL_SECRET_HEADER) ?? ''
  return timingSafeEqual(provided, expected)
}

/**
 * La réponse de refus. SOBRE, et c'est délibéré : pas d'écho de l'en-tête reçu, pas de
 * mention de sa longueur, pas de « secret invalide » contre « secret absent ». Un message
 * qui distingue les deux cas est déjà une information donnée à celui qui cherche.
 */
export function internalUnauthorized(fn: string): Response {
  console.warn(`[${fn}] unauthorized`)
  return new Response(JSON.stringify({ error: true, code: 'UNAUTHORIZED' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  })
}
