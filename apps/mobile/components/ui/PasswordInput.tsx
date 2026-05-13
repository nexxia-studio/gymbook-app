import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, type TextInputProps } from 'react-native'
import { Eye, EyeOff } from 'lucide-react-native'

interface PasswordInputProps extends Omit<TextInputProps, 'secureTextEntry'> {
  label?: string
  error?: string
}

export function PasswordInput({ label, error, style, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false)

  return (
    <View className="gap-1.5">
      {label && <Text className="font-dmsans-medium text-sm text-move-dark">{label}</Text>}
      <View className="relative">
        <TextInput
          secureTextEntry={!visible}
          placeholderTextColor="#9A9890"
          style={style}
          className={`rounded-2xl border bg-white px-4 py-3.5 pr-12 font-dmsans text-sm text-move-dark ${
            error ? 'border-red-400' : 'border-move-border'
          }`}
          {...props}
        />
        <TouchableOpacity
          onPress={() => setVisible((v) => !v)}
          className="absolute right-3 top-3.5"
          hitSlop={8}
        >
          {visible ? (
            <EyeOff size={20} color="#9A9890" />
          ) : (
            <Eye size={20} color="#9A9890" />
          )}
        </TouchableOpacity>
      </View>
      {error && <Text className="font-dmsans text-xs text-red-500">{error}</Text>}
    </View>
  )
}
