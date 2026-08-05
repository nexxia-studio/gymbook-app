// GYM-214 — Lecture du dossier disciplinaire d'un membre (table `penalties`).
//
// ⚠️ CE MODULE NE FAIT QUE LIRE ET INTERPRÉTER. Aucune ligne de `penalties` n'est
// modifiée nulle part dans ce lot : l'historique n'est pas réécrit, il est expliqué.

/** D'où vient la sanction — deux comportements distincts, à ne jamais confondre. */
export type PenaltyOrigin = 'noshow' | 'late_cancel' | 'unknown'

/** Forme de la sanction, indépendante de la valeur brute de `type`. */
export type PenaltyKind = 'warning_1' | 'warning_2' | 'warning_late' | 'suspension' | 'unknown'

export interface PenaltyDuration {
  unit: 'hours' | 'days' | 'weeks'
  value: number
}

/**
 * ORIGINE de la pénalité — le point le plus délicat de la lecture.
 *
 * `type` NE SUFFIT PAS : `'suspension'` est émis par les DEUX chemins.
 *   · mark_attendance_atomic (GYM-175, no-show constaté) → 'warning_1' | 'warning_2' | 'suspension'
 *   · cancel-booking (annulation tardive)                → 'warning' | 'suspension'
 *
 * Le discriminant fiable est le STATUT DE LA RÉSERVATION liée : un no-show constaté
 * laisse `bookings.status = 'no_show'`, une annulation tardive `'cancelled'`. C'est une
 * propriété du chemin qui a écrit la ligne, pas une convention de nommage.
 *
 * Quand rien ne permet de trancher (booking_id NULL, réservation purgée, statut
 * inattendu), on renvoie 'unknown' et l'écran reste muet sur l'origine : mieux vaut ne
 * rien affirmer que ranger une annulation tardive parmi les absences — c'est exactement
 * ce genre d'amalgame qui fausserait le jugement du gérant.
 */
export function resolvePenaltyOrigin(type: string, bookingStatus: string | null): PenaltyOrigin {
  // 'warning' (sans suffixe) n'est émis QUE par cancel-booking : signal non ambigu.
  if (type === 'warning') return 'late_cancel'
  // 'warning_1' / 'warning_2' ne sont émis QUE par mark_attendance_atomic.
  if (type === 'warning_1' || type === 'warning_2') return 'noshow'

  if (bookingStatus === 'no_show') return 'noshow'
  if (bookingStatus === 'cancelled') return 'late_cancel'
  return 'unknown'
}

/**
 * FORME de la sanction, tolérante aux valeurs historiques.
 *
 * ⚠️ Aucune valeur brute de `type` n'est jamais montrée au gérant. Les valeurs connues
 * aujourd'hui sont 'warning_1', 'warning_2', 'suspension' et 'warning', mais la colonne
 * est un `text` libre et des lignes anciennes peuvent porter 'suspension_48h' ou
 * 'suspension_2w' : tout type préfixé `suspension` est donc traité comme une suspension,
 * sa durée réelle étant de toute façon lue sur expires_at (cf. `penaltyDuration`).
 * Le reste retombe sur 'unknown' → libellé générique.
 */
export function resolvePenaltyKind(type: string): PenaltyKind {
  if (type === 'warning_1') return 'warning_1'
  if (type === 'warning_2') return 'warning_2'
  if (type === 'warning') return 'warning_late'
  if (type === 'suspension' || type.startsWith('suspension_')) return 'suspension'
  return 'unknown'
}

/**
 * Durée d'une suspension, déduite de expires_at − applied_at.
 *
 * C'est la SEULE source fiable : GYM-175 écrit volontairement le type générique
 * 'suspension' et porte la durée réelle sur expires_at, précisément pour que la durée
 * reste configurable par salle (noshow_rules.suspension_hours) sans nouveau type.
 * Lire la durée dans le nom du type produirait « 48 h » chez une salle qui suspend 72 h.
 */
