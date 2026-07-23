// GYM-174 — Pointage des présences d'un créneau (dans le SlotDrawer).
//
// INVERSION : non pointé = présent. Chaque inscrit est affiché PRÉSENT par défaut. Le clic
// sur une ligne cycle Présent → Absent → Excusé → Présent, avec mise à jour OPTIMISTE et
// rollback si l'Edge échoue. Un champ de recherche permet d'ajouter un membre au comptoir
// (walk-in), pointé présent immédiatement. Mobile-first : lignes hautes, zones tactiles larges.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, X as XIcon, CircleSlash, Search, UserPlus, Loader2 } from 'lucide-react'
import type { TimeSlot, AttendanceStatus, SlotMember } from '@/types/planning'
import { isPresent } from '@/types/planning'
import { useToastStore } from '@/hooks/useToast'
import type { MarkAttendanceResult, MemberSearchResult } from '@/hooks/usePlanning'

interface AttendanceSectionProps {
  slot: TimeSlot
  onMark: (bookingId: string, status: AttendanceStatus) => Promise<MarkAttendanceResult>
  onWalkIn: (memberId: string) => Promise<void>
  searchMembers: (query: string, excludeIds: string[]) => Promise<MemberSearchResult[]>
  onOpenAddMember: () => void
}

// Cycle Présent → Absent → Excusé → Présent.
function nextStatus(current: AttendanceStatus): AttendanceStatus {
  if (isPresent(current)) return 'no_show'
  if (current === 'no_show') return 'excused'
  return 'attended' // depuis 'excused' → retour présent (pointé explicitement).
}

