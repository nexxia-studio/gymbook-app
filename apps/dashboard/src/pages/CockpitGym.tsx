import { useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ShieldAlert, AlertCircle, History } from 'lucide-react'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { useCockpitGyms } from '@/hooks/useCockpitGyms'
import { usePlanCatalog } from '@/hooks/usePlanCatalog'
import { useCockpitGymDetail, valeurAvant, type ActionError } from '@/hooks/useCockpitGymDetail'

/**
 * ╔═══════════════════════════════════════════════════════════════════════════════════════╗
 * ║  COCKPIT B2B — LOT 2 : la fiche salle                                                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ CET ÉCRAN NE GARDE RIEN. Le refus vient du serveur — les quatre RPC lèvent 42501 pour
 * tout appelant non super-administrateur. Ce qu'il fait, c'est le DIRE.
 *
 * ⚠️ LA SALLE VIENT DE `cockpit_list_gyms()`, RÉUTILISÉE. Aucune seconde RPC de lecture :
 * deux sources pour la même fiche finiraient par se contredire, et la liste porte déjà
 * exactement les champs voulus. À deux ou trois salles le surcoût est nul ; le jour où il
 * y en aura cent, ce sera le moment d'ajouter `cockpit_get_gym`, pas avant.
 */

/** Les statuts du CHECK `nexxia_gyms_status_check`, relevés sur la base. */
const STATUTS = ['active', 'trialing', 'suspended', 'cancelled'] as const

type Geste =
  | { type: 'plan'; valeur: string }
  | { type: 'status'; valeur: string }
  | { type: 'trial'; valeur: string | null }
  | { type: 'commission'; sepa: number | null; cb: number | null }

