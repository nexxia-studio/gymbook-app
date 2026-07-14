import type { LucideIcon } from 'lucide-react'
import { useAnimatedCounter } from '@/hooks/useAnimatedCounter'

interface KpiCardProps {
  icon: LucideIcon
  label: string
  value: number
  prefix?: string
  suffix?: string
}

export function KpiCard({ icon: Icon, label, value, prefix, suffix }: KpiCardProps) {
  const animated = useAnimatedCounter(value)

  return (
    <div className="group rounded-2xl bg-card p-5 transition-all duration-150 hover:-translate-y-0.5 hover:shadow-lg">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-accent-dim/10">
        <Icon className="h-5 w-5 text-accent-dim" />
      </div>
      <p className="font-display text-3xl font-black tracking-tight text-dark">
        {prefix}{animated.toLocaleString()}{suffix}
      </p>
      <p className="mt-1 font-body text-sm text-muted">{label}</p>
    </div>
  )
}
