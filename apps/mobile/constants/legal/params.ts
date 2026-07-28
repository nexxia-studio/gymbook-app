// GYM-197 — Paramètres opérationnels injectés dans les textes contractuels.
//
// PRINCIPE : le gérant configure des PARAMÈTRES, Viniz fournit le CADRE JURIDIQUE. Le
// gabarit reste ici, dans le code, versionné ; seules les valeurs de la salle y sont
// injectées. Le gérant ne rédige JAMAIS de prose contractuelle.
//
// PÉRIMÈTRE STRICT : seuls les paramètres OPÉRATIONNELS sont templatés (réservations,
// liste d'attente, barème d'absences). Les clauses juridiques — responsabilité, données
// personnelles, rétractation, droit applicable, litiges, âge minimum, préavis de
// modification — restent FIXES : elles ne dépendent pas de la salle.
//
// ⚠️ MIROIR : apps/dashboard/src/lib/legalParams.ts doit garder des noms de placeholders
// et une logique STRICTEMENT identiques (les deux runtimes ne partagent pas de code).
// Toute modification ici doit y être reportée — même discipline que CONSUMING_STATUSES
// (GYM-193).

/** Valeurs opérationnelles d'une salle. `maxActiveBookings: null` = aucune limite. */
export interface LegalParams {
  maxActiveBookings: number | null
  waitlistConfirmationMinutes: number
  warning1At: number
  warning2At: number
  suspensionAt: number
  suspensionHours: number
  escalatedSuspensionHours: number
  resetAfterDays: number
}

/**
 * Repli = DEFAULT du schéma (nexxia_gyms.max_active_bookings = 3, noshow_rules = 1/2/3,
 * 48 h, 336 h, 90 j). Utilisé si le chargement échoue (réseau, RLS) : un membre doit
 * TOUJOURS pouvoir lire ses CGU, avec des valeurs plausibles plutôt qu'un écran vide.
 */
export const DEFAULT_LEGAL_PARAMS: LegalParams = {
  maxActiveBookings: 3,
  waitlistConfirmationMinutes: 30,
  warning1At: 1,
  warning2At: 2,
  suspensionAt: 3,
  suspensionHours: 48,
  escalatedSuspensionHours: 336,
  resetAfterDays: 90,
}

type Lang = 'fr' | 'en'

/** Durée lisible : heures en dessous d'un jour, jours au-delà. Accords corrects. */
function formatDuration(hours: number, lang: Lang): string {
  if (hours < 24) {
    return lang === 'fr'
      ? `${hours} heure${hours > 1 ? 's' : ''}`
      : `${hours} hour${hours > 1 ? 's' : ''}`
  }
  const days = Math.round(hours / 24)
  return lang === 'fr'
    ? `${days} jour${days > 1 ? 's' : ''}`
    : `${days} day${days > 1 ? 's' : ''}`
}

/** Rang ordinal : 1ʳᵉ / 2ᵉ / 3ᵉ — 1st / 2nd / 3rd. */
function ordinal(n: number, lang: Lang): string {
  if (lang === 'fr') return n === 1 ? '1ʳᵉ' : `${n}ᵉ`
  if (n === 1) return '1st'
  if (n === 2) return '2nd'
  if (n === 3) return '3rd'
  return `${n}th`
}

/**
 * Art. 6.2 — limite de réservations simultanées.
 * CLAUSE ENTIÈRE et non simple valeur : `null` signifie « aucune limite », ce qu'aucun
 * chiffre ne peut exprimer. La phrase doit alors se REFORMULER, jamais afficher
 * « maximum null ».
 */
function bookingLimitClause(p: LegalParams, lang: Lang): string {
  if (p.maxActiveBookings === null) {
    return lang === 'fr'
      ? "Le nombre de réservations confirmées à venir simultanément n'est pas limité."
      : 'There is no limit on the number of confirmed upcoming bookings at a time.'
  }
  const n = p.maxActiveBookings
  return lang === 'fr'
    ? `Maximum **${n} réservation${n > 1 ? 's' : ''} confirmée${n > 1 ? 's' : ''} à venir** simultanément.`
    : `Maximum **${n} confirmed upcoming booking${n > 1 ? 's' : ''}** at a time.`
}

