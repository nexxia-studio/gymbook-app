import { useState, useEffect, useMemo, useRef, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import {
  RECURRENCE_MODES, MAX_HORIZON_DAYS, maxHorizonDate, buildRRuleString,
  generateLocalDates, clampHorizon,
  type RecurrenceInput, type RecurrenceMode, type RecurrenceEndMode,
} from '@/lib/recurrence'
import type { TimeSlot, Activity, Coach } from '@/types/planning'

export interface SlotFormData {
  activityId: string
  coachId: string
  date: string
  startTime: string
  duration: number
  capacity: number
  level: string
  notes: string
  /** GYM-230 — undefined = créneau ponctuel, le cas le plus fréquent. */
  recurrence?: RecurrenceInput
}

interface SlotModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: SlotFormData) => void
  activities: Activity[]
  coaches: Coach[]
  editSlot?: TimeSlot | null
  checkOverlap?: (coachId: string, date: string, startTime: string, duration: number, excludeId?: string) => boolean
  /**
   * GYM-234 — amorçage depuis un clic sur la grille de /planning.
   *
   * Le gérant vient de regarder la case vide où il veut poser son cours : lui redemander
   * la date et l'heure à la main, c'est lui faire ressaisir ce qu'il vient de désigner.
   * Sur une grille de douze cours hebdomadaires, c'était douze saisies.
   *
   * `undefined` = ouverture par le bouton « Nouveau créneau » : on retombe sur les valeurs
   * par défaut historiques (aujourd'hui, 07:00). Ignoré en édition, où les valeurs viennent
   * du créneau.
   */
  initialDate?: string
  initialStartTime?: string
}

// Ordre RRule : 0 = lundi. Les libellés courts sont ceux du planning (MobileDayList).
const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
// Borne d'INTERFACE sur « après N occurrences ». Le moteur et la base plafonnent aussi.
const MAX_OCCURRENCES_UI = 366

const SUGGESTED_TIMES = ['07:00', '08:00', '09:30', '12:00', '17:30', '18:30', '19:00', '20:00', '20:30']

