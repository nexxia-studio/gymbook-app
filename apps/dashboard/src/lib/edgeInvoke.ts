// GYM-227 — UN SEUL point de passage pour les appels Edge, qui sait rattraper un 401.
//
// LE DÉFAUT. Le jeton dure 1 h et son renouvellement automatique repose sur un minuteur
// JavaScript, étranglé dès que l'onglet passe en arrière-plan (cf. lib/session.ts). Un
// appel Edge pouvait donc partir avec un jeton périmé et revenir en 401 — que chaque
// écran traduisait en message MÉTIER de son cru. Pendant la démo du 12/08, « Erreur lors
// de la connexion Mollie » a coûté une heure de diagnostic pour une session expirée.
//
// LE MAPPING CENTRALISÉ NE POUVAIT PAS L'ATTRAPER. edgeErrors (GYM-219) traite les refus
// MÉTIER — NO_CREDIT, FULL, SUSPENDED : des décisions prises par une fonction qui a bien
// reconnu son appelant. Un 401, c'est l'inverse : la fonction n'a jamais eu lieu. Le code
// UNAUTHORIZED existait dans la table, mais rien ne le PRODUISAIT côté client, parce que
// personne ne regardait le statut HTTP.
//
// CE QUE FAIT CE MODULE, dans cet ordre :
//   1. avant l'appel, garantir un jeton frais (le renouvellement anticipé évite le 401) ;
//   2. sur 401, renouveler puis REJOUER UNE SEULE FOIS ;
//   3. si le rejeu échoue encore, ou si le renouvellement échoue, clore la session et
//      renvoyer un refus UNAUTHORIZED — un message honnête, jamais un message métier
//      inventé.
//
// ⚠️ UN SEUL REJEU, JAMAIS DE BOUCLE. Un échec APRÈS renouvellement est un échec
// DÉFINITIF : le jeton était neuf, le serveur l'a quand même refusé. Réessayer
// martèlerait l'API pour transformer un refus certain en refus lent.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// ET LES APPELS PostgREST (supabase.from(...)) ? RIEN À FAIRE — vérifié, pas supposé.
// ─────────────────────────────────────────────────────────────────────────────────────
//
// La question se repose à chaque relecture de ce fichier : « il manque le même filet sur
// les requêtes de tables ». NON, et construire un second intercepteur serait redondant.
// Vérifié dans supabase-js 2.105.4 / auth-js 2.105.4 :
//
//  1. CHAQUE requête PostgREST passe par `fetchWithAuth` → `_getAccessToken()` →
//     `auth.getSession()`. getSession() teste l'échéance avec une MARGE DE 90 s
//     (EXPIRY_MARGIN_MS = 3 × 30 s) et appelle `_callRefreshToken()` si besoin, AVANT que
//     la requête ne parte. Un appel PostgREST n'envoie jamais un JWT sciemment périmé.
//
//  2. Si ce renouvellement échoue pour de bon (jeton de rafraîchissement révoqué — session
//     réellement morte, par opposition à une simple panne réseau, que auth-js distingue via
//     isAuthRetryableFetchError), `_removeSession()` émet SIGNED_OUT.
//
//  3. SIGNED_OUT est DÉJÀ intercepté par useAuthStore, qui vide session, gym_id, role et
//     useGymStore → ProtectedRoute renvoie vers /login. C'est exactement le terminus de
//     `endDeadSession()` ci-dessous. Deux routes, un seul traitement.
//
// ⚠️⚠️ LA LEÇON QUI COMPTE — NE JAMAIS FORGER L'EN-TÊTE Authorization À LA MAIN.
//
// `fetchWithAuth` ne pose le jeton que si l'appelant ne l'a pas déjà fait :
//
//     if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`)
//
// UN EN-TÊTE FOURNI PAR L'APPELANT GAGNE. C'est ce qui a produit les trois 401 du 12/08 :
// MollieConnectCard faisait `getSession()` puis posait lui-même son `Authorization`,
// court-circuitant le renouvellement par requête décrit au point 1. Le minuteur
// d'arrière-plan gelé n'était que la précondition (le jeton était vieux) ; la RAISON pour
// laquelle il a atteint le serveur, c'est ce court-circuit. Partout ailleurs, le
// getSession() par requête l'aurait rattrapé — d'où « le second essai passe toujours »
// dans les logs : le composant re-déclenchait getSession(), qui entre-temps avait
// rafraîchi.
//
// Corollaire pour invokeEdge : un en-tête forgé neutraliserait AUSSI le rejeu ci-dessous,
// qui repartirait avec le même jeton mort. Passer un Authorization dans `options.headers`
// est donc un défaut, jamais une précaution.
import { supabase } from '@/lib/supabase'
import { endDeadSession, ensureFreshSession, forceRefreshSession } from '@/lib/session'