/**
 * Art. 9.2 — barème d'absences.
 * CLAUSE ENTIÈRE : sa STRUCTURE change avec les seuils. Chez Dopamine
 * (w1=1, w2=2, susp=2) il n'y a qu'un avertissement ; avec les valeurs par défaut
 * (susp=3) il y en a deux. Un simple remplacement de valeurs ne saurait l'exprimer.
 * Rejoue l'ordre d'évaluation de public.mark_attendance_atomic (GYM-175).
 */
function noshowScaleClause(p: LegalParams, lang: Lang): string {
  const simple = formatDuration(p.suspensionHours, lang)
  const escalated = formatDuration(p.escalatedSuspensionHours, lang)
  const steps: string[] = []

  // Avertissements : tous les rangs strictement inférieurs au seuil de suspension.
  const firstWarn = p.warning1At
  const secondWarn = p.warning2At < p.suspensionAt ? p.warning2At : null
  if (firstWarn < p.suspensionAt) {
    steps.push(lang === 'fr'
      ? `**${ordinal(firstWarn, 'fr')} absence** = avertissement`
      : `**${ordinal(firstWarn, 'en')} absence** = warning`)
  }
  if (secondWarn !== null && secondWarn > firstWarn) {
    steps.push(lang === 'fr'
      ? `**${ordinal(secondWarn, 'fr')}** = second avertissement`
      : `**${ordinal(secondWarn, 'en')}** = second warning`)
  }
  steps.push(lang === 'fr'
    ? `**${ordinal(p.suspensionAt, 'fr')}** = suspension des réservations pendant **${simple}**`
    : `**${ordinal(p.suspensionAt, 'en')}** = booking suspension for **${simple}**`)
  steps.push(lang === 'fr'
    ? `**${ordinal(p.suspensionAt + 1, 'fr')} et suivantes** = suspension de **${escalated}**`
    : `**${ordinal(p.suspensionAt + 1, 'en')} and beyond** = suspension for **${escalated}**`)

  return (lang === 'fr' ? 'Barème automatique cumulatif : ' : 'Automatic cumulative scale: ')
    + steps.join(' · ') + '.'
}

/** Art. 9.3 — remise à zéro automatique du compteur (GYM-175). */
function counterResetClause(p: LegalParams, lang: Lang): string {
  const d = p.resetAfterDays
  return lang === 'fr'
    ? `Le compteur d'absences est cumulatif ; il est automatiquement remis à zéro après **${d} jour${d > 1 ? 's' : ''}** sans nouvelle absence.`
    : `The absence counter is cumulative; it is automatically reset after **${d} day${d > 1 ? 's' : ''}** without a new absence.`
}

/**
 * Table des substitutions. Chaque clé DOIT être résolue : le jeu de paramètres est
 * toujours complet (typé, avec repli), donc aucun placeholder ne peut rester en place.
 */
function substitutions(p: LegalParams, lang: Lang): Record<string, string> {
  const m = p.waitlistConfirmationMinutes
  return {
    booking_limit_clause: bookingLimitClause(p, lang),
    noshow_scale_clause: noshowScaleClause(p, lang),
    counter_reset_clause: counterResetClause(p, lang),
    waitlist_confirmation_minutes: lang === 'fr'
      ? `${m} minute${m > 1 ? 's' : ''}`
      : `${m}-minute`,
  }
}

/**
 * Rend un document légal en injectant les paramètres de la salle.
 *
 * GARDE-FOU FINAL : après substitution, tout `{{…}}` résiduel est retiré. Afficher un
 * placeholder brut dans des CGU serait pire que la valeur fausse qu'on corrige — mieux
 * vaut une phrase amputée d'un détail qu'un document qui affiche du code.
 */
export function renderLegal(markdown: string, params: LegalParams, lang: Lang): string {
  const table = substitutions(params, lang)
  let out = markdown.replace(/\{\{(\w+)\}\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(table, key) ? table[key] : whole,
  )
  if (/\{\{\w+\}\}/.test(out)) {
    console.warn('[legal] placeholder non résolu — retiré du rendu')
    out = out.replace(/\s*\{\{\w+\}\}/g, '')
  }
  return out
}
