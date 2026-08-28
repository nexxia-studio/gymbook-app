export interface ActivityItem {
  id: string
  name: string
  slug: string
  description: string
  durationMin: number
  defaultCapacity: number
  level: string
  icon: string
  color: string
  requiresMedicalCheck: boolean
  /** GYM-229 — false = accès libre, sans encadrement (Open Gym). true par défaut. */
  requiresCoach: boolean
  /** GYM-228 — masquée par défaut dans /planning (Open Gym). */
  hiddenInPlanning: boolean
  /**
   * GYM-231 — places que le gérant peut ajouter AU-DELÀ de la capacité d'un créneau de
   * cette activité. 0 = capacité dure (défaut, et comportement historique).
   */
  maxOverbook: number
  /**
   * 🔴 GYM-215 — `activities.image_url`. La colonne existe depuis l'origine ; AUCUNE
   * interface ne l'écrivait. Le mobile la consomme pourtant déjà (GYM-216,
   * `ActivityImage`), avec un repli aux initiales qui était donc le cas NOMINAL partout.
   *
   * ⚠️ ELLE N'EST PAS DANS `ActivityFormData`, ET C'EST VOULU. Voir `useActivities` :
   * l'image se persiste à l'envoi, pas à la soumission du formulaire.
   */
  imageUrl: string | null
  active: boolean
}

export interface ActivityFormData {
  name: string
  slug: string
  description: string
  durationMin: number
  defaultCapacity: number
  level: string
  icon: string
  color: string
  requiresMedicalCheck: boolean
  requiresCoach: boolean
  hiddenInPlanning: boolean
  maxOverbook: number
}
