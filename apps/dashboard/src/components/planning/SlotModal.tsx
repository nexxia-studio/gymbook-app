import { useState, useEffect, useMemo, useRef, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { TimeSlot, Activity, Coach } from '@/types/planning'

export interface SlotFormData {
  activityId: string
  coachId: string
  date: string
  startTime: string
  duration: number
  capacity: number
  level: string
  notes: string
  repeat: boolean
  repeatWeeks: number
}

interface SlotModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: SlotFormData) => void
  activities: Activity[]
  coaches: Coach[]
  editSlot?: TimeSlot | null
  checkOverlap?: (coachId: string, date: string, startTime: string, duration: number, excludeId?: string) => boolean
}

const SUGGESTED_TIMES = ['07:00', '08:00', '09:30', '12:00', '17:30', '18:30', '19:00', '20:00', '20:30']

function addMinutes(time: string, mins: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = h * 60 + m + mins
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

type FormErrors = Partial<Record<keyof SlotFormData, string>>

export function SlotModal({ open, onClose, onSubmit, activities, coaches, editSlot, checkOverlap }: SlotModalProps) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDialogElement>(null)

  const isEdit = !!editSlot

  const [form, setForm] = useState<SlotFormData>({
    activityId: '',
    coachId: '',
    date: todayStr(),
    startTime: '07:00',
    duration: 60,
    capacity: 16,
    level: 'all',
    notes: '',
    repeat: false,
    repeatWeeks: 4,
  })
  const [errors, setErrors] = useState<FormErrors>({})

  // Reset form when opening
  useEffect(() => {
    if (!open) return
    if (editSlot) {
      setForm({
        activityId: editSlot.activity.id,
        coachId: editSlot.coach.id,
        date: editSlot.date,
        startTime: editSlot.startTime,
        duration: editSlot.activity.durationMin,
        capacity: editSlot.capacity,
        level: 'all',
        notes: '',
        repeat: false,
        repeatWeeks: 4,
      })
    } else {
      setForm({
        activityId: '',
        coachId: '',
        date: todayStr(),
        startTime: '07:00',
        duration: 60,
        capacity: 16,
        level: 'all',
        notes: '',
        repeat: false,
        repeatWeeks: 4,
      })
    }
    setErrors({})
  }, [open, editSlot])

  // Dialog open/close
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  // Auto-fill duration + capacity from activity
  const _selectedActivity = useMemo(
    () => activities.find((a) => a.id === form.activityId),
    [activities, form.activityId],
  )
  void _selectedActivity

  function handleActivityChange(id: string) {
    const act = activities.find((a) => a.id === id)
    setForm((f) => ({
      ...f,
      activityId: id,
      duration: act?.durationMin ?? f.duration,
    }))
  }

  const endTime = useMemo(
    () => (form.startTime ? addMinutes(form.startTime, form.duration) : '--:--'),
    [form.startTime, form.duration],
  )

  const repeatPreview = useMemo(() => {
    if (!form.repeat || !form.date) return null
    const start = form.date
    const end = addDays(start, (form.repeatWeeks - 1) * 7)
    return { count: form.repeatWeeks, start, end }
  }, [form.repeat, form.date, form.repeatWeeks])

  function validate(): boolean {
    const e: FormErrors = {}
    if (!form.activityId) e.activityId = t('slots.validation.activity_required')
    if (!form.coachId) e.coachId = t('slots.validation.coach_required')
    if (!form.date) e.date = t('slots.validation.date_required')
    else if (form.date < todayStr()) e.date = t('slots.validation.date_past')
    if (!form.startTime) e.startTime = t('slots.validation.time_required')
    if (form.capacity < 1) e.capacity = t('slots.validation.capacity_min')
    if (form.capacity > 50) e.capacity = t('slots.validation.capacity_max')
    if (form.coachId && form.date && form.startTime && checkOverlap) {
      if (checkOverlap(form.coachId, form.date, form.startTime, form.duration, editSlot?.id)) {
        e.startTime = t('slots.validation.coach_overlap')
      }
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function handleSubmit(ev: FormEvent) {
    ev.preventDefault()
    if (!validate()) return
    onSubmit(form)
  }

  const selectClass =
    'w-full rounded-xl border border-border bg-card px-4 py-3 font-body text-sm text-dark outline-none transition-colors focus:border-dark'
  const labelClass = 'font-body text-sm font-medium text-dark'
  const errClass = 'text-xs text-red-500 mt-1'

  return (
    <dialog
      ref={dialogRef}
      onCancel={onClose}
      className="m-0 h-full w-full max-w-none bg-transparent p-0 backdrop:bg-black/40 md:m-auto md:h-auto md:max-w-[560px] md:rounded-2xl"
    >
      <div className="flex h-full flex-col bg-card md:h-auto md:max-h-[90vh] md:rounded-2xl md:shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border p-5">
          <h2 className="font-display text-xl font-black tracking-tight text-dark">
            {isEdit ? t('slots.edit_title') : t('slots.create_title')}
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-dark/5">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5">
          <div className="flex flex-col gap-5">
            {/* Activity */}
            <div>
              <label className={labelClass}>{t('slots.activity')}</label>
              <select
                value={form.activityId}
                onChange={(e) => handleActivityChange(e.target.value)}
                className={selectClass}
              >
                <option value="">{t('slots.activity_placeholder')}</option>
                {activities.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
              {errors.activityId && <p className={errClass}>{errors.activityId}</p>}
            </div>

            {/* Coach */}
            <div>
              <label className={labelClass}>{t('slots.coach')}</label>
              <select
                value={form.coachId}
                onChange={(e) => setForm((f) => ({ ...f, coachId: e.target.value }))}
                className={selectClass}
              >
                <option value="">{t('slots.coach_placeholder')}</option>
                {coaches.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {errors.coachId && <p className={errClass}>{errors.coachId}</p>}
            </div>

            {/* Date */}
            <div>
              <label className={labelClass}>{t('slots.date')}</label>
              <input
                type="date"
                value={form.date}
                min={todayStr()}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                className={selectClass}
              />
              {errors.date && <p className={errClass}>{errors.date}</p>}
            </div>

            {/* Start time + suggested */}
            <div>
              <label className={labelClass}>{t('slots.start_time')}</label>
              <input
                type="time"
                value={form.startTime}
                onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))}
                className={selectClass}
              />
              <div className="mt-2 flex flex-wrap gap-1">
                <span className="font-body text-[10px] text-muted">{t('slots.suggested_times')}:</span>
                {SUGGESTED_TIMES.map((time) => (
                  <button
                    key={time}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, startTime: time }))}
                    className={`rounded px-2 py-0.5 font-body text-[10px] transition-colors ${
                      form.startTime === time
                        ? 'bg-accent text-[#111111]'
                        : 'bg-dark/5 text-muted hover:bg-dark/10'
                    }`}
                  >
                    {time}
                  </button>
                ))}
              </div>
              {errors.startTime && <p className={errClass}>{errors.startTime}</p>}
            </div>

            {/* Duration + end time */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>{t('slots.duration')}</label>
                <input
                  type="number"
                  value={form.duration}
                  min={15}
                  max={180}
                  step={5}
                  onChange={(e) => setForm((f) => ({ ...f, duration: Number(e.target.value) }))}
                  className={selectClass}
                />
              </div>
              <div className="flex items-end pb-3">
                <span className="font-body text-sm font-medium text-accent-dim">
                  {t('slots.end_time', { time: endTime })}
                </span>
              </div>
            </div>

            {/* Capacity */}
            <div>
              <label className={labelClass}>{t('slots.capacity')}</label>
              <input
                type="number"
                value={form.capacity}
                min={1}
                max={50}
                onChange={(e) => setForm((f) => ({ ...f, capacity: Number(e.target.value) }))}
                className={selectClass}
              />
              {errors.capacity && <p className={errClass}>{errors.capacity}</p>}
            </div>

            {/* Level */}
            <div>
              <label className={labelClass}>{t('slots.level')}</label>
              <select
                value={form.level}
                onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))}
                className={selectClass}
              >
                <option value="all">{t('slots.level_all')}</option>
                <option value="beginner">{t('slots.level_beginner')}</option>
                <option value="intermediate">{t('slots.level_intermediate')}</option>
                <option value="advanced">{t('slots.level_advanced')}</option>
              </select>
            </div>

            {/* Notes */}
            <div>
              <label className={labelClass}>{t('slots.notes')}</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value.slice(0, 200) }))}
                placeholder={t('slots.notes_placeholder')}
                rows={2}
                className={`${selectClass} resize-none`}
              />
              <p className="mt-1 text-right font-body text-[10px] text-muted">{form.notes.length}/200</p>
            </div>

            {/* Repeat */}
            {!isEdit && (
              <div className="rounded-xl border border-border p-4">
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={form.repeat}
                    onChange={(e) => setForm((f) => ({ ...f, repeat: e.target.checked }))}
                    className="h-4 w-4 rounded accent-accent"
                  />
                  <span className={labelClass}>{t('slots.repeat')}</span>
                </label>
                {form.repeat && (
                  <div className="mt-3 flex flex-col gap-3 pl-7">
                    <p className="font-body text-xs text-secondary">{t('slots.repeat_weekly')}</p>
                    <div>
                      <label className="font-body text-xs text-muted">{t('slots.repeat_weeks')}</label>
                      <input
                        type="number"
                        value={form.repeatWeeks}
                        min={2}
                        max={12}
                        onChange={(e) => setForm((f) => ({ ...f, repeatWeeks: Number(e.target.value) }))}
                        className="mt-1 w-24 rounded-lg border border-border bg-card px-3 py-2 font-body text-sm text-dark outline-none focus:border-dark"
                      />
                    </div>
                    {repeatPreview && (
                      <p className="rounded-lg bg-accent-dim/10 px-3 py-2 font-body text-xs text-accent-dim">
                        {t('slots.repeat_preview', {
                          count: repeatPreview.count,
                          start: repeatPreview.start,
                          end: repeatPreview.end,
                        })}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </form>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-border p-5">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={(ev) => { ev.preventDefault(); const fakeEv = { preventDefault: () => {} } as FormEvent; handleSubmit(fakeEv); }}>
            {isEdit
              ? t('slots.save_button')
              : form.repeat
                ? t('slots.create_multiple', { count: form.repeatWeeks })
                : t('slots.create_button')}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
