import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Gift, ArrowDownRight } from 'lucide-react'
import { useEffectivePlan } from '@/hooks/useEffectivePlan'
import { usePlanCatalog, CATALOG_FEATURE_KEYS, type CatalogPlan } from '@/hooks/usePlanCatalog'
import { useTrialStatus } from '@/hooks/useTrialStatus'

/**
 * ╔═══════════════════════════════════════════════════════════════════════════════════════╗
 * ║  🔴 CE QUE L'ESSAI OFFRE, ET CE QU'ON PERD À LA FIN — dans cet ordre                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════════════════╝
 *
 * LE DÉFAUT CONSTATÉ AU PREMIER VRAI PARCOURS (22/09, « The Pulse Box »). L'écran de
 * bienvenue disait « Tu es sur le plan **Free** — voici ce qu'il comprend », puis listait
 * **200 membres, 5 comptes gérants**. Les deux affirmations étaient exactes prises
 * séparément — le plan CONTRACTUEL est bien `free`, les limites SERVIES sont bien celles de
 * `pro` — et leur juxtaposition était un mensonge : le gérant en déduit que Free offre 200
 * membres, et découvrira le contraire le quinzième jour.
 *
 * ⚠️ TROIS BLOCS, ET L'ORDRE EST LA CORRECTION. Dire l'offre avant la limite, et la date
 * avant la conséquence :
 *   ① « Tu es en Free. Nous t'offrons N jours de Pro. »
 *   ② ce que Pro apporte pendant l'essai ;
 *   ③ « Sans action de ta part d'ici le [date], tu repasses en Free : 15 membres, 1 compte,
 *      sans paiement en ligne. »
 *
 * ⚠️ AUCUN CHIFFRE EN DUR, AUCUN NOM DE PLAN EN DUR. Tout vient de `nexxia_plan_limits`
 * (via `usePlanCatalog`) et de `get_effective_plan` : les grilles ont déjà différé entre
 * staging et production, et un « 15 membres » recopié ici mentirait au premier changement
 * de tarif. Même règle que `SubscriptionSection` (GYM-247).
 *
 * ⚠️ NE S'AFFICHE QUE PENDANT UN ESSAI QUI CHANGE QUELQUE CHOSE. Hors essai, ou si le plan
 * servi est le plan souscrit, le composant rend `null` : il n'a rien à dire, et un encart
 * permanent redeviendrait du décor.
 */

/** Une limite lisible : `null` = illimité (convention de la grille, GYM-245). */
function limiteEnMots(
  t: (k: string, o?: Record<string, unknown>) => string,
  cle: 'members' | 'admins',
  valeur: number | null,
): string {
  if (valeur === null) return t(`trial_notice.limit_${cle}_unlimited`)
  return t(`trial_notice.limit_${cle}`, { count: valeur })
}

export function TrialPlanNotice({ variant = 'block' }: { variant?: 'welcome' | 'block' }) {
  const { t } = useTranslation()
  const { plan, effectivePlan, trialActive } = useEffectivePlan()
  const { plans } = usePlanCatalog()
  const { trial } = useTrialStatus()

  /**
   * Les deux lignes de grille qui comptent : celle du plan SOUSCRIT (où l'on retombera) et
   * celle du plan SERVI pendant l'essai.
   */
  const { souscrit, essai } = useMemo(() => {
    const trouve = (nom: string | null): CatalogPlan | null =>
      (plans ?? []).find((p) => p.plan === nom) ?? null
    return { souscrit: trouve(plan), essai: trouve(effectivePlan) }
  }, [plans, plan, effectivePlan])

  /**
   * Les fonctionnalités que l'essai AJOUTE, et qui repartiront avec lui.
   *
   * ⚠️ CALCULÉ PAR DIFFÉRENCE DE GRILLE, jamais énuméré à la main : le jour où un drapeau
   * change de plan, cette liste suit sans qu'on y pense. `CATALOG_FEATURE_KEYS` ne contient
   * déjà plus que les drapeaux réellement appliqués par le code (PR #305).
   */
  const gagnees = useMemo(() => {
    if (!souscrit || !essai) return []
    return CATALOG_FEATURE_KEYS.filter((k) => essai[k] === true && souscrit[k] !== true)
  }, [souscrit, essai])

  // Rien à dire : pas d'essai, essai sans effet, ou grille non résolue.
  if (!trialActive || !plan || !effectivePlan || plan === effectivePlan) return null
  if (!souscrit || !essai || !trial || trial.phase === 'none') return null

  const dateFin = new Date(trial.endsAt).toLocaleDateString(undefined, {
    day: 'numeric', month: 'long', year: 'numeric',
  })

  // ③ — la retombée, en une phrase : limites du plan souscrit, puis ce qu'on perd.
  const apres = [
    limiteEnMots(t, 'members', souscrit.max_members),
    limiteEnMots(t, 'admins', souscrit.max_admins),
    ...gagnees.map((k) => t('trial_notice.without', { feature: t(`subscription.features.${k}`) })),
  ].join(' · ')

  const cadre = variant === 'welcome'
    ? 'rounded-2xl border border-[#E8E6E0] bg-card p-5'
    : 'rounded-2xl border border-border bg-card p-5'

  return (
    <section className={cadre} aria-live="polite">
      {/* ① L'OFFRE D'ABORD. Un gérant qui lit « tu vas perdre » avant « on t'offre » retient
          la perte — et il n'a encore rien reçu. */}
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-dim/10">
          <Gift className="h-5 w-5 text-accent-dim" aria-hidden />
        </div>
        <p className="font-body text-sm leading-relaxed text-dark">
          {t('trial_notice.headline', {
            subscribed: souscrit.plan,
            trial: essai.plan,
            count: Math.max(trial.daysLeft, 0),
          })}
        </p>
      </div>

      {/* ② CE QUE L'ESSAI APPORTE — les limites servies, puis les fonctionnalités gagnées. */}
      <p className="mt-5 font-body text-xs font-semibold uppercase tracking-wide text-dark/40">
        {t('trial_notice.during_title', { trial: essai.plan })}
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        <Ligne texte={limiteEnMots(t, 'members', essai.max_members)} />
        <Ligne texte={limiteEnMots(t, 'admins', essai.max_admins)} />
        {gagnees.map((k) => (
          <Ligne key={k} texte={t(`subscription.features.${k}`)} />
        ))}
      </ul>

      {/* ③ LA RETOMBÉE, DATÉE. C'est la phrase qui manquait entièrement. */}
      <div className="mt-5 flex items-start gap-2 rounded-xl bg-amber-500/10 px-4 py-3">
        <ArrowDownRight className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
        <p className="font-body text-sm leading-relaxed text-dark">
          <strong className="font-semibold">
            {t('trial_notice.after_title', { date: dateFin, subscribed: souscrit.plan })}
          </strong>{' '}
          {apres}
        </p>
      </div>
    </section>
  )
}

function Ligne({ texte }: { texte: string }) {
  return (
    <li className="flex items-center gap-2 font-body text-sm text-dark/70">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-dim" aria-hidden />
      {texte}
    </li>
  )
}
