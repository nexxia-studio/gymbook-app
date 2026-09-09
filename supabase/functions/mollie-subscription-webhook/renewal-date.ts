// ╔═══════════════════════════════════════════════════════════════════════════════════════╗
// ║  🔴 GYM-319 — LA DATE DU PREMIER RENOUVELLEMENT. UNE SEULE, POUR MOLLIE ET POUR NOUS. ║
// ╚═══════════════════════════════════════════════════════════════════════════════════════╝
//
// ─────────────────────────────────────────────────────────────────────────────────────
// L'INCIDENT — DOUBLE PRÉLÈVEMENT SUR TOUS LES ABONNEMENTS
// ─────────────────────────────────────────────────────────────────────────────────────
// Mesuré en production : 5 abonnements créés depuis le 30/08, 5 doubles prélèvements.
// Écart entre le paiement initial et le premier renouvellement : 5 HEURES pour l'un
// (Robin), puis 1,4 j · 1,4 j · 1,5 j · 2,4 j. Aucun membre n'a été épargné.
//
// Le `subPayload` de POST /v2/customers/{id}/subscriptions ne portait pas `startDate`.
// La documentation Mollie est explicite : sans ce champ, « la date du jour est utilisée ».
// Le premier prélèvement récurrent partait donc immédiatement — EN PLUS du paiement
// initial déjà encaissé au checkout. Les écarts observés (heures, jours) ne sont pas la
// date de départ : c'est le délai de mise en file de Mollie, l'abonnement ayant démarré
// le jour même dans les cinq cas.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// POURQUOI UN MODULE À PART, ET PAS TROIS LIGNES DANS index.ts
// ─────────────────────────────────────────────────────────────────────────────────────
// `index.ts` appelle `Deno.serve()` au chargement : l'importer démarre un serveur, donc
// rien de ce qu'il contient n'est atteignable par un banc. C'est exactement la raison
// qui a sorti `recovery-redirect.ts` de `auth-email-hook/index.ts` (GYM-313), et le motif
// est repris À L'IDENTIQUE. Une date qui commande un prélèvement doit pouvoir être
// vérifiée hors ligne, sur les cas qui font mal (bascule d'heure, fins de mois), sans
// appeler Mollie ni la base. Voir `renewal-date_test.ts`.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// 🔴 CALENDRIER LOCAL, JAMAIS D'ARITHMÉTIQUE SUR L'INSTANT
// ─────────────────────────────────────────────────────────────────────────────────────
// `startDate` est une date NUE (YYYY-MM-DD) : Mollie la lit dans le calendrier, pas sur
// un axe de temps. On lit donc d'abord le jour tel que LA SALLE l'a vécu — via
// `nexxia_gyms.timezone`, comme `slot-series-op` le fait déjà pour les créneaux — puis on
// compte les mois sur ces trois nombres. Aucune milliseconde n'entre dans le calcul.
//
// Les deux pièges que cela désamorce, et que « +1 mois sur le Date » ne désamorce pas :
//
//   1. UTC BRUT. Un paiement du 05/09 à 01h30 à Bruxelles vaut 2026-09-04T23:30Z. Prendre
//      les composantes UTC daterait le renouvellement du 04/10 — un jour AVANT la date
//      d'anniversaire réelle du membre. Toutes les salles étant en UTC+1/+2, la fenêtre
//      est celle de chaque nuit.
//
//   2. BASCULE D'HEURE (25/10). Entre le paiement de septembre et l'échéance d'octobre,
//      l'offset de Bruxelles passe de +02:00 à +01:00. Toute méthode qui ajoute
//      30 ou 31 × 86 400 000 ms, ou qui fige un offset, dérive d'une heure — et cette
//      heure fait changer de JOUR tout paiement conclu près de minuit. En ne manipulant
//      que des entiers de calendrier, la question ne se pose pas.
//
// ⚠️ CE MODULE NE DÉCIDE PAS DU NOMBRE DE PRÉLÈVEMENTS. `times` (durée − 1) est correct et
// reste tel quel : l'incident portait sur QUAND commence la série, pas sur sa longueur.

/**
 * Le jour, dans le calendrier de la salle, où tombe l'instant `at`.
 *
 * `formatToParts` plutôt que `format` : on lit les champs par leur nom, sans supposer la
 * forme que le locale donne à la chaîne. Même geste que `tzOffsetMs` dans `slot-series-op`.
 */
function zonedYmd(at: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(at)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 'NaN')
  return { year: get('year'), month: get('month'), day: get('day') }
}

/** Nombre de jours du mois `month` (1-12) de l'année `year`. Le jour 0 du mois suivant. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * Date du PREMIER renouvellement d'un abonnement : le paiement initial + un intervalle,
 * rendue en YYYY-MM-DD dans le fuseau de la salle.
 *
 * @param paidAt        Instant du paiement initial (`molliePayment.paidAt`).
 * @param timeZone      `nexxia_gyms.timezone` — le calendrier qui fait foi. Jamais UTC.
 * @param intervalMonths Longueur d'un intervalle, en mois. DOIT rester égale à l'intervalle
 *                       envoyé dans le même `subPayload` (`interval: '1 month'`).
 *
 * ⚠️ FINS DE MOIS : le jour est ramené au dernier jour du mois cible quand il n'y existe
 * pas. Un paiement du 31/08 donne le 30/09, et non le 01/10 — `setMonth` déborderait
 * silencieusement sur le mois suivant, décalant l'échéance d'un jour hors de la période
 * payée. Le 31/01 donne le 28/02, ou le 29 en année bissextile.
 */
