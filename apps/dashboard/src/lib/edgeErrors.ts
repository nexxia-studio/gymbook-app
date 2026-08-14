// GYM-219 — Traduction des refus serveur en messages ACTIONNABLES.
//
// VÉCU EN QA (Antoine, 05/08) : ajout d'un membre à un cours depuis /planning, le membre
// n'avait plus de crédit. Le toast a dit « impossible d'ajouter ce membre » SANS EN
// DONNER LA RAISON. Il a fallu tester un SECOND membre pour comprendre.
// Au comptoir, le gérant a quelqu'un devant lui : il ne sait pas s'il doit vendre une
// carte, libérer une place, ou si la personne est déjà inscrite. Il tâtonne devant son
// client.
//
// ⚠️ LE DIAGNOSTIC EXISTAIT DÉJÀ. Les Edge Functions renvoient des codes précis
// (NO_CREDIT, FULL, ALREADY_BOOKED…). C'est l'interface qui les écrasait en un message
// unique. Ce module ne crée aucune information : il cesse d'en jeter.
//
// FORME REPRISE DE GYM-204 (admin-lift-suspension), qui distinguait déjà NOT_SUSPENDED de
// WRONG_GYM avec des messages dédiés et dont le client TESTAIT le retour d'erreur.
//
// ⚠️ TABLE UNIQUE, VOLONTAIREMENT. Elle vivra plus longtemps que les écrans qui
// l'utilisent : un objet recopié dans chaque modale divergerait au premier ajout de code.
import type { TFunction } from 'i18next'

/**
 * Détails que certaines Edge Functions joignent au refus, en plus du `code`.
 *
 * Ce ne sont pas des décorations : chacun rend le message ACTIONNABLE là où le code seul
 * resterait vague. « Limite atteinte » n'aide pas, « limite de 3 réservations » si.
 */
export interface EdgeErrorBody {
  code?: string
  /** MAX_BOOKINGS_REACHED — plafond de la salle (nexxia_gyms.max_active_bookings). */
  limit?: number
  /** SUSPENDED — échéance de la sanction, pour la nommer avant de proposer sa levée. */
  suspended_until?: string
  /** FULL — position que le membre OCCUPERAIT en liste d'attente s'il l'accepte. */
  waitlist_position?: number
}

/**
 * Lit le corps JSON d'un refus d'Edge Function.
 *
 * supabase-js emballe une réponse HTTP en erreur dans une FunctionsHttpError dont le corps
 * original n'est accessible que via `error.context` (une Response non consommée). Sans ça,
 * on ne dispose que d'un « Edge Function returned a non-2xx status code » inexploitable
 * pour afficher un message précis à l'utilisateur.
 *
 * ⚠️ UNE Response NE SE LIT QU'UNE FOIS. C'est pourquoi tout passe par cette fonction :
 * un second appel sur la même erreur trouverait le flux déjà consommé et renverrait un
 * corps vide. Les appelants qui ont besoin du code ET d'un détail (`limit`,
 * `suspended_until`…) doivent donc lire le corps UNE seule fois, ici.
 */
export async function extractErrorBody(error: unknown): Promise<EdgeErrorBody> {
  const ctx = (error as { context?: Response } | null)?.context
  if (ctx && typeof ctx.json === 'function') {
    try {
      return (await ctx.json()) as EdgeErrorBody
    } catch {
      /* corps non-JSON */
    }
  }
  return {}
}

/** Raccourci du cas courant : seul le code métier intéresse l'appelant. */
export async function extractErrorCode(error: unknown): Promise<string | undefined> {
  return (await extractErrorBody(error)).code
}

/**
 * Erreur porteuse du code métier, pour les hooks qui signalent un échec en LEVANT plutôt
 * qu'en renvoyant un résultat.
 *
 * Ces hooks jetaient l'erreur brute de supabase-js : l'appelant ne récupérait qu'un
 * « Edge Function returned a non-2xx status code » et affichait un message générique. Le
 * `catch` peut désormais lire `err.code` — et `edgeErrorCodeOf` s'en charge sans que
 * l'appelant ait à connaître cette classe.
 */
export class EdgeError extends Error {
  readonly code?: string
  constructor(code?: string) {
    super(code ?? 'EDGE_ERROR')
    this.name = 'EdgeError'
    this.code = code
  }
}

