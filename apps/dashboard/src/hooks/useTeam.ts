// GYM-200 — Équipe de la salle (comptes ayant accès au dashboard).
//
// Tout passe par des Edge Functions, jamais par PostgREST :
//   - le statut « invitation en attente » se lit dans auth.users.last_sign_in_at, table non
//     exposée à PostgREST ;
//   - l'invitation scelle salle et rôle côté serveur ;
//   - le retrait d'accès écrit profiles.role, colonne retirée du GRANT UPDATE de
//     `authenticated` par GYM-203.
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { extractErrorCode, EdgeError } from '@/lib/edgeErrors'

export interface TeamMember {
  id: string
  email: string
  firstName: string
  lastName: string
  role: string
  /** true = invitation envoyée, jamais activée. null = statut indéterminable. */
  pending: boolean | null
  /** L'utilisateur courant : il ne peut pas retirer son propre accès. */
  isSelf: boolean
}

interface TeamMemberRow {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  role: string
  pending: boolean | null
  is_self: boolean
}

/** Résultat d'une action : `code` porte l'erreur métier de l'Edge Function. */
export interface ActionResult {
  ok: boolean
  code?: string
  /** Invitation partie ou non — l'échec d'envoi n'annule PAS la création du compte. */
  emailSent?: boolean
  /** L'invitation existait déjà et a été renvoyée. */
  resent?: boolean
}

export function useTeam() {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Ne repasse PAS isLoading à true : au premier appel il l'est déjà, et sur les
  // rechargements qui suivent une invitation ou un retrait, remettre la liste en état de
  // chargement la ferait clignoter alors qu'elle est déjà à l'écran.
  const fetchTeam = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke('team-access', {
        body: { action: 'list' },
      })
      if (error) throw new EdgeError(await extractErrorCode(error))
      const rows = (data?.members ?? []) as TeamMemberRow[]
      setMembers(rows.map((m) => ({
        id: m.id,
        email: m.email,
        firstName: m.first_name ?? '',
        lastName: m.last_name ?? '',
        role: m.role,
        pending: m.pending,
        isSelf: m.is_self,
      })))
    } catch (e) {
      console.error('[useTeam] list failed', e)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { void fetchTeam() }, [fetchTeam])

  const inviteMember = useCallback(async (input: {
    email: string
    role: string
    firstName?: string
    lastName?: string
  }): Promise<ActionResult> => {
    const { data, error } = await supabase.functions.invoke('invite-team-member', {
      body: {
        email: input.email.trim().toLowerCase(),
        role: input.role,
        ...(input.firstName?.trim() ? { first_name: input.firstName.trim() } : {}),
        ...(input.lastName?.trim() ? { last_name: input.lastName.trim() } : {}),
      },
    })
    if (error) return { ok: false, code: await extractErrorCode(error) }
    await fetchTeam()
    return { ok: true, emailSent: data?.email_sent === true, resent: data?.resent === true }
  }, [fetchTeam])

  // Renvoi d'une invitation en attente : même endpoint que l'invitation. Il reconnaît un
  // compte non encore activé dans la salle et régénère un lien au lieu d'échouer en 409.
  // Le rôle n'est pas modifié au passage — la fonction conserve celui du profil existant.
  const resendInvite = useCallback(async (member: TeamMember): Promise<ActionResult> => {
    return inviteMember({
      email: member.email,
      role: member.role,
      firstName: member.firstName,
      lastName: member.lastName,
    })
  }, [inviteMember])

  const revokeAccess = useCallback(async (memberId: string): Promise<ActionResult> => {
    const { error } = await supabase.functions.invoke('team-access', {
      body: { action: 'revoke', member_id: memberId },
    })
    if (error) return { ok: false, code: await extractErrorCode(error) }
    await fetchTeam()
    return { ok: true }
  }, [fetchTeam])

  // Sert à masquer le retrait sur le dernier gérant : la garde autoritative reste côté
  // serveur (LAST_ADMIN), celle-ci évite juste de proposer une action vouée à l'échec.
  const adminCount = members.filter((m) => m.role === 'gym_admin').length

  return { members, isLoading, adminCount, refresh: fetchTeam, inviteMember, resendInvite, revokeAccess }
}
