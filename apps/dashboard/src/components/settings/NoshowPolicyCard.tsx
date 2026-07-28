import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useNoshowRules, DEFAULT_NOSHOW_RULES, type NoshowRules } from '@/hooks/useNoshowRules'
import { useToastStore } from '@/hooks/useToast'

type FieldErrors = Partial<Record<keyof NoshowRules, string>>

/**
 * GYM-175 — « Politique d'absences ».
 *
 * Ces valeurs pilotent RÉELLEMENT les sanctions : mark_attendance_atomic les lit à chaque
 * absence pointée. Les libellés sont écrits pour un gérant, pas pour un développeur.
 */
export function NoshowPolicyCard() {
  const { t } = useTranslation()
  const { rules, save } = useNoshowRules()
  const addToast = useToastStore((s) => s.addToast)

  const [form, setForm] = useState<NoshowRules>(DEFAULT_NOSHOW_RULES)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (rules) setForm(rules) }, [rules])

  function set<K extends keyof NoshowRules>(key: K, raw: string) {
    setForm((f) => ({ ...f, [key]: raw === '' ? Number.NaN : Number(raw) }))
  }

  // NaN = champ vidé : on affiche '' plutôt que « NaN ».
  const shown = (v: number) => (Number.isFinite(v) ? String(v) : '')

  async function handleSave() {
    setErrors({})
    setSaving(true)
    const result = await save(form)
    setSaving(false)

    const map: Record<string, keyof NoshowRules> = {
      suspension_at: 'suspensionAt',
      suspension_hours: 'suspensionHours',
      escalated_hours: 'escalatedSuspensionHours',
      escalated_lower: 'escalatedSuspensionHours',
      reset_days: 'resetAfterDays',
    }
    if (result.error && map[result.error]) {
      setErrors({
        [map[result.error]]: t(
          result.error === 'escalated_lower'
            ? 'settings.noshow.escalated_lower_error'
            : 'settings.noshow.positive_error',
        ),
      })
      return
    }
    if (result.error === 'forbidden') {
      addToast(t('settings.noshow.save_forbidden'), 'warning')
      return
    }
    if (result.error) {
      addToast(t('settings.noshow.save_error'), 'warning')
      return
    }
    addToast(t('settings.noshow.saved'))
  }

  const dirty = rules !== null && JSON.stringify(form) !== JSON.stringify(rules)

  return (
    <section className="rounded-2xl border border-[#E8E6E0] bg-card p-6">
      <h2 className="font-display text-xl font-black tracking-tight text-dark">
        {t('settings.noshow.title')}
      </h2>
      <p className="mt-1 font-body text-sm text-muted">{t('settings.noshow.subtitle')}</p>

      <div className="mt-6 grid max-w-2xl gap-4 sm:grid-cols-2">
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          name="suspension_at"
          label={t('settings.noshow.suspension_at_label')}
          helper={t('settings.noshow.suspension_at_helper')}
          error={errors.suspensionAt}
          value={shown(form.suspensionAt)}
          onChange={(e) => set('suspensionAt', e.target.value)}
        />
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          name="reset_after_days"
          label={t('settings.noshow.reset_days_label')}
          helper={t('settings.noshow.reset_days_helper')}
          error={errors.resetAfterDays}
          value={shown(form.resetAfterDays)}
          onChange={(e) => set('resetAfterDays', e.target.value)}
        />
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          name="suspension_hours"
          label={t('settings.noshow.suspension_hours_label')}
          helper={t('settings.noshow.suspension_hours_helper')}
          error={errors.suspensionHours}
          value={shown(form.suspensionHours)}
          onChange={(e) => set('suspensionHours', e.target.value)}
        />
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          name="escalated_suspension_hours"
          label={t('settings.noshow.escalated_hours_label')}
          helper={t('settings.noshow.escalated_hours_helper')}
          error={errors.escalatedSuspensionHours}
          value={shown(form.escalatedSuspensionHours)}
          onChange={(e) => set('escalatedSuspensionHours', e.target.value)}
        />
      </div>

      {/* Récapitulatif en clair : le gérant lit la règle telle qu'elle s'appliquera. */}
      <p className="mt-4 max-w-2xl rounded-xl bg-dark/[0.03] px-4 py-3 font-body text-xs text-muted">
        {t('settings.noshow.summary', {
          threshold: Number.isFinite(form.suspensionAt) ? form.suspensionAt : '—',
          hours: Number.isFinite(form.suspensionHours) ? form.suspensionHours : '—',
          escalated: Number.isFinite(form.escalatedSuspensionHours) ? form.escalatedSuspensionHours : '—',
          days: Number.isFinite(form.resetAfterDays) ? form.resetAfterDays : '—',
        })}
      </p>

      <div className="mt-6">
        <Button onClick={handleSave} disabled={!dirty || saving}>
          {t('settings.noshow.save')}
        </Button>
      </div>
    </section>
  )
}
