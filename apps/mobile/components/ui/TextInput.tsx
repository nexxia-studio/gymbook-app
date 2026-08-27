import { View, Text, TextInput as RNTextInput, type TextInputProps as RNTextInputProps } from 'react-native'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { SEMANTIC } from '../../lib/theme/semantic'

interface TextInputProps extends RNTextInputProps {
  label?: string
  error?: string
  helper?: string
}

export function TextInput({ label, error, helper, style, ...props }: TextInputProps) {
  const { tokens } = useTheme()

  return (
    <View className="gap-1.5">
      {label && <Text className="font-dmsans-medium text-sm" style={{ color: tokens.onSurface }}>{label}</Text>}
      {/* ⚠️ `border` RESTE DANS LA CLASSE — c'est une LARGEUR, pas une couleur (piège P-3).
          Seul `border-move-border` s'en va ; retirer les deux effacerait le trait.
          GYM-290 (addendum, décision C) — `border-red-400` valait #F87171, quatrième rouge ;
          #EF4444. Deux rouges voisins, et l'un n'est pas l'autre. */}
      <RNTextInput
        placeholderTextColor={tokens.onBackgroundMuted}
        style={[
          {
            backgroundColor: tokens.surface,
            color: tokens.onSurface,
            borderColor: error ? SEMANTIC.danger : tokens.border,
          },
          style,
        ]}
        className="rounded-2xl border px-4 py-3.5 font-dmsans text-sm"
        {...props}
      />
      {error && <Text className="font-dmsans text-xs" style={{ color: SEMANTIC.danger }}>{error}</Text>}
      {!error && helper && <Text className="font-dmsans text-xs" style={{ color: tokens.onBackgroundMuted }}>{helper}</Text>}
    </View>
  )
}
