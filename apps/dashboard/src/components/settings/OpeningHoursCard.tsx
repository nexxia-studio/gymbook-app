// GYM-228 — Horaires d'ouverture de la salle, dans /settings > Salle.
//
// PLACÉ DANS L'ONGLET « SALLE » et non dans un onglet Open Gym : ce sont les heures
// d'ouverture de Dopamine, pas un réglage de l'Open Gym. Elles serviront aussi à
// l'afficher au membre et à vérifier qu'un cours ne déborde pas — les ranger sous
// l'Open Gym les rendrait introuvables pour ces usages.
//
// ⚠️ HEURES LOCALES DE LA SALLE. Les champs affichent et enregistrent « 07:00 » au sens de
// l'horloge, jamais un instant UTC.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useGymSettings } from '@/hooks/useGymSettings'
import { useToastStore } from '@/hooks/useToast'
import {
  DAY_KEYS, SUGGESTED_HOURS, isUsableDay, timeToMinutes,
  type DayKey, type OpeningHours,
} from '@/lib/openingHours'

export function OpeningHoursCard() {
  const { t } = useTranslation()
  const { settings, updateOpeningHours } = useGymSettings()
  const addToast = useToastStore((s) => s.addToast)

  const [hours, setHours] = useState<OpeningHours>(SUGGESTED_HOURS)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!settings) return
    // `null` = jamais renseignés. On PROPOSE la suggestion dans le formulaire, sans rien
    // écrire : le gérant voit ce qu'il valide. Un défaut posé en base serait invisible.
    setHours(settings.openingHours ?? SUGGESTED_HOURS)
  }, [settings])

  function setDay(day: DayKey, next: { open: string; close: string } | null) {
    setHours((h) => ({ ...h, [day]: next }))
    setError(null)
  }

  async function handleSave() {
    // Un jour ouvert doit fermer APRÈS avoir ouvert. On refuse ici plutôt que de laisser
    // la génération produire zéro créneau ce jour-là sans expliquer pourquoi.
    const broken = DAY_KEYS.filter((d) => hours[d] !== null && !isUsableDay(hours[d]))
    if (broken.length > 0) {
      setError(t('settings.opening_hours.error_range', {
        days: broken.map((d) => t(`planning.days_short.${d}`)).join(', '),
      }))
      return
    }

    setSaving(true)
    const res = await updateOpeningHours(hours)
    setSaving(false)
    if (res.error) {
      addToast(t('settings.opening_hours.error_save'), 'error')
      return
    }
    addToast(t('settings.opening_hours.saved'), 'success')
  }

  const inputClass =
    'rounded-lg border border-border bg-card px-3 py-2 font-body text-sm text-dark outline-none focus:border-dark disabled:opacity-40'

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <Clock className="h-5 w-5 text-accent-dim" aria-hidden="true" />
        <h3 className="font-display text-lg font-black tracking-tight text-dark">
          {t('settings.opening_hours.title')}
        </h3>
      </div>
      <p className="mt-1 font-body text-sm text-muted">{t('settings.opening_hours.intro')}</p>

      {/* Horaires jamais renseignés : le dire, plutôt que de laisser croire que la
          suggestion affichée est enregistrée. */}
      {settings && settings.openingHours === null && (
        <p className="mt-3 rounded-xl bg-amber-50 px-4 py-2.5 font-body text-xs text-amber-900">
          {t('settings.opening_hours.never_set')}
        </p>
      )}

      <div className="mt-4 flex flex-col gap-2">
        {DAY_KEYS.map((day) => {
          const value = hours[day]
          const closed = value === null
          return (
            <div key={day} className="flex flex-wrap items-center gap-3">
              <span className="w-10 shrink-0 font-body text-sm font-semibold uppercase text-dark">
                {t(`planning.days_short.${day}`)}
              </span>

              {/* Ouvert / fermé. La case porte l'état OUVERT : « fermé » est l'absence
                  d'horaire, pas une valeur à cocher. */}
              <label className="flex shrink-0 items-center gap-2">
                <input
                  type="checkbox"
                  checked={!closed}
                  onChange={(e) =>
                    setDay(day, e.target.checked ? (settings?.openingHours?.[day] ?? SUGGESTED_HOURS[day]) : null)
                  }
                  className="h-4 w-4 rounded accent-accent"
                />
                <span className="font-body text-xs text-muted">
                  {closed ? t('settings.opening_hours.closed') : t('settings.opening_hours.open')}
                </span>
              </label>

              <input
                type="time"
                step={900}
                disabled={closed}
                value={value?.open ?? ''}
                onChange={(e) => setDay(day, { open: e.target.value, close: value?.close ?? '22:00' })}
                aria-label={t('settings.opening_hours.opens_at')}
                className={inputClass}
              />
              <span className="font-body text-xs text-muted">→</span>
              <input
                type="time"
                step={900}
                disabled={closed}
                value={value?.close ?? ''}
                onChange={(e) => setDay(day, { open: value?.open ?? '07:00', close: e.target.value })}
                aria-label={t('settings.opening_hours.closes_at')}
                className={inputClass}
              />

              {/* Signalé À LA SAISIE, pas seulement au moment d'enregistrer. */}
              {!closed && value && timeToMinutes(value.close) <= timeToMinutes(value.open) && (
                <span className="font-body text-xs font-semibold text-red-500">
                  {t('settings.opening_hours.day_invalid')}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {error && <p className="mt-3 font-body text-sm text-red-500">{error}</p>}

      <div className="mt-5 flex justify-end">
        <Button type="button" onClick={handleSave} isLoading={saving}>
          {t('common.save')}
        </Button>
      </div>
    </div>
  )
}
