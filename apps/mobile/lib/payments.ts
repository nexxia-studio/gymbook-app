// GYM-76 — Couche d'achat partagée (one-time + récurrent), pilotée par gym_plans.
// Contrats backend v24 (déployés) :
//  - create-payment      : body { gym_id, plan_id (UUID), redirect_url } → { success, payment_id, checkout_url }
//  - create-subscription : body { gym_id, member_id, plan_id (UUID), redirect_url } → { success, payment_id, customer_id, checkout_url }
//
// GYM-336 — les deux bodies portent en plus `early_performance_consent` (booléen) et
// `early_performance_consent_version`. LE CLIENT N'ENVOIE QU'UNE INTENTION : c'est le
// serveur qui date la demande et l'écrit dans `payments`. Voir
// supabase/functions/_shared/early-performance.ts.
import * as Linking from 'expo-linking'
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
// ║  🔴 GYM-369 — LE CHECKOUT S'OUVRE DANS LE NAVIGATEUR DU SYSTÈME, PAS DANS UNE VUE    ║
// ╚═══════════════════════════════════════════════════════════════════════════════════════╝
//
// CE QUE MOLLIE PRESCRIT, ET QUI TRANCHE TROIS SEMAINES D'HYPOTHÈSES
// (docs.mollie.com/docs/accepting-payments-in-your-app, étape 3) :
//
//   « Do this in the native browser of the device and NOT in an in-app browser view,
//     since the operating systems will reject opening the bank apps from these views. »
//
// 🔴 CE N'EST PAS UNE PRÉFÉRENCE D'ERGONOMIE, C'EST UNE CONTRAINTE DU SYSTÈME. Une vue
// intégrée — `SFSafariViewController` comme `ASWebAuthenticationSession` — ne peut pas
// ouvrir une application bancaire. `openAuthSessionAsync` n'aurait donc RIEN réglé : c'est
// encore une vue intégrée. Et en Belgique, BANCONTACT ouvre l'app bancaire.
//
// ⚠️ CE N'EST PAS THÉORIQUE : mesuré le 24/09 à 20 h 37 sur la production, un paiement
// d'une membre réelle est `open` chez Mollie avec `method: "bancontact"` et un lien
// `_links.mobileAppCheckout` de schéma `bepgenapp://`. Le premier paiement Bancontact vit
// déjà — dans une vue intégrée, il était condamné.
//
// CE QUE LA PRODUCTION A MESURÉ EN FACE (24/09 au soir) :
//   · payé DANS SAFARI      → Mollie redirige, iOS honore le lien universel, l'app s'ouvre,
//                             crédit + facture + email arrivent. Idem à l'annulation.
//   · payé DANS L'APP (1.2.2) → la page Mollie reste affichée ; il faut toucher « Terminé ».
//   · François Quoilin, membre réel : 5 tentatives sur 3 jours, 170 €, dont une en 1.2.2.
//     Sa trace PostHog le montre de retour dans l'app 8 s après, naviguant dans 3 écrans :
//     IL N'A JAMAIS VU LA PAGE MOLLIE.
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// 🔴 CE QUI DISPARAÎT AVEC LA VUE INTÉGRÉE, ET POURQUOI C'EST UN GAIN
// ─────────────────────────────────────────────────────────────────────────────────────────
// `Linking.openURL` ne rend RIEN sur le paiement : l'app passe en arrière-plan, il n'y a
// plus ni promesse de fermeture, ni `type`, ni durée. Tout l'appareillage de GYM-352
// tombe avec la vue qu'il mesurait :
//
//   · LE SEUIL DE 400 ms — SUPPRIMÉ, et c'est le plus important. C'était une heuristique
//     (« un 'cancel' rendu trop vite = jamais présenté »), et elle a MASQUÉ l'échec de
//     François : la vue s'affichait bel et bien, elle affichait juste autre chose que la
//     page Mollie. Une mesure qui déclare « présenté » ce que le membre n'a jamais vu ne
//     mesure pas ce qu'elle prétend.
//   · LE VERROU 'locked' ET SON DÉSARMEMENT (`dismissBrowser`) — SANS OBJET : il n'y a plus
//     de session `WebBrowser` à verrouiller. Le code est retiré, pas neutralisé : un appel
//     de fermeture d'un navigateur qu'on n'ouvre plus ne se comprendrait plus dans six mois.
//   · LE RÉESSAI UNIQUE — SANS OBJET : il rattrapait un échec de PRÉSENTATION. Ici, si le
//     système refuse l'URL, il la refusera à l'identique au second appel.
//
// ⚠️ CE QUI RESTE, ET QUI EST DÉSORMAIS LE SEUL FAIT : la résolution de `Linking.openURL`
// est un accusé de réception DU SYSTÈME — il a accepté de passer la main. Ce n'est pas une
// déduction, c'est un retour d'API. C'est à cet instant, et à aucun autre, qu'on sait que
// le membre est parti payer.
//
// ⚠️ CE QU'ON NE SAIT TOUJOURS PAS, ET QU'IL FAUT DIRE : qu'il a VU la page, qu'il a payé,
// qu'il est revenu. Aucune de ces trois choses n'est observable d'ici — elles le sont par le
// poll de `app/payment/success.tsx` et par le webhook. C'est pour cela que l'écran de
// vérification doit être monté AVANT que l'app passe en arrière-plan.

