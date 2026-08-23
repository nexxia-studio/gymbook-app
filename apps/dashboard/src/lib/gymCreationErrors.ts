// GYM-248 — Traduction des refus de create_gym_self_serve.
//
// Le RPC lève des exceptions dont le SQLSTATE est en classe 'PT' : PostgREST en fait le
// statut HTTP (les 3 derniers chiffres) ET le recopie dans le corps, avec le HINT. On
// dispose donc de DEUX identifiants stables pour le même refus.
//
// ⚠️ On mappe sur le HINT en premier : c'est le jeton métier, choisi par nous et lisible
// (GYM_ALREADY_IN_GYM). Le SQLSTATE n'est qu'un repli — il porte un statut HTTP, pas une
// intention, et deux refus pourraient un jour partager un statut sans partager un sens.
//
// ⚠️ AUCUN refus ne doit finir en toast générique : chacun a son écran ou son champ.
// C'est la raison d'être de ce module — un « une erreur est survenue » sur un compte qui
// a déjà une salle envoie le gérant dans le mur au lieu de l'envoyer sur son dashboard.

/** Ce que l'appelant doit FAIRE du refus, au-delà du message. */
export type GymCreationOutcome =
  /** Le compte a déjà une salle → proposer le dashboard, pas un réessai. */
  | 'already-has-gym'
  /** Email non confirmé → renvoyer à l'écran « vérifie ta boîte mail ». */
  | 'email-unconfirmed'
  /** Session absente ou profil introuvable → reconnexion. */
  | 'needs-login'
  /** Quota horaire → attendre, réessayer plus tard. */
  | 'rate-limited'
  /** Nom refusé → erreur INLINE sur le champ, pas une bannière. */
  | 'invalid-name'
  /** Tout le reste → message générique RÉESSAYABLE. */
  | 'retry'

export interface GymCreationError {
  outcome: GymCreationOutcome
  /** Clé i18n du message à afficher. */
  messageKey: string
}

/** Forme minimale d'une erreur PostgREST — on ne dépend pas du type du SDK. */
interface PostgrestLike {
  code?: string | null
  hint?: string | null
  message?: string | null
}

const BY_HINT: Record<string, GymCreationError> = {
  GYM_NOT_AUTHENTICATED:   { outcome: 'needs-login',       messageKey: 'gym_creation.errors.not_authenticated' },
  GYM_EMAIL_NOT_CONFIRMED: { outcome: 'email-unconfirmed', messageKey: 'gym_creation.errors.email_not_confirmed' },
  GYM_PROFILE_MISSING:     { outcome: 'needs-login',       messageKey: 'gym_creation.errors.profile_missing' },
  GYM_ALREADY_IN_GYM:      { outcome: 'already-has-gym',   messageKey: 'gym_creation.errors.already_has_gym' },
  GYM_RATE_LIMITED:        { outcome: 'rate-limited',      messageKey: 'gym_creation.errors.rate_limited' },
  GYM_INVALID_NAME:        { outcome: 'invalid-name',      messageKey: 'gym_creation.errors.invalid_name' },
}

// Repli par SQLSTATE, si le HINT venait à manquer (proxy qui le mange, version de
// PostgREST qui ne le remonte pas). Mêmes issues, dans le même ordre.
const BY_CODE: Record<string, GymCreationError> = {
  PT401: BY_HINT.GYM_NOT_AUTHENTICATED,
  PT403: BY_HINT.GYM_EMAIL_NOT_CONFIRMED,
  PT404: BY_HINT.GYM_PROFILE_MISSING,
  PT409: BY_HINT.GYM_ALREADY_IN_GYM,
  PT429: BY_HINT.GYM_RATE_LIMITED,
  PT422: BY_HINT.GYM_INVALID_NAME,
}

const GENERIC: GymCreationError = { outcome: 'retry', messageKey: 'gym_creation.errors.generic' }

export function mapGymCreationError(error: PostgrestLike | null | undefined): GymCreationError {
  if (!error) return GENERIC
  const byHint = error.hint ? BY_HINT[error.hint.trim()] : undefined
  if (byHint) return byHint
  const byCode = error.code ? BY_CODE[error.code.trim()] : undefined
  if (byCode) return byCode
  return GENERIC
}
