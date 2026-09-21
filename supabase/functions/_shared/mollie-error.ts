// ╔═══════════════════════════════════════════════════════════════════════════════════════╗
// ║  GYM-346 — LIRE UN ÉCHEC MOLLIE : le journaliser, le classer, et NE PAS le divulguer  ║
// ╚═══════════════════════════════════════════════════════════════════════════════════════╝
//
// LE DÉFAUT (établi le 14/09). La branche d'échec de `create-subscription` plaçait la
// réponse brute de Mollie dans le message d'un 502… et n'en gardait AUCUNE trace côté
// serveur. Trois échecs ce jour-là, zéro ligne de journal : il a fallu croiser les journaux
// d'exécution avec la connexion OAuth pour écarter le jeton. Une demi-journée.
//
// Deux conséquences, corrigées ici :
//
//   1. LE DÉTAIL PARTAIT DANS LE MAUVAIS SENS. Il transitait par l'appareil du MEMBRE
//      (corps de la réponse), d'où il remontait ensuite dans Sentry via `EdgeError.message`.
//      Or une réponse Mollie peut porter des informations de compte. Désormais : le détail
//      va dans les journaux SERVEUR, et le membre ne reçoit qu'un message générique.
//
//   2. TOUT ÉCHEC ÉTAIT « RÉESSAYABLE ». Un 422 de Mollie est DÉFINITIF — la même requête
//      à l'identique sera refusée à l'identique. Dire « réessaie » a fait retenter trois
//      fois une requête vouée à échouer. Un 5xx ou un timeout, lui, est INCERTAIN : la
//      nouvelle tentative a du sens.
//
// ⚠️ MÊME MOTIF QUE GYM-279 (l'app ne distingue pas le refus de l'incertitude). Ce module
// le referme POUR LE CHEMIN MOLLIE DE LA CRÉATION DE CHECKOUT, et là seulement. Les autres
// surfaces de GYM-279 ne sont pas touchées par ce lot.

/** Ce que l'appelant doit rendre au client, et ce qu'il doit en penser. */
export interface MollieOutcome {
  /** Code métier distinct, lu par `mapPaymentError` côté mobile. */
  code: string
  /** Statut HTTP à rendre — 422 quand c'est définitif, 502/503 quand c'est incertain. */
  status: number
  /** Message GÉNÉRIQUE. Ne contient JAMAIS la réponse de Mollie. */
  message: string
  /**
   * `true` ⇒ rejouer la même requête à l'identique échouera à l'identique.
   * C'est cette valeur, et non le statut HTTP seul, qui décide du « réessaie » affiché.
   */
  definitive: boolean
}

/** Échecs de la porte du jeton — aucun n'est réparable par le membre, aucun en réessayant. */
export const TOKEN_OUTCOMES: Record<string, MollieOutcome> = {
  NOT_CONNECTED: {
    code: 'MOLLIE_NOT_CONNECTED',
    status: 503,
    message: 'La salle n\'a pas connecté son compte de paiement',
    definitive: true,
  },
  CONNECTION_REVOKED: {
    code: 'MOLLIE_NOT_CONNECTED',
    status: 503,
    message: 'La connexion au compte de paiement de la salle n\'est plus active',
    definitive: true,
  },
  REFRESH_FAILED: {
    code: 'MOLLIE_TOKEN_REJECTED',
    status: 503,
    message: 'La connexion au compte de paiement de la salle doit être refaite',
    definitive: true,
  },
}

/**
 * Mollie renvoie ses refus en JSON : `{ status, title, detail, field? }`.
 * On ne s'en sert QUE pour choisir un code — jamais pour composer un message au membre.
 */
function readMollieBody(body: string): { detail: string; field: string } {
  try {
    const parsed = JSON.parse(body) as { detail?: unknown; field?: unknown }
    return {
      detail: typeof parsed.detail === 'string' ? parsed.detail : '',
      field: typeof parsed.field === 'string' ? parsed.field : '',
    }
  } catch {
    // Corps non-JSON (page d'erreur de passerelle, corps vide) : on ne devine pas.
    return { detail: '', field: '' }
  }
}

/** Le refus porte-t-il sur le moyen de paiement plutôt que sur la requête elle-même ? */
function isMethodProblem(detail: string, field: string): boolean {
  if (field === 'method') return true
  const d = detail.toLowerCase()
  return d.includes('payment method') || d.includes('no suitable payment method')
}

