import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useGymSettings } from '@/hooks/useGymSettings'
import { useToastStore } from '@/hooks/useToast'

export function GymSettingsCard() {
  const { t } = useTranslation()
  const { settings, updateWaitlistDelay, updateMaxActiveBookings } = useGymSettings()
  const addToast = useToastStore((s) => s.addToast)
  const [minutes, setMinutes] = useState<string>('')
  // GYM-196 — chaîne vide = AUCUNE limite (null en base), pas « non renseigné ».
  const [maxBookings, setMaxBookings] = useState<string>('')
  const [error, setError] = useState<string | undefined>()
  const [maxError, setMaxError] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!settings) return
    setMinutes(String(settings.waitlistConfirmationMinutes))
    setMaxBookings(settings.maxActiveBookings === null ? '' : String(settings.maxActiveBookings))
  }, [settings])

  async function handleSave() {
    const n = Number(minutes)
    if (!Number.isInteger(n) || n < 10 || n > 120) {
      setError(t('settings.gym.waitlist_delay_range_error'))
      return
    }
    const trimmed = maxBookings.trim()
    const max = trimmed === '' ? null : Number(trimmed)
    if (max !== null && (!Number.isInteger(max) || max < 1)) {
      setMaxError(t('settings.gym.max_bookings_range_error'))
      return
    }
    setError(undefined)
    setMaxError(undefined)
    setSaving(true)

    // Deux écritures distinctes : on n'enregistre la limite que si elle a changé, pour ne
    // pas repousser inutilement une valeur identique.
    const result = minutesDirty ? await updateWaitlistDelay(n) : {}
    const maxResult = maxDirty ? await updateMaxActiveBookings(max) : {}
    setSaving(false)

    if (result.error === 'range') {
      setError(t('settings.gym.waitlist_delay_range_error'))
      return
    }
    if (maxResult.error === 'range') {
      setMaxError(t('settings.gym.max_bookings_range_error'))
      return
    }
    if (result.error || maxResult.error) {
      addToast(t('settings.gym.save_error'), 'warning')
      return
    }
    addToast(t('settings.gym.saved'))
  }

  const minutesDirty = settings !== null && Number(minutes) !== settings.waitlistConfirmationMinutes
  const maxDirty = settings !== null
    && (maxBookings.trim() === '' ? null : Number(maxBookings.trim())) !== settings.maxActiveBookings
  const dirty = minutesDirty || maxDirty

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

        {/* GYM-196 — limite de réservations simultanées. Champ vide = aucune limite. */}
        <div className="mt-6">
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            name="max_active_bookings"
            label={t('settings.gym.max_bookings_label')}
            helper={t('settings.gym.max_bookings_helper')}
            error={maxError}
            value={maxBookings}
            onChange={(e) => setMaxBookings(e.target.value)}
          />
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
