// GYM-76 — Couche d'achat partagée (one-time + récurrent), pilotée par gym_plans.
// Contrats backend v24 (déployés) :
//  - create-payment      : body { gym_id, plan_id (UUID), redirect_url } → { success, payment_id, checkout_url }
//  - create-subscription : body { gym_id, member_id, plan_id (UUID), redirect_url } → { success, payment_id, customer_id, checkout_url }
import * as WebBrowser from 'expo-web-browser'
import i18n from './i18n'
import { captureEvent } from './analytics'
import { tryEdgeInvoke } from './edgeInvoke'

// GYM-89 — Les paiements MEMBRES (one-time + abonnement) reviennent sur la page membre
// dédiée, et NON sur /mollie/callback (réservé au flux OAuth gérant).
//
// GYM-207 — L'URL n'est plus en dur (elle pointait sur l'ancien domaine
// gymbook-app.vercel.app) : elle est construite depuis le slug de la salle, et vise
// désormais un Universal Link links.viniz.app/{slug}/payment-success. Voir lib/gymUrls.ts
// pour le pourquoi du https plutôt que du schéma `dopamine://`.
export { buildPaymentReturnUrl as buildRedirectUrl } from './gymUrls'
import { buildPaymentReturnUrl } from './gymUrls'

/** Formate un montant (en CENTIMES) selon la devise. Fallback robuste si Intl indisponible. */
export function formatPrice(priceCents: number, currency = 'EUR'): string {
  const value = (priceCents ?? 0) / 100
  try {
    return new Intl.NumberFormat(i18n.language || 'fr', { style: 'currency', currency }).format(value)
  } catch {
    return `${value.toFixed(2)} ${currency}`
  }
}

export interface PaymentErrorInfo {
  /** Clé i18n du message à afficher. */
  messageKey: string
  /** L'action est réessayable (erreur transitoire côté prestataire). */
  retryable: boolean
  /** La liste des plans doit être rafraîchie (plan introuvable). */
  refetch: boolean
}

/** Mappe un code d'erreur backend → message FR/i18n. Centralisé pour les 2 surfaces. */
export function mapPaymentError(code?: string): PaymentErrorInfo {
  switch (code) {
    case 'MISSING_GYM_ID':
    case 'MISSING_PLAN_ID':
    case 'MISSING_REDIRECT_URL':
    case 'MISSING_MEMBER_ID':
      return { messageKey: 'payments.errors.MISSING_FIELDS', retryable: false, refetch: false }
    case 'UNAUTHORIZED':
      return { messageKey: 'payments.errors.UNAUTHORIZED', retryable: false, refetch: false }
    case 'PROFILE_NOT_FOUND':
      return { messageKey: 'payments.errors.PROFILE_NOT_FOUND', retryable: false, refetch: false }
    case 'GYM_FORBIDDEN':
      return { messageKey: 'payments.errors.GYM_FORBIDDEN', retryable: false, refetch: false }
    case 'PLAN_NOT_FOUND':
      return { messageKey: 'payments.errors.PLAN_NOT_FOUND', retryable: false, refetch: true }
    // GYM-246 — la garde serveur renvoie désormais PLAN_PAYMENTS_DISABLED (résolu par
    // get_effective_plan, overrides par salle compris). PAYMENTS_DISABLED est conservé :
    // les builds mobiles DÉJÀ EN CIRCULATION n'envoient rien, mais un backend antérieur
    // peut encore le renvoyer le temps du déploiement. Même message pour les deux.
    case 'PAYMENTS_DISABLED':
    case 'PLAN_PAYMENTS_DISABLED':
      return { messageKey: 'payments.errors.PAYMENTS_DISABLED', retryable: false, refetch: false }
    // GYM-246 — le plan n'a pas pu être résolu : c'est une PANNE, pas un refus de droit.
    // retryable, et surtout PAS le message « pas activé pour cette salle », qui ferait
    // lire une indisponibilité passagère comme une rétrogradation d'abonnement.
    case 'PLAN_RESOLUTION_FAILED':
      return { messageKey: 'payments.errors.PLAN_RESOLUTION_FAILED', retryable: true, refetch: false }
    case 'PLAN_MISCONFIGURED':
      return { messageKey: 'payments.errors.PLAN_MISCONFIGURED', retryable: false, refetch: false }
    case 'MOLLIE_TOKEN_EXPIRED':
      return { messageKey: 'payments.errors.MOLLIE_TOKEN_EXPIRED', retryable: true, refetch: false }
    case 'MOLLIE_ERROR':
    case 'MOLLIE_NO_CHECKOUT':
      return { messageKey: 'payments.errors.MOLLIE_ERROR', retryable: true, refetch: false }
    // One-time uniquement
    case 'PLAN_NOT_ONE_TIME':
      return { messageKey: 'payments.errors.PLAN_NOT_ONE_TIME', retryable: false, refetch: false }
    // Récurrent uniquement
    case 'MEMBER_MISMATCH':
      return { messageKey: 'payments.errors.MEMBER_MISMATCH', retryable: false, refetch: false }
    case 'PLAN_NOT_RECURRING':
      return { messageKey: 'payments.errors.PLAN_NOT_RECURRING', retryable: false, refetch: false }
    case 'MOLLIE_CUSTOMER_ERROR':
      return { messageKey: 'payments.errors.MOLLIE_CUSTOMER_ERROR', retryable: true, refetch: false }
    // GYM-94 — abonnement actif : crédits one_time inutiles / 2e abonnement refusé.
    case 'SUBSCRIPTION_ACTIVE':
      return { messageKey: 'payments.errors.SUBSCRIPTION_ACTIVE', retryable: false, refetch: true }
    case 'SUBSCRIPTION_ALREADY_ACTIVE':
      return { messageKey: 'payments.errors.SUBSCRIPTION_ALREADY_ACTIVE', retryable: false, refetch: true }
    // GYM-252 (reste-à-faire UI) — l'abonnement existe mais son prélèvement a échoué
    // (past_due) ou il est suspendu pour impayé. Le serveur refuse d'en ouvrir un second :
    // le premier est toujours vivant chez Mollie, qui le représente jusqu'à cinq fois, et
    // souscrire à côté produirait DEUX mandats SEPA.
    //
    // ⚠️ `retryable: false` — réessayer ne changera rien tant que le prélèvement n'a pas
    // abouti, et proposer « Réessayer » ferait croire à un incident technique.
    // `refetch: true` : la régularisation est automatique au webhook `paid`, donc relire
    // l'état de l'abonnement est exactement ce qu'il y a d'utile à faire.
    case 'SUBSCRIPTION_PAST_DUE':
      return { messageKey: 'payments.errors.SUBSCRIPTION_PAST_DUE', retryable: false, refetch: true }
    // GYM-243 — les DEUX flux (create-payment, create-subscription) refusent de rendre
    // l'URL de checkout quand la ligne payments n'a pas pu être écrite : sans elle, le
    // webhook ne retrouve pas la salle et l'euro encaissé ne délivre rien. Rien n'a été
    // débité, l'action est donc réessayable. Sans ce cas le refus tombait dans FALLBACK
    // (« une erreur est survenue »), qui ne dit pas que le paiement N'A PAS eu lieu.
    case 'DB_INSERT_FAILED':
      return { messageKey: 'payments.errors.DB_INSERT_FAILED', retryable: true, refetch: false }
    default:
      return { messageKey: 'payments.errors.FALLBACK', retryable: true, refetch: false }
  }
}

