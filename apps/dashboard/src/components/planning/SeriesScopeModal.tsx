// GYM-230 — « Cet événement uniquement » ou « et tous les suivants » ?
//
// La question d'Apple Calendar, et la demande de Nico mot pour mot : « proposer de modifier
// soit cet événement, soit tous les futurs ».
//
// ⚠️ JAMAIS « TOUS LES ÉVÉNEMENTS ». Le troisième choix d'Apple n'existe pas ici : le passé
// ne se réécrit pas (décision produit 6). Des présences, des pénalités et des paiements sont
// attachés aux cours déjà tenus — proposer de les modifier serait proposer de mentir sur ce
// qui a eu lieu. L'absence de cette option est une décision, pas un manque.
//
// ⚠️ LE COMPTE EST ANNONCÉ AVANT LA VALIDATION (décision produit 4). Le gérant voit
// « 8 cours · 12 membres seront prévenus » avant de trancher. Sans ce chiffre, il déciderait
// à l'aveugle sur un geste qui touche des dizaines de personnes — et c'est précisément le
// genre de geste qu'on ne défait pas d'un clic.
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarRange, CalendarDays, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'

export type SeriesScope = 'single' | 'following'

export interface SeriesImpact {
  /** Créneaux futurs concernés par « et tous les suivants ». */
  slots: number
  /** Inscrits (confirmés + liste d'attente) sur ces créneaux. */
  members: number
  /** Créneaux déjà modifiés seuls, que la série ÉPARGNERA. */
  skippedExceptions: number
}

interface SeriesScopeModalProps {
  open: boolean
  onClose: () => void
  /** 'update' ou 'delete' — change le vocabulaire, pas la mécanique. */
  action: 'update' | 'delete'
  /** Chargé par l'appelant via l'op 'count'. `null` = calcul en cours. */
  impact: SeriesImpact | null
  onConfirm: (scope: SeriesScope) => Promise<void>
}

export function SeriesScopeModal({ open, onClose, action, impact, onConfirm }: SeriesScopeModalProps) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [scope, setScope] = useState<SeriesScope>('single')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const d = dialogRef.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  // Réouverture → repartir de « cet événement uniquement ». Le choix le plus SÛR est le
  // choix par défaut : se tromper d'un cours se rattrape, se tromper de cinquante non.
  useEffect(() => {
    if (open) { setScope('single'); setSubmitting(false) }
  }, [open])

  async function handleConfirm() {
    if (submitting) return
    setSubmitting(true)
    try {
      await onConfirm(scope)
    } finally {
      setSubmitting(false)
    }
  }

  const destructive = action === 'delete'

  return (
    <dialog
      ref={dialogRef}
      onCancel={onClose}
      className="m-0 h-full w-full max-w-none bg-transparent p-0 backdrop:bg-black/40 md:m-auto md:h-auto md:max-w-[460px] md:rounded-2xl"
    >
      <div className="flex h-full flex-col bg-card md:h-auto md:rounded-2xl md:shadow-2xl">
        <div className="border-b border-border p-5">
          <h2 className="font-display text-xl font-black tracking-tight text-dark">
            {t(`series.${action}.title`)}
          </h2>
          <p className="mt-1 font-body text-sm text-muted">{t(`series.${action}.intro`)}</p>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="flex flex-col gap-2">
            {/* Cet événement uniquement — le créneau devient une EXCEPTION, et les
                modifications de série ultérieures l'épargneront. */}
            <ScopeOption
              Icon={CalendarDays}
              selected={scope === 'single'}
              onSelect={() => setScope('single')}
              title={t('series.scope_single')}
              hint={t(`series.${action}.scope_single_hint`)}
            />

            {/* Et tous les suivants — jamais les précédents. */}
            <ScopeOption
              Icon={CalendarRange}
              selected={scope === 'following'}
              onSelect={() => setScope('following')}
              title={t('series.scope_following')}
              hint={t(`series.${action}.scope_following_hint`)}
            />
          </div>

          {/* L'IMPACT, annoncé avant la décision. */}
          {scope === 'following' && (
            <div className={`mt-4 rounded-xl px-4 py-3 ${destructive ? 'bg-red-50' : 'bg-amber-50'}`}>
              {impact === null ? (
                <span className="inline-flex items-center gap-2 font-body text-xs text-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  {t('series.counting')}
                </span>
              ) : (
                <>
                  <p className={`font-body text-sm font-semibold ${destructive ? 'text-red-700' : 'text-amber-900'}`}>
                    {t(`series.${action}.impact`, { slots: impact.slots, members: impact.members })}
                  </p>
                  {/* Le recrédit n'est pas une promesse en l'air : cancel_slot_atomic le
                      fait, créneau par créneau. On le dit pour que le gérant sache que ses
                      membres ne perdent rien. */}
                  {destructive && impact.members > 0 && (
                    <p className="mt-1 font-body text-xs text-red-700">{t('series.delete.refund_note')}</p>
                  )}
                  {/* Les exceptions épargnées : le gérant doit savoir que certains cours
                      NE seront PAS touchés, sinon il croira à un oubli. */}
                  {impact.skippedExceptions > 0 && (
                    <p className="mt-1.5 font-body text-xs text-muted">
                      {t('series.skipped_exceptions', { count: impact.skippedExceptions })}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-border p-5">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            isLoading={submitting}
            // Attendre le compte avant d'autoriser une action de masse : valider pendant
            // le calcul, ce serait valider sans savoir.
            disabled={submitting || (scope === 'following' && impact === null)}
            className={destructive ? 'bg-red-600 text-white hover:bg-red-700' : undefined}
          >
            {t(`series.${action}.confirm`)}
          </Button>
        </div>
      </div>
    </dialog>
  )
}

function ScopeOption({ Icon, selected, onSelect, title, hint }: {
  Icon: typeof CalendarDays
  selected: boolean
  onSelect: () => void
  title: string
  hint: string
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      // `aria-pressed` plutôt qu'un radio natif : l'apparence est celle d'une carte, mais
      // l'état sélectionné doit rester annoncé par un lecteur d'écran.
      aria-pressed={selected}
      className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-colors ${
        selected ? 'border-dark bg-dark/[0.03]' : 'border-border hover:bg-dark/[0.02]'
      }`}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${selected ? 'text-dark' : 'text-muted'}`} aria-hidden="true" />
      <span className="min-w-0">
        <span className="block font-body text-sm font-semibold text-dark">{title}</span>
        <span className="mt-0.5 block font-body text-xs text-muted">{hint}</span>
      </span>
    </button>
  )
}
