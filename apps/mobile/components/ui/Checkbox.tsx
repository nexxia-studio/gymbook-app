import { type ReactNode } from 'react'
import { TouchableOpacity, View } from 'react-native'
import { Check } from 'lucide-react-native'

interface CheckboxProps {
  checked: boolean
  onToggle: () => void
  children: ReactNode
}

export function Checkbox({ checked, onToggle, children }: CheckboxProps) {
  return (
    <TouchableOpacity onPress={onToggle} activeOpacity={0.7} className="flex-row items-start gap-3">
      <View
        className={`mt-0.5 h-5 w-5 items-center justify-center rounded-md border ${
          checked ? 'border-move-accent bg-move-accent' : 'border-move-border bg-white'
        }`}
      >
        {checked && <Check size={14} color="#111111" />}
      </View>
      <View className="flex-1">{children}</View>
    </TouchableOpacity>
  )
}
