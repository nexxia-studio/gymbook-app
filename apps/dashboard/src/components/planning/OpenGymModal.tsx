// GYM-228 — Génération des créneaux Open Gym.
//
// PLACÉE DANS /planning, PAS DANS /settings — et c'est un choix, pas une commodité.
// Générer des créneaux est un geste de PLANNING : le gérant en voit le résultat
// immédiatement dans la vue qu'il a sous les yeux, et peut vérifier que les exclusions ont
// bien joué. /settings porte de la configuration qu'on règle une fois (horaires, formules,
// politique d'absences) ; y ranger une action qui produit 800 lignes obligerait à changer
// d'écran pour en constater l'effet.
//
// Les HORAIRES, eux, restent dans /settings : ils décrivent la salle, pas cette action.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarPlus, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useToastStore } from '@/hooks/useToast'
import { useGymSettings } from '@/hooks/useGymSettings'
import { useOpenGym } from '@/hooks/useOpenGym'
import { openDaysCount } from '@/lib/openGym'
import { MAX_HORIZON_DAYS, maxHorizonDate } from '@/lib/recurrence'
import type { Activity } from '@/types/planning'

interface OpenGymModalProps {
  open: boolean
  onClose: () => void
  activities: Activity[]
  onGenerated: () => void
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

export function OpenGymModal({ open, onClose, activities, onGenerated }: OpenGymModalProps) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const addToast = useToastStore((s) => s.addToast)
  const { settings } = useGymSettings()
  const { generate, estimate, running } = useOpenGym()

  const [activityId, setActivityId] = useState('')
  const [from, setFrom] = useState(todayStr())
  // Quelques semaines par défaut : assez pour être utile, assez peu pour qu'une erreur de
  // paramétrage ne coûte pas 800 suppressions.
  const [to, setTo] = useState(addDays(todayStr(), 27))

