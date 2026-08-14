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
