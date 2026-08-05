// GYM-214 — Dossier disciplinaire d'un membre (drawer /members + modale de levée).
//
// Même forme de chargement que le journal d'ajustements de crédits (GYM-182 dans
// useMemberDetail) : un Promise.all de lectures directes, mappées vers des interfaces
// typées, un `loading`, un `reload`.
//
// POLICIES — tout est déjà autorisé au gym_admin, AUCUNE migration dans ce lot :
//   · penalties          → « Gym admins gèrent les pénalités du gym »
//                          USING (gym_id = get_my_gym_id() AND is_gym_admin())
//   · gym_admin_actions  → « Gym admins voient leurs actions », même prédicat
//   · noshow_rules       → « Gym admins gèrent les règles no-show », même prédicat
//   · bookings           → déjà lues par la fiche membre (useMemberDetail)
// Les trois policies sont en USING sans clause FOR : elles couvrent donc le SELECT.
//
// ⚠️ LECTURE SEULE. Aucune ligne de `penalties` n'est écrite ni modifiée ici.
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/useAuthStore'
import {
  resolvePenaltyOrigin, resolvePenaltyKind, penaltyDuration, findLiftForPenalty, noshowResetDate,
  type PenaltyOrigin, type PenaltyKind, type PenaltyDuration, type PenaltyLift,
} from '@/lib/penalties'

export type { PenaltyLift } from '@/lib/penalties'

/** Une pénalité, déjà interprétée : plus aucune valeur brute de `type` en aval. */
export interface PenaltyEntry {
  id: string
  kind: PenaltyKind
  origin: PenaltyOrigin
  appliedAt: string | null
  expiresAt: string | null
  duration: PenaltyDuration | null
  /** penalties.notes — le motif écrit par le chemin qui a posé la sanction. */
  notes: string
  /** Cours concerné, via booking_id → time_slots → activities. Null si non résolvable. */
  activity: string | null
  /** Levée accordée (GYM-204), rapprochée à l'affichage. Null = jamais levée. */
  lift: PenaltyLift | null
  /** Suspension encore en cours MAINTENANT et non levée. */
  active: boolean
}

export interface DisciplineSummary {
  /** profiles.noshow_count, tel quel. */
  noshowCount: number
  /** Dernière absence CONSTATÉE (booking 'no_show'), pas la dernière pénalité. */
  lastNoShowAt: string | null
  /** noshow_rules.reset_after_days de la salle (90 par défaut). */
  resetAfterDays: number
  /** Échéance de remise à zéro, ou null s'il n'y a rien d'honnête à annoncer. */
  resetAt: Date | null
}

const DEFAULT_RESET_AFTER_DAYS = 90

