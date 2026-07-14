import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MoreVertical, Pencil, Copy, Trash2, ShieldCheck } from 'lucide-react'
import type { ActivityItem } from '@/types/activity'
import { ActivityIcon } from './ActivityIcon'

interface ActivityCardProps {
  activity: ActivityItem
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
  onToggle: () => void
}

const levelKeys: Record<string, string> = {
  all: 'activities.level_all',
  beginner: 'activities.level_beginner',
  intermediate: 'activities.level_intermediate',
  advanced: 'activities.level_advanced',
}

export function ActivityCard({ activity, onEdit, onDuplicate, onDelete, onToggle }: ActivityCardProps) {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className={`relative overflow-hidden rounded-2xl bg-card transition-shadow hover:shadow-lg ${!activity.active ? 'opacity-50' : ''}`}>
      {/* Color band */}
      <div className="h-1.5" style={{ backgroundColor: activity.color }} />

      {/* Menu */}
      <div className="absolute right-3 top-4">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="rounded-lg p-1.5 text-muted transition-colors hover:bg-dark/5"
        >
          <MoreVertical className="h-4 w-4" />
        </button>

        {menuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 z-20 mt-1 w-40 rounded-xl border border-border bg-card py-1 shadow-lg">
              <button
                type="button"
                onClick={() => { setMenuOpen(false); onEdit() }}
                className="flex w-full items-center gap-2 px-3 py-2 font-body text-sm text-dark hover:bg-dark/5"
              >
                <Pencil className="h-3.5 w-3.5" />
                {t('activities.edit')}
              </button>
              <button
                type="button"
                onClick={() => { setMenuOpen(false); onDuplicate() }}
                className="flex w-full items-center gap-2 px-3 py-2 font-body text-sm text-dark hover:bg-dark/5"
              >
                <Copy className="h-3.5 w-3.5" />
                {t('activities.duplicate')}
              </button>
              <button
                type="button"
                onClick={() => { setMenuOpen(false); onDelete() }}
                className="flex w-full items-center gap-2 px-3 py-2 font-body text-sm text-red-500 hover:bg-red-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t('activities.delete')}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Content */}
      <div className="p-5 pt-4">
        {/* Icon */}
        <div
          className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl"
          style={{ backgroundColor: `${activity.color}20` }}
        >
          <ActivityIcon name={activity.icon} className="h-6 w-6" />
        </div>

        {/* Name */}
        <h3 className="font-display text-lg font-black tracking-tight text-dark">
          {activity.name}
        </h3>

        {/* Duration + Capacity */}
        <p className="mt-1 font-body text-sm text-muted">
          {activity.durationMin} min &middot; {activity.defaultCapacity} {t('activities.capacity').toLowerCase()}
        </p>

        {/* Badges */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          <span className="rounded-lg bg-dark/5 px-2 py-0.5 font-body text-[10px] font-medium text-secondary">
            {t(levelKeys[activity.level] ?? 'activities.level_all')}
          </span>
          {activity.requiresMedicalCheck && (
            <span className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-2 py-0.5 font-body text-[10px] font-medium text-red-500">
              <ShieldCheck className="h-3 w-3" />
              {t('activities.medical_badge')}
            </span>
          )}
        </div>

        {/* Toggle */}
        <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
          <span className="font-body text-xs text-muted">
            {activity.active ? t('activities.active') : t('activities.inactive')}
          </span>
          <button
            type="button"
            onClick={onToggle}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              activity.active ? 'bg-accent-dim' : 'bg-dark/15'
            }`}
          >
            <span
              className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                activity.active ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  )
}
