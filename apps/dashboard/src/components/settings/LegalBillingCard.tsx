import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useGymLegal, EMPTY_GYM_LEGAL, type GymLegal } from '@/hooks/useGymLegal'
import { useToastStore } from '@/hooks/useToast'

/**
 * GYM-180 — « Informations légales & facturation ».
 *
 * Ce que le gérant saisit ici est ce qui s'imprime sur les factures (bloc émetteur +
 * régime TVA). Le taux est une DONNÉE, jamais du code : il doit pouvoir être corrigé
 * après confirmation du comptable sans redéploiement.
 */
export function LegalBillingCard() {
  const { t } = useTranslation()
  const { legal, save } = useGymLegal()
  const addToast = useToastStore((s) => s.addToast)

  const [form, setForm] = useState<GymLegal>(EMPTY_GYM_LEGAL)
  const [rateError, setRateError] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (legal) setForm(legal) }, [legal])

  function set<K extends keyof GymLegal>(key: K, value: GymLegal[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function handleSave() {
    setRateError(undefined)
    setSaving(true)
    const result = await save(form)
    setSaving(false)

    if (result.error === 'rate') {
      setRateError(t('settings.legal.vat_rate_error'))
      return
    }
    if (result.error === 'forbidden') {
      addToast(t('settings.legal.save_forbidden'), 'warning')
      return
    }
    if (result.error) {
      addToast(t('settings.legal.save_error'), 'warning')
      return
    }
    addToast(t('settings.legal.saved'))
  }

  const dirty = legal !== null && JSON.stringify(form) !== JSON.stringify(legal)

  return (
    <section className="rounded-2xl border border-[#E8E6E0] bg-card p-6">
      <h2 className="font-display text-xl font-black tracking-tight text-dark">
        {t('settings.legal.title')}
      </h2>
      <p className="mt-1 font-body text-sm text-muted">{t('settings.legal.subtitle')}</p>

      {/* ── Identité ── */}
      <h3 className="mt-6 font-body text-sm font-semibold uppercase tracking-wide text-dark/50">
        {t('settings.legal.identity_title')}
      </h3>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <Input
          name="commercial_name"
          label={t('settings.legal.commercial_name_label')}
          helper={t('settings.legal.commercial_name_helper')}
          value={form.commercialName}
          onChange={(e) => set('commercialName', e.target.value)}
        />
        <Input
          name="legal_name"
          label={t('settings.legal.legal_name_label')}
          helper={t('settings.legal.legal_name_helper')}
          value={form.legalName}
          onChange={(e) => set('legalName', e.target.value)}
        />
        <Input
          name="legal_form"
          label={t('settings.legal.legal_form_label')}
          helper={t('settings.legal.legal_form_helper')}
          value={form.legalForm}
          onChange={(e) => set('legalForm', e.target.value)}
        />
        <Input
          name="vat_number"
          label={t('settings.legal.vat_number_label')}
          helper={t('settings.legal.vat_number_helper')}
          value={form.vatNumber}
          onChange={(e) => set('vatNumber', e.target.value)}
        />
      </div>

      {/* ── Siège social ── */}
      <h3 className="mt-8 font-body text-sm font-semibold uppercase tracking-wide text-dark/50">
        {t('settings.legal.registered_office_title')}
      </h3>
      <p className="mt-1 font-body text-xs text-muted">
        {t('settings.legal.registered_office_helper')}
      </p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Input
            name="legal_address"
            label={t('settings.legal.street_label')}
            value={form.legalAddress}
            onChange={(e) => set('legalAddress', e.target.value)}
          />
        </div>
        <Input
          name="legal_postal_code"
          label={t('settings.legal.postal_code_label')}
          value={form.legalPostalCode}
          onChange={(e) => set('legalPostalCode', e.target.value)}
        />
        <Input
          name="legal_city"
          label={t('settings.legal.city_label')}
          value={form.legalCity}
          onChange={(e) => set('legalCity', e.target.value)}
        />
      </div>

      {/* ── Établissement (la salle) ── */}
      <h3 className="mt-8 font-body text-sm font-semibold uppercase tracking-wide text-dark/50">
        {t('settings.legal.venue_title')}
      </h3>
      <p className="mt-1 font-body text-xs text-muted">{t('settings.legal.venue_helper')}</p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Input
            name="address"
            label={t('settings.legal.street_label')}
            value={form.address}
            onChange={(e) => set('address', e.target.value)}
          />
        </div>
        <Input
          name="postal_code"
          label={t('settings.legal.postal_code_label')}
          value={form.postalCode}
          onChange={(e) => set('postalCode', e.target.value)}
        />
        <Input
          name="city"
          label={t('settings.legal.city_label')}
          value={form.city}
          onChange={(e) => set('city', e.target.value)}
        />
      </div>

      {/* ── Régime TVA ── */}
      <h3 className="mt-8 font-body text-sm font-semibold uppercase tracking-wide text-dark/50">
        {t('settings.legal.vat_title')}
      </h3>
      <div className="mt-3 max-w-sm">
        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            name="vat_exempt"
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-[#E8E6E0] accent-dark"
            checked={form.vatExempt}
            onChange={(e) => set('vatExempt', e.target.checked)}
          />
          <span>
            <span className="font-body text-sm font-medium text-dark">
              {t('settings.legal.vat_exempt_label')}
            </span>
            <span className="block font-body text-xs text-dark/40">
              {t('settings.legal.vat_exempt_helper')}
            </span>
          </span>
        </label>

        <div className="mt-4">
          {form.vatExempt ? (
            <Input
              name="vat_exempt_mention"
              label={t('settings.legal.vat_mention_label')}
              helper={t('settings.legal.vat_mention_helper')}
              value={form.vatExemptMention}
              onChange={(e) => set('vatExemptMention', e.target.value)}
            />
          ) : (
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              min={0}
              max={100}
              name="vat_rate"
              label={t('settings.legal.vat_rate_label')}
              helper={t('settings.legal.vat_rate_helper')}
              error={rateError}
              value={form.vatRate}
              onChange={(e) => set('vatRate', e.target.value)}
            />
          )}
        </div>
      </div>

      <div className="mt-6">
        <Button onClick={handleSave} disabled={!dirty || saving}>
          {t('settings.legal.save')}
        </Button>
      </div>
    </section>
  )
}
