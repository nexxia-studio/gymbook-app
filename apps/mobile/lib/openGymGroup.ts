// GYM-228 (volet 5) — Regrouper les créneaux en accès libre d'une journée en UNE carte.
//
// POURQUOI C'EST BLOQUANT. La génération produit 14 créneaux Open Gym PAR JOUR. Sans
// regroupement, /accueil et /planning afficheraient quatorze cartes « Open Gym » avant
// d'atteindre le premier vrai cours : l'app deviendrait illisible, et c'est la raison pour
// laquelle les créneaux ne sont pas encore générés en production.
//
// ⚠️ ON AGRÈGE L'OFFRE, JAMAIS LES RÉSERVATIONS. Un membre inscrit à un Open Gym de 8 h
// doit continuer de voir CE créneau, à cette heure, dans « Mes réservations » et dans son
// historique. Ce module ne touche donc qu'aux listes d'offre (accueil, planning) — les
// favoris, réservations et historique passent par d'autres chemins, non modifiés.

/**
 * Forme minimale attendue : les deux hooks (accueil, planning) la satisfont.
 *
 * ⚠️ STRICTEMENT CE QU'IL FAUT POUR REGROUPER, rien de plus. `HomeSlot` et `ScheduleSlot`
 * ont divergé (l'un porte `activityColor` et `imageUrl`, l'autre `color` et pas d'image) :
 * exiger ici une couleur ou une capacité forcerait à renommer des champs dans un hook
 * pour satisfaire l'autre. Les cartes lisent ces champs sur LEURS créneaux, qu'elles
 * connaissent précisément (le groupe est générique).
 */
export interface GroupableSlot {
  id: string
  activityId: string
  date: string
  time: string      // 'HH:MM' local
  endTime: string   // 'HH:MM' local
  activity: string
  requiresCoach: boolean
}

export interface OpenGymGroup<T extends GroupableSlot> {
  /** Clé stable pour le rendu : une carte par (activité, jour). */
  key: string
  activityId: string
  activity: string
  date: string
  /** Amplitude RÉELLE de la journée. */
  from: string
  to: string
  /** Les créneaux du jour, dans l'ordre — accessibles au clic pour réserver. */
  slots: T[]
}

/**
 * Une entrée de liste : soit un cours normal, soit un groupe d'accès libre.
 *
 * Type discriminé plutôt que deux listes séparées : l'ordre chronologique de la journée
 * doit être préservé. Rendre les groupes en tête ferait apparaître l'Open Gym de 20 h
 * avant le cours de 9 h.
 */
export type DayEntry<T extends GroupableSlot> =
  | { kind: 'slot'; slot: T }
  | { kind: 'openGym'; group: OpenGymGroup<T> }

/**
 * Seuil de regroupement.
 *
 * ⚠️ À DEUX, PAS À UN. Un jour où un seul créneau d'accès libre subsiste (les cours ont
 * exclu tout le reste) n'a rien à agréger : « Open Gym — de 7 h à 9 h » ne dit pas plus que
 * la carte du créneau lui-même, et masquerait ses places disponibles derrière un clic.
 * C'est aussi le seuil qu'applique WeekSlots (`slots.length <= 1 → null`), qu'on réutilise
 * pour le détail : en deçà, il ne rendrait rien.
 */
export const GROUP_MIN_SLOTS = 2

/**
 * Transforme les créneaux d'UNE journée en entrées de liste.
 *
 * ⚠️ CRITÈRE : `requiresCoach === false`. Une activité sans coach est par nature un accès
 * libre (GYM-229) — c'est la même règle que le dashboard applique pour choisir ce qu'il
 * peut générer.
 *   · PAS le NOM « Open Gym » : un libellé se renomme, et ce projet l'a déjà vécu
 *     (GYM-176, coachs renommés en une semaine).
 *   · PAS `hidden_in_planning` : c'est un réglage du planning GÉRANT, sans rapport avec ce
 *     que voit le membre. La colonne n'est d'ailleurs pas lue par l'app mobile.
 *
 * ⚠️ UNE CARTE PAR (ACTIVITÉ, JOUR), jamais une carte fourre-tout : une salle peut avoir un
 * espace cardio ET un espace musculation, tous deux en accès libre. Les fondre ferait
 * disparaître l'un des deux.
 */