function personName(raw: unknown): string {
  const p = (Array.isArray(raw) ? raw[0] : raw) as { first_name?: string; last_name?: string } | null
  const name = `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.trim()
  return name || '—'
}

export function useMemberDiscipline(memberId: string | null) {
  const gymId = useAuthStore((s) => s.gym_id)
  const [penalties, setPenalties] = useState<PenaltyEntry[]>([])
  const [lifts, setLifts] = useState<PenaltyLift[]>([])
  const [summary, setSummary] = useState<DisciplineSummary | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!memberId || !gymId) return
    setLoading(true)
    try {
      const [penaltiesRes, liftsRes, rulesRes, profileRes, noShowsRes] = await Promise.all([
        // La réservation liée porte le STATUT qui distingue no-show et annulation
        // tardive (cf. resolvePenaltyOrigin), et le cours à afficher.
        supabase
          .from('penalties')
          .select('id, type, applied_at, expires_at, notes, booking_id, booking:bookings!penalties_booking_id_fkey(status, time_slots(starts_at, activities(name)))')
          .eq('member_id', memberId)
          .eq('gym_id', gymId)
          .order('applied_at', { ascending: false })
          .limit(50),
        // Levées accordées (GYM-204). L'auteur est embarqué via la FK admin_id.
        supabase
          .from('gym_admin_actions')
          .select('id, created_at, reason, metadata, admin:profiles!gym_admin_actions_admin_id_fkey(first_name, last_name)')
          .eq('target_id', memberId)
          .eq('gym_id', gymId)
          .eq('action_type', 'noshow_penalty_lift')
          .order('created_at', { ascending: false })
          .limit(50),
        supabase.from('noshow_rules').select('reset_after_days').eq('gym_id', gymId).maybeSingle(),
        supabase.from('profiles').select('noshow_count').eq('id', memberId).maybeSingle(),
        // Dernière absence CONSTATÉE : c'est sur elle que le cron de remise à zéro
        // compte (GYM-175), pas sur la dernière pénalité. Le tri se fait côté client,
        // PostgREST ne triant pas les lignes parentes sur une colonne embarquée.
        supabase
          .from('bookings')
          .select('id, time_slots(starts_at)')
          .eq('member_id', memberId)
          .eq('status', 'no_show')
          .limit(200),
      ])

      const liftLines: PenaltyLift[] = ((liftsRes.data ?? []) as Array<Record<string, unknown>>).map((l) => {
        const meta = (l.metadata ?? null) as { lifted_suspended_until?: string } | null
        return {
          id: l.id as string,
          createdAt: l.created_at as string,
          reason: (l.reason as string | null) ?? '',
          adminName: personName(l.admin),
          liftedSuspendedUntil: meta?.lifted_suspended_until ?? null,
        }
      })
      setLifts(liftLines)

      const now = Date.now()
      const penaltyLines: PenaltyEntry[] = ((penaltiesRes.data ?? []) as Array<Record<string, unknown>>).map((p) => {
        // Embeds to-one typés en tableau par le client — tolérer objet ou tableau.
        const bk = (Array.isArray(p.booking) ? p.booking[0] : p.booking) as
          { status?: string; time_slots?: unknown } | null
        const ts = (Array.isArray(bk?.time_slots) ? bk?.time_slots[0] : bk?.time_slots) as
          { activities?: unknown } | null
        const act = (Array.isArray(ts?.activities) ? ts?.activities[0] : ts?.activities) as
          { name?: string } | null

        const type = p.type as string
        const appliedAt = (p.applied_at as string | null) ?? null
        const expiresAt = (p.expires_at as string | null) ?? null
        const lift = findLiftForPenalty({ appliedAt, expiresAt }, liftLines)

        return {
          id: p.id as string,
          kind: resolvePenaltyKind(type),
          origin: resolvePenaltyOrigin(type, bk?.status ?? null),
          appliedAt,
          expiresAt,
          duration: penaltyDuration(appliedAt, expiresAt),
          notes: (p.notes as string | null) ?? '',
          activity: act?.name ?? null,
          lift,
          // Une suspension levée n'est PLUS active, même si expires_at est dans le futur :
          // la ligne penalties n'a pas bougé, c'est l'accès qui a été rendu.
          active: !!expiresAt && new Date(expiresAt).getTime() > now && lift === null,
        }
      })
      setPenalties(penaltyLines)

      const noShowDates = ((noShowsRes.data ?? []) as Array<Record<string, unknown>>)
        .map((b) => {
          const ts = (Array.isArray(b.time_slots) ? b.time_slots[0] : b.time_slots) as { starts_at?: string } | null
          return ts?.starts_at ?? null
        })
        .filter((d): d is string => !!d)
      const lastNoShowAt = noShowDates.length > 0
        ? noShowDates.reduce((a, b) => (new Date(a).getTime() >= new Date(b).getTime() ? a : b))
        : null

      const noshowCount = ((profileRes.data as { noshow_count?: number } | null)?.noshow_count) ?? 0
      const resetAfterDays = (rulesRes.data as { reset_after_days?: number } | null)?.reset_after_days
        ?? DEFAULT_RESET_AFTER_DAYS

      setSummary({
        noshowCount,
        lastNoShowAt,
        resetAfterDays,
        resetAt: noshowResetDate(lastNoShowAt, noshowCount, resetAfterDays),
      })
    } catch (e) {
      console.error('Failed to load member discipline', e)
    } finally {
      setLoading(false)
    }
  }, [memberId, gymId])

  useEffect(() => {
    if (memberId) load()
  }, [memberId, load])

  return { penalties, lifts, summary, loading, reload: load }
}
