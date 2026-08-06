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
      late_cancel_hours: 'lateCancelHours',
      warning_1_at: 'warning1At',
      warning_2_at: 'warning2At',
      warning_order: 'warning2At',
      suspension_at: 'suspensionAt',
      suspension_order: 'suspensionAt',
      suspension_hours: 'suspensionHours',
      escalated_hours: 'escalatedSuspensionHours',
      escalated_lower: 'escalatedSuspensionHours',
      reset_days: 'resetAfterDays',
    }
    const messageKey: Record<string, string> = {
      warning_order: 'settings.noshow.warning_order_error',
      suspension_order: 'settings.noshow.suspension_order_error',
      escalated_lower: 'settings.noshow.escalated_lower_error',
    }
    if (result.error && map[result.error]) {
      setErrors({
        [map[result.error]]: t(messageKey[result.error] ?? 'settings.noshow.positive_error'),
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

  /**
   * Simulation des premiers paliers, dans le MÊME ordre d'évaluation que le serveur :
   * suspension aggravée, suspension, 2e avertissement, 1er avertissement, rien. On va
   * jusqu'au premier palier aggravé inclus, qui absorbe ensuite tous les suivants —
   * d'où le « et suivantes » sur la dernière ligne.
   *
   * ⚠️ SOURCE DE VÉRITÉ = la fonction SQL public.apply_noshow_penalty (GYM-218), qui
   * porte l'escalade pour les DEUX moteurs — absence pointée et annulation tardive.
   * Ceci n'est qu'un AFFICHAGE qui la rejoue : toute évolution de la règle doit être
   * répercutée AUX DEUX ENDROITS, sinon le gérant verrait une politique différente de
   * celle réellement appliquée.
   */
  const preview = (() => {
    const { warning1At: w1, warning2At: w2, suspensionAt: sa } = form
    const { suspensionHours: sh, escalatedSuspensionHours: eh, lateCancelHours: lc } = form
    if (![w1, w2, sa, sh, eh, lc].every(Number.isFinite)) return null
    if (w2 < w1 || sa < w2) return null // configuration incohérente : rien à montrer

    const lines: { rank: number; text: string }[] = []
    for (let n = 1; n <= sa + 1; n++) {
      let text: string
      if (n > sa) text = t('settings.noshow.preview_escalated', { hours: eh })
      else if (n === sa) text = t('settings.noshow.preview_suspension', { hours: sh })
      else if (n >= w2) text = t('settings.noshow.preview_warning_2')
      else if (n >= w1) text = t('settings.noshow.preview_warning_1')
      else text = t('settings.noshow.preview_none')
      lines.push({ rank: n, text })
    }
    return lines
  })()

  return (
    <section className="rounded-2xl border border-[#E8E6E0] bg-card p-6">
      <h2 className="font-display text-xl font-black tracking-tight text-dark">
        {t('settings.noshow.title')}
      </h2>
      <p className="mt-1 font-body text-sm text-muted">{t('settings.noshow.subtitle')}</p>

      <div className="mt-6 grid max-w-2xl gap-4 sm:grid-cols-2">
        {/* GYM-218 — déclencheur de toute la politique côté annulation : placé en tête,
            avant les paliers qu'il alimente. */}
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          name="late_cancel_hours"
          label={t('settings.noshow.late_cancel_label')}
          helper={t('settings.noshow.late_cancel_helper')}
          error={errors.lateCancelHours}
          value={shown(form.lateCancelHours)}
          onChange={(e) => set('lateCancelHours', e.target.value)}
        />
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          name="warning_1_at"
          label={t('settings.noshow.warning_1_label')}
          helper={t('settings.noshow.warning_1_helper')}
          error={errors.warning1At}
          value={shown(form.warning1At)}
          onChange={(e) => set('warning1At', e.target.value)}
        />
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          name="warning_2_at"
          label={t('settings.noshow.warning_2_label')}
          helper={t('settings.noshow.warning_2_helper')}
          error={errors.warning2At}
          value={shown(form.warning2At)}
          onChange={(e) => set('warning2At', e.target.value)}
        />
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

      {/* Récapitulatif en clair, RECALCULÉ à la saisie : c'est ce qui rend le réglage
          compréhensible sans documentation. Il rejoue exactement la règle du serveur
          (mark_attendance_atomic), du palier le plus haut au plus bas. */}
      {preview && (
        <div className="mt-5 max-w-2xl rounded-xl bg-dark/[0.03] px-4 py-3">
          <p className="font-body text-xs font-semibold uppercase tracking-wide text-dark/50">
            {t('settings.noshow.preview_title')}
          </p>
          <ul className="mt-2 space-y-1">
            {preview.map((line) => (
              <li key={line.rank} className="font-body text-xs text-muted">
                <span className="font-semibold text-dark">
                  {t('settings.noshow.preview_rank', { count: line.rank })}
                </span>
                {' — '}
                {line.text}
              </li>
            ))}
          </ul>
          {/* GYM-218 — le barème ci-dessus vaut pour les DEUX moteurs : absence pointée
              et annulation tardive. C'est ce récapitulatif que le gérant lit pour
              comprendre sa propre politique ; taire la moitié du système le tromperait. */}
          <p className="mt-2 font-body text-xs text-muted">
            {t('settings.noshow.preview_late_cancel', { count: form.lateCancelHours })}
          </p>
          <p className="mt-2 font-body text-xs text-muted">
            {t('settings.noshow.preview_reset', { count: form.resetAfterDays })}
          </p>
        </div>
      )}

      <div className="mt-6">
        <Button onClick={handleSave} disabled={!dirty || saving}>
          {t('settings.noshow.save')}
        </Button>
      </div>
    </section>
  )
}
