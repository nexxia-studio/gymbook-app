import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Minus, Loader2, RefreshCcw } from 'lucide-react'
import { useEffectivePlan } from '@/hooks/useEffectivePlan'
import { usePlanCatalog, CATALOG_FEATURE_KEYS, type CatalogPlan } from '@/hooks/usePlanCatalog'
import { useMembers } from '@/hooks/useMembers'
import { useTeam } from '@/hooks/useTeam'
import { useGymStore } from '@/stores/useGymStore'

const UPGRADE_EMAIL = 'hello@viniz.app'

/** Prix en cents → chaîne localisée. `null`/0 se lit « Gratuit », pas « 0,00 € ». */
function formatPrice(cents: number | null, locale: string): string | null {
  if (cents === null) return null
  if (cents === 0) return null
  return new Intl.NumberFormat(locale || 'fr', {
    style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(cents / 100)
}

/** Barre de consommation d'un quota. `max === null` = illimité : aucune barre. */
function QuotaBar({ label, current, max }: { label: string; current: number; max: number | null }) {
  const { t } = useTranslation()
  if (max === null) {
    return (
      <div>
        <div className="flex items-baseline justify-between">
          <span className="font-body text-sm text-dark">{label}</span>
          <span className="font-body text-sm font-semibold text-dark">
            {t('subscription.quota.unlimited_value', { current })}
          </span>
        </div>
        <div className="mt-1.5 h-2 rounded-full bg-dark/5" />
      </div>
    )
  }

  const ratio = max > 0 ? Math.min(current / max, 1) : 0
  const tone = ratio >= 1 ? 'bg-red-500' : ratio >= 0.8 ? 'bg-accent-dim' : 'bg-[#4827B4] dark:bg-[#C8FF3D]'

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="font-body text-sm text-dark">{label}</span>
        <span className="font-body text-sm font-semibold text-dark">{current} / {max}</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-dark/5">
        <div className={`h-full rounded-full transition-all ${tone}`} style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  )
}

function FeatureCell({ on }: { on: boolean | null }) {
  return on
    ? <Check className="mx-auto h-4 w-4 text-[#4827B4] dark:text-[#C8FF3D]" />
    : <Minus className="mx-auto h-4 w-4 text-muted/40" />
}

/**
 * GYM-247 — Réglages → Abonnement.
 *
 * ⚠️ TOUT vient de la base : le plan courant de get_effective_plan, la grille de
 * nexxia_plan_limits. Aucun nom de plan, aucun prix, aucune limite n'est écrit ici — les
 * grilles ont déjà différé entre staging et production, et un tarif recopié dans le code
 * ment dès le premier changement.
 *
 * Pas de bouton de rétrogradation : en Beta la facturation est manuelle, et une
 * rétrogradation touche des limites déjà consommées (que fait-on de 60 membres sur un
 * plan à 50 ?). C'est une conversation, pas un bouton — d'où le mailto.
 */
export function SubscriptionSection() {
  const { t, i18n } = useTranslation()
  const { plan: currentPlan, effectivePlan, trialActive, limits, features, isLoading: planLoading, error: planError, reload } = useEffectivePlan()
  const { plans, isLoading: catalogLoading, error: catalogError, reload: reloadCatalog } = usePlanCatalog()
  const gymName = useGymStore((s) => s.gym?.name) ?? ''

  // Consommation réelle. Les deux hooks sont déjà montés ailleurs dans l'app et servent
  // les mêmes prédicats que les gardes serveur (profiles role='member' / 'gym_admin',
  // deleted_at IS NULL) : les chiffres affichés sont ceux que le serveur comptera.
  const { totalCount: memberCount } = useMembers()
  const { adminCount } = useTeam()

  const mailto = useMemo(() => {
    const subject = t('subscription.upgrade.mail_subject', { gym: gymName })
    return `mailto:${UPGRADE_EMAIL}?subject=${encodeURIComponent(subject)}`
  }, [t, gymName])

  const unresolved = features === null || plans === null

  if (unresolved) {
    const failed = Boolean(planError || catalogError)
    return (
      <div className="flex items-center justify-center rounded-2xl border border-border bg-card px-6 py-16">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-dark/5">
            {planLoading || catalogLoading || !failed
              ? <Loader2 className="h-6 w-6 animate-spin text-muted" />
              : <RefreshCcw className="h-6 w-6 text-muted" />}
          </div>
          <p className="font-body text-sm text-muted">{t('subscription.gate.checking')}</p>
          {failed && (
            <button
              type="button"
              onClick={() => { reload(); reloadCatalog() }}
              className="mt-3 font-body text-sm font-semibold text-accent-dim underline underline-offset-4 hover:opacity-80"
            >
              {t('subscription.gate.retry')}
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── Plan actuel + consommation ─────────────────────────────────────── */}
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-display text-xl font-black tracking-tight text-dark">
            {t('subscription.current.title')}
          </h2>
          <span className="rounded-full bg-[#4827B4] px-3 py-1 font-ui text-xs font-bold uppercase tracking-wide text-[#C8FF3D] dark:bg-[#C8FF3D] dark:text-[#17102E]">
            {currentPlan}
          </span>
          {/* Un essai sert les limites d'un AUTRE plan que celui contracté : le dire, sinon
              les chiffres ci-dessous paraissent incohérents avec le badge. */}
          {trialActive && effectivePlan !== currentPlan && (
            <span className="rounded-full bg-accent-dim/10 px-3 py-1 font-ui text-xs font-bold text-accent-dim">
              {t('subscription.current.trial', { plan: effectivePlan })}
            </span>
          )}
        </div>

        <div className="mt-6 flex flex-col gap-4 sm:max-w-md">
          <QuotaBar label={t('subscription.quota.members')} current={memberCount} max={limits?.max_members ?? null} />
          <QuotaBar label={t('subscription.quota.admins')} current={adminCount} max={limits?.max_admins ?? null} />
        </div>
      </div>

      {/* ── Grille comparative ─────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-border bg-card p-6">
        <h2 className="font-display text-xl font-black tracking-tight text-dark">
          {t('subscription.catalog.title')}
        </h2>
        <p className="mt-1 font-body text-sm text-muted">{t('subscription.catalog.subtitle')}</p>

        {/* Le tableau défile horizontalement : la grille compte autant de colonnes que la
            base contient de plans, et ce nombre n'est pas décidé ici. */}
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse">
            <thead>
              <tr>
                <th className="w-40 border-b border-border pb-3 text-left font-body text-xs font-medium uppercase tracking-wide text-muted" />
                {plans.map((p: CatalogPlan) => {
                  const isCurrent = p.plan === effectivePlan
                  const monthly = formatPrice(p.price_cents, i18n.language)
                  const yearly = formatPrice(p.price_yearly_cents, i18n.language)
                  return (
                    <th key={p.plan} className={`border-b px-3 pb-3 text-center ${isCurrent ? 'border-[#4827B4] dark:border-[#C8FF3D]' : 'border-border'}`}>
                      <div className="font-display text-base font-black capitalize tracking-tight text-dark">{p.plan}</div>
                      <div className="mt-1 font-body text-sm font-semibold text-dark">
                        {monthly ? t('subscription.catalog.per_month', { price: monthly }) : t('subscription.catalog.free')}
                      </div>
                      {yearly && (
                        <div className="font-body text-xs text-muted">
                          {t('subscription.catalog.per_year', { price: yearly })}
                        </div>
                      )}
                      {isCurrent && (
                        <div className="mt-1.5 inline-block rounded-full bg-[#4827B4] px-2 py-0.5 font-ui text-[10px] font-bold uppercase tracking-wide text-[#C8FF3D] dark:bg-[#C8FF3D] dark:text-[#17102E]">
                          {t('subscription.catalog.your_plan')}
                        </div>
                      )}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="py-2.5 font-body text-sm text-dark">{t('subscription.quota.members')}</td>
                {plans.map((p) => (
                  <td key={p.plan} className="px-3 py-2.5 text-center font-body text-sm text-dark">
                    {p.max_members ?? t('subscription.quota.unlimited')}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-2.5 font-body text-sm text-dark">{t('subscription.quota.admins')}</td>
                {plans.map((p) => (
                  <td key={p.plan} className="px-3 py-2.5 text-center font-body text-sm text-dark">
                    {p.max_admins ?? t('subscription.quota.unlimited')}
                  </td>
                ))}
              </tr>
              {CATALOG_FEATURE_KEYS.map((key) => (
                <tr key={key} className="border-t border-border/50">
                  <td className="py-2.5 font-body text-sm text-dark">{t(`subscription.features.${key}`)}</td>
                  {plans.map((p) => (
                    <td key={p.plan} className="px-3 py-2.5 text-center">
                      <FeatureCell on={p[key]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 flex flex-col gap-2 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-body text-sm text-muted">{t('subscription.upgrade.hint')}</p>
          <a
            href={mailto}
            className="inline-flex shrink-0 items-center justify-center rounded-xl bg-[#4827B4] px-6 py-3 font-ui text-sm font-bold text-[#C8FF3D] transition-all hover:opacity-90 dark:bg-[#C8FF3D] dark:text-[#17102E]"
          >
            {t('subscription.upgrade.cta')}
          </a>
        </div>
      </div>
    </div>
  )
}