/** Code métier d'une exception attrapée, ou `undefined` (panne réseau, erreur hors protocole). */
export function edgeErrorCodeOf(err: unknown): string | undefined {
  return err instanceof EdgeError ? err.code : undefined
}

/**
 * Codes CONNUS, relevés en lisant les Edge Functions appelées par le dashboard — jamais
 * devinés. Chacun a une entrée `edge_errors.<CODE>` en fr ET en en.
 *
 * Un code absent de cette liste retombe sur le repli honnête (cf. `resolveEdgeError`) :
 * c'est volontaire, un message inventé serait pire qu'un message vague.
 */
export const KNOWN_EDGE_ERROR_CODES = [
  // ── mark-attendance (pointage + walk-in comptoir, GYM-174) ──
  'FULL', 'NO_CREDIT', 'ALREADY_BOOKED', 'SLOT_CANCELLED', 'SLOT_TOO_OLD',
  'BOOKING_NOT_FOUND', 'SLOT_NOT_FOUND', 'INVALID_STATUS', 'INVALID_SOURCE_STATUS',
  'BOOKING_FAILED', 'MARK_FAILED',
  // ── create-booking (côté membre) ET admin-book-member (GYM-226, inscription à un
  //    cours FUTUR par le gérant). Ces trois codes n'étaient PLUS « non atteignables
  //    depuis le dashboard » dès GYM-226 : le gérant les rencontre désormais tous les
  //    trois, et ce sont trois gestes différents — attendre, lever la suspension
  //    (admin-lift-suspension), vendre une formule (admin-sell-plan). ──
  'MAX_BOOKINGS_REACHED', 'SUSPENDED', 'PAYMENT_REQUIRED',
  // ── admin-book-member (GYM-226), codes propres à ce chemin ──
  //  · ALREADY_WAITLISTED — distinct d'ALREADY_BOOKED : le membre a une place PROMISE,
  //    pas une place ACQUISE. Les confondre ferait dire au gérant « c'est bon, tu es
  //    inscrit » à quelqu'un qui ne l'est pas.
  //  · SLOT_PAST — le geste demandé n'est pas celui-ci : sur un cours déjà tenu, c'est le
  //    pointage walk-in qui sert.
  //  · MEMBER_QUOTA_REACHED — quota de membres du plan Viniz (limite d'abonnement de la
  //    salle, pas du membre) : rien à faire au comptoir, c'est un sujet de facturation.
  'ALREADY_WAITLISTED', 'SLOT_PAST', 'MEMBER_QUOTA_REACHED',
  // ── create-refund (GYM-209 / GYM-189) ──
  'MOLLIE_SCOPE_MISSING', 'MOLLIE_TOKEN_EXPIRED', 'MOLLIE_ERROR', 'INSUFFICIENT_BALANCE',
  'SUBSCRIPTION_PAYMENT', 'MANUAL_PAYMENT', 'NOT_REFUNDABLE', 'NOTHING_TO_REFUND',
  'AMOUNT_TOO_HIGH', 'INVALID_AMOUNT', 'PAYMENT_NOT_FOUND',
  // ── adjust-credits (GYM-182) ──
  'INVALID_DELTA', 'REASON_REQUIRED', 'MEMBER_NOT_IN_GYM', 'ADJUST_FAILED',
  // ── admin-create-member ──
  'EMAIL_EXISTS', 'INVALID_EMAIL', 'PLAN_NOT_FOUND', 'PLAN_MISCONFIGURED',
  'PLAN_NOT_ONE_TIME', 'INVALID_PAYMENT_METHOD', 'CREATE_FAILED', 'MISSING_FIELDS',
  // ── admin-sell-plan (GYM-222 — vente au comptoir à un membre existant) ──
  // Partage les gardes de formule ci-dessus (module _shared/counter-sale.ts) et y ajoute :
  //  · SUBSCRIPTION_ACTIVE — refus LÉGITIME : un abonnement en cours ouvre déjà l'accès
  //    illimité. À EXPLIQUER, jamais à masquer : le gérant doit comprendre qu'il ne s'agit
  //    pas d'une panne mais d'un achat qui ne servirait à rien au membre.
  //  · PAYMENT_NOT_RECORDED / CREDITS_NOT_APPLIED — l'argent a été annoncé mais la trace ou
  //    la contrepartie manque. Le gérant doit le savoir TOUT DE SUITE, pas le découvrir
  //    quand le membre voudra réserver.
  'SUBSCRIPTION_ACTIVE', 'PAYMENT_NOT_RECORDED', 'CREDITS_NOT_APPLIED',
  'MISSING_MEMBER_ID', 'MISSING_PLAN_ID',
  // PLAN_ALREADY_USED n'est PAS renvoyé par le comptoir (dérogation gérant GYM-193, cf.
  // _shared/counter-sale.ts) — seulement par create-payment, côté app membre. Il est mappé
  // ici parce que le code est partagé avec le libre-service et qu'un refus non traduit
  // retomberait sur « l'action n'a pas abouti ».
  'PLAN_ALREADY_USED',
  // ── admin-update-member ──
  'INVALID_FIRST_NAME', 'INVALID_LAST_NAME', 'INVALID_PHONE', 'NO_FIELDS', 'UPDATE_FAILED',
  // ── admin-lift-suspension (GYM-204, le modèle) ──
  'NOT_SUSPENDED', 'REASON_TOO_LONG',
  // ── invite-team-member / team-access ──
  'ALREADY_ACTIVE', 'INVALID_ROLE', 'LINK_FAILED', 'LAST_ADMIN', 'CANNOT_REVOKE_SELF',
  'NOT_TEAM_MEMBER', 'REVOKE_FAILED', 'LIST_FAILED',
  // ── cancel-slot (GYM-143) ──
  'SLOT_STARTED', 'CANCEL_FAILED',
  // ── generate-invoice ──
  'NOT_PAID', 'NO_EMAIL', 'RESEND_NOT_CONFIGURED', 'EMAIL_SEND_FAILED', 'GYM_NOT_FOUND',
  // ── send-communication ──
  'ALREADY_SENT',
  // ── code CLIENT (GYM-219) : pas de jeton push en base, donc aucun appel émis.
  //    Ce n'est pas une erreur serveur mais un refus à expliquer au gérant. ──
  'NO_PUSH_TOKEN',
  // ── transverses (toutes fonctions) ──
  'FORBIDDEN', 'UNAUTHORIZED', 'WRONG_GYM', 'MEMBER_NOT_FOUND', 'MEMBER_DELETED',
  'NOT_A_MEMBER', 'NO_GYM', 'NOT_FOUND', 'SERVER_ERROR',
] as const

