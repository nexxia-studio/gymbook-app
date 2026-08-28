// GYM-286b — migré vers les jetons. Voir docs/GYM-286-inventaire.md.
import { type ReactNode } from 'react'
import { TouchableOpacity, View } from 'react-native'
import { Check } from 'lucide-react-native'
import { useTheme } from '../../lib/theme/ThemeProvider'

interface CheckboxProps {
  checked: boolean
  onToggle: () => void
  children: ReactNode
}

export function Checkbox({ checked, onToggle, children }: CheckboxProps) {
  const { tokens } = useTheme()

  // ⚠️ `onAccent`, PAS `onSurface` — piège P-6, sur un cas où il se voit.
  // Le ✓ n'est rendu QUE lorsque la case est cochée, c'est-à-dire remplie de
  // `tokens.accent`. C'est donc une encre posée sur la couleur d'action de la salle, et
  // `onAccent` est la seule que le garde-fou ait validée pour cet emploi. Les deux valent
  // #111111 chez Dopamine ; chez une salle à l'action sombre, `onSurface` écrirait un ✓
  // noir sur une case noire.
  // 🔴 GYM-293b — LA CASE VIDE DOIT SE VOIR, ET ELLE NE SE VOYAIT PAS.
  //
  // Décochée, elle valait `surface` sur `surface` : la couleur de la carte, posée sur la
  // carte. Il ne restait donc QUE son trait `border` pour dire qu'une case existe — un
  // jeton dérivé pour SÉPARER (filet de carte, trait de liste), à un contraste bien
  // au-dessous de 3:1. Sur l'écran d'inscription d'une salle claire, deux consentements
  // OBLIGATOIRES étaient ainsi invisibles : le membre ne voyait pas ce qu'on lui demandait
  // de cocher, et l'inscription échouait sur une erreur qui ne désignait rien à l'écran.
  //
  // `field`/`fieldBorder` sont les jetons de ce rôle exact — un creux et son contour à
  // SEUIL_SURFACE. La case décochée est un champ vide ; elle se peint comme tel.
  //
  // ⚠️ COCHÉE, RIEN NE CHANGE : la case pleine porte déjà `accent`, qui se détache par
  // construction. Seul l'état vide était en défaut, et seul lui est corrigé.
  //
  // ⚠️ EN SINGLE, AUCUN PIXEL NE BOUGE : `field` vaut #FFFFFF (= `surface`) et
  // `fieldBorder` vaut #E8E6E0 (= `border`), figés dans `DOPAMINE_THEME`.
  return (
    <TouchableOpacity onPress={onToggle} activeOpacity={0.7} className="flex-row items-start gap-3">
      <View
        className="mt-0.5 h-5 w-5 items-center justify-center rounded-md border"
        style={
          checked
            ? { borderColor: tokens.accent, backgroundColor: tokens.accent }
            : { borderColor: tokens.fieldBorder, backgroundColor: tokens.field }
        }
      >
        {checked && <Check size={14} color={tokens.onAccent} />}
      </View>
      <View className="flex-1">{children}</View>
    </TouchableOpacity>
  )
}
