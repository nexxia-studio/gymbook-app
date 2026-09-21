// GYM-76 — Couche d'achat partagée (one-time + récurrent), pilotée par gym_plans.
// Contrats backend v24 (déployés) :
//  - create-payment      : body { gym_id, plan_id (UUID), redirect_url } → { success, payment_id, checkout_url }
//  - create-subscription : body { gym_id, member_id, plan_id (UUID), redirect_url } → { success, payment_id, customer_id, checkout_url }
//
// GYM-336 — les deux bodies portent en plus `early_performance_consent` (booléen) et
// `early_performance_consent_version`. LE CLIENT N'ENVOIE QU'UNE INTENTION : c'est le
// serveur qui date la demande et l'écrit dans `payments`. Voir
// supabase/functions/_shared/early-performance.ts.
import * as WebBrowser from 'expo-web-browser'
import { Platform } from 'react-native'
// GYM-352 — un navigateur qui ne s'ouvre pas est une panne : elle doit alerter, au même
// titre que les échecs d'infrastructure de GYM-270. Ce n'est pas un refus métier.
import * as Sentry from '@sentry/react-native'
import i18n from './i18n'
import { captureEvent } from './analytics'
import { tryEdgeInvoke } from './edgeInvoke'
import { EARLY_PERFORMANCE_CONSENT_VERSION } from '../constants/earlyPerformance'

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
    // ══════════════════════════════════════════════════════════════════════════════════
    // GYM-346 — LE REFUS N'EST PLUS CONFONDU AVEC L'INCERTITUDE
    // ══════════════════════════════════════════════════════════════════════════════════
    // Jusqu'ici, TOUT échec Mollie rendait MOLLIE_ERROR « réessaie ». Or un 422 de Mollie
    // est DÉFINITIF : la même requête à l'identique sera refusée à l'identique. Proposer
    // « Réessayer » a fait retenter trois fois une requête vouée à échouer (14/09).
    //
    // Le serveur classe désormais sur le STATUT rendu par Mollie, et n'envoie plus jamais
    // son détail — il peut porter des informations de compte, et il transitait par
    // l'appareil du membre avant de remonter dans Sentry.
    //
    // ⚠️ MOLLIE_ERROR reste au-dessus, inchangé : les binaires DÉJÀ EN CIRCULATION
    // parlent à un backend qui le renvoie encore, et le renverra jusqu'au déploiement.
    //
    // ⚠️ AUCUN de ces codes n'est ajouté à EXPECTED_EDGE_CODES (lib/edgeInvoke.ts) : ce
    // sont des pannes ou des défauts de configuration, ils DOIVENT alerter Sentry. C'est
    // l'absence d'alerte qui a coûté deux semaines sur GYM-259.

    // La salle n'a jamais connecté Mollie, ou sa connexion n'est plus active. Le membre
    // n'y peut rien et réessayer ne répare rien : c'est au gérant d'agir. C'est la cause
    // exacte de GYM-259, jusqu'ici indistinguable d'une panne passagère.
    case 'MOLLIE_NOT_CONNECTED':
      return { messageKey: 'payments.errors.MOLLIE_NOT_CONNECTED', retryable: false, refetch: false }
    // Le jeton existe mais Mollie le refuse (401/403), ou il n'est plus rafraîchissable.
    // Le gérant doit refaire la connexion.
    case 'MOLLIE_TOKEN_REJECTED':
      return { messageKey: 'payments.errors.MOLLIE_TOKEN_REJECTED', retryable: false, refetch: false }
    // Aucun moyen de paiement disponible pour cette salle — configuration Mollie.
    case 'MOLLIE_METHOD_UNAVAILABLE':
      return { messageKey: 'payments.errors.MOLLIE_METHOD_UNAVAILABLE', retryable: false, refetch: false }
    // Refus métier définitif (422). Réessayer à l'identique redonnera le même refus.
    case 'MOLLIE_REFUSED':
      return { messageKey: 'payments.errors.MOLLIE_REFUSED', retryable: false, refetch: false }
    // Panne ou injoignabilité du prestataire (5xx, 429, timeout, réseau) — INCERTAIN,
    // rien n'a été débité, la nouvelle tentative a du sens.
    case 'MOLLIE_UNAVAILABLE':
      return { messageKey: 'payments.errors.MOLLIE_UNAVAILABLE', retryable: true, refetch: false }
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

