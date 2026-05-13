import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MoreVertical, Pencil, Power, Trash2 } from 'lucide-react'
import type { CoachItem } from '@/types/coach'

interface CoachCardProps {
  coach: CoachItem
  activityColors: Record<string, string>
  onEdit: () => void
  onToggle: () => void
  onDelete: () => void
}

// Deterministic color from name
function nameToColor(name: string): string {
  const colors = ['#4ECDC4', '#FF6B6B', '#6C5CE7', '#FF8E53', '#A8E6CF', '#B8B8FF', '#FFB7C5', '#81ECEC']
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return colors[Math.abs(hash) % colors.length]
}

const MAX_PILLS = 3

export function CoachCard({ coach, activityColors, onEdit, onToggle, onDelete }: CoachCardProps) {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)

  const fullName = `${coach.firstName} ${coach.lastName}`.trim()
  const initials = `${coach.firstName.charAt(0)}${coach.lastName.charAt(0) || ''}`.toUpperCase()
  const avatarColor = nameToColor(fullName)
  const visibleSpecialties = coach.specialties.slice(0, MAX_PILLS)
  const extraCount = coach.specialties.length - MAX_PILLS

  return (
    <div className={`relative overflow-hidden rounded-2xl bg-card transition-shadow hover:shadow-lg ${!coach.active ? 'opacity-50' : ''}`}>
      {/* Menu */}
      <div className="absolute right-3 top-3">
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
            <div className="absolute right-0 z-20 mt-1 w-44 rounded-xl border border-border bg-card py-1 shadow-lg">
              <button
                type="button"
                onClick={() => { setMenuOpen(false); onEdit() }}
                className="flex w-full items-center gap-2 px-3 py-2 font-body text-sm text-dark hover:bg-dark/5"
              >
                <Pencil className="h-3.5 w-3.5" />
                {t('coaches.edit')}
              </button>
              <button
                type="button"
                onClick={() => { setMenuOpen(false); onToggle() }}
                className="flex w-full items-center gap-2 px-3 py-2 font-body text-sm text-dark hover:bg-dark/5"
              >
                <Power className="h-3.5 w-3.5" />
                {coach.active ? t('coaches.deactivate') : t('coaches.activate')}
              </button>
              <button
                type="button"
                onClick={() => { setMenuOpen(false); onDelete() }}
                className="flex w-full items-center gap-2 px-3 py-2 font-body text-sm text-red-500 hover:bg-red-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t('coaches.delete')}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Content */}
      <div className="p-5">
        {/* Avatar */}
        <div
          className="mb-4 flex h-16 w-16 items-center justify-center rounded-full font-display text-xl font-black text-white"
          style={{ backgroundColor: avatarColor }}
        >
          {initials}
        </div>

        {/* Name */}
        <h3 className="font-display text-lg font-black uppercase tracking-tight text-dark">
          {fullName}
        </h3>

        {/* Bio */}
        {coach.bio && (
          <p className="mt-1 line-clamp-2 font-body text-xs text-muted">{coach.bio}</p>
        )}

        {/* Specialty pills */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {visibleSpecialties.map((spec) => (
            <span
              key={spec}
              className="rounded-lg px-2 py-0.5 font-body text-[10px] font-medium"
              style={{
                backgroundColor: `${activityColors[spec] ?? '#6B6861'}20`,
                color: activityColors[spec] ?? '#6B6861',
              }}
            >
              {spec}
            </span>
          ))}
          {extraCount > 0 && (
            <span className="rounded-lg bg-dark/5 px-2 py-0.5 font-body text-[10px] font-medium text-muted">
              {t('coaches.more_specialties', { count: extraCount })}
            </span>
          )}
        </div>

        {/* Site + Status */}
        <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
          <span className="font-body text-xs text-muted">
            {coach.sites.join(', ')}
          </span>
          <span className={`rounded-lg px-2 py-0.5 font-body text-[10px] font-semibold ${
            coach.active ? 'bg-green-500/10 text-green-600' : 'bg-dark/5 text-muted'
          }`}>
            {coach.active ? t('coaches.active') : t('coaches.inactive')}
          </span>
        </div>
      </div>
    </div>
  )
}
