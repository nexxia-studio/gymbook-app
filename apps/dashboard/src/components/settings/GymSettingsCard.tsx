import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useGymSettings } from '@/hooks/useGymSettings'
import { useToastStore } from '@/hooks/useToast'

export function GymSettingsCard() {
  const { t } = useTranslation()
  const { settings, updateWaitlistDelay } = useGymSettings()
  const addToast = useToastStore((s) => s.addToast)
  const [minutes, setMinutes] = useState<string>('')
  const [error, setError] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (settings) setMinutes(String(settings.waitlistConfirmationMinutes))
  }, [settings])

  async function handleSave() {
    const n = Number(minutes)
    if (!Number.isInteger(n) || n < 10 || n > 120) {
      setError(t('settings.gym.waitlist_delay_range_error'))
      return
    }
    setError(undefined)
    setSaving(true)
    const result = await updateWaitlistDelay(n)
    setSaving(false)
    if (result.error === 'range') {
      setError(t('settings.gym.waitlist_delay_range_error'))
      return
    }
    if (result.error) return
    addToast(t('settings.gym.saved'))
  }

  const dirty = settings !== null && Number(minutes) !== settings.waitlistConfirmationMinutes

  return (
    <section className="rounded-2xl border border-[#E8E6E0] bg-card p-6">
      <h2 className="font-display text-xl font-black tracking-tight text-dark">
        {t('settings.gym.booking_rules_title')}
      </h2>

      <div className="mt-6 max-w-sm">
        <Input
          type="number"
          inputMode="numeric"
          min={10}
          max={120}
          label={t('settings.gym.waitlist_delay_label')}
          helper={t('settings.gym.waitlist_delay_helper')}
          error={error}
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
        />
        <div className="mt-1 font-body text-xs text-dark/40">
          {t('settings.gym.waitlist_delay_unit')}
        </div>

        <div className="mt-4">
          <Button onClick={handleSave} disabled={!dirty || saving}>
            {t('settings.gym.save')}
          </Button>
        </div>
      </div>
    </section>
  )
}