/**
 * GYM-336 — Traduit la décision du membre en paramètres de body.
 *
 * ⚠️ LE FLAG EST TOUJOURS ENVOYÉ, `false` COMPRIS. Un `false` explicite dit « cette app
 * sait poser la question, et le membre n'a pas demandé » ; l'ABSENCE du champ dit « cette
 * app ne sait pas encore poser la question ». Le serveur enregistre NULL dans les deux cas
 * — la situation juridique est identique — mais la distinction reste lisible dans les
 * journaux et dans l'événement `payment_initiated`, ce qui permet de suivre l'extinction
 * des binaires anciens sans rien ajouter au schéma.
 *
 * ⚠️ LA VERSION N'ACCOMPAGNE QUE LE `true`. Certifier un libellé que le membre n'a pas
 * accepté n'aurait aucun sens.
 */
function consentBody(requested: boolean): Record<string, unknown> {
  return requested
    ? {
        early_performance_consent: true,
        early_performance_consent_version: EARLY_PERFORMANCE_CONSENT_VERSION,
      }
    : { early_performance_consent: false }
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
    // GYM-336 — le flag rejoint l'événement : il n'y a AUCUNE colonne à interroger pour
    // savoir combien d'achats partent encore sans demande expresse, et cette question se
    // posera tant que des binaires anciens circuleront.
    captureEvent('payment_initiated', {
      kind: fn,
      early_performance: body.early_performance_consent === true,
    })
    return { ok: true, checkoutUrl: res.data.checkout_url, paymentId: res.data.payment_id }
  }

  // ⚠️ Une réponse 200 SANS checkout_url reste un échec — c'était déjà le cas avant, et le
  // rester est important : Mollie a pu refuser sans que la fonction rende un 4xx. Sans
  // code, l'écran retombe sur son message générique, comme auparavant.
  //
  // 🔴 GYM-352 — DEUXIÈME RETOUR NON LU DE CE FICHIER. Ce cas-ci ne journalisait RIEN : un
  // 200 sans `checkout_url` perdait toute la réponse en silence, et `mapPaymentError(undefined)`
  // affichait « une erreur est survenue, réessaie ». Même motif que `openCheckout` ci-dessous.
  // Le comportement est INCHANGÉ — seule la trace est ajoutée.
  if (res.ok) {
    console.error(`[invokeCheckout] ${fn} : 200 SANS checkout_url`
      + ` success=${String(res.data?.success)} payment_id=${String(res.data?.payment_id ?? '(none)')}`)
  }
  return { ok: false, code: res.ok ? undefined : res.error.code || undefined }
}

/** Achat à l'unité (one-time) → create-payment v24. */
export async function startOneTimeCheckout(
  planId: string,
  opts: { gymId: string; redirectUrl?: string; earlyPerformanceConsent: boolean },
): Promise<CheckoutResult> {
  return invokeCheckout('create-payment', {
    gym_id: opts.gymId,
    plan_id: planId,
    redirect_url: opts.redirectUrl ?? await buildPaymentReturnUrl('one_time'),
    ...consentBody(opts.earlyPerformanceConsent),
  })
}

/** Abonnement récurrent → create-subscription v24 (member_id = utilisateur courant). */
export async function startSubscriptionCheckout(
  planId: string,
  opts: { gymId: string; memberId: string; redirectUrl?: string; earlyPerformanceConsent: boolean },
): Promise<CheckoutResult> {
  return invokeCheckout('create-subscription', {
    gym_id: opts.gymId,
    member_id: opts.memberId,
    plan_id: planId,
    redirect_url: opts.redirectUrl ?? await buildPaymentReturnUrl('subscription'),
    ...consentBody(opts.earlyPerformanceConsent),
  })
}

