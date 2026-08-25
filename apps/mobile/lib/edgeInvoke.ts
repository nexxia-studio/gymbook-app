// GYM-270 — LIRE LES ERREURS DES EDGE FUNCTIONS, ET CESSER DE POLLUER SENTRY.
//
// ═════════════════════════════════════════════════════════════════════════════════════
// LE DÉFAUT
// ═════════════════════════════════════════════════════════════════════════════════════
// `supabase.functions.invoke` lève un `FunctionsHttpError` dès que la réponse n'est pas
// 2xx, et son `error.message` vaut « Edge Function returned a non-2xx status code ». Or
// TOUS nos codes métier — PAYMENT_REQUIRED, SLOT_FULL, SUBSCRIPTION_PAST_DUE, PLAN_* —
// sont dans le CORPS de cette réponse, que supabase-js ne lit pas. Le corps est accessible
// via `error.context`, qui est une `Response` : il faut l'`await .json()` soi-même.
//
// Trois copies de cette lecture existaient déjà, écrites séparément :
//   · stores/useBookingStore.ts, dans createBooking ;
//   · stores/useBookingStore.ts, dans confirmWaitlist (même code, réécrit) ;
//   · lib/payments.ts, dans extractErrorCode.
// Elles ne traitaient pas les mêmes cas et ne remontaient pas les mêmes erreurs. C'est le
// motif que GYM-191 a payé côté serveur : un prédicat recopié finit par diverger.
//
// ═════════════════════════════════════════════════════════════════════════════════════
// 🔴 ET SURTOUT : SENTRY RECEVAIT DES REFUS NORMAUX
// ═════════════════════════════════════════════════════════════════════════════════════
// « Ce créneau est complet », « il te faut un crédit », « ton abonnement est déjà actif »
// sont des RÉPONSES DU PRODUIT, pas des défauts. Elles arrivaient dans Sentry au même
// titre qu'un crash, et noyaient ce qui méritait d'être vu. Un outil d'alerte qui alerte
// sur le fonctionnement normal cesse d'être lu — et c'est ce qu'on veut éviter à trois
// semaines de l'ouverture.
//
// LA RÈGLE, appliquée ici et nulle part ailleurs :
//   · 4xx AVEC un code métier connu  → refus attendu : JAMAIS envoyé.
//   · 4xx avec un code INCONNU        → envoyé (soit un code oublié de cette liste, soit
//                                       une réponse qu'on ne sait pas traiter : les deux
//                                       méritent un œil).
//   · 5xx, réseau, corps illisible    → envoyés.
//
// Le filtrage est fait DEUX FOIS, volontairement : ici (on n'appelle simplement pas
// `captureException`) et dans le `beforeSend` de `Sentry.init` (app/_layout.tsx), qui
// rattrape une `EdgeError` attendue arrivée par un autre chemin — un `throw` non rattrapé
// dans un composant, par exemple. La ceinture et la bretelle, comme pour le prédicat
// d'abonnement serveur.
import * as Sentry from '@sentry/react-native'
import { supabase } from './supabase'

/**
 * REFUS MÉTIER CONNUS — relevés dans supabase/functions/, pas inventés.
 *
 * ⚠️ CE QUI N'Y FIGURE PAS EST DÉLIBÉRÉ :
 *   · les échecs d'infrastructure (BOOKING_FAILED, DB_INSERT_FAILED, MOLLIE_ERROR,
 *     CONFIG_ERROR, INTERNAL_ERROR, PLAN_RESOLUTION_FAILED…) : ce sont des pannes, elles
 *     doivent alerter ;
 *   · les MISSING_* (paramètre absent) : le serveur les rend en 400, mais c'est L'APP qui
 *     a mal appelé. Un bug d'appel doit se voir, pas se taire.
 *
 * Ajouter un code ici, c'est décider qu'on ne veut plus en être averti. À faire seulement
 * quand le produit sait l'afficher au membre.
 */
const EXPECTED_EDGE_CODES: ReadonlySet<string> = new Set([
  // ── Réservation / liste d'attente ──
  'SUSPENDED', 'PAYMENT_REQUIRED', 'NO_CREDIT', 'MAX_BOOKINGS_REACHED',
  'BOOKING_LIMIT_REACHED', 'ALREADY_BOOKED', 'ALREADY_WAITLISTED', 'ALREADY_CANCELLED',
  'BOOKING_NOT_FOUND', 'NOT_WAITLISTED', 'WAITLIST_EXPIRED',
  'SLOT_NOT_FOUND', 'SLOT_CANCELLED', 'SLOT_PAST', 'SLOT_FULL', 'FULL',
  // ── Formules, paiements, abonnements ──
  'SUBSCRIPTION_ACTIVE', 'SUBSCRIPTION_ALREADY_ACTIVE', 'SUBSCRIPTION_PAST_DUE',
  'SUBSCRIPTION_ENGAGED',
  'PLAN_NOT_FOUND', 'PLAN_MISCONFIGURED', 'PLAN_ALREADY_USED',
  'PLAN_NOT_ONE_TIME', 'PLAN_NOT_RECURRING',
  'PLAN_PAYMENTS_DISABLED', 'PLAN_MEMBER_LIMIT', 'PLAN_ADMIN_LIMIT',
  // ── Facture ──
  'NOT_PAID', 'NO_EMAIL', 'NOT_FOUND',
  // ── Accès ──
  'UNAUTHORIZED', 'FORBIDDEN', 'WRONG_GYM', 'GYM_FORBIDDEN', 'MEMBER_MISMATCH',
  'PROFILE_NOT_FOUND',
])