export function penaltyDuration(appliedAt: string | null, expiresAt: string | null): PenaltyDuration | null {
  if (!appliedAt || !expiresAt) return null
  const ms = new Date(expiresAt).getTime() - new Date(appliedAt).getTime()
  if (!Number.isFinite(ms) || ms <= 0) return null
  const hours = Math.round(ms / 3_600_000)
  if (hours <= 0) return null
  if (hours % 168 === 0) return { unit: 'weeks', value: hours / 168 }
  if (hours % 24 === 0) return { unit: 'days', value: hours / 24 }
  return { unit: 'hours', value: hours }
}

/** Une levée accordée par le gérant (gym_admin_actions, action_type='noshow_penalty_lift'). */
export interface PenaltyLift {
  id: string
  createdAt: string
  reason: string
  adminName: string
  /** metadata.lifted_suspended_until — la valeur exacte de suspended_until qui a été levée. */
  liftedSuspendedUntil: string | null
}

/**
 * 🔴 LE POINT DÉLICAT — apparier une levée à la pénalité qu'elle a neutralisée.
 *
 * Une levée (GYM-204) met profiles.suspended_until à NULL mais NE TOUCHE PAS à la ligne
 * penalties, qui garde son expires_at d'origine. C'est volontaire : on ne réécrit pas
 * l'historique. Sans ce rapprochement, l'écran montrerait « suspension en cours » alors
 * que l'accès a été rendu — exactement l'affichage naïf à éviter.
 *
 * LE FIX EST ICI, À L'AFFICHAGE. Deux niveaux, du plus sûr au plus tolérant :
 *   1. ÉGALITÉ EXACTE — admin-lift-suspension consigne dans metadata la valeur de
 *      suspended_until levée, qui est celle écrite par la même transaction que
 *      penalties.expires_at. Correspondance certaine, pas une heuristique.
 *   2. FENÊTRE TEMPORELLE — repli pour les levées d'avant GYM-204 ou dont le journal
 *      a échoué (l'insert est best-effort) : une levée tombée entre applied_at et
 *      expires_at ne peut avoir neutralisé que cette suspension-là.
 *
 * Une pénalité sans expires_at (un avertissement) n'est jamais « levée » : il n'y avait
 * aucun accès à rendre.
 */
export function findLiftForPenalty(
  penalty: { appliedAt: string | null; expiresAt: string | null },
  lifts: PenaltyLift[],
): PenaltyLift | null {
  if (!penalty.expiresAt) return null
  const expiresMs = new Date(penalty.expiresAt).getTime()
  if (!Number.isFinite(expiresMs)) return null

  const exact = lifts.find(
    (l) => l.liftedSuspendedUntil && new Date(l.liftedSuspendedUntil).getTime() === expiresMs,
  )
  if (exact) return exact

  const appliedMs = penalty.appliedAt ? new Date(penalty.appliedAt).getTime() : null
  if (appliedMs === null || !Number.isFinite(appliedMs)) return null
  return lifts.find((l) => {
    const at = new Date(l.createdAt).getTime()
    return Number.isFinite(at) && at >= appliedMs && at <= expiresMs
  }) ?? null
}

/**
 * Date de remise à zéro du compteur d'absences.
 *
 * Reproduit reset_noshow_counters() (GYM-175) : le délai court depuis la DERNIÈRE
 * absence constatée — `time_slots.starts_at` du dernier booking 'no_show' — et NON
 * depuis la dernière pénalité (le compteur s'incrémente même sous le 1er seuil, sans
 * qu'aucune pénalité soit tracée).
 *
 * Renvoie null quand il n'y a rien à annoncer : compteur à zéro, ou aucune absence
 * constatable (le cron traite ce cas en « orphan » et remet à zéro au prochain passage —
 * annoncer une date serait faux). Le cron ignore par ailleurs les membres encore
 * suspendus : l'appelant doit taire l'échéance tant que la suspension court.
 */
export function noshowResetDate(
  lastNoShowAt: string | null,
  noshowCount: number,
  resetAfterDays: number,
): Date | null {
  if (noshowCount <= 0 || !lastNoShowAt) return null
  const base = new Date(lastNoShowAt).getTime()
  if (!Number.isFinite(base)) return null
  return new Date(base + resetAfterDays * 86_400_000)
}
