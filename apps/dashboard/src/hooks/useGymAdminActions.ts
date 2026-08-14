import { useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { extractErrorCode } from '@/lib/edgeErrors'
import { useAuthStore } from '@/stores/useAuthStore'
import type { Json } from '@/types/database'
import { invokeEdge } from '@/lib/edgeInvoke'

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
    const { data, error } = await invokeEdge('admin-lift-suspension', {
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

  /**
   * GYM-219 — 🔴 FAUX SUCCÈS CORRIGÉ. Cette fonction n'extrayait même pas `error` de
   * l'appel : l'envoi pouvait échouer, le journal enregistrait quand même 'push_sent' et
   * l'appelant affichait « notification envoyée ». Même silence que le défaut qui a
   * masqué GYM-204 pendant des mois.
   *
   * Le membre SANS push_token était le second silence : rien n'était envoyé, rien n'était
   * dit. Le gérant croyait avoir joint quelqu'un d'injoignable.
   *
   * Renvoie donc un résultat explicite que l'appelant DOIT lire.
   */
  const sendPush = useCallback(async (
    memberId: string,
    title: string,
    body: string,
  ): Promise<{ ok: boolean; code?: string }> => {
    const { data: profile } = await supabase
      .from('profiles')
      .select('push_token')
      .eq('id', memberId)
      .single()

    // Pas de jeton = application jamais installée ou notifications refusées. Ce n'est pas
    // une erreur serveur : c'est un code métier dédié, pour un message dédié.
    if (!profile?.push_token) return { ok: false, code: 'NO_PUSH_TOKEN' }

    const { error } = await invokeEdge('send-notification', {
      body: {
        tokens: [profile.push_token],
        title,
        body,
        data: { type: 'admin_message' },
      },
    })
    if (error) return { ok: false, code: await extractErrorCode(error) }

    // Journalisé APRÈS le succès seulement : le journal ne doit pas affirmer un envoi
    // qui n'a pas eu lieu.
    await logAction('push_sent', memberId, { title })
    return { ok: true }
  }, [logAction])

  return { liftSuspension, sendPush, logAction }
}
