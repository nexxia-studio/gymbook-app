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
// 🔴 GYM-290 (décision A) — LA VARIANTE `primary` EST DÉBLOQUÉE, ET VOICI COMMENT
// ═══════════════════════════════════════════════════════════════════════════════════════
// Elle portait `bg-move-dark` + `text-move-accent` : un bouton SOMBRE à libellé LIME, figé
// en classes NativeWind depuis GYM-286 parce qu'aucune des deux traductions possibles ne
// marchait. Rappel de l'impasse, mesurée à l'époque :
//
//   · fond `accent` / encre `onAccent` → retournait le bouton de TOUTE l'app de Dopamine ;
//   · fond `background` / encre `accent` → invisible chez une salle, puisque
//     `page === background` : un rectangle de la couleur exacte de sa page, 1,00:1.
//
// LES DEUX OBSTACLES SONT TOMBÉS, ET PAS PAR DÉCRET.
//   · La décision B sépare `page` de `background` d'un pas de 1,30:1 : le second cas
//     n'existe plus.
//   · Le couple `actionBg` / `onAction` permet à Dopamine de FIGER son bouton là où une
//     salle le DÉRIVE. C'est ce qui fait tomber le premier.
//
// Chez une salle : fond = son accent, encre = celle que le garde-fou a retenue pour cet
// accent (seuil TEXTE, 4,5:1). Aucun sombre inventé, aucun accent retouché — si l'accent ne
// porte aucune encre, c'est le garde-fou qui fournit l'encre de secours, jamais nous.
// Chez Dopamine : `DOPAMINE_THEME.actionBg` = #111111 et `onAction` = #C8F000, recopiés de
// `move-dark` et `move-accent`. Le bouton de production ne bouge pas d'un pixel — vérifié
// par `verify-screen-parity` sur les 83 écrans.
//
// ⚠️ `opacity-50` RESTE LE MÉCANISME DÉSACTIVÉ, et ce n'est pas un renoncement : c'est une
// transformation UNIFORME du couple, donc dérivée par construction et valable pour toute
// salle. Une paire désactivée choisie à la main aurait dû être revalidée salle par salle.
const variants: Record<Variant, { bg: string; text?: string; border?: string }> = {
  // `primary` n'a plus de classe de couleur : ses deux jetons sont posés en `style`,
  // parce qu'ils dépendent de la salle et que NativeWind résout ses classes à la
  // COMPILATION — c'est la raison technique pour laquelle un jeton ne peut jamais être
  // une classe.
  primary: { bg: '' },
  secondary: { bg: 'bg-transparent', border: 'border' },
  ghost: { bg: 'bg-transparent' },
}

export function Button({ title, onPress, variant = 'primary', isLoading, disabled, style }: ButtonProps) {
  const { tokens } = useTheme()
  const v = variants[variant]

  // ⚠️ LE FOND D'ACTION EST RÉSOLU ICI, ET PAS DANS LE TABLEAU `style`. `variants` portait
  // `bg-move-dark` AVANT `text-move-accent` ; `verify-screen-parity` compare des suites
  // ORDONNÉES, et le résoudre plus bas inversait les deux premières couleurs du fichier.
  // Ce n'est pas de la cosmétique : la position d'un jeton dans le fichier est ce qui
  // permet de prouver que Dopamine n'a pas bougé.
  const actionSurface = variant === 'primary' ? tokens.actionBg : undefined

  // Les variantes `secondary` et `ghost` ne portent PAS la paire bloquée : elles se
  // posent sur un fond transparent et n'ont qu'une encre. Elles migrent normalement.
  const ink = {
    primary: { text: tokens.onAction, border: undefined },
    secondary: { text: tokens.onBackground, border: tokens.onBackground },
    ghost: { text: tokens.onBackgroundMuted, border: undefined },
  }[variant]

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || isLoading}
      activeOpacity={0.8}
      style={[
        style,
        actionSurface ? { backgroundColor: actionSurface } : null,
        ink.border ? { borderColor: ink.border } : null,
      ]}
      className={`flex-row items-center justify-center rounded-2xl px-6 py-4 ${v.bg} ${v.border ?? ''} ${
        disabled || isLoading ? 'opacity-50' : ''
      }`}
    >
      {isLoading ? (
        // Le spinner de `primary` est posé SUR le fond d'action : c'est donc `onAction`
        // qu'il porte, la même encre que le libellé qu'il remplace le temps du chargement.
        <ActivityIndicator color={variant === 'primary' ? tokens.onAction : tokens.onBackground} size="small" />
      ) : (
        <Text className={`font-dmsans-bold text-base ${v.text ?? ''}`} style={ink.text ? { color: ink.text } : undefined}>
          {title}
        </Text>
      )}
    </TouchableOpacity>
  )
}
