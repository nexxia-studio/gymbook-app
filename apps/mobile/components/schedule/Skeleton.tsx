import { View } from 'react-native'

function SkeletonCard() {
  return (
    <View className="mb-2 h-16 rounded-2xl bg-move-border/30" />
  )
}

export function Skeleton() {
  return (
    <View className="px-5 pt-4">
      <View className="mb-3 h-3 w-24 rounded bg-move-border/30" />
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
      <View className="mb-3 mt-4 h-3 w-28 rounded bg-move-border/30" />
      <SkeletonCard />
    </View>
  )
}
