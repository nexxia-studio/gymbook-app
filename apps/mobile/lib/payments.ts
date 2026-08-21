// GYM-76 — Couche d'achat partagée (one-time + récurrent), pilotée par gym_plans.
// Contrats backend v24 (déployés) :
//  - create-payment      : body { gym_id, plan_id (UUID), redirect_url } → { success, payment_id, checkout_url }
//  - create-subscription : body { gym_id, member_id, plan_id (UUID), redirect_url } → { success, payment_id, customer_id, checkout_url }
import * as WebBrowser from 'expo-web-browser'
import { supabase } from './supabase'
import i18n from './i18n'
import { captureEvent } from './analytics'

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

/** Lit le `code` d'erreur d'une réponse Edge Function (corps JSON dans error.context). */
async function extractErrorCode(
  data: { code?: string } | null,
  error: unknown,
): Promise<string | undefined> {
  const ctx = (error as { context?: Response } | null)?.context
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.json()
      if (body?.code) return body.code as string
    } catch {
      /* corps non-JSON */
    }
  }
  return data?.code
}

async function invokeCheckout(fn: string, body: Record<string, unknown>): Promise<CheckoutResult> {
  try {
    const { data, error } = await supabase.functions.invoke(fn, { body })
    if (!error && data?.success && data?.checkout_url) {
      // payment_initiated — chokepoint unique des 2 flux (create-payment / create-subscription),
      // émis à l'obtention du checkout Mollie (achat effectivement lancé).
      captureEvent('payment_initiated', { kind: fn })
      return { ok: true, checkoutUrl: data.checkout_url as string, paymentId: data.payment_id }
    }
    return { ok: false, code: await extractErrorCode(data, error) }
  } catch {
    return { ok: false }
  }
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