/**
 * Classe une réponse HTTP d'échec de Mollie.
 *
 * ⚠️ LE TEST PORTE SUR LE STATUT, PAS SUR LE TEXTE. Le texte sert seulement à départager
 * les 422 entre eux. Un classement fondé sur le message se serait périmé au premier
 * changement de libellé chez Mollie.
 */
export function classifyMollieHttpError(httpStatus: number, body: string): MollieOutcome {
  // 401/403 — Mollie refuse NOTRE jeton. Le membre n'y peut rien, et réessayer non plus.
  if (httpStatus === 401 || httpStatus === 403) {
    return {
      code: 'MOLLIE_TOKEN_REJECTED',
      status: 503,
      message: 'La connexion au compte de paiement de la salle doit être refaite',
      definitive: true,
    }
  }

  // 429 — trop d'appels. DÉFINITIF pour cette requête-ci, mais pas pour la suivante :
  // classé incertain, c'est exactement le cas où réessayer est la bonne conduite.
  if (httpStatus === 429) {
    return {
      code: 'MOLLIE_UNAVAILABLE',
      status: 503,
      message: 'Le prestataire de paiement est momentanément saturé',
      definitive: false,
    }
  }

  // 5xx — la panne est chez Mollie. Incertain : la requête a pu ne pas être traitée.
  if (httpStatus >= 500) {
    return {
      code: 'MOLLIE_UNAVAILABLE',
      status: 502,
      message: 'Le prestataire de paiement est momentanément indisponible',
      definitive: false,
    }
  }

  // 422 et autres 4xx — Mollie a COMPRIS la requête et l'a refusée. Rejouer la même
  // requête produira le même refus.
  const { detail, field } = readMollieBody(body)
  if (isMethodProblem(detail, field)) {
    return {
      code: 'MOLLIE_METHOD_UNAVAILABLE',
      status: 422,
      message: 'Aucun moyen de paiement disponible pour cette salle',
      definitive: true,
    }
  }

  return {
    code: 'MOLLIE_REFUSED',
    status: 422,
    message: 'Le prestataire de paiement a refusé la demande',
    definitive: true,
  }
}

/**
 * Classe un échec SANS réponse : le `fetch` a levé (réseau, DNS, timeout, abandon).
 * Toujours INCERTAIN — on ne sait même pas si Mollie a reçu la requête.
 */
export function classifyMollieNetworkError(): MollieOutcome {
  return {
    code: 'MOLLIE_UNAVAILABLE',
    status: 502,
    message: 'Le prestataire de paiement est injoignable',
    definitive: false,
  }
}

/**
 * 🔴 LA LIGNE QUI MANQUAIT. Un seul `console.error`, structuré, dans CHAQUE branche
 * d'échec Mollie — c'est le correctif le plus rentable du ticket : il aurait répondu en
 * trente secondes à la demi-journée du 14/09.
 *
 * Le détail Mollie va ICI, dans les journaux serveur. Il ne va nulle part ailleurs.
 *
 * ⚠️ Ne lève JAMAIS : elle est appelée depuis des chemins déjà en échec, et une exception
 * ici masquerait le défaut d'origine par un second.
 */
export function logMollieFailure(
  fn: string,
  stage: string,
  ctx: { gymId?: string; memberId?: string; planId?: string; httpStatus?: number },
  outcome: MollieOutcome,
  detail?: string,
): void {
  try {
    console.error(
      `[${fn}] mollie_failure stage=${stage} code=${outcome.code}`
      + ` definitive=${outcome.definitive} http=${ctx.httpStatus ?? 'none'}`
      + ` gym=${ctx.gymId ?? '(none)'} member=${ctx.memberId ?? '(none)'} plan=${ctx.planId ?? '(none)'}`
      + ` detail=${truncate(detail ?? '(aucun)', 1500)}`,
    )
  } catch {
    // Un journal qui lève serait pire que pas de journal.
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`
}

/**
 * GYM-346 — caviarde le secret du rappel avant journalisation.
 *
 * 🔴 `create-payment` journalisait son payload Mollie ENTIER à chaque appel, `webhookUrl`
 * compris — or celle-ci porte `?secret=${MOLLIE_WEBHOOK_SECRET}` en clair. Le secret
 * partait donc dans les journaux d'exécution à CHAQUE paiement réussi, pas seulement en
 * cas d'échec.
 */
export function redactSecrets(value: string): string {
  return value.replace(/([?&]secret=)[^&"'\s]+/gi, '$1[redacted]')
}
