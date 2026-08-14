// GYM-226 — Inscrire un membre à un cours FUTUR, depuis le drawer du planning.
//
// LE MANQUE QUE ÇA COMBLE. Le dashboard ne savait ajouter quelqu'un à un cours que par le
// walk-in (GYM-174) : inscription + pointage « présent », pour une personne debout au
// comptoir. Appliqué à un cours de la semaine prochaine, il marquerait présent à un cours
// qui n'a pas eu lieu. Sans ce chemin, un membre Android — 40 à 45 % du parc belge, et
// l'app n'existe que sur iOS — ne peut réserver ni lui-même, ni par la salle.
//
// ⚠️ CETTE MODALE NE POINTE RIEN. Elle crée une réservation, exactement comme l'app membre.
// Le pointage reste la recherche du bloc « Présences », sur les cours du jour et passés.
//
// TROIS REFUS, TROIS GESTES — et aucun contournement silencieux :
//   · SUSPENDU → on ne bloque pas sèchement, on ne contourne pas non plus. La suspension
//     est NOMMÉE et DATÉE, et sa levée est proposée comme ce qu'elle est : un acte à motif
//     obligatoire, journalisé dans gym_admin_actions (admin-lift-suspension, GYM-204).
//     C'est ce qui distingue une dérogation d'un trou.
//   · COMPLET → on PROPOSE la liste d'attente en annonçant la position, on ne l'impose
//     jamais. Le gérant décide pour quelqu'un d'autre : l'inscrire d'office sur une place
//     qu'il n'a pas, ce serait la lui promettre.
//   · SANS CRÉDIT → refus explicite, et on nomme le geste suivant : vendre une formule
//     depuis la fiche membre (GYM-222). Les deux gestes s'enchaînent naturellement.
//
// Le plafond de réservations (GYM-196) s'applique ici comme au libre-service : décision
// produit d'Antoine, « sinon la règle ne veut plus rien dire ». Le refus est affiché avec
// son nombre, jamais silencieusement écarté.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Search, UserPlus, Loader2, ShieldOff, Users, CreditCard } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useToastStore } from '@/hooks/useToast'
import { useGymAdminActions } from '@/hooks/useGymAdminActions'
import { edgeErrorMessage } from '@/lib/edgeErrors'
import type { BookMemberResult, MemberSearchResult } from '@/hooks/usePlanning'
import type { TimeSlot } from '@/types/planning'

interface BookMemberModalProps {
  open: boolean
  onClose: () => void
  slot: TimeSlot | null
  onBook: (slotId: string, memberId: string, allowWaitlist?: boolean) => Promise<BookMemberResult>
  searchMembers: (query: string, excludeIds: string[]) => Promise<MemberSearchResult[]>
}

// Motifs suggérés pour la levée — MÊMES clés que la modale de la fiche membre (GYM-204) :
// une levée décidée depuis le planning doit se lire comme une levée décidée ailleurs.
const LIFT_REASON_KEYS = ['checkin_error', 'proof_provided', 'commercial', 'other'] as const

/**
 * Étape en cours. `idle` = recherche ; les trois autres sont des DÉCISIONS rendues au
 * gérant, avec le contexte que le serveur a renvoyé. Aucune ne se franchit toute seule.
 */
type Step =
  | { kind: 'idle' }
  | { kind: 'suspended'; member: MemberSearchResult; until?: string }
  | { kind: 'full'; member: MemberSearchResult; position?: number }
  | { kind: 'payment'; member: MemberSearchResult; code: string }

function formatUntil(iso: string | undefined, locale: string): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(d)
}

