// GYM-220 — Icône d'une activité, choisie par le gérant (activities.icon).
//
// Même motif que GYM-216 : l'icône était décidée EN DUR dans trois écrans
// (`activity === 'Open Gym' ? Dumbbell : Flame`), si bien que tous les cours sauf un
// portaient la même flamme — alors que le dashboard propose un sélecteur d'icônes depuis
// toujours et que la colonne est renseignée en production (Trophy, Zap, Activity, Flame,
// Leaf…). Le gérant choisissait, l'app ignorait.
//
// ⚠️ CONTRAT AVEC LE DASHBOARD — cette table reproduit EXACTEMENT la liste de
// apps/dashboard/src/components/settings/ActivityIcon.tsx (ICON_MAP), qui est la grille
// fermée du sélecteur. Les deux applications utilisent la même bibliothèque (lucide) avec
// les mêmes noms de composants : `lucide-react` côté dashboard, `lucide-react-native`
// côté mobile, en version 1.14.0 des deux côtés.
// Toute icône ajoutée au sélecteur du dashboard doit être ajoutée ICI.
//
// ⚠️ IMPORTS EXPLICITES, jamais un import dynamique de toute la bibliothèque : lucide
// compte des milliers d'icônes et le bundler ne peut pas élaguer ce qu'il ne voit pas.
// Seules ces 12 entrées pèsent dans le bundle.
import {
  Dumbbell, Zap, Flame, Activity, PersonStanding,
  Leaf, Waves, Baby, Heart, Timer, Trophy, Target,
  type LucideIcon,
} from 'lucide-react-native'

const ACTIVITY_ICONS: Record<string, LucideIcon> = {
  Dumbbell, Zap, Flame, Activity, PersonStanding,
  Leaf, Waves, Baby, Heart, Timer, Trophy, Target,
}

/**
 * Repli. Aligné sur celui du dashboard (`ICON_MAP[name] ?? Dumbbell`) : une activité sans
 * icône choisie porte le même symbole dans les deux applications.
 */
export const DEFAULT_ACTIVITY_ICON: LucideIcon = Dumbbell

/**
 * Résout un nom d'icône lucide vers son composant.
 *
 * 🔴 REPLI DÉFENSIF — c'est la leçon de GYM-178, où un statut inconnu faisait planter
 * l'app faute de valeur par défaut. `activities.icon` est un `text` libre écrit par une
 * AUTRE application, qui peut évoluer plus vite que le binaire déjà installé : le gérant
 * peut parfaitement choisir demain une icône que cette version ne connaît pas. Tous les
 * chemins mènent donc à un composant valide, jamais à `undefined` :
 *   · colonne vide ou null (cas de « Strength » en prod aujourd'hui) ;
 *   · nom absent de la table (icône ajoutée au dashboard après ce build) ;
 *   · entrée présente mais non résolue — garde-fou contre une future version de lucide
 *     qui retirerait un alias rétrocompatible (`Waves` n'est plus qu'un alias de
 *     `WavesHorizontal` en 1.x : un import silencieusement `undefined` rendrait
 *     `<undefined />`, soit un écran blanc, pas une icône manquante) ;
 *   · nom héritant d'Object.prototype — 'constructor', 'toString', 'valueOf'…
 *     Une simple indexation les résoudrait le long de la chaîne de prototypes et
 *     renverrait une fonction qui N'EST PAS un composant : `<Object />` fait planter le
 *     rendu. D'où `hasOwnProperty`, et non un test sur `undefined`.
 */
export function resolveActivityIcon(iconName: string | null | undefined): LucideIcon {
  if (!iconName) return DEFAULT_ACTIVITY_ICON
  const key = iconName.trim()
  if (!Object.prototype.hasOwnProperty.call(ACTIVITY_ICONS, key)) return DEFAULT_ACTIVITY_ICON
  return ACTIVITY_ICONS[key] ?? DEFAULT_ACTIVITY_ICON
}