export type CheckoutResult =
  | { ok: true; checkoutUrl: string; paymentId?: string }
  | { ok: false; code?: string }

// GYM-270 — `extractErrorCode` a été SUPPRIMÉE : c'était la troisième copie de la lecture
// de `error.context` dans le dépôt mobile (les deux autres vivaient dans useBookingStore).
// La lecture est désormais dans `lib/edgeInvoke.ts`, avec le filtrage Sentry qui va avec —
// ces refus-ci (SUBSCRIPTION_ACTIVE, PLAN_ALREADY_USED, PLAN_PAYMENTS_DISABLED…) sont des
// réponses normales du produit et n'ont plus à alerter qui que ce soit.
async function invokeCheckout(fn: string, body: Record<string, unknown>): Promise<CheckoutResult> {
  const res = await tryEdgeInvoke<{
    success?: boolean
    checkout_url?: string
    payment_id?: string
  }>(fn, body)

  if (res.ok && res.data?.success && res.data?.checkout_url) {
    // payment_initiated — chokepoint unique des 2 flux (create-payment / create-subscription),
    // émis à l'obtention du checkout Mollie (achat effectivement lancé).
    captureEvent('payment_initiated', { kind: fn })
    return { ok: true, checkoutUrl: res.data.checkout_url, paymentId: res.data.payment_id }
  }

  // ⚠️ Une réponse 200 SANS checkout_url reste un échec — c'était déjà le cas avant, et le
  // rester est important : Mollie a pu refuser sans que la fonction rende un 4xx. Sans
  // code, l'écran retombe sur son message générique, comme auparavant.
  return { ok: false, code: res.ok ? undefined : res.error.code || undefined }
}

/** Achat à l'unité (one-time) → create-payment v24. */
export async function startOneTimeCheckout(
  planId: string,
  opts: { gymId: string; redirectUrl?: string },
): Promise<CheckoutResult> {
  return invokeCheckout('create-payment', {
    gym_id: opts.gymId,
    plan_id: planId,
    redirect_url: opts.redirectUrl ?? await buildPaymentReturnUrl('one_time'),
  })
}

/** Abonnement récurrent → create-subscription v24 (member_id = utilisateur courant). */
export async function startSubscriptionCheckout(
  planId: string,
  opts: { gymId: string; memberId: string; redirectUrl?: string },
): Promise<CheckoutResult> {
  return invokeCheckout('create-subscription', {
    gym_id: opts.gymId,
    member_id: opts.memberId,
    plan_id: planId,
    redirect_url: opts.redirectUrl ?? await buildPaymentReturnUrl('subscription'),
  })
}

/** Ouvre l'URL de checkout Mollie — mécanisme unique partout. */
export async function openCheckout(url: string): Promise<void> {
  await WebBrowser.openBrowserAsync(url)
}