/**
 * 🔴 GYM-276 — PANNE RÉSEAU : UN CODE À PART, ET SURTOUT UN MESSAGE.
 *
 * Défaut observé en test (Antoine, réseau coupé) : le bouton de réservation ne faisait
 * RIEN. Aucun message, aucun retour — le membre appuie, il ne se passe rien, il recommence.
 *
 * Ce n'est PAS un code renvoyé par une Edge Function : le serveur n'a jamais été atteint.
 * On le fabrique ici pour que les écrans aient quelque chose à afficher, plutôt que de
 * retomber dans le « erreur générique » muet.
 *
 * ⚠️ CLASSÉ ATTENDU, DONC JAMAIS ENVOYÉ À SENTRY. Une coupure réseau n'est pas un défaut
 * de l'app : c'est la doctrine de GYM-270, et GYM-240 avait déjà tranché ce point
 * (« rejets réseau capturés au lieu d'alerter Sentry pour rien »). Le tunnel du métro de
 * chaque membre n'a pas à réveiller qui que ce soit.
 */
export const NETWORK_OFFLINE_CODE = 'NETWORK_OFFLINE'

/**
 * L'appel a-t-il échoué AVANT d'atteindre le serveur ?
 *
 * Trois signaux, parce qu'ils ne viennent pas de la même couche :
 *  · `FunctionsFetchError` — la classe que supabase-js construit quand le fetch échoue
 *    (« Failed to send a request to the Edge Function ») ; c'est le cas nominal ;
 *  · `TypeError` — ce que lève `fetch` lui-même sur un réseau injoignable, si l'erreur
 *    remonte sans être enveloppée ;
 *  · absence de `context` exploitable — pas de réponse du tout, donc pas de statut.
 */
function isNetworkFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = (error as { name?: string }).name
  if (name === 'FunctionsFetchError' || name === 'FunctionsRelayError') return true
  if (error instanceof TypeError) return true
  const ctx = (error as { context?: unknown }).context
  return !(ctx && typeof (ctx as Response).json === 'function')
}

/** Erreur d'appel à une Edge Function, avec ce qu'il faut pour AFFICHER quelque chose. */
export class EdgeError extends Error {
  /** Nom de la fonction appelée — sert de tag Sentry et de contexte de log. */
  readonly fn: string
  /** Statut HTTP. 0 = pas de réponse (réseau, timeout). */
  readonly status: number
  /** Code métier lu dans le corps, ou '' si le corps n'en portait pas. */
  readonly code: string
  /** Refus attendu du produit → ne doit PAS remonter dans Sentry. */
  readonly expected: boolean
  /** Corps JSON complet, quand il y en avait un : certains codes portent des champs
   *  supplémentaires (`limit` de MAX_BOOKINGS_REACHED, `suspended_until` de SUSPENDED). */
  readonly body: Record<string, unknown> | null

  constructor(params: {
    fn: string
    status: number
    code: string
    message: string
    expected: boolean
    body: Record<string, unknown> | null
  }) {
    super(params.message)
    this.name = 'EdgeError'
    this.fn = params.fn
    this.status = params.status
    this.code = params.code
    this.expected = params.expected
    this.body = params.body
  }
}

/** Vrai si l'erreur est un refus métier attendu — lu par le `beforeSend` de Sentry. */
export function isExpectedEdgeError(e: unknown): boolean {
  return e instanceof EdgeError && e.expected
}

/**
 * Lit le corps de la réponse portée par `FunctionsHttpError`.
 *
 * ⚠️ `error.context` est une `Response` dont le flux n'est lisible QU'UNE FOIS. Le lire
 * ici, à un seul endroit, évite le « body already consumed » que produisaient deux
 * lectures successives dans le code appelant.
 *
 * Le corps peut ne pas être du JSON (page d'erreur de la passerelle, corps vide sur un
 * 502) : on rend alors `null` plutôt que de laisser l'exception remplacer l'erreur réelle
 * par une erreur de parsing, qui ne dirait rien de ce qui s'est passé.
 */
async function readErrorBody(error: unknown): Promise<{
  body: Record<string, unknown> | null
  status: number
}> {
  const ctx = (error as { context?: Response } | null)?.context
  if (!ctx || typeof ctx.json !== 'function') return { body: null, status: 0 }

  const status = typeof ctx.status === 'number' ? ctx.status : 0
  try {
    const parsed = await ctx.json()
    return {
      body: parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null,
      status,
    }
  } catch {
    return { body: null, status }
  }
}

