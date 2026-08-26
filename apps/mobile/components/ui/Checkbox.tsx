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
  return (
    <TouchableOpacity onPress={onToggle} activeOpacity={0.7} className="flex-row items-start gap-3">
      <View
        className="mt-0.5 h-5 w-5 items-center justify-center rounded-md border"
        style={
          checked
            ? { borderColor: tokens.accent, backgroundColor: tokens.accent }
            : { borderColor: tokens.border, backgroundColor: tokens.surface }
        }
      >
        {checked && <Check size={14} color={tokens.onAccent} />}
      </View>
      <View className="flex-1">{children}</View>
    </TouchableOpacity>
  )
}
