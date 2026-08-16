import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/useAuthStore'
import { computeMemberPlan, type MemberPlan } from '@/lib/subscription'

export interface Member {
  id: string
  firstName: string
  lastName: string
  email: string
  phone: string | null
  role: string
  noshowCount: number
  suspendedUntil: string | null
  memberSince: string | null
  lastSeenAt: string | null
  pushToken: string | null
  avatarUrl: string | null
  preferredLanguage: string | null
  /** GYM-224 — code du badge d'accès physique. NULL = pas encore de badge attribué. */
  accessBadgeCode: string | null
  /**
   * GYM-147 — ce que le membre POSSÈDE (abonnement / crédits / rien), et l'échéance quand
   * il y en a une.
   *
   * ⚠️ Distinct de son droit d'accès, porté par `suspendedUntil` : un membre suspendu peut
   * très bien être abonné. Les deux colonnes de /members répondent à deux questions —
   * « qu'a-t-il acheté ? » et « peut-il réserver ? » — et une seule perdrait l'autre.
   */
  plan: MemberPlan
}

/**
 * GYM-147 — filtres de la liste.
 *
 * ⚠️ 'active' A DISPARU, et c'est le cœur du lot. L'ancien couple Actif/Inactif ne lisait
 * que `suspended_until` : un membre dont l'abonnement avait expiré s'affichait « Actif ».
 * Le filtre disait donc « non suspendu », pas « en règle ». Les trois filtres qui le
 * remplacent isolent chacun une population sur laquelle le gérant peut AGIR.
 */
export type MemberStatusFilter = 'all' | 'no_plan' | 'expiring' | 'suspended'

