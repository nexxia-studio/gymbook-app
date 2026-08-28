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
      {/* 🔴 GYM-293b — LE CHAMP A SES PROPRES JETONS, ET C'EST LA CORRECTION.
          Il portait `surface` — la couleur de la CARTE qui le contient. Chez Dopamine,
          blanc sur blanc, un trait clair suffisait à le situer ; chez une salle à la carte
          colorée, le champ disparaissait dans son support (recette Q3/Q5 : rose sur rose).
          Le placeholder, lui, portait `onBackgroundMuted` : un gris validé sur le FOND de
          l'app, posé dans un champ sur une CARTE — deux surfaces sans rapport garanti.
          ⚠️ EN SINGLE, RIEN NE BOUGE : les quatre jetons sont figés dans `DOPAMINE_THEME`
          sur les quatre valeurs employées jusqu'ici, à l'octet. */}
      {/* ⚠️ `border` RESTE DANS LA CLASSE — c'est une LARGEUR, pas une couleur (piège P-3).
          Seul `border-move-border` s'en va ; retirer les deux effacerait le trait.
          GYM-290 (addendum, décision C) — `border-red-400` valait #F87171, quatrième rouge ;
          #EF4444. Deux rouges voisins, et l'un n'est pas l'autre. */}
      <RNTextInput
        placeholderTextColor={tokens.onFieldMuted}
        style={[
          {
            backgroundColor: tokens.field,
            color: tokens.onField,
            borderColor: error ? SEMANTIC.danger : tokens.fieldBorder,
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
