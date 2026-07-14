import { useState, useEffect, useRef, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ActivityIcon, ICON_NAMES, ACTIVITY_COLORS } from './ActivityIcon'
import type { ActivityItem, ActivityFormData } from '@/types/activity'

interface ActivityModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: ActivityFormData) => void
  editActivity?: ActivityItem | null
  slugify: (text: string) => string
}

const DURATION_PRESETS = [20, 45, 60, 90]

type FormErrors = Partial<Record<keyof ActivityFormData, string>>

export function ActivityModal({ open, onClose, onSubmit, editActivity, slugify }: ActivityModalProps) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const isEdit = !!editActivity

  const [form, setForm] = useState<ActivityFormData>({
    name: '',
    slug: '',
    description: '',
    durationMin: 60,
    defaultCapacity: 16,
    level: 'all',
    icon: 'Dumbbell',
    color: '#4ECDC4',
    requiresMedicalCheck: false,
  })
  const [errors, setErrors] = useState<FormErrors>({})
  const [slugManual, setSlugManual] = useState(false)

  useEffect(() => {
    if (!open) return
    if (editActivity) {
      setForm({
        name: editActivity.name,
        slug: editActivity.slug,
        description: editActivity.description,
        durationMin: editActivity.durationMin,
        defaultCapacity: editActivity.defaultCapacity,
        level: editActivity.level,
        icon: editActivity.icon,
        color: editActivity.color,
        requiresMedicalCheck: editActivity.requiresMedicalCheck,
      })
      setSlugManual(true)
    } else {
      setForm({
        name: '', slug: '', description: '', durationMin: 60,
        defaultCapacity: 16, level: 'all', icon: 'Dumbbell',
        color: '#4ECDC4', requiresMedicalCheck: false,
      })
      setSlugManual(false)
    }
    setErrors({})
  }, [open, editActivity])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  function handleNameChange(value: string) {
    setForm((f) => ({
      ...f,
      name: value,
      slug: slugManual ? f.slug : slugify(value),
    }))
  }

  function validate(): boolean {
    const e: FormErrors = {}
    if (!form.name.trim()) e.name = t('activities.validation.name_required')
    if (!form.slug.trim()) e.slug = t('activities.validation.slug_required')
    if (form.durationMin < 5) e.durationMin = t('activities.validation.duration_min')
    if (form.defaultCapacity < 1) e.defaultCapacity = t('activities.validation.capacity_min')
    if (form.defaultCapacity > 100) e.defaultCapacity = t('activities.validation.capacity_max')
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function handleSubmit(ev: FormEvent) {
    ev.preventDefault()
    if (!validate()) return
    onSubmit(form)
  }

  const selectClass = 'w-full rounded-xl border border-border bg-card px-4 py-3 font-body text-sm text-dark outline-none transition-colors focus:border-dark'
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
            {isEdit ? t('activities.edit_title') : t('activities.create_title')}
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-dark/5">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5">
          <div className="flex flex-col gap-5">
            {/* Name */}
            <div>
              <label className={labelClass}>{t('activities.name')}</label>
              <input
                value={form.name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder={t('activities.name_placeholder')}
                className={selectClass}
                required
              />
              {errors.name && <p className={errClass}>{errors.name}</p>}
            </div>

            {/* Slug */}
            <div>
              <label className={labelClass}>{t('activities.slug')}</label>
              <input
                value={form.slug}
                onChange={(e) => { setSlugManual(true); setForm((f) => ({ ...f, slug: e.target.value })) }}
                className={`${selectClass} font-mono text-xs`}
              />
              {errors.slug && <p className={errClass}>{errors.slug}</p>}
            </div>

            {/* Description */}
            <div>
              <label className={labelClass}>{t('activities.description')}</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value.slice(0, 500) }))}
                placeholder={t('activities.description_placeholder')}
                rows={3}
                className={`${selectClass} resize-none`}
              />
              <p className="mt-1 text-right font-body text-[10px] text-muted">{form.description.length}/500</p>
            </div>

            {/* Duration + presets */}
            <div>
              <label className={labelClass}>{t('activities.duration')}</label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="number"
                  value={form.durationMin}
                  min={5}
                  max={300}
                  onChange={(e) => setForm((f) => ({ ...f, durationMin: Number(e.target.value) }))}
                  className={`${selectClass} w-24`}
                />
                {DURATION_PRESETS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, durationMin: d }))}
                    className={`rounded-lg px-3 py-2 font-body text-xs font-medium transition-colors ${
                      form.durationMin === d ? 'bg-accent text-[#17102E]' : 'bg-dark/5 text-muted hover:bg-dark/10'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
              {errors.durationMin && <p className={errClass}>{errors.durationMin}</p>}
            </div>

            {/* Capacity */}
            <div>
              <label className={labelClass}>{t('activities.capacity')}</label>
              <input
                type="number"
                value={form.defaultCapacity}
                min={1}
                max={100}
                onChange={(e) => setForm((f) => ({ ...f, defaultCapacity: Number(e.target.value) }))}
                className={`${selectClass} w-32`}
              />
              {errors.defaultCapacity && <p className={errClass}>{errors.defaultCapacity}</p>}
            </div>

            {/* Level */}
            <div>
              <label className={labelClass}>{t('activities.level')}</label>
              <select
                value={form.level}
                onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))}
                className={selectClass}
              >
                <option value="all">{t('activities.level_all')}</option>
                <option value="beginner">{t('activities.level_beginner')}</option>
                <option value="intermediate">{t('activities.level_intermediate')}</option>
                <option value="advanced">{t('activities.level_advanced')}</option>
              </select>
            </div>

            {/* Icon picker */}
            <div>
              <label className={labelClass}>{t('activities.icon')}</label>
              <div className="mt-2 grid grid-cols-6 gap-2">
                {ICON_NAMES.map((iconName) => (
                  <button
                    key={iconName}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, icon: iconName }))}
                    className={`flex h-12 items-center justify-center rounded-xl transition-all ${
                      form.icon === iconName
                        ? 'border-2 border-accent-dim bg-accent-dim/10'
                        : 'border border-border bg-card hover:bg-dark/5'
                    }`}
                  >
                    <ActivityIcon name={iconName} className="h-5 w-5 text-dark" />
                  </button>
                ))}
              </div>
            </div>

            {/* Color picker */}
            <div>
              <label className={labelClass}>{t('activities.color')}</label>
              <div className="mt-2 flex flex-wrap gap-2">
                {ACTIVITY_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, color: c }))}
                    className={`h-8 w-8 rounded-full transition-all ${
                      form.color === c ? 'ring-2 ring-dark ring-offset-2' : 'hover:scale-110'
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>

            {/* Medical check */}
            <label className="flex items-center gap-3 rounded-xl border border-border p-4">
              <input
                type="checkbox"
                checked={form.requiresMedicalCheck}
                onChange={(e) => setForm((f) => ({ ...f, requiresMedicalCheck: e.target.checked }))}
                className="h-4 w-4 rounded accent-accent"
              />
              <span className={labelClass}>{t('activities.medical_check')}</span>
            </label>
          </div>
        </form>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-border p-5">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={handleSubmit}>
            {isEdit ? t('common.save') : t('common.create')}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
