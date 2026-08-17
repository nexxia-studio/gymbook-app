// GYM-228 — Horaires d'ouverture : lecture, écriture, et ce qu'ils autorisent.
//
// ⚠️ TOUT EST EN HEURE LOCALE DE LA SALLE. « 07:00 » signifie « 7 h à l'horloge », jamais
// un instant absolu — même discipline que GYM-230 (lib/recurrence). La conversion en UTC
// n'intervient qu'au moment de poser un créneau, occurrence par occurrence.
//
// Le module ne connaît PAS l'Open Gym : il décrit quand la salle est ouverte, un point.
// C'est ce qui permettra de s'en servir plus tard pour l'afficher au membre ou vérifier
// qu'un cours ne déborde pas de l'ouverture.

/** Clés de jour, dans l'ordre ISO — celui de getMonday, WEEKDAY_KEYS et RRule. */
export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type DayKey = (typeof DAY_KEYS)[number]

/** Un jour d'ouverture. `null` = FERMÉ — jamais un objet aux heures vides, qui se lirait
 *  aussi bien « fermé » que « ouvert la nuit ». */
export interface DayHours {
  open: string   // 'HH:MM' local
  close: string  // 'HH:MM' local
}

export type OpeningHours = Record<DayKey, DayHours | null>

/**
 * Horaires proposés à la première ouverture de l'écran de réglages.
 *
 * ⚠️ CE N'EST PAS UN DÉFAUT EN BASE. La migration n'écrit rien : ces valeurs ne sont
 * qu'une SUGGESTION de formulaire, que le gérant voit et valide. Un défaut posé en base
 * serait invisible — donc jamais relu, jamais corrigé, et pourtant utilisé pour générer
 * des centaines de créneaux.
 *
 * 07:00–22:00 sept jours sur sept : c'est le fonctionnement décrit par Nico.
 */
export const SUGGESTED_HOURS: OpeningHours = {
  mon: { open: '07:00', close: '22:00' },
  tue: { open: '07:00', close: '22:00' },
  wed: { open: '07:00', close: '22:00' },
  thu: { open: '07:00', close: '22:00' },
  fri: { open: '07:00', close: '22:00' },
  sat: { open: '07:00', close: '22:00' },
  sun: { open: '07:00', close: '22:00' },
}

/**
 * Lit la valeur brute de `nexxia_gyms.opening_hours`.
 *
 * Tolérant par construction : une clé manquante devient « fermé » plutôt que de faire
 * échouer la lecture. Un horaire à moitié saisi ne doit pas rendre l'écran de réglages
 * inutilisable — c'est précisément là qu'on va le corriger.
 */
export function parseOpeningHours(raw: unknown): OpeningHours | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const src = raw as Record<string, unknown>
  const out = {} as OpeningHours
  for (const day of DAY_KEYS) {
    const v = src[day]
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = v as Record<string, unknown>
      out[day] = typeof o.open === 'string' && typeof o.close === 'string'
        ? { open: o.open, close: o.close }
        : null
    } else {
      out[day] = null
    }
  }
  return out
}

/** 'HH:MM' → minutes depuis minuit. -1 si la chaîne est inexploitable. */
export function timeToMinutes(time: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time)
  if (!m) return -1
  const h = Number(m[1]); const min = Number(m[2])
  if (h > 23 || min > 59) return -1
  return h * 60 + min
}

/** minutes depuis minuit → 'HH:MM'. */
export function minutesToTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/**
 * Un jour est-il exploitable ? Ouvert, et la fermeture APRÈS l'ouverture.
 *
 * Une salle « ouverte de 22:00 à 07:00 » (à cheval sur minuit) n'est pas gérée, et c'est
 * délibéré : aucun créneau du produit ne franchit la nuit — la contrainte
 * `time_slots_check (ends_at > starts_at)` le refuserait de toute façon. Le jour est alors
 * traité comme non exploitable plutôt que d'être interprété au hasard.
 */
export function isUsableDay(hours: DayHours | null): boolean {
  if (!hours) return false
  const o = timeToMinutes(hours.open)
  const c = timeToMinutes(hours.close)
  return o >= 0 && c >= 0 && c > o
}

/** Index de jour ISO (0 = lundi) d'une date locale 'YYYY-MM-DD'. */
export function dayKeyOf(dateStr: string): DayKey {
  const [y, m, d] = dateStr.split('-').map(Number)
  // Encodée à minuit UTC : c'est une case de calendrier, pas un instant (cf. lib/recurrence).
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return DAY_KEYS[(dow + 6) % 7]
}
