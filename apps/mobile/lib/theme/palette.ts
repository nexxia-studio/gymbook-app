// GYM-286b (A-7) — LA PALETTE D'AVATARS. Ni marque, ni signal : l'identité du MEMBRE.
//
// ═════════════════════════════════════════════════════════════════════════════════════
// POURQUOI CES SIX COULEURS NE SUIVENT PAS LA SALLE
// ═════════════════════════════════════════════════════════════════════════════════════
// La couleur d'un avatar identifie une PERSONNE, pas un club. Deux conséquences, et ce
// sont elles qui décident :
//
//   1. Elle doit rester la même quand le membre change de salle. Un membre inscrit dans
//      deux salles est le même membre ; voir sa pastille changer de couleur en basculant
//      lui dirait le contraire.
//   2. Elle ne doit pas se confondre avec la couleur de la salle. Une palette dérivée de
//      la marque produirait six variantes de la primaire — et un mur d'avatars où plus
//      personne ne se distingue de personne.
//
// ⚠️ LES SIX VALEURS SONT RECOPIÉES À L'IDENTIQUE, dans leur ordre d'origine. L'ordre
// n'est pas décoratif : c'est lui qui décide, via le hachage ci-dessous, quelle couleur
// reçoit quel nom. Le permuter changerait la couleur de tous les avatars de l'app —
// aucun pixel « nouveau », et pourtant tout le monde change de tête.
export const AVATAR_COLORS = ['#4ECDC4', '#FF6B6B', '#6C5CE7', '#FF8E53', '#A8E6CF', '#B8B8FF'] as const

/**
 * La couleur d'un membre, dérivée de son nom.
 *
 * 🔴 CE N'EST PAS L'ARRAY QUI ÉTAIT DUPLIQUÉ, C'EST LA FONCTION ENTIÈRE. `edit.tsx` et
 * `ProfileHeader.tsx` en portaient chacun une copie mot pour mot — y compris le hachage.
 * Deux listes qui doivent rester identiques et que rien n'obligeait à l'être : il
 * suffisait qu'une des deux gagne une couleur pour qu'un membre s'affiche en turquoise
 * sur son profil et en corail dans l'écran d'édition du MÊME profil.
 *
 * ⚠️ LE HACHAGE EST REPRIS TEL QUEL, décalages et débordements compris. Le « corriger »
 * redistribuerait les couleurs sur tous les membres existants.
 */
export function avatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}
