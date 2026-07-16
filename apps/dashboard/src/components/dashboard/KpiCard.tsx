import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useAnimatedCounter } from '@/hooks/useAnimatedCounter'

interface KpiCardProps {
  icon: LucideIcon
  label: string
  value: number
  prefix?: string
  suffix?: string
  // Contenu optionnel en haut à droite (ex. toggle J/S/M). Absent → l'icône reste seule.
  action?: ReactNode
  // Si défini, affiché à la place de la valeur animée (ex. "—" quand la donnée est vide).
  placeholder?: string
}

export function KpiCard({ icon: Icon, label, value, prefix, suffix, action, placeholder }: KpiCardProps) {
  const animated = useAnimatedCounter(value)

  return (
    <div className="group rounded-2xl bg-card p-5 transition-all duration-150 hover:-translate-y-0.5 hover:shadow-lg">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-dim/10">
          <Icon className="h-5 w-5 text-accent-dim" />
        </div>
        {action}
      </div>
      <p className="font-display text-3xl font-black tracking-tight text-dark">
        {placeholder !== undefined ? placeholder : <>{prefix}{animated.toLocaleString()}{suffix}</>}
      </p>
      <p className="mt-1 font-body text-sm text-muted">{label}</p>
    </div>
  )
}
