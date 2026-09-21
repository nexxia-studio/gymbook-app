import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Building2, ShieldAlert, AlertCircle, Check, Minus } from 'lucide-react'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { useNavigate } from 'react-router-dom'
import { useCockpitGyms, type CockpitGym } from '@/hooks/useCockpitGyms'

/**
 * ╔═══════════════════════════════════════════════════════════════════════════════════════╗
 * ║  COCKPIT B2B — LOT 1 : « Mes salles », LECTURE SEULE                                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ CET ÉCRAN NE DÉCIDE DE RIEN. Le refus vient du serveur : `cockpit_list_gyms()` lève
 * `42501` pour tout appelant qui n'est pas super-administrateur. Ce que fait cette page en
 * cas de refus, c'est le DIRE — elle ne garde aucune porte, elle n'en a pas les moyens.
 *
 * C'est la différence avec un simple masquage de menu : un `gym_admin` qui taperait
 * `/cockpit` à la main arrive bien ici, et repart avec zéro donnée.
 *
 * ⚠️ AUCUNE ACTION. Changer un plan, une commission ou un essai est le LOT 2, et passera
 * par des RPC journalisées dans `gym_admin_actions`. Rien ici n'écrit.
 */

/** Une pastille oui/non, lisible sans lire la légende. */
function Flag({ on }: { on: boolean }) {
  return on
    ? <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
    : <Minus className="h-4 w-4 text-muted/40" aria-hidden />
}

/**
 * Le plan affiché est le plan EFFECTIF. La colonne brute n'apparaît que lorsqu'elle en
 * DIFFÈRE — sinon elle ajouterait du bruit à chaque ligne.
 *
 * ⚠️ Ce n'est pas théorique : Dopamine est `premium` en colonne, et `nexxia_features` lui
 * retire `multi_site`. Un cockpit qui n'afficherait que la colonne croirait une salle plus
 * servie qu'elle ne l'est.
 */
function PlanCell({ gym }: { gym: CockpitGym }) {
  const divergent = gym.plan_colonne !== gym.plan_effectif
  return (
    <div className="flex flex-col">
      <span className="font-body-bold text-sm">{gym.plan_effectif}</span>
      {divergent && (
        <span className="font-body text-xs text-amber-600 dark:text-amber-400">
          colonne : {gym.plan_colonne}
        </span>
      )}
    </div>
  )
}