// Le générique est REPRIS TEL QUEL de supabase-js (T par défaut `any`) : les appelants
// lisent `data?.booking_id` sans annoter, exactement comme avant. Figer T à un objet vide
// aurait cassé chacun des vingt sites d'appel migrés.
type InvokeOptions = Parameters<typeof supabase.functions.invoke>[1]
type InvokeResult<T> = Awaited<ReturnType<typeof supabase.functions.invoke<T>>>

/**
 * Statut HTTP d'une erreur supabase-js, SANS consommer le corps.
 *
 * ⚠️ Ne jamais lire `context.json()` ici : la Response ne se lit qu'une fois, et le corps
 * appartient à l'appelant (c'est lui qui y trouve le code métier via extractErrorBody).
 * `status` est une propriété, pas un flux — la lire est sans effet de bord.
 */
function httpStatusOf(error: unknown): number | undefined {
  const ctx = (error as { context?: Response } | null)?.context
  return typeof ctx?.status === 'number' ? ctx.status : undefined
}

/**
 * Erreur synthétique portant un 401, dans la forme exacte qu'attendent les appelants —
 * `context` est une vraie Response dont `extractErrorBody` tirera `{ code: 'UNAUTHORIZED' }`.
 *
 * Construire cet objet plutôt que renvoyer l'erreur d'origine est délibéré : le 401 du
 * serveur peut porter n'importe quel corps (voire aucun). Ici, le message affiché est
 * décidé par nous — « ta session a expiré, reconnecte-toi » — et il est VRAI.
 */
function unauthorizedError(): Error {
  const err = new Error('SESSION_EXPIRED') as Error & { context: Response }
  err.context = new Response(
    JSON.stringify({ error: true, code: 'UNAUTHORIZED', message: 'Session expirée' }),
    { status: 401, headers: { 'Content-Type': 'application/json' } },
  )
  return err
}

/**
 * Appelle une Edge Function en survivant à un jeton périmé.
 *
 * Signature et retour IDENTIQUES à `supabase.functions.invoke` : les appelants existants
 * continuent de lire `{ data, error }` et de passer par `extractErrorBody` / `EdgeError`
 * pour le code métier. Rien à réapprendre — seul l'import change.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function invokeEdge<T = any>(
  name: string,
  options?: InvokeOptions,
): Promise<InvokeResult<T>> {
  // 1. Prévenir plutôt que guérir : un jeton qui expire dans moins d'une minute est
  //    renouvelé AVANT de partir. C'est ce qui évite la majorité des 401.
  await ensureFreshSession()

  const first = await supabase.functions.invoke<T>(name, options)
  if (!first.error || httpStatusOf(first.error) !== 401) return first

  // 2. 401 avéré → le serveur a tranché, l'échéance locale ne compte plus.
  const refreshed = await forceRefreshSession()
  if (!refreshed) {
    await endDeadSession()
    return { data: null, error: unauthorizedError() } as InvokeResult<T>
  }

  // 3. LE rejeu — le seul. Ce que le second essai réussissait par hasard dans les logs du
  //    12/08 devient un comportement voulu.
  const second = await supabase.functions.invoke<T>(name, options)
  if (second.error && httpStatusOf(second.error) === 401) {
    // Jeton neuf, refusé quand même : la session est bel et bien morte.
    await endDeadSession()
    return { data: null, error: unauthorizedError() } as InvokeResult<T>
  }

  return second
}