export type EdgeErrorCode = (typeof KNOWN_EDGE_ERROR_CODES)[number]

const KNOWN = new Set<string>(KNOWN_EDGE_ERROR_CODES)

/** Éléments de contexte que l'écran connaît et que le message peut nommer. */
export interface EdgeErrorContext {
  /** Prénom (ou nom complet) du membre concerné — le gérant a souvent plusieurs
   *  personnes devant lui, « ce membre » ne suffit pas à savoir laquelle. */
  name?: string | null
  /** Plafond renvoyé par le serveur, pour MAX_BOOKINGS_REACHED. */
  limit?: number | null
}

/**
 * Message affichable pour un refus serveur.
 *
 * ⚠️ REPLI HONNÊTE — un code inconnu (fonction déployée plus récemment que ce build,
 * code ajouté côté serveur) donne « l'action a échoué », SANS inventer de cause. Un
 * message faux est pire qu'un message vague : il enverrait le gérant vendre une carte à
 * quelqu'un dont le problème est ailleurs. Le code technique part en console pour le
 * diagnostic, jamais à l'écran.
 */
export function edgeErrorMessage(
  code: string | undefined,
  t: TFunction,
  ctx: EdgeErrorContext = {},
): string {
  if (!code || !KNOWN.has(code)) {
    if (code) console.warn('[edgeErrors] code inconnu de ce build :', code)
    return t('edge_errors.FALLBACK')
  }
  // Un membre sans nom connu reste désigné de façon grammaticale, jamais par une chaîne
  // vide qui produirait «  n'a plus de crédit ».
  const name = ctx.name?.trim() || t('edge_errors.default_member')
  return t(`edge_errors.${code}`, { name, limit: ctx.limit ?? undefined })
}

/**
 * Raccourci du cas courant : une erreur supabase-js → un message affichable.
 * Enchaîne l'extraction du code et sa traduction.
 */
export async function resolveEdgeError(
  error: unknown,
  t: TFunction,
  ctx: EdgeErrorContext = {},
): Promise<string> {
  return edgeErrorMessage(await extractErrorCode(error), t, ctx)
}
