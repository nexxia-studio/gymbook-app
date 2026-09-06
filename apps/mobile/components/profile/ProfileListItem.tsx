import { TouchableOpacity, View, Text } from 'react-native'
import { ChevronRight } from 'lucide-react-native'
import type { LucideIcon } from 'lucide-react-native'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { SEMANTIC } from '../../lib/theme/semantic'

interface ProfileListItemProps {
  icon: LucideIcon
  label: string
  detail?: string
  badge?: string
  badgeColor?: string
  destructive?: boolean
  onPress?: () => void
}

export function ProfileListItem({ icon: Icon, label, detail, badge, badgeColor, destructive, onPress }: ProfileListItemProps) {
  const { tokens } = useTheme()
  const textColor = destructive ? SEMANTIC.danger : tokens.onSurface
  const iconColor = destructive ? SEMANTIC.danger : tokens.onSurfaceSecondary

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.6}
      className="flex-row items-center px-5 py-3.5"
    >
      <Icon size={20} color={iconColor} />
      <View className="ml-3 flex-1">
        <Text className="font-dmsans-medium text-sm" style={{ color: textColor }}>{label}</Text>
        {detail && (
          <Text className="mt-0.5 font-dmsans text-xs" style={{ color: tokens.onBackgroundMuted }}>{detail}</Text>
        )}
      </View>
      {badge && (
        // GYM-286 (A-10) — `SEMANTIC.success + '20'` : le jeton PLUS son opacité, écrite.
        // La concaténation rend exactement la chaîne d'origine #22C55E20, au caractère
        // près — c'est ce que « opacité explicite » veut dire ici, et non un `opacity`
        // qui s'appliquerait aussi au texte de la pastille.
        // ⚠️ Le blanc reste en dur : c'est l'encre posée sur une couleur FOURNIE PAR
        // L'APPELANT (`badgeColor`), dont aucun jeton ne sait rien.
        <View className="mr-2 rounded-md px-2 py-0.5" style={{ backgroundColor: badgeColor ?? SEMANTIC.success + '20' }}>
          <Text className="font-dmsans-bold text-[10px]" style={{ color: badgeColor ? '#FFFFFF' : SEMANTIC.success }}>
            {badge}
          </Text>
        </View>
      )}
      <ChevronRight size={18} color={tokens.onBackgroundMuted} />
    </TouchableOpacity>
  )
}
