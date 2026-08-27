import { TouchableOpacity, Text, ActivityIndicator, type ViewStyle } from 'react-native'
import { useTheme } from '../../lib/theme/ThemeProvider'

type Variant = 'primary' | 'secondary' | 'ghost'

interface ButtonProps {
  title: string
  onPress: () => void
  variant?: Variant
  isLoading?: boolean
  disabled?: boolean
  style?: ViewStyle
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// 🔴 GYM-286 — A-3/A-4, EN ATTENTE. LA VARIANTE `primary` NE SE MIGRE PAS.
// ═══════════════════════════════════════════════════════════════════════════════════════
// `bg-move-dark` + `text-move-accent` : un bouton SOMBRE à libellé LIME. C'est l'action
// primaire de toute l'app, et elle reste en classes NativeWind — figée, donc identique
// chez Dopamine.
//
// L'option retenue par le cockpit était : fond `tokens.background`, encre `tokens.accent`.
// Exacte au pixel chez Dopamine (#111111 / #C8F000). Deux faits MESURÉS l'ont écartée,
// obtenus en exécutant le vrai résolveur, pas en le lisant :
//
//   1. LE BOUTON DEVIENT INVISIBLE. `resolveTheme` pose `page === background` — A-4 ayant
//      été refusé, cela reste vrai. Un bouton rempli de `background` posé sur une page
//      `page` est un rectangle de la couleur EXACTE de son fond : 1,00:1. Vérifié sur six
//      salles plausibles, repli Viniz compris — les six donnent page === background.
//      Chez Dopamine le problème n'existe pas parce que `DOPAMINE_THEME` est une constante
//      écrite à la main, où la bande (#111111) diffère de la page (#F5F4F0). L'arbitrage
//      avait été rendu sur ce cas-là, le seul où il fonctionne.
//
//   2. LE GARDE-FOU NE COUVRE PAS (background, accent) EN TANT QUE TEXTE. Il vérifie
//      `accentVsBackground >= 3` — le seuil WCAG § 1.4.11 des ÉLÉMENTS D'INTERFACE,
//      correct pour une FORME. Avec l'option (b) l'accent devient un LIBELLÉ : 4,5:1.
//      Contre-exemples qui PASSENT le garde-fou et ÉCHOUENT le seuil texte :
//        primaire #0163A6 / secondaire #101010 → 3,02:1
//        primaire #0855E4 / secondaire #101010 → 3,11:1
//        primaire #058E98 / secondaire #1E1E1E → 4,23:1
//
// Le point 2 s'étendrait « sur le même modèle ». Le point 1 ne s'étend pas : aucun calcul
// de contraste ne rend visible un bouton dont le fond EST celui de la page. C'est une
// COMPOSITION, pas un contraste. A-3 est donc fusionné avec A-4 et reporté au lot charte.
//
// ⚠️ LE MÊME MOTIF EXISTE DANS ONZE AUTRES FICHIERS, tous bloqués de la même façon.
// Migrer les instances en laissant cette brique produirait exactement l'écran à moitié
// invisible que le blocage cherche à éviter.
const variants: Record<Variant, { bg: string; text?: string; border?: string }> = {
  primary: { bg: 'bg-move-dark', text: 'text-move-accent' },
  secondary: { bg: 'bg-transparent', border: 'border' },
  ghost: { bg: 'bg-transparent' },
}

export function Button({ title, onPress, variant = 'primary', isLoading, disabled, style }: ButtonProps) {
  const { tokens } = useTheme()
  const v = variants[variant]

  // Les variantes `secondary` et `ghost` ne portent PAS la paire bloquée : elles se
  // posent sur un fond transparent et n'ont qu'une encre. Elles migrent normalement.
  const ink = {
    primary: { text: undefined, border: undefined },
    secondary: { text: tokens.onBackground, border: tokens.onBackground },
    ghost: { text: tokens.onBackgroundMuted, border: undefined },
  }[variant]

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || isLoading}
      activeOpacity={0.8}
      style={[style, ink.border ? { borderColor: ink.border } : null]}
      className={`flex-row items-center justify-center rounded-2xl px-6 py-4 ${v.bg} ${v.border ?? ''} ${
        disabled || isLoading ? 'opacity-50' : ''
      }`}
    >
      {isLoading ? (
        // Le spinner de `primary` est l'accent posé sur le fond sombre : même paire, même
        // blocage. Celui des autres variantes est une encre ordinaire.
        <ActivityIndicator color={variant === 'primary' ? '#C8F000' : tokens.onBackground} size="small" />
      ) : (
        <Text className={`font-dmsans-bold text-base ${v.text ?? ''}`} style={ink.text ? { color: ink.text } : undefined}>
          {title}
        </Text>
      )}
    </TouchableOpacity>
  )
}