export function groupDayEntries<T extends GroupableSlot>(daySlots: T[]): DayEntry<T>[] {
  const byActivity = new Map<string, T[]>()
  for (const s of daySlots) {
    if (s.requiresCoach) continue
    const list = byActivity.get(s.activityId)
    if (list) list.push(s)
    else byActivity.set(s.activityId, [s])
  }

  // Activités effectivement regroupées : en deçà du seuil, les créneaux restent des cartes
  // normales et ne doivent PAS être retirés de la liste.
  const grouped = new Set<string>()
  const groups: OpenGymGroup<T>[] = []

  for (const [activityId, slots] of byActivity) {
    if (slots.length < GROUP_MIN_SLOTS) continue
    grouped.add(activityId)

    // ⚠️ AMPLITUDE CALCULÉE SUR LES CRÉNEAUX RÉELLEMENT PRÉSENTS, jamais sur les horaires
    // d'ouverture de la salle. Si les cours du soir ont fait sauter l'Open Gym après 17 h,
    // la carte doit annoncer « de 7 h à 17 h » — promettre 22 h enverrait le membre devant
    // une porte sans créneau à réserver.
    //
    // Comparaison lexicographique sur 'HH:MM' : sûre parce que le format est à largeur
    // fixe et zéro-paddé (07:00 < 18:00 se compare correctement en chaînes).
    const ordered = [...slots].sort((a, b) => a.time.localeCompare(b.time))
    const from = ordered[0].time
    const to = ordered.reduce((max, s) => (s.endTime > max ? s.endTime : max), ordered[0].endTime)

    groups.push({
      key: `og-${activityId}-${ordered[0].date}`,
      activityId,
      activity: ordered[0].activity,
      date: ordered[0].date,
      from,
      to,
      slots: ordered,
    })
  }

  // Reconstitution dans l'ORDRE CHRONOLOGIQUE : chaque groupe prend la place de son
  // PREMIER créneau, les autres sont retirés. La journée se lit donc toujours de haut en
  // bas dans l'ordre des heures.
  const entries: DayEntry<T>[] = []
  const emitted = new Set<string>()

  for (const s of daySlots) {
    if (!grouped.has(s.activityId)) {
      entries.push({ kind: 'slot', slot: s })
      continue
    }
    if (emitted.has(s.activityId)) continue
    emitted.add(s.activityId)
    const group = groups.find((g) => g.activityId === s.activityId)
    if (group) entries.push({ kind: 'openGym', group })
  }

  return entries
}

/**
 * 'HH:MM' → '7h' / '7h30'. Un membre lit une heure, pas un horaire de train.
 *
 * Partagé par les deux cartes (accueil, planning) : deux formatages de la même amplitude
 * finiraient par diverger, et le membre verrait « de 7h à 22h » ici et « 07:00 » là.
 */
export function formatAmplitudeHour(time: string): string {
  const [h, m] = time.split(':')
  const hh = String(Number(h))
  return m === '00' ? `${hh}h` : `${hh}h${m}`
}

/**
 * GYM-242 — Nombre de créneaux ENCORE DISPONIBLES dans un groupe d'accès libre.
 *
 * 🔴 CE QU'ON REMPLACE. La carte agrégée affichait « 60 places » : la SOMME des capacités
 * de créneaux INDÉPENDANTS. Pour un membre, ce nombre ne veut rien dire — il ne peut
 * réserver qu'UN créneau, à 8 places. Additionner des capacités qui ne se cumulent nulle
 * part produisait un chiffre impressionnant et faux.
 *
 * Ce qui l'aide à décider, c'est COMBIEN DE CRÉNEAUX lui restent ouverts aujourd'hui :
 * « 8 créneaux » = il a le choix, « 2 créneaux » = ça se remplit, « 0 » = complet.
 *
 * ⚠️ MÊME PRÉDICAT QUE LES CARTES DE COURS NORMALES : `booked < capacity`, celui
 * qu'emploient déjà WeekSlots et les cartes de créneau. On n'écrit pas un second calcul de
 * disponibilité — deux définitions de « disponible » finiraient par diverger.
 *
 * ⚠️ LES CARTES DE COURS NORMALES NE CHANGENT PAS. Elles continuent d'annoncer des PLACES
 * (« 12 places », « 2 places »), et c'est juste : sur un créneau unique, la place est
 * l'unité qui compte. Seule la carte AGRÉGÉE change de langage, parce qu'elle seule
 * additionnait des capacités indépendantes.
 */
export function availableSlotCount<T extends GroupableSlot & { capacity: number; booked: number }>(
  slots: T[],
): number {
  return slots.filter((s) => s.booked < s.capacity).length
}
