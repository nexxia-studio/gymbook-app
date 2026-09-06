import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useGymLegal, EMPTY_GYM_LEGAL, type GymLegal } from '@/hooks/useGymLegal'
import { missingLegalFields } from '@/lib/gymLegalIdentity'
import { useToastStore } from '@/hooks/useToast'

/**
 * GYM-180 — « Informations légales & facturation ».
 *
 * Ce que le gérant saisit ici est ce qui s'imprime sur les factures (bloc émetteur +
 * régime TVA). Le taux est une DONNÉE, jamais du code : il doit pouvoir être corrigé
 * après confirmation du comptable sans redéploiement.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * GYM-265 — CE FORMULAIRE ALIMENTE AUSSI LES CGV PUBLIQUES DE LA SALLE
 * ─────────────────────────────────────────────────────────────────────────────────────
 * Ces mêmes colonnes sont désormais interpolées dans /legal/terms?gym=<slug>. Un champ
 * vide n'est donc plus seulement une facture incomplète : c'est un « [à compléter par la
 * salle] » VISIBLE par tous les membres, au milieu d'un contrat.
 *
 * ⚠️ AUCUN NOUVEL ÉCRAN N'A ÉTÉ CRÉÉ, ET C'EST VOULU. Le ticket demandait une section
 * « Identité légale » ; elle existait déjà ici depuis GYM-180 et écrit exactement les
 * bonnes colonnes. En ouvrir une seconde aurait donné deux formulaires concurrents sur
 * les mêmes champs — la divergence que ce dépôt paie déjà cher ailleurs. Ce lot ajoute
 * donc : le bandeau d'incitation, et le bloc contact dont les CGV ont besoin.
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

  // ⚠️ CALCULÉ SUR L'ÉTAT ENREGISTRÉ (`legal`), PAS SUR LE FORMULAIRE. Le bandeau décrit ce
  // que les membres LISENT en ce moment sur la page publique ; le baser sur `form` le
  // ferait disparaître dès la première frappe, avant que quoi que ce soit soit enregistré.
  const missing = legal ? missingLegalFields(legal) : []

  return (
    <section className="rounded-2xl border border-[#E8E6E0] bg-card p-6">
      <h2 className="font-display text-xl font-black tracking-tight text-dark">
        {t('settings.legal.title')}
      </h2>
      <p className="mt-1 font-body text-sm text-muted">{t('settings.legal.subtitle')}</p>

      {/* GYM-265 — INCITATION, PAS BLOCAGE. La décision de bloquer les paiements d'une
          salle aux CGV incomplètes est explicitement DIFFÉRÉE : elle couperait le chiffre
          d'affaires d'un gérant pour un champ de formulaire, et cet arbitrage n'appartient
          pas à ce lot. On informe, précisément, avec la liste des champs manquants. */}
      {missing.length > 0 && (
        <div
          role="status"
          className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3"
        >
          <p className="font-body text-sm font-semibold text-amber-900">
            {t('settings.legal.incomplete_title')}
          </p>
          <p className="mt-1 font-body text-xs leading-5 text-amber-800">
            {t('settings.legal.incomplete_body')}
          </p>
          <p className="mt-1.5 font-body text-xs font-medium text-amber-900">
            {t('settings.legal.incomplete_fields', {
              fields: missing.map((f) => t(`settings.legal.field_${f}`)).join(', '),
            })}
          </p>
        </div>
      )}

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

      {/* ── Contact (GYM-265) ── */}
      <h3 className="mt-8 font-body text-sm font-semibold uppercase tracking-wide text-dark/50">
        {t('settings.legal.contact_title')}
      </h3>
      <p className="mt-1 font-body text-xs text-muted">{t('settings.legal.contact_helper')}</p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <Input
          name="email"
          type="email"
          label={t('settings.legal.email_label')}
          value={form.email}
          onChange={(e) => set('email', e.target.value)}
        />
        <Input
          name="phone"
          label={t('settings.legal.phone_label')}
          value={form.phone}
          onChange={(e) => set('phone', e.target.value)}
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

        {/* ═══════════════════════════════════════════════════════════════════════════
            🔴 GYM-308 — LE TAUX RESTE VISIBLE QUAND L'EXEMPTION EST COCHÉE.
            ═══════════════════════════════════════════════════════════════════════════
            Il DISPARAISSAIT : cocher « exonéré » remplaçait le champ par la mention. Le
            gérant perdait alors de vue le taux qu'il avait saisi, et ne pouvait plus
            vérifier ce qui repartirait s'il décochait — au moment précis où il touche à la
            règle fiscale de ses factures.

            Il est donc DÉSACTIVÉ, pas retiré : la valeur reste lisible, et la mention
            d'exemption s'affiche EN PLUS. Les deux ensemble disent l'état complet du
            régime, ce qu'aucun des deux ne dit seul. */}
        <div className="mt-4 flex flex-col gap-4">
          <Input
            type="number"
            inputMode="decimal"
            step="0.01"
            min={0}
            /* ⚠️ 30 ET NON 100 (GYM-308). Aucun taux de TVA européen n'approche 100 % — la
               borne large laissait passer une faute de frappe (« 60 » pour « 6,0 ») qui
               serait partie sur les factures sans que rien ne l'arrête. Vérifié avant de
               resserrer : aucune salle ne porte un taux supérieur à 30. La contrainte de
               base (GYM-180) reste plus large, volontairement — c'est l'app qui guide, la
               base qui garde. */
            max={30}
            name="vat_rate"
            label={t('settings.legal.vat_rate_label')}
            helper={t('settings.legal.vat_rate_helper')}
            error={rateError}
            value={form.vatRate}
            disabled={form.vatExempt}
            onChange={(e) => set('vatRate', e.target.value)}
          />

          {form.vatExempt && (
            <Input
              name="vat_exempt_mention"
              label={t('settings.legal.vat_mention_label')}
              helper={t('settings.legal.vat_mention_helper')}
              value={form.vatExemptMention}
              onChange={(e) => set('vatExemptMention', e.target.value)}
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
