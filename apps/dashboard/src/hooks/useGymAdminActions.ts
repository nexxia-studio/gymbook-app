import { useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/useAuthStore'
import type { Json } from '@/types/database'

/** GYM-204 — Résultat explicite : l'appelant DOIT distinguer succès et échec. */
export interface LiftSuspensionResult {
  ok: boolean
  /** Code métier renvoyé par l'Edge Function (NOT_SUSPENDED, WRONG_GYM, …). */
  code?: string
}

export function useGymAdminActions() {
  const gymId = useAuthStore((s) => s.gym_id)
  const userId = useAuthStore((s) => s.user?.id)

  const logAction = useCallback(async (
    actionType: string,
    targetId: string,
    metadata?: Json,
  ) => {
    if (!gymId || !userId) return
    await supabase.from('gym_admin_actions').insert({
      gym_id: gymId,
      admin_id: userId,
      target_id: targetId,
      action_type: actionType,
      metadata: metadata ?? null,
    })
  }, [gymId, userId])

  /**
   * GYM-204 — Levée d'une suspension no-show.
   *
   * L'écriture directe sur profiles est REMPLACÉE par l'Edge Function
   * admin-lift-suspension (service_role). L'ancienne version écrivait
   * `{ suspended_until: null, noshow_count: 0 }` sur le profil d'un autre utilisateur
   * depuis le client : la policy « Modifier son propre profil » ne matchait aucune ligne,
   * PostgREST renvoyait 0 ligne SANS erreur, et rien ici ne testait `error` → faux succès
   * pendant des mois.
   *
   * 🔴 Cette fonction ne LANCE PAS et ne renvoie PAS void : elle retourne un résultat
   * explicite que l'appelant DOIT lire. C'est le silence qui a masqué le défaut.
   *
   * Le journal (gym_admin_actions) et la notification du membre sont désormais faits
   * côté serveur — ne pas les rejouer ici, ce serait un doublon.
   */
  const liftSuspension = useCallback(async (
    memberId: string,
    reason: string,
  ): Promise<LiftSuspensionResult> => {
    const { data, error } = await supabase.functions.invoke('admin-lift-suspension', {
      body: { member_id: memberId, reason },
    })

    if (error) {
      // Le corps JSON de l'Edge Function vit dans error.context — c'est lui qui porte le
      // `code` métier (NOT_SUSPENDED, WRONG_GYM, REASON_REQUIRED…).
      const ctx = (error as { context?: Response }).context
      if (ctx && typeof ctx.json === 'function') {
        try {
          const body = await ctx.json()
          return { ok: false, code: (body?.code as string | undefined) ?? undefined }
        } catch { /* corps non-JSON */ }
      }
      return { ok: false }
    }

    if ((data as { success?: boolean } | null)?.success !== true) {
      return { ok: false, code: (data as { code?: string } | null)?.code }
    }

    return { ok: true }
  }, [])

  const sendPush = useCallback(async (memberId: string, title: string, body: string) => {
    const { data: profile } = await supabase
      .from('profiles')
      .select('push_token')
      .eq('id', memberId)
      .single()

    if (profile?.push_token) {
      await supabase.functions.invoke('send-notification', {
        body: {
          tokens: [profile.push_token],
          title,
          body,
          data: { type: 'admin_message' },
        },
      })
      await logAction('push_sent', memberId, { title })
    }
  }, [logAction])

  return { liftSuspension, sendPush, logAction }
}
