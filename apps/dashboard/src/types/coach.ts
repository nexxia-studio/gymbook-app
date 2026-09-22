export interface CoachItem {
  id: string
  firstName: string
  lastName: string
  bio: string
  photoUrl: string | null
  specialties: string[]
  sites: string[]
  sortOrder: number
  active: boolean
}

export interface CoachFormData {
  /**
   * Identifiant PRÉ-TIRÉ à la création, pour que la photo et la ligne partagent la même
   * identité dès le premier geste (le chemin dans `gym-media` est déterministe, cf.
   * `MediaUpload`). Absent en édition : la fiche a déjà le sien.
   */
  id?: string
  firstName: string
  lastName: string
  bio: string
  /**
   * 🔴 22/09 — CE CHAMP MANQUAIT, ET C'EST TOUT LE DÉFAUT. `CoachItem.photoUrl` était LU
   * depuis `coaches.photo_url`, mais aucun formulaire ne pouvait l'écrire : le bouton
   * « Téléverser » de la modale n'avait ni `onClick`, ni `<input type="file">`, ni zone
   * de dépôt. Le gérant cliquait sur un élément décoratif.
   *
   * `null` = pas de photo (l'avatar retombe sur les initiales colorées).
   */
  photoUrl: string | null
  specialties: string[]
  sites: string[]
  sortOrder: number
  active: boolean
}
