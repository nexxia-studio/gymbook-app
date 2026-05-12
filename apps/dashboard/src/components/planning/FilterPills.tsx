import { useTranslation } from 'react-i18next'
import type { Activity, Coach } from '@/types/planning'

interface FilterPillsProps {
  coaches: Coach[]
  activities: Activity[]
  filterCoach: string | null
  filterActivity: string | null
  filterStatus: string | null
  onCoachChange: (v: string | null) => void
  onActivityChange: (v: string | null) => void
  onStatusChange: (v: string | null) => void
}

function Pill({
  label,
  active,
  onClick,
  color,
}: {
  label: string
  active: boolean
  onClick: () => void
  color?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-lg px-3 py-1.5 font-body text-xs font-medium transition-all ${
        active
          ? 'bg-accent text-[#111111]'
          : 'bg-card text-secondary hover:bg-dark/5'
      }`}
      style={active && color ? { backgroundColor: color, color: '#111111' } : undefined}
    >
      {label}
    </button>
  )
}

export function FilterPills({
  coaches,
  activities,
  filterCoach,
  filterActivity,
  filterStatus,
  onCoachChange,
  onActivityChange,
  onStatusChange,
}: FilterPillsProps) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-wrap gap-2">
      {/* Coaches */}
      <Pill
        label={t('planning.filter_all_coaches')}
        active={filterCoach === null}
        onClick={() => onCoachChange(null)}
      />
      {coaches.map((c) => (
        <Pill
          key={c.id}
          label={c.name}
          active={filterCoach === c.id}
          onClick={() => onCoachChange(filterCoach === c.id ? null : c.id)}
        />
      ))}

      <div className="mx-1 w-px self-stretch bg-border" />

      {/* Activities */}
      <Pill
        label={t('planning.filter_all_activities')}
        active={filterActivity === null}
        onClick={() => onActivityChange(null)}
      />
      {activities.map((a) => (
        <Pill
          key={a.id}
          label={a.name}
          active={filterActivity === a.id}
          onClick={() => onActivityChange(filterActivity === a.id ? null : a.id)}
          color={filterActivity === a.id ? a.color : undefined}
        />
      ))}

      <div className="mx-1 w-px self-stretch bg-border" />

      {/* Status */}
      <Pill
        label={t('planning.filter_all_statuses')}
        active={filterStatus === null}
        onClick={() => onStatusChange(null)}
      />
      <Pill
        label={t('planning.filter_scheduled')}
        active={filterStatus === 'scheduled'}
        onClick={() => onStatusChange(filterStatus === 'scheduled' ? null : 'scheduled')}
      />
      <Pill
        label={t('planning.filter_completed')}
        active={filterStatus === 'completed'}
        onClick={() => onStatusChange(filterStatus === 'completed' ? null : 'completed')}
      />
      <Pill
        label={t('planning.filter_cancelled')}
        active={filterStatus === 'cancelled'}
        onClick={() => onStatusChange(filterStatus === 'cancelled' ? null : 'cancelled')}
      />
    </div>
  )
}