// ╔═══════════════════════════════════════════════════════════════════════════════════════╗
// ║  GYM-352 — openCheckout DIT enfin ce qui s'est passé                                  ║
// ╚═══════════════════════════════════════════════════════════════════════════════════════╝
//
// LE DÉFAUT. Cette fonction était `Promise<void>` et JETAIT le résultat de
// `openBrowserAsync`. L'app était donc structurellement incapable de savoir si le
// navigateur s'était affiché. Constaté en recette le 17/09, DEUX FOIS, par deux chemins
// différents (profile/subscription.tsx à 15h34, PaymentRequiredSheet à 16h03) : paiement
// créé chez Mollie, `checkout_url` valide, écran « Vérification… » affiché — et la page de
// paiement jamais ouverte. Aucune exception, aucun événement Sentry : rien à lire.
//
// ⚠️ QUATRIÈME CAS DE LA SEMAINE DU MÊME MOTIF : un `catch` qui avale (GYM-337), un
// `update` qu'on ne lit pas (GYM-337), un `tsc` qui ne vérifie rien (GYM-350), un résultat
// qu'on jette (ici). Le motif n'est pas l'erreur : c'est le RETOUR NON LU.
//
// ⚠️ CE LOT NE CORRIGE PAS LA CAUSE — il la rend mesurable. La piste retenue (présenter le
// navigateur pendant une transition de navigation) ne doit pas être « corrigée » avant
// d'être mesurée : l'écran de vérification est monté AVANT le navigateur délibérément
// (GYM-96), pour que le poll démarre quel que soit le mode de retour.

/** Ce que `openBrowserAsync` a réellement fait. */
export interface CheckoutOpenOutcome {
  /**
   * INFÉRÉ, pas rapporté — voir `PRESENTATION_FLOOR_MS`. Les champs bruts ci-dessous
   * restent la mesure ; celui-ci n'est qu'une lecture commode pour l'appelant.
   */
  presented: boolean
  /**
   * Brut, tel que le module le rend : 'opened' | 'cancel' | 'dismiss' | 'locked' | 'threw'.
   *
   * ⚠️ 'locked' N'EST PAS DANS LES TYPES PUBLICS d'expo-web-browser — il est dans le code
   * natif (ios/WebBrowserModule.swift). Voir `LOCKED` ci-dessous : c'est le cas le plus
   * probable des deux échecs du 17/09.
   */
  type: string
  /** Brut : millisecondes écoulées. LE signal discriminant sur iOS. */
  elapsedMs: number
  detail?: string
}

/**
 * 🔴 POURQUOI LE DÉLAI, ET PAS SEULEMENT LE TYPE.
 *
 * Les deux plateformes ne résolvent PAS au même moment :
 *   · Android — `openBrowserAsync` résout AUSSITÔT, avec `type: 'opened'`.
 *   · iOS     — elle résout à la FERMETURE du navigateur, avec 'cancel' (le membre l'a
 *               fermé) ou 'dismiss' (fermeture programmatique).
 *
 * Sur iOS, un 'cancel' est donc NORMAL après un vrai affichage. Ce qui ne l'est pas, c'est
 * un 'cancel' rendu instantanément : personne ne peut ouvrir et fermer une page en moins
 * d'une demi-seconde — l'animation de présentation dure à elle seule ~300 ms. Une
 * résolution immédiate signifie que la présentation n'a pas eu lieu.
 *
 * ⚠️ SEUIL HEURISTIQUE, ASSUMÉ COMME TEL. C'est pourquoi `type` et `elapsedMs` sont
 * journalisés BRUTS et rendus à l'appelant : si le seuil se révèle mal placé, la mesure
 * reste lisible et le diagnostic ne dépend pas de lui.
 */
const PRESENTATION_FLOOR_MS = 400