export function firstRenewalDate(paidAt: Date, timeZone: string, intervalMonths: number): string {
  const { year, month, day } = zonedYmd(paidAt, timeZone)

  // Mois compté en base 0 sur un entier unique : le passage d'année se règle tout seul
  // (septembre + 4 mois = janvier de l'année suivante), sans cas particulier à écrire.
  const shifted = (month - 1) + intervalMonths
  const targetYear = year + Math.floor(shifted / 12)
  const targetMonth = (shifted % 12 + 12) % 12 + 1
  const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth))

  const pad = (n: number) => String(n).padStart(2, '0')
  return `${targetYear}-${pad(targetMonth)}-${pad(targetDay)}`
}

// ╔═══════════════════════════════════════════════════════════════════════════════════════╗
// ║  🔴 GYM-321 — LE TERME FAIT FOI, PAS LE COMPTEUR MOLLIE.                              ║
// ╚═══════════════════════════════════════════════════════════════════════════════════════╝
//
// L'AUDIT GYM-321 a établi que `completed` tombe SYSTÉMATIQUEMENT un mois avant `ends_at` :
// `max_payments` vaut `duration_months`, `payments_count` démarre à 1 (le checkout), et
// `times` vaut durée − 1 — la dernière échéance est donc à M+11 quand `ends_at` est à M+12.
// Comme `completed` n'est dans AUCUN prédicat d'accès, chaque abonnement perdait son
// dernier mois de droits. GYM-317 n'a pas créé ce défaut, il l'a doublé pour six membres.
//
// Cette fonction est la seule chose que le correctif ajoute : `index.ts` ne pose plus
// `completed` tant qu'il reste du terme.
//
// ⚠️ ELLE VIT ICI POUR ÊTRE ÉPROUVÉE, exactement comme `firstRenewalDate` : `index.ts`
// appelle `Deno.serve()` au chargement, donc rien de ce qu'il contient n'est atteignable
// par un banc. Voir `renewal-date_test.ts`.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// 🔴 POURQUOI CETTE COMPARAISON N'A PAS BESOIN DU FUSEAU DE LA SALLE
// ─────────────────────────────────────────────────────────────────────────────────────
// Le cadrage demandait de comparer « en heure locale de la salle, comme renewal-date.ts,
// à cause du piège DST du 25/10 ». Le piège est réel, mais il ne porte pas ici, et la
// distinction mérite d'être écrite parce qu'elle n'est pas évidente :
//
//   · `firstRenewalDate` FABRIQUE une date de calendrier (YYYY-MM-DD) en AJOUTANT des
//     mois. C'est de l'arithmétique sur des composantes — année, mois, jour — et c'est
//     là que le fuseau et la bascule d'heure décident du résultat.
//
//   · Ici, on ne fabrique rien et on n'ajoute rien : on COMPARE DEUX INSTANTS déjà
//     déterminés, `ends_at` (timestamptz, lu en base) et l'instant courant. L'ordre de
//     deux instants sur l'axe du temps est le MÊME dans tous les fuseaux. Aucune
//     composante n'est lue, donc ni l'heure d'été ni l'écart UTC n'ont de prise.
//
// ⚠️ « PAS EN UTC BRUT » EST RESPECTÉ AU SENS OÙ LE MODULE L'ENTEND : ce qui est proscrit
// plus haut, c'est de lire les COMPOSANTES UTC d'un instant (`getUTCMonth()` & co). On n'en
// lit aucune.
//
// 🔴 ET C'EST LA MÊME COMPARAISON QUE PARTOUT AILLEURS, ce qui est l'argument décisif :
// `expire_subscriptions()` teste `ends_at < now()` et `notExpiredFilter()` teste
// `ends_at.gt.<instant>` — deux comparaisons d'instants. Employer ici une règle de
// CALENDRIER aurait fait de ce site le seul à décider autrement du même terme, et aurait
// pu écarter jusqu'à 24 h dans le sens qui COUPE LES DROITS TROP TÔT — c'est-à-dire
// reproduire en miniature le défaut que ce lot corrige. Le fuseau aurait par ailleurs
// coûté une lecture de `nexxia_gyms` sur le chemin de chaque renouvellement.

/**
 * Reste-t-il du terme après `at` ? `true` ⇒ des droits sont encore dus.
 *
 * ⚠️ LE REPLI EST `false`, DONC L'ANCIEN COMPORTEMENT. Sans terme lisible — colonne à
 * `null`, ou date illisible — on ne peut pas affirmer qu'il reste des droits, et l'appelant
 * écrit alors `completed` comme avant ce lot. C'est le sens conservateur : `ends_at` est
 * la source de vérité, et une source muette ne fabrique pas de droits.
 *
 * ⚠️ ET C'EST AUSSI LE SEUL SENS SÛR pour `ends_at IS NULL`. `expire_subscriptions()` exige
 * `ends_at IS NOT NULL` : une ligne sans terme laissée `active` ne serait JAMAIS clôturée
 * par personne, et ouvrirait des droits perpétuels. Aucune ligne n'est dans ce cas en
 * production (vérifié : 0 sur 7), mais la colonne est nullable et rien ne l'interdit.
 */
export function hasRemainingTerm(
  endsAt: string | Date | null | undefined,
  at: Date = new Date(),
): boolean {
  if (endsAt === null || endsAt === undefined || endsAt === '') return false
  const t = endsAt instanceof Date ? endsAt.getTime() : Date.parse(endsAt)
  if (Number.isNaN(t)) return false
  return t > at.getTime()
}
