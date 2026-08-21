import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Lock, Loader2, RefreshCcw } from 'lucide-react'
import { useEffectivePlan } from '@/hooks/useEffectivePlan'
import { SUBSCRIPTION_TAB_PATH } from './subscriptionPath'

/**
 * GYM-247 — verrou d'écran ou de bloc, adossé au plan Viniz de la salle.
 *
 * ⚠️ CE N'EST PAS UN CONTRÔLE DE SÉCURITÉ. Le refus qui compte est celui des Edge
 * Functions (GYM-246) ; ceci n'existe que pour PRÉVENIR et EXPLIQUER avant le refus.
 * Ne jamais s'y fier pour protéger une donnée.
 *
 * On MONTRE ce qu'on rate : l'écran reste dans le menu et garde son titre, seul son
 * contenu est remplacé par un état vide qui nomme la fonctionnalité et propose la suite.
 * Masquer l'entrée de menu laisserait le gérant croire que la fonction n'existe pas.
 *
 * ⚠️ CONTRAT DE useEffectivePlan : `features === null` veut dire « ON NE SAIT PAS »,
 * jamais « aucun droit ». Une panne de résolution n'est pas une rétrogradation : on rend
 * alors un état neutre avec réessai, JAMAIS le cadenas. Verrouiller sur une panne
 * ferait lire une coupure passagère comme une perte d'abonnement.
 */
interface PlanGateProps {
  /** Drapeau requis, tel que résolu par get_effective_plan (ex. 'payments_enabled'). */
  feature: string
  /** Nom lisible de ce qui est verrouillé, pour le titre. */
  labelKey: string
  /** 'page' = écran entier, 'block' = encart dans une page déjà rendue. */
  variant?: 'page' | 'block'
  children: ReactNode
}

export function PlanGate({ feature, labelKey, variant = 'page', children }: PlanGateProps) {
  const { t } = useTranslation()
  const { features, isLoading, error, reload } = useEffectivePlan()

  const wrapper = variant === 'page'
    ? 'flex flex-1 items-center justify-center py-20'
    : 'flex items-center justify-center rounded-2xl border border-border bg-card px-6 py-14'

  // ── Plan non résolu : état NEUTRE, jamais le verrou. ────────────────────────
  if (features === null) {
    return (
      <div className={wrapper}>
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-dark/5">
            {isLoading || !error
              ? <Loader2 className="h-6 w-6 animate-spin text-muted" />
              : <RefreshCcw className="h-6 w-6 text-muted" />}
          </div>
          <p className="font-body text-sm text-muted">{t('subscription.gate.checking')}</p>
          {/* Le réessai n'apparaît qu'une fois l'échec constaté : proposer de réessayer
              pendant le chargement inviterait à corriger ce qui n'est pas cassé. */}
          {error && (
            <button
              type="button"
              onClick={() => reload()}
              className="mt-3 font-body text-sm font-semibold text-accent-dim underline underline-offset-4 hover:opacity-80"
            >
              {t('subscription.gate.retry')}
            </button>
          )}
        </div>
      </div>
    )
  }

  if (features[feature] === true) return <>{children}</>

  // ── Verrou ─────────────────────────────────────────────────────────────────
  return (
    <div className={wrapper}>
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-dim/10">
          <Lock className="h-8 w-8 text-accent-dim" />
        </div>
        <h2 className="font-display text-2xl font-black tracking-tight text-dark">
          {t('subscription.gate.locked_title', { feature: t(labelKey) })}
        </h2>
        <p className="mt-2 font-body text-sm text-muted">
          {t('subscription.gate.locked_message')}
        </p>
        <Link
          to={SUBSCRIPTION_TAB_PATH}
          className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl bg-[#4827B4] px-6 py-3 font-ui text-sm font-bold text-[#C8FF3D] transition-all hover:opacity-90 dark:bg-[#C8FF3D] dark:text-[#17102E]"
        >
          {t('subscription.gate.cta')}
        </Link>
      </div>
    </div>
  )
}
