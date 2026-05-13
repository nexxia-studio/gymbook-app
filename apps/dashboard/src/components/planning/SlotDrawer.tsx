import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Pencil, Trash2, XCircle } from 'lucide-react'
import type { TimeSlot, DisplayStatus } from '@/types/planning'
import { getDisplayStatus } from '@/types/planning'
import { Button } from '@/components/ui/Button'

interface SlotDrawerProps {
  slot: TimeSlot | null
  onClose: () => void
  onEdit: (slot: TimeSlot) => void
  onCancel: (slot: TimeSlot) => void
  onDelete: (slot: TimeSlot) => void
}

const statusColors: Record<DisplayStatus, string> = {
  scheduled: 'bg-accent/15 text-accent-dim',
  completed: 'bg-dark/5 text-muted',
  cancelled: 'bg-red-50 text-red-500',
  in_progress: 'bg-green-500/15 text-green-600',
}

export function SlotDrawer({ slot, onClose, onEdit, onCancel, onDelete }: SlotDrawerProps) {
  const { t } = useTranslation()

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    if (slot) {
      document.addEventListener('keydown', handleKey)
      return () => document.removeEventListener('keydown', handleKey)
    }
  }, [slot, onClose])

  const canDelete = slot ? slot.booked === 0 : false

  return (
    <>
      {/* Overlay */}
      <div
        className={`fixed inset-0 z-40 bg-black/30 transition-opacity duration-200 ${
          slot ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
      />

      {/* Drawer */}
      <aside
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-card shadow-2xl transition-transform duration-300 ease-out ${
          slot ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {slot && (
          <>
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border p-5">
              <h2 className="font-display text-xl font-black uppercase tracking-tight text-dark">
                {t('planning.slot_detail')}
              </h2>
              <button onClick={onClose} className="rounded-lg p-1.5 text-muted transition-colors hover:bg-dark/5">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-5">
              {/* Activity header */}
              <div className="mb-6 flex items-center gap-3">
                <div
                  className="h-12 w-12 rounded-xl"
                  style={{ backgroundColor: `${slot.activity.color}30` }}
                />
                <div>
                  <h3 className="font-display text-2xl font-black uppercase tracking-tight text-dark">
                    {slot.activity.name}
                  </h3>
                  {(() => {
                    const ds = getDisplayStatus(slot)
                    return (
                      <span className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-semibold ${statusColors[ds]}`}>
                        {ds === 'in_progress' && (
                          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
                        )}
                        {t(`planning.status.${ds}`)}
                      </span>
                    )
                  })()}
                </div>
              </div>

              {/* Info grid */}
              <div className="mb-6 grid grid-cols-2 gap-4">
                <div>
                  <p className="font-body text-xs text-muted">{t('planning.date')}</p>
                  <p className="font-body text-sm font-medium text-dark">{slot.date}</p>
                </div>
                <div>
                  <p className="font-body text-xs text-muted">{t('planning.time')}</p>
                  <p className="font-body text-sm font-medium text-dark">
                    {slot.startTime} — {slot.endTime}
                  </p>
                </div>
                <div>
                  <p className="font-body text-xs text-muted">{t('planning.coach')}</p>
                  <p className="font-body text-sm font-medium text-dark">{slot.coach.name}</p>
                </div>
                <div>
                  <p className="font-body text-xs text-muted">{t('planning.capacity')}</p>
                  <p className="font-body text-sm font-medium text-dark">
                    {slot.booked} / {slot.capacity}
                  </p>
                </div>
              </div>

              {/* Fill bar */}
              <div className="mb-6 h-2 overflow-hidden rounded-full bg-dark/5">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.round((slot.booked / slot.capacity) * 100)}%`,
                    backgroundColor: slot.activity.color,
                  }}
                />
              </div>

              {/* Members list */}
              <div>
                <h4 className="mb-3 font-body text-sm font-semibold text-dark">
                  {t('planning.members_enrolled')}
                </h4>
                {slot.members.length === 0 ? (
                  <p className="font-body text-sm text-muted">{t('planning.no_members')}</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {slot.members.map((member) => (
                      <div key={member.id} className="flex items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 font-body text-xs font-bold text-accent-dim">
                          {member.name.split(' ').map((n) => n[0]).join('')}
                        </div>
                        <span className="font-body text-sm text-dark">{member.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Actions */}
            {getDisplayStatus(slot) !== 'cancelled' && (
              <div className="flex flex-col gap-2 border-t border-border p-5">
                <div className="flex gap-3">
                  <Button variant="secondary" className="flex-1" onClick={() => onEdit(slot)}>
                    <Pencil className="h-4 w-4" />
                    {t('planning.edit_slot')}
                  </Button>
                </div>
                <div className="flex gap-3">
                  {/* Cancel button — always visible */}
                  <Button
                    variant="ghost"
                    className="flex-1 text-orange-500 hover:bg-orange-50 hover:text-orange-600"
                    onClick={() => onCancel(slot)}
                  >
                    <XCircle className="h-4 w-4" />
                    {t('planning.cancel_slot')}
                  </Button>

                  {/* Delete button — only if 0 members */}
                  <div className="group relative flex-1">
                    <Button
                      variant="ghost"
                      className="w-full text-red-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                      disabled={!canDelete}
                      onClick={() => onDelete(slot)}
                    >
                      <Trash2 className="h-4 w-4" />
                      {t('slots.permanently_delete')}
                    </Button>
                    {!canDelete && (
                      <div className="invisible absolute bottom-full left-1/2 z-10 mb-2 w-56 -translate-x-1/2 rounded-lg bg-dark px-3 py-2 font-body text-xs text-white shadow-lg group-hover:visible">
                        {t('slots.permanently_delete_disabled', { count: slot.booked })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </aside>
    </>
  )
}
