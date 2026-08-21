import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { TrendingUp } from 'lucide-react'
import { SUBSCRIPTION_TAB_PATH } from './subscriptionPath'

/**
 * GYM-247 — bannière d'approche de plafond.
 *
 * Elle apparaît à partir de 80 % du quota et NE DISPARAÎT PLUS : au-delà, le gérant est
 * à quelques inscriptions d'un refus serveur (PLAN_MEMBER_LIMIT), et l'apprendre au
 * comptoir avec un membre en face est exactement ce que ce lot doit éviter.
 *
 * ⚠️ `max === null` = illimité : aucune bannière. Un plafond absent n'est pas un plafond
 * atteint — c'est la même règle que côté serveur (`limits.max_members !== null`).
 */
interface PlanLimitBannerProps {
  current: number
  max: number | null
  /** Clé i18n du libellé de l'unité comptée (membres, comptes d'équipe…). */
  labelKey: string
}

/** Seuil d'alerte. 0.8 : assez tôt pour agir, assez tard pour ne pas crier au loup. */
const WARN_RATIO = 0.8

export function PlanLimitBanner({ current, max, labelKey }: PlanLimitBannerProps) {
  const { t } = useTranslation()

  if (max === null || max <= 0) return null
  if (current / max < WARN_RATIO) return null

  const reached = current >= max

  return (
    <div
      className={`mb-4 flex flex-col gap-3 rounded-2xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
        reached
          ? 'border-red-500/30 bg-red-500/5'
          : 'border-accent-dim/30 bg-accent-dim/5'
      }`}
    >
      <div className="flex items-start gap-3">
        <TrendingUp className={`mt-0.5 h-5 w-5 shrink-0 ${reached ? 'text-red-500' : 'text-accent-dim'}`} />
        <div>
          <p className="font-body text-sm font-semibold text-dark">
            {t('subscription.banner.count', { current, max, unit: t(labelKey) })}
          </p>
          <p className="mt-0.5 font-body text-xs text-muted">
            {t(reached ? 'subscription.banner.reached' : 'subscription.banner.approaching')}
          </p>
        </div>
      </div>
      <Link
        to={SUBSCRIPTION_TAB_PATH}
        className="shrink-0 self-start rounded-xl bg-[#4827B4] px-4 py-2 font-ui text-sm font-bold text-[#C8FF3D] transition-all hover:opacity-90 sm:self-auto dark:bg-[#C8FF3D] dark:text-[#17102E]"
      >
        {t('subscription.banner.cta')}
      </Link>
    </div>
  )
}
