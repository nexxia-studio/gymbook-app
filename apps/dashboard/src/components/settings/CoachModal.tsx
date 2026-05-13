import { useState, useEffect, useRef, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Upload } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { CoachItem, CoachFormData } from '@/types/coach'

interface CoachModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: CoachFormData) => void
  editCoach?: CoachItem | null
  availableActivities: Array<{ name: string; color: string }>
  availableSites: string[]
}

type FormErrors = Partial<Record<keyof CoachFormData, string>>

function nameToColor(name: string): string {
  const colors = ['#4ECDC4', '#FF6B6B', '#6C5CE7', '#FF8E53', '#A8E6CF', '#B8B8FF', '#FFB7C5', '#81ECEC']
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return colors[Math.abs(hash) % colors.length]
}

export function CoachModal({ open, onClose, onSubmit, editCoach, availableActivities, availableSites }: CoachModalProps) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const isEdit = !!editCoach

  const [form, setForm] = useState<CoachFormData>({
    firstName: '',
    lastName: '',
    bio: '',
    specialties: [],
    sites: availableSites.length > 0 ? [availableSites[0]] : [],
    sortOrder: 1,
    active: true,
  })
  const [errors, setErrors] = useState<FormErrors>({})

  useEffect(() => {
    if (!open) return
    if (editCoach) {
      setForm({
        firstName: editCoach.firstName,
        lastName: editCoach.lastName,
        bio: editCoach.bio,
        specialties: [...editCoach.specialties],
        sites: [...editCoach.sites],
        sortOrder: editCoach.sortOrder,
        active: editCoach.active,
      })
    } else {
      setForm({
        firstName: '', lastName: '', bio: '',
        specialties: [],
        sites: availableSites.length > 0 ? [availableSites[0]] : [],
        sortOrder: 1, active: true,
      })
    }
    setErrors({})
  }, [open, editCoach, availableSites])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  function toggleSpecialty(name: string) {
    setForm((f) => ({
      ...f,
      specialties: f.specialties.includes(name)
        ? f.specialties.filter((s) => s !== name)
        : [...f.specialties, name],
    }))
  }

  function validate(): boolean {
    const e: FormErrors = {}
    if (!form.firstName.trim()) e.firstName = t('coaches.validation.first_name_required')
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function handleSubmit(ev: FormEvent) {
    ev.preventDefault()
    if (!validate()) return
    onSubmit(form)
  }

  const fullName = `${form.firstName} ${form.lastName}`.trim()
  const initials = `${form.firstName.charAt(0) || '?'}${form.lastName.charAt(0) || ''}`.toUpperCase()
  const avatarColor = nameToColor(fullName || '?')

  const selectClass = 'w-full rounded-xl border border-border bg-card px-4 py-3 font-body text-sm text-dark outline-none transition-colors focus:border-dark'
  const labelClass = 'font-body text-sm font-medium text-dark'
  const errClass = 'text-xs text-red-500 mt-1'

  return (
    <dialog
      ref={dialogRef}
      onCancel={onClose}
      className="m-0 h-full w-full max-w-none bg-transparent p-0 backdrop:bg-black/40 md:m-auto md:h-auto md:max-w-[520px] md:rounded-2xl"
    >
      <div className="flex h-full flex-col bg-card md:h-auto md:max-h-[90vh] md:rounded-2xl md:shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border p-5">
          <h2 className="font-display text-xl font-black uppercase tracking-tight text-dark">
            {isEdit ? t('coaches.edit_title') : t('coaches.create_title')}
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-dark/5">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5">
          <div className="flex flex-col gap-5">
            {/* Photo zone */}
            <div>
              <label className={labelClass}>{t('coaches.photo')}</label>
              <div className="mt-2 flex items-center gap-4">
                <div
                  className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full font-display text-2xl font-black text-white"
                  style={{ backgroundColor: avatarColor }}
                >
                  {initials}
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 font-body text-xs font-medium text-secondary transition-colors hover:bg-dark/5"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    {t('coaches.photo_drop')}
                  </button>
                </div>
              </div>
            </div>

            {/* Name row */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>{t('coaches.first_name')}</label>
                <input
                  value={form.firstName}
                  onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                  className={selectClass}
                  required
                />
                {errors.firstName && <p className={errClass}>{errors.firstName}</p>}
              </div>
              <div>
                <label className={labelClass}>{t('coaches.last_name')}</label>
                <input
                  value={form.lastName}
                  onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                  className={selectClass}
                />
              </div>
            </div>

            {/* Bio */}
            <div>
              <label className={labelClass}>{t('coaches.bio')}</label>
              <textarea
                value={form.bio}
                onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value.slice(0, 300) }))}
                placeholder={t('coaches.bio_placeholder')}
                rows={3}
                className={`${selectClass} resize-none`}
              />
              <p className="mt-1 text-right font-body text-[10px] text-muted">{form.bio.length}/300</p>
            </div>

            {/* Specialties — activity chips */}
            <div>
              <label className={labelClass}>{t('coaches.specialties')}</label>
              <p className="mb-2 font-body text-xs text-muted">{t('coaches.specialties_hint')}</p>
              <div className="flex flex-wrap gap-2">
                {availableActivities.map((act) => {
                  const selected = form.specialties.includes(act.name)
                  return (
                    <button
                      key={act.name}
                      type="button"
                      onClick={() => toggleSpecialty(act.name)}
                      className={`rounded-lg px-3 py-1.5 font-body text-xs font-medium transition-all ${
                        selected ? 'ring-2 ring-offset-1' : 'opacity-60 hover:opacity-100'
                      }`}
                      style={{
                        backgroundColor: `${act.color}20`,
                        color: act.color,
                        ...(selected ? { ringColor: act.color } : {}),
                      }}
                    >
                      {act.name}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Sites */}
            <div>
              <label className={labelClass}>{t('coaches.sites')}</label>
              <div className="mt-2 flex flex-wrap gap-2">
                {availableSites.map((site) => {
                  const selected = form.sites.includes(site)
                  return (
                    <button
                      key={site}
                      type="button"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          sites: selected
                            ? f.sites.filter((s) => s !== site)
                            : [...f.sites, site],
                        }))
                      }
                      className={`rounded-lg px-3 py-1.5 font-body text-xs font-medium transition-all ${
                        selected
                          ? 'bg-accent text-[#111111]'
                          : 'bg-dark/5 text-muted hover:bg-dark/10'
                      }`}
                    >
                      {site}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Sort order */}
            <div>
              <label className={labelClass}>{t('coaches.sort_order')}</label>
              <input
                type="number"
                value={form.sortOrder}
                min={1}
                onChange={(e) => setForm((f) => ({ ...f, sortOrder: Number(e.target.value) }))}
                className={`${selectClass} w-24`}
              />
            </div>

            {/* Active toggle */}
            <label className="flex items-center gap-3 rounded-xl border border-border p-4">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                className="h-4 w-4 rounded accent-accent"
              />
              <span className={labelClass}>
                {form.active ? t('coaches.active') : t('coaches.inactive')}
              </span>
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
