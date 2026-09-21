import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Clock, AlertTriangle } from 'lucide-react'
import { useTrialStatus } from '@/hooks/useTrialStatus'
import { SUBSCRIPTION_TAB_PATH } from './subscriptionPath'

/**
 * GYM-250 — LE BANDEAU DE FIN D'ESSAI.
 *
 * 🔴 POURQUOI IL EST DANS LE LAYOUT ET PAS DANS RÉGLAGES. Le gérant ne va dans Réglages →
 * Abonnement que s'il a une raison d'y aller — or la raison, c'est précisément ce qu'il
 * ignore. Le badge d'essai posé par GYM-247 y vit très bien, mais il n'a jamais prévenu
 * personne : il faut être déjà au courant pour le voir. Le bandeau, lui, est sur le chemin.
 *
 * ⚠️ IL NE S'AFFICHE PAS PENDANT TOUT L'ESSAI, et c'est délibéré. Un bandeau permanent
 * pendant quatorze jours devient un élément de décor qu'on cesse de lire — et il aurait
 * alors exactement la valeur du badge qu'il remplace. Il apparaît à J-3, au moment où
 * l'information devient actionnable, et reste après le terme tant qu'aucune formule n'est
 * choisie.
 *
 * ⚠️ CE N'EST PAS UN CONTRÔLE DE SÉCURITÉ, comme `PlanGate` : c'est une information. Le
 * refus qui compte est celui des Edge Functions.
 *
 * ⚠️ `trial === null` VEUT DIRE « ON NE SAIT PAS » : on n'affiche RIEN plutôt qu'un
 * bandeau alarmant sur une panne de lecture. Même contrat que `PlanGate` avec
 * `features === null`.
 */
export function TrialBanner() {
  const { t } = useTranslation()
  const { trial } = useTrialStatus()

  if (!trial || trial.phase === 'none' || trial.phase === 'running_quiet') return null

  const fini = trial.phase === 'ended'
  const Icone = fini ? AlertTriangle : Clock

  return (
    <div
      role="status"
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3 lg:px-6 ${
        fini
          ? 'border-amber-500/30 bg-amber-500/10'
          : 'border-border bg-dark/[0.03] dark:bg-light/[0.04]'
      }`}
    >
      <Icone className={`h-4 w-4 shrink-0 ${fini ? 'text-amber-600' : 'text-muted'}`} />
      <p className="font-body text-sm text-dark">
        <strong className="font-semibold">
          {fini
            ? t('subscription.trial_banner.ended_title')
            : t('subscription.trial_banner.ending_title', { count: trial.daysLeft })}
        </strong>{' '}
        {/* 🔴 LE BANDEAU DIT LA MÊME CHOSE QUE LE COURRIER DU J-0 : ce qui continue AVANT
            ce qui s'arrête. Un gérant qui lit « vous ne pouvez plus vendre » sans lire
            « vos membres gardent tout » appelle ses membres pour les rassurer — c'est
            l'inverse du message. */}
        {fini
          ? t('subscription.trial_banner.ended_body')
          : t('subscription.trial_banner.ending_body')}
      </p>
      <Link
        to={SUBSCRIPTION_TAB_PATH}
        className="ml-auto shrink-0 font-body text-sm font-semibold text-accent-dim underline underline-offset-4 hover:opacity-80"
      >
        {t('subscription.trial_banner.cta')}
      </Link>
    </div>
  )
}
