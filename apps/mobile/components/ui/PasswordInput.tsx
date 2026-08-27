// GYM-239 — Champ de mot de passe. C'EST ICI QUE LES ESPACES SONT ROGNÉES.
//
// VÉCU LE 18/08 : un futur client de Dopamine n'a pas pu créer son compte. Son mot de
// passe de 17 caractères validait les cinq règles en vert, et la confirmation répondait
// « les mots de passe ne correspondent pas ». Le clavier iOS avait ajouté une espace après
// le caractère spécial final — invisible dans un champ masqué, impossible à diagnostiquer
// pour lui. Il a abandonné.
//
// ⚠️ POURQUOI À LA SAISIE, ET SURTOUT PAS À LA VALIDATION. Rogner au moment de valider
// l'INSCRIPTION créerait un compte enregistré SANS l'espace ; à la connexion, le membre
// retaperait son mot de passe AVEC, et serait refusé sans jamais comprendre pourquoi. Le
// trim doit valoir PARTOUT ou NULLE PART — et le seul endroit qui garantit « partout »,
// c'est le composant que tous les écrans utilisent. Un écran ne peut pas l'oublier.
//
// ⚠️ CE QUE ÇA NE FAIT PAS. `trim()` ne retire que les espaces de DÉBUT et de FIN :
// « Mon mot 2026! » reste intact, espaces intérieures comprises. Aucun mot de passe
// légitime ne se distingue d'un autre par une espace en bordure — un champ masqué ne
// permet ni de la voir ni de la retaper de façon fiable.
import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, type TextInputProps } from 'react-native'
import { Eye, EyeOff } from 'lucide-react-native'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { SEMANTIC } from '../../lib/theme/semantic'

interface PasswordInputProps extends Omit<TextInputProps, 'secureTextEntry'> {
  label?: string
  error?: string
}

export function PasswordInput({ label, error, style, onChangeText, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false)
  const { tokens } = useTheme()

  return (
    <View className="gap-1.5">
      {label && <Text className="font-dmsans-medium text-sm" style={{ color: tokens.onSurface }}>{label}</Text>}
      <View className="relative">
        {/* GYM-290 (addendum, décision C) — `border-red-400` valait #F87171, quatrième rouge ;
            #EF4444. Et `border` reste dans la classe : c'est une largeur (piège P-3). */}
        <TextInput
          secureTextEntry={!visible}
          // Rogné À CHAQUE FRAPPE : l'appelant ne voit jamais la valeur non rognée, donc
          // aucun écran ne peut en enregistrer une par inadvertance.
          onChangeText={(v) => onChangeText?.(v.trim())}
          placeholderTextColor={tokens.onBackgroundMuted}
          style={[
            {
              backgroundColor: tokens.surface,
              color: tokens.onSurface,
              borderColor: error ? SEMANTIC.danger : tokens.border,
            },
            style,
          ]}
          className="rounded-2xl border px-4 py-3.5 pr-12 font-dmsans text-sm"
          {...props}
        />
        <TouchableOpacity
          onPress={() => setVisible((v) => !v)}
          className="absolute right-3 top-3.5"
          hitSlop={8}
        >
          {visible ? (
            <EyeOff size={20} color={tokens.onBackgroundMuted} />
          ) : (
            <Eye size={20} color={tokens.onBackgroundMuted} />
          )}
        </TouchableOpacity>
      </View>
      {error && <Text className="font-dmsans text-xs" style={{ color: SEMANTIC.danger }}>{error}</Text>}
    </View>
  )
}
