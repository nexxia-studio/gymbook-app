import { TouchableOpacity, Text, ActivityIndicator, type ViewStyle } from 'react-native'

type Variant = 'primary' | 'secondary' | 'ghost'

interface ButtonProps {
  title: string
  onPress: () => void
  variant?: Variant
  isLoading?: boolean
  disabled?: boolean
  style?: ViewStyle
}

const variants: Record<Variant, { bg: string; text: string; border?: string }> = {
  primary: { bg: 'bg-move-dark', text: 'text-move-accent' },
  secondary: { bg: 'bg-transparent', text: 'text-white', border: 'border border-white' },
  ghost: { bg: 'bg-transparent', text: 'text-move-text-muted' },
}

export function Button({ title, onPress, variant = 'primary', isLoading, disabled, style }: ButtonProps) {
  const v = variants[variant]

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || isLoading}
      activeOpacity={0.8}
      style={style}
      className={`flex-row items-center justify-center rounded-2xl px-6 py-4 ${v.bg} ${v.border ?? ''} ${
        disabled || isLoading ? 'opacity-50' : ''
      }`}
    >
      {isLoading ? (
        <ActivityIndicator color={variant === 'primary' ? '#C8F000' : '#FFFFFF'} size="small" />
      ) : (
        <Text className={`font-dmsans-bold text-base ${v.text}`}>{title}</Text>
      )}
    </TouchableOpacity>
  )
}
