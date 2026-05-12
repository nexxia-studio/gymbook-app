import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import type { TimeSlot } from '@/types/planning'

interface SlotCardProps {
  slot: TimeSlot
  onClick: () => void
  compact?: boolean
  style?: CSSProperties
}

const statusBadge: Record<string, string> = {
  cancelled: 'bg-red-500/90 text-white',
  completed: 'bg-black/40 text-white',
}

export function SlotCard({ slot, onClick, compact = false, style }: SlotCardProps) {
  const { t } = useTranslation()
  const fillPercent = Math.round((slot.booked / slot.capacity) * 100)

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...style,
        backgroundColor: `${slot.activity.color}20`,
        borderLeft: `3px solid ${slot.activity.color}`,
      }}
      className={`group box-border h-full w-full cursor-pointer overflow-hidden rounded-xl text-left transition-shadow duration-150 hover:shadow-md ${
        compact ? 'p-1.5' : 'p-2'
      }`}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0 flex-1">
          <p className={`truncate font-body font-semibold text-dark ${compact ? 'text-[10px] leading-tight' : 'text-xs'}`}>
            {slot.activity.name}
          </p>
          <p className={`font-body text-secondary ${compact ? 'text-[9px]' : 'text-[10px]'}`}>
            {slot.startTime} — {slot.endTime}
          </p>
          {!compact && (
            <p className="mt-0.5 truncate font-body text-[10px] text-muted">{slot.coach.name}</p>
          )}
        </div>
        {slot.status !== 'scheduled' && !compact && (
          <span className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold ${statusBadge[slot.status]}`}>
            {t(`planning.status.${slot.status}`)}
          </span>
        )}
      </div>

      {!compact && (
        <div className="mt-1 flex items-center gap-1">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-dark/10">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${fillPercent}%`, backgroundColor: slot.activity.color }}
            />
          </div>
          <span className="font-body text-[9px] font-medium text-muted">
            {slot.booked}/{slot.capacity}
          </span>
        </div>
      )}
    </button>
  )
}
