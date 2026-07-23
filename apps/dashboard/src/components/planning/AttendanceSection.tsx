// GYM-174 — Pointage des présences d'un créneau (dans le SlotDrawer).
//
// INVERSION : non pointé = présent. Chaque inscrit est affiché PRÉSENT par défaut. Le clic
// sur une ligne cycle Présent → Absent → Excusé → Présent, avec mise à jour OPTIMISTE et
// rollback si l'Edge échoue. Un champ de recherche permet d'ajouter un membre au comptoir
// (walk-in), pointé présent immédiatement. Mobile-first : lignes hautes, zones tactiles larges.
//
// GYM-179 (fix 2) — DEBOUNCE ~5 s PAR RÉSERVATION de la persistance. L'UI reste optimiste et
// instantanée, mais seul l'ÉTAT FINAL est envoyé à l'Edge après 5 s d'inactivité sur la ligne.
// Un passage éclair Présent→Absent→Excusé n'écrit donc qu'UNE fois (l'état final), évitant les
// écritures crédit/pénalité successives et surtout une fausse notification de suspension sur un
// passage transitoire par « Absent ». Si l'état final == l'état en base, aucun appel. Les
// changements en attente sont FLUSHÉS immédiatement à la fermeture / au changement de créneau /
// au démontage (un pointage n'est jamais perdu).
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

// Délai d'inactivité avant persistance d'une ligne (GYM-179).
const DEBOUNCE_MS = 5000

// Cycle Présent → Absent → Excusé → Présent.
function nextStatus(current: AttendanceStatus): AttendanceStatus {
  if (isPresent(current)) return 'no_show'
  if (current === 'no_show') return 'excused'
  return 'attended' // depuis 'excused' → retour présent (pointé explicitement).
}

export function AttendanceSection({ slot, onMark, onWalkIn, searchMembers, onOpenAddMember }: AttendanceSectionProps) {
  const { t } = useTranslation()
  const addToast = useToastStore((s) => s.addToast)

  // Statuts optimistes affichés (indexés par bookingId), en attente de persistance/confirmation.
  const [optimistic, setOptimistic] = useState<Record<string, AttendanceStatus>>({})
  // Lignes avec une écriture en attente (timer) ou en vol → indicateur « Enregistrement… ».
  const [saving, setSaving] = useState<Record<string, boolean>>({})

  // Refs pour le debounce : survivent aux re-renders et sont lisibles depuis les timeouts
  // et les cleanups (flush au démontage) sans dépendre de closures obsolètes.
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const pendingTargetRef = useRef<Record<string, AttendanceStatus>>({}) // état final visé par ligne
  const pendingBaseRef = useRef<Record<string, AttendanceStatus>>({})   // état en base au 1er clic
  const onMarkRef = useRef(onMark)
  const mountedRef = useRef(true)
  useEffect(() => { onMarkRef.current = onMark }, [onMark])

  // Persiste (ou annule) l'état en attente d'une ligne. Ne fait AUCUN appel si l'état final
  // égale l'état en base. `interactive` = false lors d'un flush de cleanup (pas de setState).
  function flush(bookingId: string, interactive: boolean) {
    const timer = timersRef.current[bookingId]
    if (timer) { clearTimeout(timer); delete timersRef.current[bookingId] }

    const target = pendingTargetRef.current[bookingId]
    const base = pendingBaseRef.current[bookingId]
    delete pendingTargetRef.current[bookingId]
    delete pendingBaseRef.current[bookingId]
    if (target === undefined) return

    // État final identique à la base → rien à écrire (annulation nette).
    if (target === base) {
      if (interactive && mountedRef.current) {
        setOptimistic((prev) => { const n = { ...prev }; delete n[bookingId]; return n })
        setSaving((prev) => { const n = { ...prev }; delete n[bookingId]; return n })
      }
      return
    }

    const done = () => {
      if (interactive && mountedRef.current) {
        setSaving((prev) => { const n = { ...prev }; delete n[bookingId]; return n })
      }
    }
    onMarkRef.current(bookingId, target)
      .then((res) => {
        if (res.penalty?.action === 'applied' && res.penalty.expires_at && interactive && mountedRef.current) {
          addToast(t('attendance.toast_suspension_applied'), 'warning')
        }
      })
      .catch(() => {
        // Rollback : on retire l'entrée optimiste → retour au statut réel des props.
        if (interactive && mountedRef.current) {
          setOptimistic((prev) => { const n = { ...prev }; delete n[bookingId]; return n })
          addToast(t('attendance.toast_mark_error'), 'error')
        }
      })
      .finally(done)
  }

  // Démontage : marquer non monté (les flushs de cleanup ne doivent pas setState).
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // Flush garanti au CHANGEMENT DE CRÉNEAU et au DÉMONTAGE (fermeture du panneau /
  // navigation) : le cleanup de cet effet s'exécute avant tout reset, sans rien perdre.
  useEffect(() => {
    return () => {
      for (const id of Object.keys(pendingTargetRef.current)) {
        flush(id, false)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot.id])

  // Nouveau créneau → repartir d'un affichage propre (les pendings de l'ancien ont été flushés
  // par le cleanup ci-dessus, qui s'exécute avant ce body).
  useEffect(() => {
    setOptimistic({})
    setSaving({})
  }, [slot.id])

  // Réconcilier : dès que les props reflètent un statut optimiste, on purge l'entrée
  // (sauf si une écriture est encore en attente sur cette ligne).
  useEffect(() => {
    setOptimistic((prev) => {
      let changed = false
      const next = { ...prev }
      for (const m of slot.members) {
        if (next[m.bookingId] !== undefined && next[m.bookingId] === m.status && pendingTargetRef.current[m.bookingId] === undefined) {
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

  function handleCycle(m: SlotMember) {
    const current = statusOf(m)
    const target = nextStatus(current)

    // Affichage optimiste immédiat.
    setOptimistic((prev) => ({ ...prev, [m.bookingId]: target }))
    setSaving((prev) => ({ ...prev, [m.bookingId]: true }))

    // État en base capturé au PREMIER clic du cycle (jamais écrasé par les clics suivants),
    // pour détecter un retour net à l'état initial.
    if (pendingBaseRef.current[m.bookingId] === undefined) {
      pendingBaseRef.current[m.bookingId] = m.status
    }
    pendingTargetRef.current[m.bookingId] = target

    // (Re)armer le debounce de CETTE ligne : un nouveau clic réinitialise son timer.
    const existing = timersRef.current[m.bookingId]
    if (existing) clearTimeout(existing)
    timersRef.current[m.bookingId] = setTimeout(() => flush(m.bookingId, true), DEBOUNCE_MS)
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
            const isSaving = !!saving[m.bookingId]

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
                className={`flex min-h-[52px] items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors active:scale-[0.99] ${rowStyles}`}
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
                  {isSaving ? (
                    <span className="inline-flex items-center gap-1 font-body text-[10px] font-medium text-muted">
                      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                      {t('attendance.saving')}
                    </span>
                  ) : (
                    m.noshowCount > 0 && (
                      <span className="font-body text-[10px] font-semibold text-red-500">
                        {t('planning.noshow_count', { count: m.noshowCount })}
                      </span>
                    )
                  )}
                </div>
                <span className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 font-body text-xs font-semibold ${badge.cls}`}>
                  {badge.icon}
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