function addMinutes(time: string, mins: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = h * 60 + m + mins
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/**
 * GYM-231 — repli quand AUCUNE activité n'est encore choisie.
 *
 * C'était la valeur en dur qui s'affichait TOUJOURS : le formulaire proposait 16 places
 * même pour une activité réglée à 2. Elle ne subsiste que pour l'état initial, avant tout
 * choix d'activité — dès qu'une activité est sélectionnée, c'est SA capacité par défaut
 * qui s'applique.
 */
const FALLBACK_CAPACITY = 16
/** Idem pour la durée, sur le même chemin. */
const FALLBACK_DURATION = 60

/**
 * Durée RÉELLE d'un créneau, depuis ses bornes.
 *
 * ⚠️ En édition, la durée doit venir du CRÉNEAU et non de son activité : un cours
 * exceptionnel de 90 min sur une activité réglée à 60 se voyait ramené à 60 à la simple
 * ouverture de la modale — la même faute que celle corrigée ici pour la capacité, dans
 * l'autre sens. `0` ou négatif (donnée aberrante) → on laisse l'appelant replier.
 */
function minutesBetween(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const diff = (eh * 60 + em) - (sh * 60 + sm)
  return diff > 0 ? diff : 0
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}


type FormErrors = Partial<Record<keyof SlotFormData, string>>

export function SlotModal({
  open, onClose, onSubmit, activities, coaches, editSlot, checkOverlap,
  initialDate, initialStartTime,
}: SlotModalProps) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDialogElement>(null)

  const isEdit = !!editSlot

  const [form, setForm] = useState<SlotFormData>({
    activityId: '',
    coachId: '',
    date: todayStr(),
    startTime: '07:00',
    duration: FALLBACK_DURATION,
    capacity: FALLBACK_CAPACITY,
    level: 'all',
    notes: '',
    recurrence: undefined,
  })
  const [errors, setErrors] = useState<FormErrors>({})

  /**
   * GYM-231 — le gérant a-t-il SAISI lui-même la capacité / la durée ?
   *
   * ⚠️ ARBITRAGE : changer d'activité ne réamorce QUE tant que la valeur est encore celle
   * proposée. Écraser toujours serait plus simple, mais effacerait sans un mot une saisie
   * explicite — un gérant qui pose un cours exceptionnel à 20 places, puis corrige un
   * clic d'activité, verrait son 20 redevenir 12 sans rien remarquer. Or effacer
   * silencieusement une donnée juste est précisément le défaut que ce lot corrige ; le
   * reproduire dans l'autre sens ne serait pas un progrès.
   *
   * Ne jamais réamorcer du tout, à l'inverse, viderait la correction de son sens : le
   * formulaire proposerait éternellement le repli de la première activité choisie.
   */
  const capacityTouched = useRef(false)
  const durationTouched = useRef(false)

  // Reset form when opening
  useEffect(() => {
    if (!open) return
    if (editSlot) {
      setForm({
        activityId: editSlot.activity.id,
        coachId: editSlot.coach.id,
        date: editSlot.date,
        startTime: editSlot.startTime,
        // ⚠️ LE CRÉNEAU D'ABORD, SON ACTIVITÉ ENSUITE. Ces deux valeurs appartiennent au
        // créneau : elles ne doivent JAMAIS être réamorcées depuis l'activité en édition,
        // sinon un cours exceptionnel perd ce qui le rend exceptionnel.
        duration: minutesBetween(editSlot.startTime, editSlot.endTime) || editSlot.activity.durationMin,
        capacity: editSlot.capacity,
        level: 'all',
        notes: '',
        recurrence: undefined,
      })
    } else {
      setForm({
        activityId: '',
        coachId: '',
        // GYM-234 — amorce du clic sur la grille, sinon les valeurs historiques.
        date: initialDate ?? todayStr(),
        startTime: initialStartTime ?? '07:00',
        duration: FALLBACK_DURATION,
        capacity: FALLBACK_CAPACITY,
        level: 'all',
        notes: '',
        recurrence: undefined,
      })
    }
    // Une saisie manuelle ne survit pas à la fermeture : la modale rouverte doit reproposer.
    capacityTouched.current = false
    durationTouched.current = false
    setErrors({})
  }, [open, editSlot, initialDate, initialStartTime])

  // Dialog open/close
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  // Auto-fill duration + capacity from activity
  const selectedActivity = useMemo(
    () => activities.find((a) => a.id === form.activityId),
    [activities, form.activityId],
  )

  // GYM-229 — le coach est-il attendu pour CETTE activité ?
  //
  // Repli sur `true` tant qu'aucune activité n'est choisie, et pour une activité chargée
  // par un build antérieur à la migration : le comportement historique (coach obligatoire)
  // reste celui par défaut, on ne relâche jamais la règle par accident.
  const needsCoach = selectedActivity?.requiresCoach ?? true

  function handleActivityChange(id: string) {
    const act = activities.find((a) => a.id === id)
    // ⚠️ RÉAGIT AU CHANGEMENT D'ACTIVITÉ, pas seulement à l'ouverture de la modale. Passer
    // d'un cours encadré à l'Open Gym doit OUBLIER le coach déjà choisi : le conserver
    // enregistrerait un encadrant sur un créneau en accès libre — exactement la donnée
    // fausse que ce lot supprime. Le champ étant masqué, le gérant ne pourrait pas le voir
    // ni le corriger.
    const actNeedsCoach = act?.requiresCoach ?? true
    setForm((f) => ({
      ...f,
      activityId: id,
      // GYM-231 — la capacité PROPOSÉE vient de l'activité choisie, et suit le CHANGEMENT
      // d'activité (même comportement que le sélecteur de coach, GYM-229). Elle reste
      // librement modifiable : c'est une proposition, pas une contrainte.
      capacity: capacityTouched.current ? f.capacity : act?.defaultCapacity ?? f.capacity,
      duration: durationTouched.current ? f.duration : act?.durationMin ?? f.duration,
      coachId: actNeedsCoach ? f.coachId : '',
    }))
  }

  const endTime = useMemo(
    () => (form.startTime ? addMinutes(form.startTime, form.duration) : '--:--'),
    [form.startTime, form.duration],
  )

  /**
   * GYM-230 — APERÇU CALCULÉ PAR LE MOTEUR, pas estimé.
   *
   * L'ancien aperçu multipliait les semaines (`start + (n-1)*7`) : juste pour un
   * hebdomadaire, faux pour tout le reste. Ici on construit la vraie règle et on génère
   * les vraies dates — le gérant voit le nombre exact de cours qu'il va créer, et la
   * dernière date, AVANT de valider. Un « chaque 31 du mois » qui saute février se lit
   * alors dans l'aperçu, pas après coup dans le planning.
   */
  const preview = useMemo(() => {
    if (!form.recurrence || !form.date) return null
    try {
      const rec: RecurrenceInput = { ...form.recurrence, startsOn: form.date }
      const rrule = buildRRuleString(rec)
      const wantedEnd = rec.endMode === 'until' && rec.until ? rec.until : maxHorizonDate(rec.startsOn)
      const dates = generateLocalDates(rrule, rec.startsOn, clampHorizon(rec.startsOn, wantedEnd))
      if (dates.length === 0) return null
      return { count: dates.length, first: dates[0], last: dates[dates.length - 1] }
    } catch {
      // Une combinaison impossible ne doit pas faire tomber la modale : pas d'aperçu,
      // et la validation refusera à la soumission.
      return null
    }
  }, [form.recurrence, form.date])

  function validate(): boolean {
    const e: FormErrors = {}
    if (!form.activityId) e.activityId = t('slots.validation.activity_required')
    // GYM-229 — exigence portée par l'activité, plus par le formulaire.
    if (needsCoach && !form.coachId) e.coachId = t('slots.validation.coach_required')
    if (!form.date) e.date = t('slots.validation.date_required')
    else if (form.date < todayStr()) e.date = t('slots.validation.date_past')
    if (!form.startTime) e.startTime = t('slots.validation.time_required')
    if (form.capacity < 1) e.capacity = t('slots.validation.capacity_min')
    if (form.capacity > 50) e.capacity = t('slots.validation.capacity_max')
    // GYM-230 — une série qui ne produit rien serait un silence : le gérant validerait et
    // rien n'apparaîtrait. On refuse à la soumission, en nommant la cause.
    if (form.recurrence && !preview) e.recurrence = t('slots.validation.recurrence_empty')
    if (form.coachId && form.date && form.startTime && checkOverlap) {
      if (checkOverlap(form.coachId, form.date, form.startTime, form.duration, editSlot?.id)) {
        e.startTime = t('slots.validation.coach_overlap')
      }
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function handleSubmit(ev: FormEvent) {
    ev.preventDefault()
    if (!validate()) return
    onSubmit(form)
  }

  const selectClass =
    'w-full rounded-xl border border-border bg-card px-4 py-3 font-body text-sm text-dark outline-none transition-colors focus:border-dark'
  const labelClass = 'font-body text-sm font-medium text-dark'
  const errClass = 'text-xs text-red-500 mt-1'

  return (
    <dialog
      ref={dialogRef}
      onCancel={onClose}
      className="m-0 h-full w-full max-w-none bg-transparent p-0 backdrop:bg-black/40 md:m-auto md:h-auto md:max-w-[560px] md:rounded-2xl"
    >
      <div className="flex h-full flex-col bg-card md:h-auto md:max-h-[90vh] md:rounded-2xl md:shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border p-5">
          <h2 className="font-display text-xl font-black tracking-tight text-dark">
            {isEdit ? t('slots.edit_title') : t('slots.create_title')}
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-dark/5">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5">
          <div className="flex flex-col gap-5">
            {/* Activity */}
            <div>
              <label className={labelClass}>{t('slots.activity')}</label>
              <select
                value={form.activityId}
                onChange={(e) => handleActivityChange(e.target.value)}
                className={selectClass}
              >
                <option value="">{t('slots.activity_placeholder')}</option>
                {activities.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
              {errors.activityId && <p className={errClass}>{errors.activityId}</p>}
            </div>

            {/* Coach — GYM-229 : MASQUÉ, pas seulement facultatif, quand l'activité est en
                accès libre. Un champ vide et sans objet invite à le remplir « au cas où » ;
                c'est ainsi qu'on se retrouve avec un coach fictif sur un créneau Open Gym.
                Une note explique l'absence, pour que le champ ne semble pas avoir disparu
                par erreur. */}
            {!needsCoach ? (
              <div className="rounded-xl border border-border bg-dark/[0.02] px-4 py-3">
                <p className="font-body text-xs text-muted">{t('slots.no_coach_needed')}</p>
              </div>
            ) : (
            <div>
              <label className={labelClass}>{t('slots.coach')}</label>
              <select
                value={form.coachId}
                onChange={(e) => setForm((f) => ({ ...f, coachId: e.target.value }))}
                className={selectClass}
              >
                <option value="">{t('slots.coach_placeholder')}</option>
                {coaches.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {errors.coachId && <p className={errClass}>{errors.coachId}</p>}
            </div>
            )}

            {/* Date */}
            <div>
              <label className={labelClass}>{t('slots.date')}</label>
              <input
                type="date"
                value={form.date}
                min={todayStr()}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                className={selectClass}
              />
              {errors.date && <p className={errClass}>{errors.date}</p>}
            </div>

            {/* Start time + suggested */}
            <div>
              <label className={labelClass}>{t('slots.start_time')}</label>
              <input
                type="time"
                value={form.startTime}
                onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))}
                className={selectClass}
              />
              <div className="mt-2 flex flex-wrap gap-1">
                <span className="font-body text-[10px] text-muted">{t('slots.suggested_times')}:</span>
                {SUGGESTED_TIMES.map((time) => (
                  <button
                    key={time}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, startTime: time }))}
                    className={`rounded px-2 py-0.5 font-body text-[10px] transition-colors ${
                      form.startTime === time
                        ? 'bg-accent text-[#17102E]'
                        : 'bg-dark/5 text-muted hover:bg-dark/10'
                    }`}
                  >
                    {time}
                  </button>
                ))}
              </div>
              {errors.startTime && <p className={errClass}>{errors.startTime}</p>}
            </div>

            {/* Duration + end time */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>{t('slots.duration')}</label>
                <input
                  type="number"
                  value={form.duration}
                  min={15}
                  max={180}
                  step={5}
                  onChange={(e) => {
                    durationTouched.current = true
                    setForm((f) => ({ ...f, duration: Number(e.target.value) }))
                  }}
                  className={selectClass}
                />
              </div>
              <div className="flex items-end pb-3">
                <span className="font-body text-sm font-medium text-accent-dim">
                  {t('slots.end_time', { time: endTime })}
                </span>
              </div>
            </div>

            {/* Capacity */}
            <div>
              <label className={labelClass}>{t('slots.capacity')}</label>
              <input
                type="number"
                value={form.capacity}
                min={1}
                max={50}
                onChange={(e) => {
                  capacityTouched.current = true
                  setForm((f) => ({ ...f, capacity: Number(e.target.value) }))
                }}
                className={selectClass}
              />
              {errors.capacity && <p className={errClass}>{errors.capacity}</p>}
            </div>

            {/* Level */}
            <div>
              <label className={labelClass}>{t('slots.level')}</label>
              <select
                value={form.level}
                onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))}
                className={selectClass}
              >
                <option value="all">{t('slots.level_all')}</option>
                <option value="beginner">{t('slots.level_beginner')}</option>
                <option value="intermediate">{t('slots.level_intermediate')}</option>
                <option value="advanced">{t('slots.level_advanced')}</option>
              </select>
            </div>

            {/* Notes */}
            <div>
              <label className={labelClass}>{t('slots.notes')}</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value.slice(0, 200) }))}
                placeholder={t('slots.notes_placeholder')}
                rows={2}
                className={`${selectClass} resize-none`}
              />
              <p className="mt-1 text-right font-body text-[10px] text-muted">{form.notes.length}/200</p>
            </div>

            {/* GYM-230 — RÉCURRENCE.
                Le cas PONCTUEL reste le geste le plus fréquent : tant que la case n'est
                pas cochée, rien ne s'affiche et le formulaire est exactement celui d'avant.
                Cocher déplie les options — on ne fait pas payer le cas simple pour le
                cas complexe. */}
            {!isEdit && (
              <div className="rounded-xl border border-border p-4">
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={!!form.recurrence}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        recurrence: e.target.checked
                          ? { mode: 'weekly', startsOn: f.date, endMode: 'count', count: 8 }
                          : undefined,
                      }))
                    }
                    className="h-4 w-4 rounded accent-accent"
                  />
                  <span className={labelClass}>{t('slots.repeat')}</span>
                </label>

                {form.recurrence && (
                  <div className="mt-3 flex flex-col gap-3 pl-7">
                    {/* Fréquence */}
                    <div>
                      <label className="font-body text-xs text-muted">{t('slots.repeat_frequency')}</label>
                      <select
                        value={form.recurrence.mode}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            recurrence: { ...f.recurrence!, mode: e.target.value as RecurrenceMode },
                          }))
                        }
                        className={`${selectClass} mt-1`}
                      >
                        {RECURRENCE_MODES.map((m) => (
                          <option key={m} value={m}>{t(`slots.recurrence_mode.${m}`)}</option>
                        ))}
                      </select>
                    </div>

                    {/* Jours de la semaine — mode personnalisé uniquement. */}
                    {form.recurrence.mode === 'custom_weekdays' && (
                      <div>
                        <label className="font-body text-xs text-muted">{t('slots.repeat_weekdays')}</label>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {WEEKDAY_KEYS.map((key, idx) => {
                            const picked = form.recurrence?.weekdays?.includes(idx) ?? false
                            return (
                              <button
                                key={key}
                                type="button"
                                aria-pressed={picked}
                                onClick={() =>
                                  setForm((f) => {
                                    const cur = f.recurrence!.weekdays ?? []
                                    const next = cur.includes(idx) ? cur.filter((d) => d !== idx) : [...cur, idx]
                                    return { ...f, recurrence: { ...f.recurrence!, weekdays: next } }
                                  })
                                }
                                className={`h-8 w-9 rounded-lg font-body text-xs font-semibold transition-colors ${
                                  picked ? 'bg-accent text-[#17102E]' : 'bg-dark/5 text-muted hover:bg-dark/10'
                                }`}
                              >
                                {t(`planning.days_short.${key}`)}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* Fin — jamais « jamais » (décision produit 3). */}
                    <div>
                      <label className="font-body text-xs text-muted">{t('slots.repeat_end')}</label>
                      <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
                        <select
                          value={form.recurrence.endMode}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              recurrence: { ...f.recurrence!, endMode: e.target.value as RecurrenceEndMode },
                            }))
                          }
                          className={`${selectClass} sm:w-48`}
                        >
                          <option value="count">{t('slots.repeat_end_count')}</option>
                          <option value="until">{t('slots.repeat_end_until')}</option>
                        </select>

                        {form.recurrence.endMode === 'count' ? (
                          <input
                            type="number"
                            min={2}
                            max={MAX_OCCURRENCES_UI}
                            value={form.recurrence.count ?? 8}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                recurrence: { ...f.recurrence!, count: Number(e.target.value) },
                              }))
                            }
                            className="w-24 rounded-lg border border-border bg-card px-3 py-2 font-body text-sm text-dark outline-none focus:border-dark"
                          />
                        ) : (
                          <input
                            type="date"
                            value={form.recurrence.until ?? ''}
                            min={form.date}
                            /* Plafond d'un an, posé jusque dans le sélecteur de date : le
                               gérant ne peut pas même choisir une date hors horizon. La
                               contrainte est REDITE en base — celle-ci guide, celle-là
                               empêche. */
                            max={maxHorizonDate(form.date)}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                recurrence: { ...f.recurrence!, until: e.target.value },
                              }))
                            }
                            className="rounded-lg border border-border bg-card px-3 py-2 font-body text-sm text-dark outline-none focus:border-dark"
                          />
                        )}
                      </div>
                    </div>

                    {/* Aperçu — le nombre EXACT de cours, calculé par le moteur. */}
                    {preview ? (
                      <p className="rounded-lg bg-accent-dim/10 px-3 py-2 font-body text-xs text-accent-dim">
                        {t('slots.repeat_preview', {
                          count: preview.count,
                          start: preview.first,
                          end: preview.last,
                        })}
                      </p>
                    ) : (
                      <p className="rounded-lg bg-amber-50 px-3 py-2 font-body text-xs text-amber-800">
                        {t('slots.validation.recurrence_empty')}
                      </p>
                    )}
                    {errors.recurrence && <p className={errClass}>{errors.recurrence}</p>}

                    <p className="font-body text-[11px] text-muted">
                      {t('slots.repeat_horizon_hint', { days: MAX_HORIZON_DAYS })}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </form>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-border p-5">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={(ev) => { ev.preventDefault(); const fakeEv = { preventDefault: () => {} } as FormEvent; handleSubmit(fakeEv); }}>
            {isEdit
              ? t('slots.save_button')
              : preview
                ? t('slots.create_multiple', { count: preview.count })
                : t('slots.create_button')}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
