import {
  Dumbbell, Zap, Flame, Activity, PersonStanding,
  Leaf, Waves, Baby, Heart, Timer, Trophy, Target,
  type LucideIcon,
} from 'lucide-react'

const ICON_MAP: Record<string, LucideIcon> = {
  Dumbbell, Zap, Flame, Activity, PersonStanding,
  Leaf, Waves, Baby, Heart, Timer, Trophy, Target,
}

export const ICON_NAMES = Object.keys(ICON_MAP)

export const ACTIVITY_COLORS = [
  '#FF6B6B', '#4ECDC4', '#FF8E53', '#6C5CE7',
  '#A8E6CF', '#B8B8FF', '#FFB7C5', '#81ECEC',
  '#FFEAA7', '#74B9FF', '#00B894', '#FDCB6E',
]

interface ActivityIconProps {
  name: string
  className?: string
}

export function ActivityIcon({ name, className = 'h-5 w-5' }: ActivityIconProps) {
  const Icon = ICON_MAP[name] ?? Dumbbell
  return <Icon className={className} />
}