export function useMembers() {
  const [members, setMembers] = useState<Member[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<MemberStatusFilter>('all')
  const gymId = useAuthStore((s) => s.gym_id)

  const fetchMembers = useCallback(async () => {
    if (!gymId) return
    setIsLoading(true)
    try {
      // GYM-147 — TROIS requêtes, en parallèle, quel que soit le nombre de membres.
      //
      // ⚠️ PAS UNE REQUÊTE PAR LIGNE. La tentation serait d'appeler useMemberDetail (qui
      // charge abonnement + crédits d'UN membre) pour chaque ligne : sur 200 membres, ce
      // serait 400 requêtes au montage de l'écran. Les deux tables sont lues EN BLOC,
      // bornées à la salle — la policy RLS « gym_id = get_my_gym_id() AND is_gym_admin() »
      // les couvre déjà toutes les deux — puis rapprochées en mémoire.
      const [profilesRes, subsRes, creditsRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, first_name, last_name, email, phone, role, noshow_count, suspended_until, member_since, last_seen_at, push_token, avatar_url, preferred_language, created_at, access_badge_code')
          .eq('gym_id', gymId)
          .eq('role', 'member')
          .is('deleted_at', null)
          .order('created_at', { ascending: false }),
        // Tous les abonnements de la salle. Le tri décroissant permet de ne retenir que le
        // PLUS RÉCENT par membre (premier vu = bon), sans DISTINCT ON côté PostgREST.
        // ⚠️ Aucun filtre de statut ici : c'est isSubscriptionActive (lib/subscription.ts)
        // qui tranche, pour que la règle reste à UN seul endroit.
        supabase
          .from('member_subscriptions')
          .select('member_id, status, ends_at, created_at')
          .eq('gym_id', gymId)
          .order('created_at', { ascending: false }),
        // Solde de séances. `credits_remaining` est une colonne GÉNÉRÉE (total − used).
        supabase
          .from('member_credits')
          .select('member_id, credits_remaining')
          .eq('gym_id', gymId)
          .gt('credits_remaining', 0),
      ])

      const { data, error } = profilesRes
      if (error) throw error

      // Abonnement le plus récent par membre.
      const latestSub = new Map<string, { status: string | null; endsAt: string | null }>()
      for (const s of (subsRes.data ?? []) as Array<Record<string, unknown>>) {
        const mid = s.member_id as string
        if (latestSub.has(mid)) continue // déjà le plus récent (tri décroissant)
        latestSub.set(mid, { status: (s.status as string) ?? null, endsAt: (s.ends_at as string) ?? null })
      }

      // Solde cumulé par membre. Un membre peut porter plusieurs lignes de crédits
      // (achats successifs, ajustements GYM-182) : c'est bien la SOMME qui compte.
      const creditsByMember = new Map<string, number>()
      for (const c of (creditsRes.data ?? []) as Array<Record<string, unknown>>) {
        const mid = c.member_id as string
        creditsByMember.set(mid, (creditsByMember.get(mid) ?? 0) + ((c.credits_remaining as number) ?? 0))
      }

      setMembers((data ?? []).map((r) => ({
        id: r.id,
        firstName: r.first_name ?? '',
        lastName: r.last_name ?? '',
        email: r.email,
        phone: r.phone,
        accessBadgeCode: r.access_badge_code,
        role: r.role,
        noshowCount: r.noshow_count ?? 0,
        suspendedUntil: r.suspended_until,
        memberSince: r.member_since ?? r.created_at,
        lastSeenAt: r.last_seen_at,
        pushToken: r.push_token,
        avatarUrl: r.avatar_url,
        preferredLanguage: r.preferred_language,
        plan: computeMemberPlan(latestSub.get(r.id) ?? null, creditsByMember.get(r.id) ?? 0),
      })))
    } catch (e) {
      console.error('Failed to fetch members', e)
    } finally {
      setIsLoading(false)
    }
  }, [gymId])

  useEffect(() => { fetchMembers() }, [fetchMembers])

  // Realtime
  useEffect(() => {
    if (!gymId) return
    const channel = supabase
      .channel(`members-${gymId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles', filter: `gym_id=eq.${gymId}` }, () => fetchMembers())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [gymId, fetchMembers])

  const filteredMembers = members.filter((m) => {
    if (search) {
      const q = search.toLowerCase()
      // GYM-224 — le CODE DE BADGE est cherchable. Cas d'usage direct au comptoir :
      // « quelqu'un vient de badger, qui est-ce ? » — le gérant tape le numéro lu sur le
      // lecteur et tombe sur la fiche. Le filtre est CLIENT, sur des lignes déjà chargées :
      // l'ajout ne touche pas la requête et ne coûte rien.
      const haystack = `${m.firstName} ${m.lastName} ${m.email} ${m.accessBadgeCode ?? ''}`
      if (!haystack.toLowerCase().includes(q)) return false
    }
    // GYM-147 — chaque filtre isole une population SUR LAQUELLE AGIR. C'est tout l'objet du
    // lot : sans eux, il faut lire quarante lignes pour trouver les six qui décrochent.
    if (statusFilter === 'suspended') {
      return isSuspendedNow(m)
    }
    if (statusFilter === 'no_plan') {
      // Ni abonnement ouvrant, ni séance restante. La population de relance nº 1.
      return m.plan.kind === 'none'
    }
    if (statusFilter === 'expiring') {
      // Encore abonné, mais plus pour longtemps : le seul moment où relancer sert encore.
      return m.plan.expiringSoon
    }
    return true
  })

  // Membres possédant quelque chose (abonnement ou séances). Remplace l'ancien
  // `activeCount`, qui comptait les NON-SUSPENDUS et annonçait donc « actifs » des gens
  // dont l'abonnement avait expiré depuis des mois — le défaut même que GYM-147 corrige.
  const withPlanCount = members.filter((m) => m.plan.kind !== 'none').length
  const noPlanCount = members.length - withPlanCount
  const expiringCount = members.filter((m) => m.plan.expiringSoon).length
  const suspendedCount = members.filter(isSuspendedNow).length

  return {
    members: filteredMembers,
    totalCount: members.length,
    withPlanCount,
    noPlanCount,
    expiringCount,
    suspendedCount,
    isLoading,
    search, setSearch,
    statusFilter, setStatusFilter,
    refetch: fetchMembers,
  }
}

/** Suspension EN COURS : une échéance passée n'est plus une sanction, c'est un reliquat.
 *  Même lecture que create-booking et admin-lift-suspension. */
function isSuspendedNow(m: Member): boolean {
  return !!m.suspendedUntil && new Date(m.suspendedUntil) > new Date()
}