/**
 * 🔴 'locked' — LE CAS QUE LA SIGNATURE TYPESCRIPT NE DIT PAS, ET QUI EXPLIQUE UN ÉCHEC
 * DÉFINITIF.
 *
 * Dans `expo-web-browser/ios/WebBrowserModule.swift` :
 *
 *     if vcDidPresent { currentWebBrowserSession = nil; vcDidPresent = false }
 *     guard currentWebBrowserSession == nil else {
 *       promise.resolve(["type": "locked"])   // résout AUSSITÔT, sans rien présenter
 *       return
 *     }
 *
 * `vcDidPresent` n'est posé que dans le complétion de `present(...)`, et la session n'est
 * remise à nil que là ou à la fermeture du navigateur. Si une présentation n'aboutit
 * JAMAIS — `WebBrowserSession.open()` fait `currentViewController?.present(...)`, et ce
 * `?` avale silencieusement le cas où `UIApplication.shared.keyWindow` est nil — alors :
 *
 *   · `didPresent` ne part jamais → `vcDidPresent` reste false ;
 *   · le rappel de session ne part jamais → `currentWebBrowserSession` reste non nul ;
 *   · TOUS les appels suivants rendent 'locked', instantanément, jusqu'au redémarrage.
 *
 * C'est la seule hypothèse qui explique que DEUX chemins différents, à 29 minutes
 * d'intervalle, échouent à l'identique sans lever quoi que ce soit.
 *
 * ⚠️ NON CORRIGÉ DANS CE LOT, DÉLIBÉRÉMENT. `WebBrowser.dismissBrowser()` déverrouillerait
 * la session bloquée (`dismiss` sur un contrôleur non présenté appelle quand même son
 * complétion, donc `finish` et la remise à nil). Mais c'est une correction fondée sur une
 * lecture de code, pas sur une mesure : le journal ci-dessous dira 'locked' ou autre chose
 * dès le prochain essai, et c'est cette mesure qui doit décider.
 */
const LOCKED = 'locked'

/**
 * Ouvre l'URL de checkout Mollie — mécanisme unique partout.
 *
 * Ne lève JAMAIS : un échec d'ouverture est une information à rendre, pas une exception à
 * propager. Les appelants l'affichaient jusqu'ici comme une erreur générique, ou pas du tout.
 */
export async function openCheckout(url: string): Promise<CheckoutOpenOutcome> {
  const startedAt = Date.now()
  try {
    const res = await WebBrowser.openBrowserAsync(url)
    const elapsedMs = Date.now() - startedAt
    const type = String(res?.type ?? 'unknown')
    // 'locked' est un échec CERTAIN, pas une inférence : le module dit lui-même qu'il n'a
    // rien présenté. Il court-circuite donc l'heuristique de délai.
    const presented = type !== LOCKED && (type === 'opened' || elapsedMs >= PRESENTATION_FLOOR_MS)
    // 🔴 LA LIGNE QUI MANQUAIT. Un seul console.log, avec les valeurs BRUTES.
    console.log(`[openCheckout] platform=${Platform.OS} type=${type} elapsedMs=${elapsedMs} presented=${presented}`)
    if (!presented) {
      // Le navigateur ne s'est pas affiché : c'est une panne, elle doit alerter. Ce n'est
      // PAS un refus métier — le membre n'a rien refusé, il n'a rien pu voir.
      Sentry.captureException(new Error(
        type === LOCKED
          // Message distinct : 'locked' veut dire que le module est bloqué sur une session
          // fantôme et le restera jusqu'au redémarrage — ce n'est pas un échec ponctuel.
          ? `openCheckout: module VERROUILLÉ sur une session fantôme (platform=${Platform.OS} elapsedMs=${elapsedMs}) — tous les achats échoueront jusqu'au redémarrage`
          : `openCheckout: navigateur non présenté (platform=${Platform.OS} type=${type} elapsedMs=${elapsedMs})`,
      ))
    }
    return { presented, type, elapsedMs }
  } catch (e) {
    const elapsedMs = Date.now() - startedAt
    const detail = e instanceof Error ? e.message : String(e)
    console.error(`[openCheckout] platform=${Platform.OS} type=threw elapsedMs=${elapsedMs} detail=${detail}`)
    Sentry.captureException(e)
    return { presented: false, type: 'threw', elapsedMs, detail }
  }
}