export function BookMemberModal({ open, onClose, slot, onBook, searchMembers }: BookMemberModalProps) {
  const { t, i18n } = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const { liftSuspension } = useGymAdminActions()
  const dialogRef = useRef<HTMLDialogElement>(null)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MemberSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [step, setStep] = useState<Step>({ kind: 'idle' })
  const [liftReason, setLiftReason] = useState('')
  const searchSeq = useRef(0)

  // Les inscrits (et pointés) sont exclus de la recherche : les proposer ne mènerait qu'à
  // un refus ALREADY_BOOKED, après un aller-retour serveur et un client qui attend.
  const enrolledIds = useMemo(() => slot?.members.map((m) => m.id) ?? [], [slot])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  // Réouverture / changement de créneau → repartir propre. Une décision en attente
  // (« mettre en liste d'attente ? ») ne doit pas survivre au créneau qui l'a produite.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setResults([])
    setBusyId(null)
    setStep({ kind: 'idle' })
    setLiftReason('')
  }, [open, slot?.id])

  useEffect(() => {
    const term = query.trim()
    if (term.length < 2) {
      setResults([])
      setSearching(false)
      return
    }
    const seq = ++searchSeq.current
    setSearching(true)
    const handle = setTimeout(async () => {
      const found = await searchMembers(term, enrolledIds)
      if (seq === searchSeq.current) {
        setResults(found)
        setSearching(false)
      }
    }, 250)
    return () => clearTimeout(handle)
  }, [query, enrolledIds, searchMembers])

  const nameOf = (m: MemberSearchResult) => `${m.firstName} ${m.lastName}`.trim() || m.email

  /** Succès → toast qui DIT ce qui s'est passé (place acquise vs promise) et ferme. */
  function handleSuccess(member: MemberSearchResult, res: BookMemberResult) {
    const name = nameOf(member)
    if (res.status === 'waitlisted') {
      addToast(t('book_member.toast_waitlisted', { name, position: res.waitlistPosition ?? '?' }), 'success')
    } else {
      addToast(t('book_member.toast_booked', { name }), 'success')
    }
    onClose()
  }

  /**
   * Achemine un refus vers la décision qu'il appelle. Les codes qui ouvrent un geste
   * (suspension, complet, paiement) deviennent une ÉTAPE ; les autres sont des impasses
   * franches et partent en toast via le mapping centralisé (GYM-219).
   */
  function handleRefusal(member: MemberSearchResult, res: BookMemberResult) {
    switch (res.code) {
      case 'SUSPENDED':
        setStep({ kind: 'suspended', member, until: res.suspendedUntil })
        return
      case 'FULL':
        setStep({ kind: 'full', member, position: res.waitlistPosition })
        return
      case 'PAYMENT_REQUIRED':
      case 'NO_CREDIT':
        setStep({ kind: 'payment', member, code: res.code })
        return
      default:
        addToast(
          edgeErrorMessage(res.code, t, { name: member.firstName || nameOf(member), limit: res.limit }),
          'error',
        )
    }
  }

  async function attemptBook(member: MemberSearchResult, allowWaitlist = false) {
    if (!slot || busyId) return
    setBusyId(member.id)
    try {
      const res = await onBook(slot.id, member.id, allowWaitlist)
      if (res.ok) handleSuccess(member, res)
      else handleRefusal(member, res)
    } catch {
      // Panne réseau / exception hors protocole : aucun code à afficher, repli honnête.
      addToast(edgeErrorMessage(undefined, t), 'error')
    } finally {
      setBusyId(null)
    }
  }

  /**
   * Lever PUIS inscrire — deux appels, deux actes. La levée passe par
   * admin-lift-suspension : motif obligatoire, écriture service_role, trace dans
   * gym_admin_actions. On ne « saute » jamais la sanction, on la lève nommément.
   *
   * ⚠️ Si la levée réussit et l'inscription échoue ensuite (cours devenu complet, dernier
   * crédit consommé…), la levée RESTE ACQUISE — c'est une décision qui a été prise et
   * journalisée, pas une étape technique à annuler. Le refus suivant s'affiche normalement.
   */
  async function handleLiftAndBook() {
    if (step.kind !== 'suspended' || !liftReason.trim() || busyId) return
    const member = step.member
    setBusyId(member.id)
    try {
      const lift = await liftSuspension(member.id, liftReason.trim())
      if (!lift.ok) {
        addToast(
          edgeErrorMessage(lift.code, t, { name: member.firstName || nameOf(member) }),
          'error',
        )
        return
      }
      addToast(t('book_member.toast_lifted', { name: nameOf(member) }), 'success')
      setStep({ kind: 'idle' })
      setLiftReason('')
    } finally {
      setBusyId(null)
    }
    // Hors du finally : `busyId` doit être relâché avant qu'attemptBook le repose.
    await attemptBook(member)
  }

  const busy = busyId !== null
  const cardClass = 'rounded-xl border px-4 py-3'

  return (
    <dialog
      ref={dialogRef}
      onCancel={onClose}
      className="m-0 h-full w-full max-w-none bg-transparent p-0 backdrop:bg-black/40 md:m-auto md:h-auto md:max-w-[480px] md:rounded-2xl"
    >
      <div className="flex h-full flex-col bg-card md:h-auto md:max-h-[90vh] md:rounded-2xl md:shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border p-5">
          <div className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-accent-dim" />
            <h2 className="font-display text-xl font-black tracking-tight text-dark">
              {t('book_member.title')}
            </h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-dark/5">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {slot && (
            <p className="font-body text-sm text-muted">
              {t('book_member.slot_summary', {
                activity: slot.activity.name,
                date: slot.date,
                time: slot.startTime,
              })}
              {' · '}
              {t('book_member.seats', { booked: slot.booked, capacity: slot.capacity })}
            </p>
          )}

          {/* ── SUSPENDU : nommer la sanction, proposer sa levée tracée. ───────── */}
          {step.kind === 'suspended' && (
            <div className={`${cardClass} mt-4 border-amber-200 bg-amber-50`}>
              <div className="flex items-center gap-2">
                <ShieldOff className="h-4 w-4 shrink-0 text-amber-700" />
                <p className="font-body text-sm font-semibold text-amber-900">
                  {t('book_member.suspended.headline', {
                    name: step.member.firstName || nameOf(step.member),
                    date: formatUntil(step.until, i18n.language) ?? t('book_member.suspended.unknown_date'),
                  })}
                </p>
              </div>
              <p className="mt-2 font-body text-xs text-amber-800">
                {t('book_member.suspended.explain')}
              </p>

              {/* Motif OBLIGATOIRE — le bouton reste inerte tant qu'il est vide. Une levée
                  de sanction est une décision : elle doit être justifiée et retrouvable. */}
              <label className="mt-4 block font-body text-xs font-semibold text-amber-900">
                {t('members.lift.reason_label')} *
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                {LIFT_REASON_KEYS.map((k) => {
                  const label = t(`members.lift.reason.${k}`)
                  const isOther = k === 'other'
                  const active = !isOther && liftReason === label
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setLiftReason(isOther ? '' : label)}
                      className={`rounded-full border px-3 py-1.5 font-body text-xs font-semibold transition-colors ${
                        active ? 'border-amber-900 bg-amber-900 text-white' : 'border-amber-300 text-amber-800 hover:bg-amber-100'
                      }`}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
              <input
                value={liftReason}
                onChange={(e) => setLiftReason(e.target.value)}
                placeholder={t('members.lift.reason_placeholder')}
                className="mt-2 w-full rounded-xl border border-amber-300 bg-white px-4 py-3 font-body text-sm text-dark outline-none focus:border-amber-600"
              />
              <p className="mt-2 font-body text-[11px] text-amber-700">
                {t('book_member.suspended.traced')}
              </p>

              <div className="mt-4 flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => { setStep({ kind: 'idle' }); setLiftReason('') }}>
                  {t('common.cancel')}
                </Button>
                <Button
                  type="button"
                  onClick={handleLiftAndBook}
                  disabled={!liftReason.trim() || busy}
                  isLoading={busy}
                >
                  {t('book_member.suspended.lift_and_book')}
                </Button>
              </div>
            </div>
          )}

          {/* ── COMPLET : proposer la liste d'attente, position annoncée. ──────── */}
          {step.kind === 'full' && (
            <div className={`${cardClass} mt-4 border-border bg-dark/[0.03]`}>
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 shrink-0 text-muted" />
                <p className="font-body text-sm font-semibold text-dark">
                  {t('book_member.full.headline')}
                </p>
              </div>
              <p className="mt-2 font-body text-xs text-muted">
                {t('book_member.full.explain', {
                  name: step.member.firstName || nameOf(step.member),
                  position: step.position ?? '?',
                })}
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setStep({ kind: 'idle' })}>
                  {t('common.cancel')}
                </Button>
                <Button
                  type="button"
                  onClick={() => attemptBook(step.member, true)}
                  disabled={busy}
                  isLoading={busy}
                >
                  {t('book_member.full.confirm')}
                </Button>
              </div>
            </div>
          )}

          {/* ── SANS CRÉDIT : refus explicite + le geste suivant, nommé. ───────── */}
          {step.kind === 'payment' && (
            <div className={`${cardClass} mt-4 border-border bg-dark/[0.03]`}>
              <div className="flex items-center gap-2">
                <CreditCard className="h-4 w-4 shrink-0 text-muted" />
                <p className="font-body text-sm font-semibold text-dark">
                  {edgeErrorMessage(step.code, t, { name: step.member.firstName || nameOf(step.member) })}
                </p>
              </div>
              <p className="mt-2 font-body text-xs text-muted">
                {t('book_member.payment.next_step', { name: step.member.firstName || nameOf(step.member) })}
              </p>
              <div className="mt-4 flex justify-end">
                <Button type="button" variant="ghost" onClick={() => setStep({ kind: 'idle' })}>
                  {t('book_member.payment.back_to_search')}
                </Button>
              </div>
            </div>
          )}

          {/* ── Recherche ─────────────────────────────────────────────────────── */}
          {step.kind === 'idle' && (
            <>
              <div className="mt-4 flex items-center gap-2 rounded-lg bg-dark/[0.03] px-3 py-2">
                <Search className="h-4 w-4 shrink-0 text-muted" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('book_member.search_placeholder')}
                  className="w-full bg-transparent font-body text-sm text-dark outline-none placeholder:text-muted"
                />
                {searching && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted" />}
              </div>

              {query.trim().length < 2 ? (
                <p className="mt-3 px-1 font-body text-xs text-muted">{t('book_member.search_hint')}</p>
              ) : (
                <div className="mt-2 flex flex-col gap-1">
                  {results.length === 0 && !searching ? (
                    <p className="px-1 py-2 font-body text-xs text-muted">{t('attendance.walkin_no_result')}</p>
                  ) : (
                    results.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => attemptBook(r)}
                        disabled={busy}
                        className="flex min-h-[48px] items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-dark/5 disabled:opacity-60"
                      >
                        <UserPlus className="h-4 w-4 shrink-0 text-accent-dim" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-body text-sm text-dark">{nameOf(r)}</span>
                          {r.email && (
                            <span className="block truncate font-body text-[11px] text-muted">{r.email}</span>
                          )}
                        </span>
                        {busyId === r.id && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted" />}
                      </button>
                    ))
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end border-t border-border p-5">
          <Button type="button" variant="ghost" onClick={onClose}>{t('common.close')}</Button>
        </div>
      </div>
    </dialog>
  )
}
