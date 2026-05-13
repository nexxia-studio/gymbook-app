import { View, Text, TextInput as RNTextInput, type TextInputProps as RNTextInputProps } from 'react-native'

interface TextInputProps extends RNTextInputProps {
  label?: string
  error?: string
  helper?: string
}

export function TextInput({ label, error, helper, style, ...props }: TextInputProps) {
  return (
    <View className="gap-1.5">
      {label && <Text className="font-dmsans-medium text-sm text-move-dark">{label}</Text>}
      <RNTextInput
        placeholderTextColor="#9A9890"
        style={style}
        className={`rounded-2xl border bg-white px-4 py-3.5 font-dmsans text-sm text-move-dark ${
          error ? 'border-red-400' : 'border-move-border'
        }`}
        {...props}
      />
      {error && <Text className="font-dmsans text-xs text-red-500">{error}</Text>}
      {!error && helper && <Text className="font-dmsans text-xs text-move-text-muted">{helper}</Text>}
    </View>
  )
}
