// GYM-386 — LES TEXTES DES RAPPELS, COMPOSÉS SANS RÉSEAU NI BASE.
//
// Le rappel « 2h » part pour tout cours qui commence entre +1h30 et +2h30
// (`get_pending_reminders`) : écrire « dans 2h » était faux une fois sur deux, et avec des
// cours rapprochés le membre ne savait plus duquel on parlait. Le rappel « 24h » a la même
// fenêtre de ±30 min : un cours à 00:15 pouvait être annoncé « demain » le jour même.
//
// La règle : AUCUNE durée, AUCUN « demain ». Le texte donne l'heure — et, pour le 24h, le
// jour — du cours, dans le fuseau de la salle. C'est vrai quelle que soit l'heure d'envoi.
//
// ⚠️ LE FUSEAU N'EST JAMAIS UNE CONSTANTE SEULE (piège DST, GYM-93) : il vient de
// `nexxia_gyms.timezone`, et `FUSEAU_REPLI` ne sert que si la colonne est vide ou illisible
// — le même repli que `get_pending_reminders` (`COALESCE(g.timezone, 'Europe/Brussels')`).

export const FUSEAU_REPLI = 'Europe/Brussels'
export const ACTIVITE_REPLI = 'Cours'

export interface ReminderTexts {
  /** Nom affiché de l'activité (« Cours » si elle n'en a pas). */
  activite: string
  /** « 18:00 » — heure locale de la salle, sur 24 h, deux chiffres. */
  heure: string
  /** « mardi 24 novembre » — jour local de la salle. */
  jour: string
  /** Le fuseau réellement employé (celui de la salle, ou le repli). */
  fuseau: string
  pushTitle: string
  pushBody: string
  /** Renseignés pour le rappel 24h, le seul qui envoie un email. */
  emailSubject: string | null
  emailTitle: string | null
  /** Phrase « {Activité} {jour} à {HH:mm} », sans balisage. */
  quand: string
}

/** Le fuseau de la salle s'il est exploitable par `Intl`, sinon le repli. */
export function fuseauSalle(timezone: unknown): string {
  if (typeof timezone !== 'string' || timezone.trim() === '') return FUSEAU_REPLI
  try {
    new Intl.DateTimeFormat('fr-BE', { timeZone: timezone.trim() })
    return timezone.trim()
  } catch {
    return FUSEAU_REPLI
  }
}

/**
 * Compose les textes d'un rappel.
 *
 * `startsAt` est l'instant du cours (ISO, tel que rendu par `get_pending_reminders`). Une
 * date illisible LÈVE : mieux vaut un rappel non envoyé — la boucle le journalise — qu'un
 * « Invalid Date » poussé sur le téléphone d'un membre.
 */
export function composeReminderTexts(
  type: '24h' | '2h',
  activityName: string | null | undefined,
  startsAt: string | Date,
  timezone: unknown,
): ReminderTexts {
  const instant = startsAt instanceof Date ? startsAt : new Date(startsAt)
  if (Number.isNaN(instant.getTime())) throw new RangeError(`starts_at illisible : ${String(startsAt)}`)

  const fuseau = fuseauSalle(timezone)
  const activite = typeof activityName === 'string' && activityName.trim() !== '' ? activityName.trim() : ACTIVITE_REPLI

  // `formatToParts` plutôt qu'une chaîne toute faite : le séparateur et l'ordre ne dépendent
  // plus de la version d'ICU. `h23` : minuit s'écrit 00:15, jamais 24:15.
  const parts = new Intl.DateTimeFormat('fr-BE', {
    timeZone: fuseau, hourCycle: 'h23',
    weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  }).formatToParts(instant)
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? ''
  const heure = `${p('hour').padStart(2, '0')}:${p('minute').padStart(2, '0')}`
  const jour = `${p('weekday')} ${p('day')} ${p('month')}`
  const quand = `${activite} ${jour} à ${heure}`

  if (type === '2h') {
    return {
      activite, heure, jour, fuseau, quand,
      pushTitle: "C'est bientôt ! 🏃",
      pushBody: `${activite} à ${heure} — à tout à l'heure !`,
      emailSubject: null,
      emailTitle: null,
    }
  }
  return {
    activite, heure, jour, fuseau, quand,
    pushTitle: 'Rappel cours 🏋️',
    pushBody: `${activite} à ${heure}`,
    emailSubject: `Rappel — ${quand}`,
    emailTitle: `Rappel — votre cours ${jour}`,
  }
}
