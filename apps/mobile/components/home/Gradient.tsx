import { View } from 'react-native'

export function LinearGradient() {
  // Simple CSS-like gradient overlay for RN (no expo-linear-gradient needed)
  return (
    <>
      <View
        className="absolute inset-0"
        style={{ backgroundColor: 'rgba(0,0,0,0.15)' }}
      />
      <View
        className="absolute bottom-0 left-0 right-0 h-24"
        style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
      />
    </>
  )
}
