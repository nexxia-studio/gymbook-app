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
  /** 1 ou 2 — un échec de présentation est réessayé UNE fois (correctif du 22/09). */
  attempts: number
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
 * 🔴 22/09 — ON NE PEUT PLUS ATTENDRE LA MESURE. Ce commentaire disait « non corrigé
 * délibérément : le journal dira 'locked' dès le prochain essai, et c'est cette mesure qui
 * doit décider ». L'argument était bon — et il est mort de deux façons :
 *
 *   · le journal n'est JAMAIS parti : l'instrumentation du 17/09 n'est pas dans la 1.2.1
 *     (bump de version le 16/09, instrumentation le 17/09 — vérifié sur l'historique) ;
 *   · pendant ce temps, 9 achats ont échoué en deux jours, ~600 € non encaissés.
 *
 * Attendre une mesure qui ne peut pas arriver, c'est ne rien attendre du tout. Le correctif
 * couvre donc TOUTES les hypothèses à la fois — verrou hérité, cascade de présentation,
 * échec ponctuel — parce qu'un aller-retour de revue Apple par hypothèse coûterait des
 * semaines de ventes. `desarmerLeVerrou()` ci-dessous est la réponse à celle-ci.
 */
const LOCKED = 'locked'

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

/** Une tentative, telle que le module l'a rendue. */
interface Tentative {
  type: string
  elapsedMs: number
  presented: boolean
  detail?: string
}

/**
 * Déverrouille une session fantôme avant de présenter.
 *
 * 🔴 C'EST LE POINT 1 DU CORRECTIF. `dismissBrowser()` sur un contrôleur non présenté
 * appelle quand même sa complétion — donc `finish`, donc la remise à `nil` de
 * `currentWebBrowserSession`. Un verrou hérité d'une session précédente est ainsi désarmé
 * AVANT qu'il ne fasse échouer l'ouverture.
 *
 * ⚠️ iOS SEULEMENT, ET ELLE NE DOIT JAMAIS LEVER. `dismissBrowser` n'existe pas sur
 * Android, et sur iOS elle rejette quand il n'y a rien à fermer — c'est-à-dire dans le cas
 * NORMAL. Une exception ici empêcherait le paiement qu'on essaie de sauver.
 */
async function desarmerLeVerrou(): Promise<void> {
  if (Platform.OS !== 'ios') return
  try {
    await WebBrowser.dismissBrowser()
  } catch {
    // Rien à fermer : c'est le cas normal, et ce n'est pas une erreur.
  }
}

/** Une seule tentative de présentation, mesurée. */
async function tenter(url: string): Promise<Tentative> {
  const startedAt = Date.now()
  try {
    const res = await WebBrowser.openBrowserAsync(url)
    const elapsedMs = Date.now() - startedAt
    const type = String(res?.type ?? 'unknown')
    const presented = type !== LOCKED && (type === 'opened' || elapsedMs >= PRESENTATION_FLOOR_MS)
    return { type, elapsedMs, presented }
  } catch (e) {
    return {
      type: 'threw',
      elapsedMs: Date.now() - startedAt,
      presented: false,
      detail: e instanceof Error ? e.message : String(e),
    }
  }
}

/**
 * ╔═══════════════════════════════════════════════════════════════════════════════════════╗
 * ║  OUVRE LA PAGE MOLLIE — ET SURVIT AUX TROIS FAÇONS DONT ELLE NE S'OUVRAIT PAS        ║
 * ╚═══════════════════════════════════════════════════════════════════════════════════════╝
 *
 * 🔴 CE QUE LA PRODUCTION A MESURÉ (21–22/09) : 9 échecs, 3 membres, ~600 € non encaissés.
 * Dans TOUS les cas la ligne `payments` existe et `checkout_url` est stockée — le lien
 * Mollie a été obtenu, la page n'a jamais été réglée, le paiement a expiré.
 *
 * Trois défenses, dans cet ordre :
 *   ① `dismissBrowser()` AVANT chaque présentation — désarme un verrou hérité ;
 *   ② `onPresented` prévient l'appelant DÈS que la page est à l'écran, pour qu'il ne
 *      navigue et ne démonte RIEN dans le même tic que la présentation ;
 *   ③ un échec de PRÉSENTATION est réessayé UNE fois. Un navigateur qui ne s'affiche pas
 *      n'est pas un membre qui renonce — les confondre, c'est perdre la vente.
 *
 * ⚠️ `onPresented` NE PEUT PAS ATTENDRE LA PROMESSE. Sur iOS, `openBrowserAsync` ne résout
 * qu'à la FERMETURE du navigateur : attendre pour savoir si la page s'est ouverte
 * reviendrait à attendre la fin du paiement. On infère donc la présentation au passage du
 * seuil — si la promesse n'a pas résolu après {@link PRESENTATION_FLOOR_MS}, c'est qu'il y
 * a bien quelque chose à l'écran. C'est la même heuristique que `presented`, prise dans
 * l'autre sens, et elle se falsifie de la même façon.
 *
 * ⚠️ NE LÈVE JAMAIS. Un échec d'ouverture est une information à rendre, pas une exception
 * à propager.
 */
export async function openCheckout(
  url: string,
  ctx: CheckoutContext,
  /** Appelé AU PLUS UNE FOIS, dès que la page est à l'écran. C'est là qu'on navigue. */
  onPresented?: () => void,
): Promise<CheckoutOpenOutcome> {
  let prevenu = false
  const prevenir = () => {
    if (prevenu) return
    prevenu = true
    try { onPresented?.() } catch (e) { Sentry.captureException(e) }
  }

  const tentatives: Tentative[] = []

  for (let essai = 1; essai <= 2; essai++) {
    // ① Le verrou est désarmé avant CHAQUE essai, pas seulement avant le second : le
    // verrou peut être hérité d'une session précédente de l'app, donc présent dès le
    // premier achat. C'est ce qu'implique l'écart de deux heures entre les essais
    // d'Emma — une session fraîche échouait AUSSI.
    await desarmerLeVerrou()

    // ② Le minuteur qui prévient l'appelant. Armé AVANT la présentation, annulé si la
    // promesse résout avant lui (ce qui signifie justement qu'il n'y a rien à l'écran).
    const minuteur = setTimeout(prevenir, PRESENTATION_FLOOR_MS)
    const t = await tenter(url)
    clearTimeout(minuteur)
    tentatives.push(t)

    if (t.presented) {
      // Android résout aussitôt avec 'opened' : le minuteur n'a pas eu le temps de partir.
      prevenir()
      journaliser(ctx, tentatives, true)
      return { presented: true, type: t.type, elapsedMs: t.elapsedMs, attempts: essai, detail: t.detail }
    }

    // ③ Un seul réessai, et seulement sur un échec de PRÉSENTATION.
    //
    // ⚠️ `threw` N'EST PAS RÉESSAYÉ. Une exception vient d'une URL invalide ou d'un module
    // absent : recommencer donnerait la même exception, et ouvrirait deux fois la porte à
    // un comportement qu'on ne comprend pas.
    if (essai === 1 && t.type !== 'threw') continue
    break
  }

  const derniere = tentatives[tentatives.length - 1]
  journaliser(ctx, tentatives, false)
  return {
    presented: false,
    type: derniere.type,
    elapsedMs: derniere.elapsedMs,
    attempts: tentatives.length,
    detail: derniere.detail,
  }
}

/**
 * 🔴 SENTRY, PAS `console.log` — C'EST LE POINT 4, ET C'EST CE QUI NOUS A MANQUÉ.
 *
 * L'instrumentation de GYM-352 écrivait dans la console. Antoine a cherché `[openCheckout]`
 * dans Sentry le 22/09 : aucun résultat — et pour DEUX raisons, dont une qu'il faut dire.
 * La console n'est pas capturée, c'est vrai ; mais surtout **cette instrumentation n'est pas
 * dans la 1.2.1** : le relevé git le montre (bump 1.2.0 → 1.2.1 le 16/09, instrumentation le
 * 17/09). L'absence d'événement ne prouvait donc rien du tout.
 *
 * ⚠️ `captureMessage` ET NON `captureException` POUR LE SUCCÈS : un achat qui marche n'est
 * pas une erreur, et le noyer dans les issues rendrait le tableau illisible. On envoie un
 * message de niveau `info` sur le succès APRÈS un réessai (l'information qui compte : le
 * correctif a rattrapé une vente) et `error` sur l'échec définitif.
 */
function journaliser(ctx: CheckoutContext, tentatives: Tentative[], reussi: boolean): void {
  const resume = tentatives
    .map((t, i) => `#${i + 1} type=${t.type} ms=${t.elapsedMs}${t.detail ? ` detail=${t.detail}` : ''}`)
    .join(' | ')

  // Un succès du PREMIER coup est le cas normal : il n'a rien à raconter.
  if (reussi && tentatives.length === 1) return

  Sentry.captureMessage(
    reussi
      ? `openCheckout: page présentée au ${tentatives.length}ᵉ essai (${ctx.screen})`
      : `openCheckout: page JAMAIS présentée après ${tentatives.length} essai(s) (${ctx.screen})`,
    {
      level: reussi ? 'info' : 'error',
      tags: {
        // Des ÉTIQUETTES, parce qu'elles se filtrent et se comptent dans Sentry — un
        // message libre ne se compte pas.
        checkout_screen: ctx.screen,
        checkout_result: reussi ? 'presented' : 'never_presented',
        checkout_last_type: tentatives[tentatives.length - 1].type,
        platform: Platform.OS,
      },
      extra: {
        payment_id: ctx.paymentId ?? null,
        plan_id: ctx.planId ?? null,
        attempts: tentatives.length,
        tentatives: resume,
      },
    },
  )

  // La console reste, pour le débogage local. Elle ne remplace rien.
  console.log(`[openCheckout] screen=${ctx.screen} payment=${ctx.paymentId ?? '-'} ${resume}`)
}