export function AttendanceSection({ slot, onMark, onWalkIn, searchMembers, onOpenAddMember }: AttendanceSectionProps) {
  const { t } = useTranslation()
  const addToast = useToastStore((s) => s.addToast)

  // Statuts optimistes en attente de confirmation serveur, indexés par bookingId.
  const [optimistic, setOptimistic] = useState<Record<string, AttendanceStatus>>({})
  const [pending, setPending] = useState<Record<string, boolean>>({})

  // Réinitialiser l'état optimiste quand on change de créneau.
  useEffect(() => {
    setOptimistic({})
    setPending({})
  }, [slot.id])

  // Réconcilier : dès que les props reflètent un statut optimiste, on purge l'entrée.
  useEffect(() => {
    setOptimistic((prev) => {
      let changed = false
      const next = { ...prev }
      for (const m of slot.members) {
        if (next[m.bookingId] !== undefined && next[m.bookingId] === m.status) {
          delete next[m.bookingId]
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [slot.members])

  const statusOf = (m: SlotMember): AttendanceStatus => optimistic[m.bookingId] ?? m.status

  const counts = useMemo(() => {
    let present = 0, absent = 0, excused = 0
    for (const m of slot.members) {
      const s = statusOf(m)
      if (isPresent(s)) present++
      else if (s === 'no_show') absent++
      else if (s === 'excused') excused++
    }
    return { present, absent, excused, total: slot.members.length }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot.members, optimistic])

  async function handleCycle(m: SlotMember) {
    if (pending[m.bookingId]) return
    const current = statusOf(m)
    const target = nextStatus(current)

    setOptimistic((prev) => ({ ...prev, [m.bookingId]: target }))
    setPending((prev) => ({ ...prev, [m.bookingId]: true }))
    try {
      const res = await onMark(m.bookingId, target)
      // Notifier le gérant si une sanction (suspension) vient d'être appliquée.
      if (res.penalty?.action === 'applied' && res.penalty.expires_at) {
        addToast(t('attendance.toast_suspension_applied'), 'warning')
      }
    } catch {
      // Rollback : on retire l'entrée optimiste → retour au statut réel des props.
      setOptimistic((prev) => {
        const next = { ...prev }
        delete next[m.bookingId]
        return next
      })
      addToast(t('attendance.toast_mark_error'), 'error')
    } finally {
      setPending((prev) => {
        const next = { ...prev }
        delete next[m.bookingId]
        return next
      })
    }
  }

  // ── Walk-in ────────────────────────────────────────────────────────────────
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MemberSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [addingId, setAddingId] = useState<string | null>(null)
  const searchSeq = useRef(0)

  const enrolledIds = useMemo(() => slot.members.map((m) => m.id), [slot.members])

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

  async function handleWalkIn(member: MemberSearchResult) {
    if (addingId) return
    setAddingId(member.id)
    try {
      await onWalkIn(member.id)
      addToast(t('attendance.toast_walkin_added', { name: `${member.firstName} ${member.lastName}`.trim() || member.email }), 'success')
      setQuery('')
      setResults([])
    } catch {
      addToast(t('attendance.toast_walkin_error'), 'error')
    } finally {
      setAddingId(null)
    }
  }

  return (
    <div className="mt-6 border-t border-border pt-6">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="font-body text-sm font-semibold text-dark">{t('attendance.title')}</h4>
        <span className="font-body text-xs text-muted">
          {t('attendance.counter', {
            present: counts.present,
            absent: counts.absent,
            excused: counts.excused,
            total: counts.total,
          })}
        </span>
      </div>

      {slot.members.length === 0 ? (
        <p className="mb-4 font-body text-sm text-muted">{t('attendance.no_enrolled')}</p>
      ) : (
        <div className="mb-4 flex flex-col gap-2">
          {slot.members.map((m) => {
            const status = statusOf(m)
            const fullName = `${m.firstName} ${m.lastName}`.trim() || m.email || '—'
            const initials = `${m.firstName[0] ?? ''}${m.lastName[0] ?? ''}`.toUpperCase() || (m.email[0] ?? '?').toUpperCase()
            const isBusy = !!pending[m.bookingId]

            const rowStyles = isPresent(status)
              ? 'border-green-200 bg-green-50'
              : status === 'no_show'
                ? 'border-red-200 bg-red-50'
                : 'border-orange-200 bg-orange-50'

            const badge = isPresent(status)
              ? { cls: 'bg-green-100 text-green-700', icon: <Check className="h-3.5 w-3.5" />, label: t('attendance.status.present') }
              : status === 'no_show'
                ? { cls: 'bg-red-100 text-red-700', icon: <XIcon className="h-3.5 w-3.5" />, label: t('attendance.status.absent') }
                : { cls: 'bg-orange-100 text-orange-700', icon: <CircleSlash className="h-3.5 w-3.5" />, label: t('attendance.status.excused') }

            return (
              <button
                key={m.bookingId}
                type="button"
                onClick={() => handleCycle(m)}
                disabled={isBusy}
                className={`flex min-h-[52px] items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors active:scale-[0.99] disabled:opacity-60 ${rowStyles}`}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/70 font-body text-xs font-bold text-dark">
                  {m.avatarUrl ? (
                    <img src={m.avatarUrl} alt={fullName} className="h-full w-full object-cover" />
                  ) : (
                    initials
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <span className="block truncate font-body text-sm font-medium text-dark">{fullName}</span>
                  {m.noshowCount > 0 && (
                    <span className="font-body text-[10px] font-semibold text-red-500">
                      {t('planning.noshow_count', { count: m.noshowCount })}
                    </span>
                  )}
                </div>
                <span className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 font-body text-xs font-semibold ${badge.cls}`}>
                  {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : badge.icon}
                  {badge.label}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Walk-in */}
      <div className="rounded-xl border border-border p-3">
        <div className="flex items-center gap-2 rounded-lg bg-dark/[0.03] px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('attendance.walkin_placeholder')}
            className="w-full bg-transparent font-body text-sm text-dark outline-none placeholder:text-muted"
          />
          {searching && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted" />}
        </div>

        {query.trim().length >= 2 && (
          <div className="mt-2 flex flex-col gap-1">
            {results.length === 0 && !searching ? (
              <p className="px-1 py-2 font-body text-xs text-muted">{t('attendance.walkin_no_result')}</p>
            ) : (
              results.map((r) => {
                const name = `${r.firstName} ${r.lastName}`.trim() || r.email
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => handleWalkIn(r)}
                    disabled={!!addingId}
                    className="flex min-h-[44px] items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-dark/5 disabled:opacity-60"
                  >
                    <UserPlus className="h-4 w-4 shrink-0 text-accent-dim" />
                    <span className="min-w-0 flex-1 truncate font-body text-sm text-dark">{name}</span>
                    {addingId === r.id && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted" />}
                  </button>
                )
              })
            )}
          </div>
        )}

        <button
          type="button"
          onClick={onOpenAddMember}
          className="mt-2 flex items-center gap-1.5 px-1 font-body text-xs font-semibold text-accent-dim hover:underline"
        >
          <UserPlus className="h-3.5 w-3.5" />
          {t('attendance.walkin_new_member')}
        </button>
      </div>
    </div>
  )
}
