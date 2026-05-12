import { useTranslation } from 'react-i18next'
import type { TimeSlot } from '@/types/planning'

interface SlotCardProps {
  slot: TimeSlot
  onClick: () => void
  compact?: boolean
}

const statusBadge: Record<string, string> = {
  cancelled: 'bg-red-500/90 text-white',
  completed: 'bg-black/40 text-white',
}

export function SlotCard({ slot, onClick, compact = false }: SlotCardProps) {
  const { t } = useTranslation()
  const fillPercent = Math.round((slot.booked / slot.capacity) * 100)

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group w-full cursor-pointer rounded-xl text-left transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md ${
        compact ? 'p-2' : 'p-3'
      }`}
      style={{ backgroundColor: `${slot.activity.color}20`, borderLeft: `3px solid ${slot.activity.color}` }}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0 flex-1">
          <p className={`font-body font-semibold text-dark ${compact ? 'text-xs' : 'text-sm'}`}>
            {slot.activity.name}
          </p>
          <p className={`font-body text-secondary ${compact ? 'text-[10px]' : 'text-xs'}`}>
            {slot.startTime} — {slot.endTime}
          </p>
          {!compact && (
            <p className="mt-0.5 font-body text-xs text-muted">{slot.coach.name}</p>
          )}
        </div>
        {slot.status !== 'scheduled' && (
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${statusBadge[slot.status]}`}>
            {t(`planning.status.${slot.status}`)}
          </span>
        )}
      </div>

      {!compact && (
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-dark/10">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${fillPercent}%`, backgroundColor: slot.activity.color }}
            />
          </div>
          <span className="font-body text-[10px] font-medium text-muted">
            {slot.booked}/{slot.capacity}
          </span>
        </div>
      )}
    </button>
  )
}