  useEffect(() => {
    const d = dialogRef.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  useEffect(() => {
    if (!open) return
    setActivityId('')
    setFrom(todayStr())
    setTo(addDays(todayStr(), 27))
  }, [open])

  const hours = settings?.openingHours ?? null

  /**
   * GYM-228 (QA Antoine, 18/08) — SEULES LES ACTIVITÉS EN ACCÈS LIBRE.
   *
   * La modale proposait toutes les activités, donc « HIIT / Hyrox » au même titre qu'« Open
   * Gym ». Générer quatorze créneaux de HIIT par jour, tous les jours, n'est pas un usage
   * réel — et rien ne le signalait avant que 800 lignes soient créées.
   *
   * ⚠️ CRITÈRE : `requiresCoach === false`. Une activité sans coach est PAR NATURE un accès
   * libre, sans encadrement (GYM-229) : c'est exactement la population visée.
   *   · PAS `hiddenInPlanning`, qui dit autre chose (« encombre le planning ») — mélanger
   *     les deux notions les rendrait toutes deux fausses, et une salle peut vouloir
   *     masquer une activité encadrée sans qu'elle devienne générable.
   *   · PAS le NOM : une salle peut avoir deux espaces libres (cardio, musculation), et
   *     « Open Gym » est un libellé que le gérant renomme. Ce projet l'a déjà vécu
   *     (GYM-176, coachs renommés en une semaine).
   */
  const freeAccessActivities = useMemo(
    () => activities.filter((a) => a.requiresCoach === false),
    [activities],
  )

  // Estimation HAUTE : elle ignore les exclusions, qu'on ne connaît qu'en lisant les cours.
  // Annoncée comme un plafond, jamais comme un compte exact — le vrai chiffre est celui du
  // résultat.
  const estimated = useMemo(
    () => (hours && from && to ? estimate(hours, from, to) : 0),
    [hours, from, to, estimate],
  )

  async function handleGenerate() {
    if (!activityId || !hours) return
    const res = await generate(activityId, hours, from, to)
    if (!res.ok) {
      addToast(t('open_gym.error'), 'error')
      return
    }
    addToast(
      t('open_gym.done', {
        created: res.created,
        skipped: res.skippedOverlap,
        existing: res.skippedExisting,
      }),
      'success',
    )
    onGenerated()
    onClose()
  }

  const canRun = !!activityId && !!hours && from <= to && !running

  return (
    <dialog
      ref={dialogRef}
      onCancel={onClose}
      className="m-0 h-full w-full max-w-none bg-transparent p-0 backdrop:bg-black/40 md:m-auto md:h-auto md:max-w-[480px] md:rounded-2xl"
    >
      <div className="flex h-full flex-col bg-card md:h-auto md:max-h-[90vh] md:rounded-2xl md:shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border p-5">
          <CalendarPlus className="h-5 w-5 text-accent-dim" aria-hidden="true" />
          <h2 className="font-display text-xl font-black tracking-tight text-dark">
            {t('open_gym.title')}
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <p className="font-body text-sm text-muted">{t('open_gym.intro')}</p>

          {/* Sans horaires, on ne génère RIEN. Les deviner produirait des centaines de
              créneaux à des heures que personne n'a choisies. */}
          {!hours && (
            <div className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
              <p className="font-body text-xs text-amber-900">{t('open_gym.no_hours')}</p>
            </div>
          )}

          {/* ⚠️ AUCUNE ACTIVITÉ ÉLIGIBLE → on ne montre PAS un sélecteur vide. Un formulaire
              qui ne mène nulle part sans dire pourquoi est le défaut que GYM-219 a corrigé :
              le gérant doit savoir quel geste poser, et où. */}
          {activities.length > 0 && freeAccessActivities.length === 0 && (
            <div className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
              <p className="font-body text-xs text-amber-900">{t('open_gym.no_free_access')}</p>
            </div>
          )}

          <label className="mt-5 block font-body text-sm font-medium text-dark">
            {t('open_gym.activity')}
          </label>
          {/* L'activité est CHOISIE, jamais devinée par son nom : « Open Gym » est un
              libellé que le gérant peut changer, et deviner ferait générer dans la mauvaise
              activité sans rien signaler. */}
          <select
            value={activityId}
            disabled={freeAccessActivities.length === 0}
            onChange={(e) => setActivityId(e.target.value)}
            className="mt-1 w-full rounded-xl border border-border bg-card px-4 py-3 font-body text-sm text-dark outline-none focus:border-dark disabled:opacity-40"
          >
            <option value="">{t('open_gym.activity_placeholder')}</option>
            {freeAccessActivities.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <p className="mt-1 font-body text-xs text-muted">{t('open_gym.activity_hint')}</p>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <label className="block font-body text-sm font-medium text-dark">{t('open_gym.from')}</label>
              <input
                type="date" value={from} min={todayStr()}
                onChange={(e) => setFrom(e.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2.5 font-body text-sm text-dark outline-none focus:border-dark"
              />
            </div>
            <div>
              <label className="block font-body text-sm font-medium text-dark">{t('open_gym.to')}</label>
              <input
                type="date" value={to} min={from}
                /* Plafond d'un an, comme GYM-230 — posé jusque dans le sélecteur. */
                max={maxHorizonDate(from)}
                onChange={(e) => setTo(e.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2.5 font-body text-sm text-dark outline-none focus:border-dark"
              />
            </div>
          </div>

          {hours && (
            <div className="mt-4 rounded-xl bg-accent-dim/10 px-4 py-3">
              <p className="font-body text-sm font-semibold text-accent-dim">
                {t('open_gym.estimate', { count: estimated })}
              </p>
              <p className="mt-1 font-body text-xs text-muted">
                {t('open_gym.estimate_hint', { days: openDaysCount(hours) })}
              </p>
            </div>
          )}

          <p className="mt-3 font-body text-[11px] text-muted">
            {t('open_gym.idempotent_hint')}
          </p>
          <p className="mt-1 font-body text-[11px] text-muted">
            {t('open_gym.horizon_hint', { days: MAX_HORIZON_DAYS })}
          </p>
        </div>

        <div className="flex justify-end gap-3 border-t border-border p-5">
          <Button type="button" variant="ghost" onClick={onClose} disabled={running}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={handleGenerate} disabled={!canRun} isLoading={running}>
            {t('open_gym.confirm')}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
