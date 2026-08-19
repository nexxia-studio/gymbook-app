// GYM-93 — Lecture d'une date DANS LE FUSEAU DE LA SALLE, sans offset écrit en dur.
//
// LE 25 OCTOBRE 2026, l'Europe repasse à l'heure d'hiver : Europe/Brussels passe de UTC+2
// à UTC+1. Nico ouvre début septembre — la bascule arrive cinq semaines plus tard, avec des
// membres inscrits. Tout code qui suppose un décalage constant se met à mentir ce jour-là.
//
// ⚠️ CE QUE CE MODULE REMPLACE, ET POURQUOI CE N'EST PAS COSMÉTIQUE.
// /revenus et /dashboard rangeaient les paiements en mois et en semaines avec :
//     new Date(new Date(iso).toLocaleString('en-US', { timeZone: 'Europe/Brussels' }))
// Deux défauts distincts, tous deux réels :
//   1. LE FUSEAU EST UNE CONSTANTE. `nexxia_gyms.timezone` existe et le reste du dashboard
//      le lit déjà (useGymTimezone). Ces deux écrans étaient les seuls à le figer — une
//      salle hors Belgique aurait vu son chiffre d'affaires rangé sur Bruxelles.
//   2. LE DÉTOUR PAR UNE CHAÎNE. Formater en 'en-US' puis REPARSER le résultat avec
//      `new Date()` n'est garanti par aucune spécification : le format de sortie d'Intl
//      n'est pas un format d'entrée normalisé. Ça fonctionne sur V8, ça a toujours
//      fonctionné, et c'est exactement le genre d'appui qui cède sans prévenir.
//
// La méthode retenue lit les COMPOSANTS de la date directement auprès d'Intl
// (`formatToParts`) : aucun offset n'est jamais écrit, aucune chaîne n'est reparsée, et le
// changement d'heure est absorbé parce qu'Intl applique les règles du fuseau À CETTE DATE.

/** Repli quand la salle n'a pas encore été chargée. Jamais un offset — un vrai fuseau. */
export const DEFAULT_TIMEZONE = 'Europe/Brussels'

/** Composants calendaires d'un instant, lus dans un fuseau donné. */
export interface GymDateParts {
  year: number
  /** 1-12, comme on l'écrit — PAS l'index 0-11 de Date. */
  month: number
  day: number
  hour: number
  minute: number
}

/**
 * Décompose un instant selon le fuseau de la salle.
 *
 * ⚠️ `formatToParts` avec 'en-CA' et hourCycle 'h23' : le format ISO-like de 'en-CA' évite
 * les surprises de 12/24 h, et h23 garantit que minuit se lit « 00 » et non « 24 ».
 */
export function gymDateParts(instant: Date | string, timeZone: string): GymDateParts {
  const d = typeof instant === 'string' ? new Date(instant) : instant
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0')
  return {
    year: get('year'), month: get('month'), day: get('day'),
    hour: get('hour'), minute: get('minute'),
  }
}

/**
 * Date calendaire 'YYYY-MM-DD' de cet instant DANS LA SALLE.
 *
 * 🔴 C'EST LA FONCTION QUE LE FILTRE DE /revenus ATTENDAIT. Une date « du jour » dérivée
 * d'un décalage figé désigne la veille pendant les heures où le décalage a changé — et sur
 * cet écran, ce n'est pas un cours décalé, c'est un chiffre d'affaires faux.
 */
export function gymDateString(instant: Date | string, timeZone: string): string {
  const p = gymDateParts(instant, timeZone)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/**
 * Instant → Date « miroir » dont les champs LOCAUX portent l'heure murale de la salle.
 *
 * Remplace le détour `toLocaleString('en-US')` → `new Date()`. Le résultat n'est PAS un
 * instant valide (il est décalé), et ne doit servir qu'à lire des composants calendaires
 * ou à comparer des clés de regroupement — jamais à réécrire une date en base.
 */
export function toGymWallClock(instant: Date | string, timeZone: string): Date {
  const p = gymDateParts(instant, timeZone)
  return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, 0, 0)
}