async function toEdgeError(fn: string, error: unknown): Promise<EdgeError> {
  // GYM-276 — testé EN PREMIER : sans réponse, il n'y a ni statut ni corps à interpréter,
  // et la règle « 4xx + code connu » ne peut pas s'appliquer.
  if (isNetworkFailure(error)) {
    return new EdgeError({
      fn,
      status: 0,
      code: NETWORK_OFFLINE_CODE,
      message: error instanceof Error ? error.message : 'network unreachable',
      expected: true,
      body: null,
    })
  }

  const { body, status } = await readErrorBody(error)
  const code = typeof body?.code === 'string' ? body.code : ''
  const serverMessage = typeof body?.message === 'string' ? body.message : ''
  const fallback = error instanceof Error ? error.message : 'Edge function failed'

  // La règle du ticket, écrite telle quelle : 4xx + code connu = attendu. Tout le reste
  // part. Un 5xx portant par hasard un code connu reste une panne : le test de statut
  // vient EN PREMIER.
  const expected = status >= 400 && status < 500 && EXPECTED_EDGE_CODES.has(code)

  return new EdgeError({
    fn,
    status,
    code,
    message: serverMessage || fallback,
    expected,
    body,
  })
}

/**
 * Envoi Sentry des seules erreurs qui méritent un œil.
 *
 * ⚠️ LE TITRE PORTE LA FONCTION ET LE CODE. Sans ça, Sentry regroupe tout sous
 * « Edge Function returned a non-2xx status code » : un seul et même « problème » pour
 * douze causes différentes, impossible à trier. Les tags `edge_function` / `edge_code`
 * permettent en plus de filtrer et d'alerter par fonction.
 */
function reportEdgeError(err: EdgeError): void {
  if (err.expected) return
  try {
    Sentry.withScope((scope) => {
      scope.setTag('edge_function', err.fn)
      scope.setTag('edge_code', err.code || 'none')
      scope.setTag('edge_status', String(err.status))
      scope.setContext('edge', {
        fn: err.fn,
        status: err.status,
        code: err.code,
        body: err.body,
      })
      scope.setFingerprint(['edge', err.fn, err.code || String(err.status)])
      Sentry.captureException(err)
    })
  } catch {
    /* monitoring best-effort : une panne du monitoring ne casse aucun flux */
  }
}

/**
 * Appelle une Edge Function. Rend les données, ou LÈVE une `EdgeError` typée.
 *
 * ⚠️ Le repli « erreur métier rendue en 200 » est conservé : plusieurs fonctions du dépôt
 * rendent `{ error: true, code }` avec un statut 200 sur certains chemins. Ne tester que
 * le statut HTTP laisserait ces refus passer pour des succès — c'est le cas que
 * useBookingStore traitait déjà à la main, et qu'on ne perd pas en factorisant.
 */
export async function edgeInvoke<T = Record<string, unknown>>(
  fn: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, body ? { body } : undefined)

  if (error) {
    const edgeError = await toEdgeError(fn, error)
    reportEdgeError(edgeError)
    throw edgeError
  }

  const payload = (data ?? null) as Record<string, unknown> | null
  if (payload?.error === true) {
    const code = typeof payload.code === 'string' ? payload.code : ''
    const edgeError = new EdgeError({
      fn,
      // 200 côté transport, mais refus côté métier : on le classe en 400 pour que la
      // règle de filtrage soit la MÊME que pour un vrai 4xx. Un code connu = attendu.
      status: 400,
      code,
      message: typeof payload.message === 'string' ? payload.message : code || 'Edge function error',
      expected: EXPECTED_EDGE_CODES.has(code),
      body: payload,
    })
    reportEdgeError(edgeError)
    throw edgeError
  }

  return (data ?? null) as T
}

export type EdgeResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: EdgeError }

/**
 * Variante NON LEVANTE, pour les appelants qui traduisent un code en état d'écran plutôt
 * qu'en exception (les stores, essentiellement). Même implémentation, même filtrage
 * Sentry : il n'y a qu'UNE logique, deux formes d'appel.
 */
export async function tryEdgeInvoke<T = Record<string, unknown>>(
  fn: string,
  body?: Record<string, unknown>,
): Promise<EdgeResult<T>> {
  try {
    return { ok: true, data: await edgeInvoke<T>(fn, body) }
  } catch (e) {
    if (e instanceof EdgeError) return { ok: false, error: e }
    // GYM-276 — une exception qui remonte jusqu'ici sans être une EdgeError, c'est le
    // fetch lui-même qui a échoué : réseau, DNS, timeout. Même traitement que dans
    // `toEdgeError` — code NETWORK_OFFLINE, `expected: true`, donc AUCUN envoi Sentry.
    // (La version GYM-270 posait `expected: false` et alertait : corrigé ici, c'est le
    // bruit que GYM-240 avait déjà refusé.)
    const netError = new EdgeError({
      fn,
      status: 0,
      code: NETWORK_OFFLINE_CODE,
      message: e instanceof Error ? e.message : 'network error',
      expected: true,
      body: null,
    })
    reportEdgeError(netError)
    return { ok: false, error: netError }
  }
}
