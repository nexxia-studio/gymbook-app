/**
 * L'avatar d'un coach : sa photo, ou ses initiales.
 *
 * 🔴 22/09 — LA PHOTO ÉTAIT ENREGISTRÉE ET N'ÉTAIT AFFICHÉE NULLE PART. La PR précédente a
 * branché le téléversement ; `coaches.photo_url` se remplit bien (vérifié en base) — mais
 * la liste des coachs continuait de montrer la bulle d'initiales. Aucun composant hors de
 * la modale ne lisait `photoUrl`.
 *
 * ⚠️ UN SEUL COMPOSANT, et c'est le point : la règle « photo, sinon initiales colorées »
 * doit vivre à UN endroit. Deux rendus d'avatar auraient divergé au premier ajustement —
 * c'est le motif de `ColorField` (GYM-285) et de `MediaUpload` (GYM-305).
 *
 * ⚠️ LES INITIALES RESTENT LE REPLI, jamais un trou gris. Un coach sans photo est le cas
 * NORMAL, pas une anomalie : la bulle colorée le nomme, elle ne signale rien.
 */

/** Couleur déterministe tirée du nom — identique d'un écran à l'autre. */
function nameToColor(name: string): string {
  const colors = ['#4ECDC4', '#FF6B6B', '#6C5CE7', '#FF8E53', '#A8E6CF', '#B8B8FF', '#FFB7C5', '#81ECEC']
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return colors[Math.abs(hash) % colors.length]
}

interface CoachAvatarProps {
  firstName: string
  lastName: string
  photoUrl: string | null
  /** Classes de taille — `h-14 w-14`, `h-20 w-20`… Le composant ne décide pas de sa taille. */
  className?: string
  /** Taille du texte des initiales, accordée à `className`. */
  textClassName?: string
}

export function CoachAvatar({
  firstName, lastName, photoUrl,
  className = 'h-14 w-14', textClassName = 'text-lg',
}: CoachAvatarProps) {
  const fullName = `${firstName} ${lastName}`.trim()
  const initials = `${firstName.charAt(0) || '?'}${lastName.charAt(0) || ''}`.toUpperCase()

  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        // ⚠️ `alt` VIDE, ET C'EST VOULU : le nom du coach est TOUJOURS écrit à côté de
        // l'avatar. Le répéter ferait lire le nom deux fois à un lecteur d'écran.
        alt=""
        // `object-cover` : une photo de personne se recadre (contrairement à un logo, que
        // `MediaUpload` pose en `object-contain`).
        className={`shrink-0 rounded-full object-cover ${className}`}
      />
    )
  }

  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full font-display font-black text-white ${className} ${textClassName}`}
      style={{ backgroundColor: nameToColor(fullName || '?') }}
    >
      {initials}
    </div>
  )
}