export default function CockpitGym() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { gymId } = useParams<{ gymId: string }>()
  const { gyms, isLoading: listeEnCours, error: erreurListe, reload: rechargerListe } = useCockpitGyms()
  const { plans } = usePlanCatalog()
  const { journal, busy, setPlan, setStatus, setTrialEnd, setCommission } = useCockpitGymDetail(gymId)

  // Le geste en attente de confirmation. `null` = aucun.
  const [enAttente, setEnAttente] = useState<Geste | null>(null)
  const [motif, setMotif] = useState('')
  const [erreur, setErreur] = useState<ActionError | null>(null)

  const salle = useMemo(() => gyms?.find((g) => g.gym_id === gymId) ?? null, [gyms, gymId])

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(i18n.language || 'fr-BE', { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.language],
  )
  const showDate = (iso: string | null) => {
    if (!iso) return '—'
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? '—' : dateFmt.format(d)
  }

  if (erreurListe?.kind === 'forbidden') {
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

  if (listeEnCours) {
    return (
      <DashboardLayout>
        <div className="rounded-2xl border border-border bg-card px-6 py-16 text-center font-body text-sm text-muted">
          {t('cockpit.loading')}
        </div>
      </DashboardLayout>
    )
  }

  if (!salle) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center rounded-2xl border border-border bg-card px-6 py-20 text-center">
          <AlertCircle className="mb-4 h-10 w-10 text-muted" aria-hidden />
          <h1 className="font-heading text-xl">{t('cockpit.gym_not_found')}</h1>
        </div>
      </DashboardLayout>
    )
  }

  /** Exécute le geste confirmé, puis referme — ou garde ouvert pour montrer le refus. */
  async function confirmer() {
    if (!enAttente) return
    setErreur(null)
    let res: ActionError | null = null
    if (enAttente.type === 'plan') res = await setPlan(enAttente.valeur, motif)
    else if (enAttente.type === 'status') res = await setStatus(enAttente.valeur, motif)
    else if (enAttente.type === 'trial') res = await setTrialEnd(enAttente.valeur, motif)
    else res = await setCommission(enAttente.sepa, enAttente.cb, motif)

    if (res) { setErreur(res); return }
    // Succès : la liste porte l'état affiché, il faut la relire.
    await rechargerListe()
    setEnAttente(null)
    setMotif('')
  }

  const libelleGeste = (g: Geste) =>
    g.type === 'plan' ? t('cockpit.act.plan_to', { plan: g.valeur })
    : g.type === 'status' ? t('cockpit.act.status_to', { status: g.valeur })
    : g.type === 'trial' ? (g.valeur ? t('cockpit.act.trial_to', { date: showDate(g.valeur) }) : t('cockpit.act.trial_clear'))
    : g.sepa === null ? t('cockpit.act.commission_clear')
    : t('cockpit.act.commission_to', { sepa: (g.sepa * 100).toFixed(2), cb: ((g.cb ?? 0) * 100).toFixed(2) })

  return (
    <DashboardLayout>
      <button onClick={() => navigate('/cockpit')} className="mb-4 flex items-center gap-2 font-body text-sm text-muted hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden /> {t('cockpit.back_to_list')}
      </button>

      <h1 className="font-heading text-2xl">{salle.name}</h1>
      <p className="font-body text-sm text-muted">{salle.slug}</p>

      {/* ── L'état, repris du lot 1 ─────────────────────────────────────────────── */}
      <div className="mt-6 grid gap-3 rounded-2xl border border-border bg-card p-5 sm:grid-cols-2 lg:grid-cols-4">
        {/* 🔴 22/09 — l'écart dû à un ESSAI se lit comme un essai, pas comme une anomalie.
            Même règle qu'en liste (Cockpit.tsx) : l'alerte reste pour l'inexpliqué. */}
        <Champ libelle={t('cockpit.col.plan')} valeur={salle.plan_effectif}
               note={
                 salle.plan_colonne === salle.plan_effectif ? undefined
                 : salle.essai_actif && salle.essai_fin
                   ? t('cockpit.plan_trial', {
                       effective: salle.plan_effectif,
                       subscribed: salle.plan_colonne,
                       date: showDate(salle.essai_fin),
                     })
                   : `colonne : ${salle.plan_colonne}`
               } />
        <Champ libelle={t('cockpit.col.status')} valeur={salle.statut} />
        <Champ libelle={t('cockpit.col.trial_end')}
               valeur={salle.essai_fin ? showDate(salle.essai_fin) : '—'}
               note={salle.essai_fin && !salle.essai_actif ? t('cockpit.trial_over') : undefined} />
        <Champ libelle={t('cockpit.col.members')} valeur={String(salle.membres)} />
        <Champ libelle={t('cockpit.col.slots')} valeur={String(salle.creneaux_a_venir)} />
        <Champ libelle={t('cockpit.col.mollie')} valeur={salle.mollie_connecte ? '✓' : '—'} />
        <Champ libelle={t('cockpit.col.legal')} valeur={salle.identite_legale_ok ? '✓' : '—'} />
        <Champ libelle={t('cockpit.col.last_activity')} valeur={showDate(salle.derniere_activite)} />
      </div>

      {/* ── Les gestes ──────────────────────────────────────────────────────────── */}
      <h2 className="mt-8 font-heading text-lg">{t('cockpit.actions_title')}</h2>
      <p className="font-body text-xs text-muted">{t('cockpit.actions_note')}</p>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Carte titre={t('cockpit.act.plan_title')}>
          <div className="flex flex-wrap gap-2">
            {/* ⚠️ LA GRILLE VIENT DE LA BASE (`usePlanCatalog` → `nexxia_plan_limits`),
                jamais d'une liste écrite ici. La RPC la revalide de son côté : deux
                filets, et aucun nom de plan en dur nulle part. */}
            {(plans ?? []).map((p) => (
              <button key={p.plan} disabled={busy || p.plan === salle.plan_colonne}
                onClick={() => { setErreur(null); setMotif(''); setEnAttente({ type: 'plan', valeur: p.plan }) }}
                className="rounded-lg border border-border px-3 py-1.5 font-body text-sm disabled:opacity-40">
                {p.plan}
              </button>
            ))}
          </div>
        </Carte>

        <Carte titre={t('cockpit.act.status_title')}>
          <div className="flex flex-wrap gap-2">
            {STATUTS.map((s) => (
              <button key={s} disabled={busy || s === salle.statut}
                onClick={() => { setErreur(null); setMotif(''); setEnAttente({ type: 'status', valeur: s }) }}
                className="rounded-lg border border-border px-3 py-1.5 font-body text-sm disabled:opacity-40">
                {s}
              </button>
            ))}
          </div>
        </Carte>

        <Carte titre={t('cockpit.act.trial_title')}>
          {/* 🔴 LE GESTE QUI MANQUAIT : l'essai de Pace est terminé depuis le 07/09 sans
              que rien ne l'ait clos. Prolonger de 14 ou 30 jours, ou clore net. */}
          <div className="flex flex-wrap gap-2">
            {[14, 30].map((j) => (
              <button key={j} disabled={busy}
                onClick={() => {
                  const d = new Date(); d.setDate(d.getDate() + j)
                  setErreur(null); setMotif(''); setEnAttente({ type: 'trial', valeur: d.toISOString() })
                }}
                className="rounded-lg border border-border px-3 py-1.5 font-body text-sm disabled:opacity-40">
                {t('cockpit.act.trial_extend', { days: j })}
              </button>
            ))}
            <button disabled={busy || salle.essai_fin === null}
              onClick={() => { setErreur(null); setMotif(''); setEnAttente({ type: 'trial', valeur: null }) }}
              className="rounded-lg border border-border px-3 py-1.5 font-body text-sm disabled:opacity-40">
              {t('cockpit.act.trial_clear')}
            </button>
          </div>
        </Carte>

        <Carte titre={t('cockpit.act.commission_title')}>
          {/* ⚠️ Les DEUX taux ensemble, ou aucun : la RPC refuse un état mi-dérogé. */}
          <DerogationCommission busy={busy}
            onPoser={(sepa, cb) => { setErreur(null); setMotif(''); setEnAttente({ type: 'commission', sepa, cb }) }}
            onRetirer={() => { setErreur(null); setMotif(''); setEnAttente({ type: 'commission', sepa: null, cb: null }) }} />
        </Carte>
      </div>

      {/* ── Confirmation explicite ──────────────────────────────────────────────── */}
      {enAttente && (
        <div className="mt-6 rounded-2xl border-2 border-amber-500/50 bg-card p-5">
          <h3 className="font-heading text-base">{t('cockpit.confirm_title')}</h3>
          <p className="mt-1 font-body text-sm">{libelleGeste(enAttente)}</p>

          {/* 🔴 LE MOTIF EST OBLIGATOIRE, et la RPC le revérifie (22023). Le champ ici
              n'est qu'une commodité : c'est la base qui refuse un motif vide. */}
          <label className="mt-4 block font-body text-xs text-muted" htmlFor="motif">
            {t('cockpit.reason_label')}
          </label>
          <input id="motif" value={motif} onChange={(e) => setMotif(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-transparent px-3 py-2 font-body text-sm"
            placeholder={t('cockpit.reason_placeholder')} />

          {erreur && (
            <p className="mt-3 font-body text-sm text-red-600 dark:text-red-400">
              {erreur.kind === 'forbidden' ? t('cockpit.forbidden_body')
                : erreur.kind === 'unchanged' ? t('cockpit.err_unchanged')
                : erreur.kind === 'invalid' ? t('cockpit.err_invalid')
                : t('cockpit.failed_body')}
            </p>
          )}

          <div className="mt-4 flex gap-2">
            <button onClick={() => void confirmer()} disabled={busy || motif.trim() === ''}
              className="rounded-lg bg-accent px-4 py-2 font-body-bold text-sm text-[#17102E] disabled:opacity-40">
              {busy ? t('cockpit.confirm_busy') : t('cockpit.confirm_cta')}
            </button>
            <button onClick={() => { setEnAttente(null); setErreur(null); setMotif('') }} disabled={busy}
              className="rounded-lg border border-border px-4 py-2 font-body text-sm">
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* ── Le journal ──────────────────────────────────────────────────────────── */}
      <h2 className="mt-8 flex items-center gap-2 font-heading text-lg">
        <History className="h-5 w-5" aria-hidden /> {t('cockpit.journal_title')}
      </h2>
      <p className="font-body text-xs text-muted">{t('cockpit.journal_note')}</p>

      <div className="mt-3 overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[720px] text-left">
          <thead className="border-b border-border">
            <tr className="font-body text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3">{t('cockpit.journal.when')}</th>
              <th className="px-4 py-3">{t('cockpit.journal.action')}</th>
              <th className="px-4 py-3">{t('cockpit.journal.before')}</th>
              <th className="px-4 py-3">{t('cockpit.journal.after')}</th>
              <th className="px-4 py-3">{t('cockpit.journal.reason')}</th>
            </tr>
          </thead>
          <tbody>
            {(journal ?? []).length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center font-body text-sm text-muted">{t('cockpit.journal_empty')}</td></tr>
            )}
            {(journal ?? []).map((e) => {
              const avant = valeurAvant(e)
              const apres = e.new_data ? Object.entries(e.new_data).filter(([k]) => k !== 'reason') : []
              return (
                <tr key={e.id} className="border-b border-border/50 last:border-0">
                  <td className="px-4 py-3 font-body text-sm">{showDate(e.created_at)}</td>
                  <td className="px-4 py-3 font-body text-sm">{e.action}</td>
                  <td className="px-4 py-3 font-body text-sm">{avant ? String(avant.valeur ?? '—') : '—'}</td>
                  <td className="px-4 py-3 font-body text-sm">{apres.map(([, v]) => String(v ?? '—')).join(' · ') || '—'}</td>
                  <td className="px-4 py-3 font-body text-sm text-muted">{String(e.new_data?.reason ?? '—')}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </DashboardLayout>
  )
}

function Champ({ libelle, valeur, note }: { libelle: string; valeur: string; note?: string }) {
  return (
    <div>
      <div className="font-body text-xs uppercase tracking-wide text-muted">{libelle}</div>
      <div className="font-body-bold text-sm">{valeur}</div>
      {note && <div className="font-body text-xs text-amber-600 dark:text-amber-400">{note}</div>}
    </div>
  )
}

function Carte({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h3 className="mb-3 font-heading text-sm">{titre}</h3>
      {children}
    </div>
  )
}

/**
 * Saisie des deux taux, EN POURCENTAGE à l'écran et en FRACTION à la base.
 *
 * ⚠️ C'est la conversion la plus facile à rater, et la plus chère : « 1.5 » envoyé tel quel
 * prélèverait 150 % de chaque paiement. La RPC borne à 0.5, mais l'écran ne doit pas
 * compter dessus — il convertit, et il le dit.
 */
function DerogationCommission({ busy, onPoser, onRetirer }: {
  busy: boolean
  onPoser: (sepa: number, cb: number) => void
  onRetirer: () => void
}) {
  const { t } = useTranslation()
  const [sepa, setSepa] = useState('')
  const [cb, setCb] = useState('')
  const valides = sepa.trim() !== '' && cb.trim() !== '' && !Number.isNaN(Number(sepa)) && !Number.isNaN(Number(cb))

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input value={sepa} onChange={(e) => setSepa(e.target.value)} inputMode="decimal"
          placeholder={t('cockpit.act.sepa_pct')}
          className="w-28 rounded-lg border border-border bg-transparent px-2 py-1.5 font-body text-sm" />
        <input value={cb} onChange={(e) => setCb(e.target.value)} inputMode="decimal"
          placeholder={t('cockpit.act.cb_pct')}
          className="w-28 rounded-lg border border-border bg-transparent px-2 py-1.5 font-body text-sm" />
      </div>
      <div className="flex gap-2">
        <button disabled={busy || !valides}
          onClick={() => onPoser(Number(sepa) / 100, Number(cb) / 100)}
          className="rounded-lg border border-border px-3 py-1.5 font-body text-sm disabled:opacity-40">
          {t('cockpit.act.commission_set')}
        </button>
        <button disabled={busy} onClick={onRetirer}
          className="rounded-lg border border-border px-3 py-1.5 font-body text-sm disabled:opacity-40">
          {t('cockpit.act.commission_clear')}
        </button>
      </div>
      <p className="font-body text-xs text-muted">{t('cockpit.act.commission_hint')}</p>
    </div>
  )
}