export default function Cockpit() {
  const { t, i18n } = useTranslation()
  const { gyms, isLoading, error } = useCockpitGyms()
  const navigate = useNavigate()

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(i18n.language || 'fr-BE', { day: '2-digit', month: 'short', year: 'numeric' }),
    [i18n.language],
  )
  const showDate = (iso: string | null) => {
    if (!iso) return '—'
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? '—' : dateFmt.format(d)
  }

  // ── Refus serveur ────────────────────────────────────────────────────────────────
  // Distinct de la panne, délibérément : envoyer quelqu'un qui n'a pas le droit d'être
  // là chercher un incident qui n'existe pas est une perte de temps pour tout le monde.
  if (error?.kind === 'forbidden') {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center rounded-2xl border border-border bg-card px-6 py-20 text-center">
          <ShieldAlert className="mb-4 h-10 w-10 text-muted" aria-hidden />
          <h1 className="font-heading text-xl">{t('cockpit.forbidden_title')}</h1>
          <p className="mt-2 max-w-md font-body text-sm text-muted">{t('cockpit.forbidden_body')}</p>
        </div>
      </DashboardLayout>
    )
  }

  if (error?.kind === 'failed') {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center rounded-2xl border border-border bg-card px-6 py-20 text-center">
          <AlertCircle className="mb-4 h-10 w-10 text-muted" aria-hidden />
          <h1 className="font-heading text-xl">{t('cockpit.failed_title')}</h1>
          {/* Le détail technique reste dans la console — même règle que GYM-346. */}
          <p className="mt-2 max-w-md font-body text-sm text-muted">{t('cockpit.failed_body')}</p>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="mb-6 flex items-center gap-3">
        <Building2 className="h-6 w-6" aria-hidden />
        <div>
          <h1 className="font-heading text-2xl">{t('cockpit.title')}</h1>
          <p className="font-body text-sm text-muted">{t('cockpit.subtitle')}</p>
        </div>
      </div>

      {isLoading && (
        <div className="rounded-2xl border border-border bg-card px-6 py-16 text-center font-body text-sm text-muted">
          {t('cockpit.loading')}
        </div>
      )}

      {!isLoading && gyms?.length === 0 && (
        <div className="rounded-2xl border border-border bg-card px-6 py-16 text-center font-body text-sm text-muted">
          {t('cockpit.empty')}
        </div>
      )}

      {!isLoading && gyms && gyms.length > 0 && (
        <>
          <div className="mb-3 font-body text-sm text-muted">
            {t('cockpit.count', { count: gyms.length })}
          </div>

          {/* `overflow-x-auto` : le tableau porte dix colonnes et ne doit pas faire
              défiler la PAGE horizontalement sur un écran étroit. */}
          <div className="overflow-x-auto rounded-2xl border border-border bg-card">
            <table className="w-full min-w-[900px] text-left">
              <thead className="border-b border-border">
                <tr className="font-body text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3">{t('cockpit.col.gym')}</th>
                  <th className="px-4 py-3">{t('cockpit.col.plan')}</th>
                  <th className="px-4 py-3">{t('cockpit.col.status')}</th>
                  <th className="px-4 py-3">{t('cockpit.col.trial_end')}</th>
                  <th className="px-4 py-3 text-right">{t('cockpit.col.members')}</th>
                  <th className="px-4 py-3 text-right">{t('cockpit.col.slots')}</th>
                  <th className="px-4 py-3 text-center">{t('cockpit.col.mollie')}</th>
                  <th className="px-4 py-3 text-center">{t('cockpit.col.legal')}</th>
                  <th className="px-4 py-3">{t('cockpit.col.last_activity')}</th>
                </tr>
              </thead>
              <tbody>
                {gyms.map((g) => (
                  // GYM — la ligne ouvre la fiche (lot 2). `cursor-pointer` et le survol
                  // disent que c'est cliquable ; rien d'autre ne change pour le lot 1.
                  <tr key={g.gym_id}
                      onClick={() => navigate(`/cockpit/${g.gym_id}`)}
                      className="cursor-pointer border-b border-border/50 last:border-0 hover:bg-border/20">
                    <td className="px-4 py-3">
                      <div className="font-body-bold text-sm">{g.name}</div>
                      <div className="font-body text-xs text-muted">{g.slug}</div>
                    </td>
                    <td className="px-4 py-3"><PlanCell gym={g} /></td>
                    <td className="px-4 py-3 font-body text-sm">{g.statut}</td>
                    <td className="px-4 py-3 font-body text-sm">
                      {/* ⚠️ L'ESSAI EXPIRÉ EST SIGNALÉ, parce que RIEN ne le fait aujourd'hui :
                          Pace a son `trial_ends_at` dépassé depuis deux semaines et son
                          `status` vaut toujours `active`. Le résolveur dégrade bien les
                          features, mais aucun processus ne marque la salle — le cockpit est
                          le seul endroit où ça peut se voir. */}
                      {g.essai_fin
                        ? (
                          <span className={g.essai_actif ? '' : 'text-amber-600 dark:text-amber-400'}>
                            {showDate(g.essai_fin)}
                            {!g.essai_actif && ` · ${t('cockpit.trial_over')}`}
                          </span>
                        )
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-body tabular-nums text-sm">{g.membres}</td>
                    <td className="px-4 py-3 text-right font-body tabular-nums text-sm">{g.creneaux_a_venir}</td>
                    <td className="px-4 py-3"><div className="flex justify-center"><Flag on={g.mollie_connecte} /></div></td>
                    <td className="px-4 py-3"><div className="flex justify-center"><Flag on={g.identite_legale_ok} /></div></td>
                    <td className="px-4 py-3 font-body text-sm">{showDate(g.derniere_activite)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 font-body text-xs text-muted">{t('cockpit.members_note')}</p>
        </>
      )}
    </DashboardLayout>
  )
}