/** Ce que le système a fait de l'URL de paiement. */
export interface CheckoutOpenOutcome {
  /**
   * Le système a accepté d'ouvrir l'URL et l'app va passer en arrière-plan.
   *
   * ⚠️ CE N'EST PAS « le membre a payé », ni même « le membre a vu la page ». C'est le seul
   * fait dont cette couche dispose, et le nom le dit : la main a été PASSÉE.
   */
  handedOff: boolean
  /** 'opened' | 'unsupported' | 'threw' — brut, tel qu'on l'a observé. */
  type: string
  /** Millisecondes écoulées. Journalisé, jamais interprété : plus aucun seuil n'en dépend. */
  elapsedMs: number
  detail?: string
}

/**
 * D'où vient l'achat, et sur quoi il porte. ⚠️ CE N'EST PAS DÉCORATIF : sans l'écran
 * d'origine ni l'identifiant du paiement, un événement Sentry ne se raccroche à aucune
 * ligne `payments`, et on ne peut ni compter les échecs ni vérifier qu'un correctif a
 * marché. C'est très exactement ce qui nous a manqué les 21 et 22/09.
 */
export interface CheckoutContext {
  /** `profile_subscription` | `payment_required_sheet`. */
  screen: string
  /** `mollie_payment_id` quand il est connu (one-time). */
  paymentId?: string | null
  planId?: string | null
}

/**
 * ╔═══════════════════════════════════════════════════════════════════════════════════════╗
 * ║  OUVRE LA PAGE MOLLIE DANS LE NAVIGATEUR DU SYSTÈME                                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ NE LÈVE JAMAIS. Un refus d'ouverture est une information à rendre, pas une exception à
 * propager — l'appelant doit pouvoir le DIRE au membre, et c'est tout ce qu'il peut faire.
 *
 * ⚠️ AUCUN `canOpenURL` PRÉALABLE, ET C'EST DÉLIBÉRÉ. Sur Android, `canOpenURL` dépend des
 * requêtes de paquets déclarées au manifeste : il peut répondre `false` pour un `https`
 * parfaitement ouvrable. Un test qui refuse un paiement ouvrable serait pire que l'absence
 * de test. On tente, et on lit ce que le système répond.
 */
export async function openCheckout(
  url: string,
  ctx: CheckoutContext,
): Promise<CheckoutOpenOutcome> {
  const debut = Date.now()
  try {
    await Linking.openURL(url)
    const elapsedMs = Date.now() - debut
    // Le cas nominal ne fait AUCUN événement Sentry — un achat qui part n'est pas une
    // anomalie, et 76 paiements réussis noieraient les quelques-uns qui échouent. Il laisse
    // une MIETTE : si une erreur survient ensuite, la trace montrera que la main était bien
    // passée, et à quelle heure. Une miette ne crée pas d'issue et ne coûte rien.
    Sentry.addBreadcrumb({
      category: 'checkout',
      level: 'info',
      message: `openCheckout: main passée au navigateur du système (${ctx.screen})`,
      data: { payment_id: ctx.paymentId ?? null, plan_id: ctx.planId ?? null, elapsed_ms: elapsedMs, platform: Platform.OS },
    })
    return { handedOff: true, type: 'opened', elapsedMs }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    const outcome: CheckoutOpenOutcome = {
      handedOff: false,
      // `openURL` rejette aussi bien quand AUCUNE app ne sait ouvrir l'URL que sur une
      // erreur interne. On ne prétend pas distinguer : le détail brut est joint.
      type: 'threw',
      elapsedMs: Date.now() - debut,
      detail,
    }
    journaliserEchec(ctx, outcome)
    return outcome
  }
}

/**
 * 🔴 SENTRY, PAS `console.log` — C'EST CE QUI NOUS A MANQUÉ LE 22/09.
 *
 * L'instrumentation de GYM-352 écrivait dans la console. Antoine a cherché `[openCheckout]`
 * dans Sentry : aucun résultat — et pour DEUX raisons, dont une qu'il faut dire. La console
 * n'est pas capturée, c'est vrai ; mais surtout cette instrumentation n'était pas dans la
 * 1.2.1. L'absence d'événement ne prouvait donc rien du tout.
 *
 * ⚠️ IL N'Y A PLUS QU'UN SEUL ÉVÉNEMENT, ET C'EST VOULU. GYM-352 en émettait aussi un pour
 * le succès après réessai — il n'y a plus de réessai, et le succès du premier coup n'a
 * jamais rien eu à raconter. Ce qui reste est le seul fait anormal que cette couche puisse
 * encore constater : le système a REFUSÉ l'URL de paiement.
 */
function journaliserEchec(ctx: CheckoutContext, outcome: CheckoutOpenOutcome): void {
  Sentry.captureMessage(
    `openCheckout: le système a refusé d'ouvrir l'URL de paiement (${ctx.screen})`,
    {
      level: 'error',
      tags: {
        // Des ÉTIQUETTES, parce qu'elles se filtrent et se comptent dans Sentry — un
        // message libre ne se compte pas.
        checkout_screen: ctx.screen,
        checkout_result: 'not_handed_off',
        checkout_last_type: outcome.type,
        platform: Platform.OS,
      },
      extra: {
        payment_id: ctx.paymentId ?? null,
        plan_id: ctx.planId ?? null,
        elapsed_ms: outcome.elapsedMs,
        detail: outcome.detail ?? null,
      },
    },
  )

  // La console reste, pour le débogage local. Elle ne remplace rien.
  console.log(`[openCheckout] REFUS screen=${ctx.screen} payment=${ctx.paymentId ?? '-'} type=${outcome.type} detail=${outcome.detail ?? '-'}`)
}
