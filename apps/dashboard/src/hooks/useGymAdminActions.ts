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

  /**
   * ⚠️ `actionType` EST CONTRAINT PAR UN CHECK EN BASE. Seules ces valeurs passent :
   *   booking_create, booking_cancel, booking_checkin, subscription_freeze,
   *   subscription_credit_add, subscription_cancel, subscription_extend,
   *   noshow_penalty_lift, session_gift, profile_update, password_reset,
   *   push_notification_send.
   *
   * Toute autre valeur fait ÉCHOUER l'insert. Et comme rien ici ne teste `error`, l'échec
   * est SILENCIEUX : le geste a bien eu lieu, le journal n'en garde rien, et personne ne
   * l'apprend. C'est le motif de défaut que GYM-204 puis GYM-219 ont déjà eu à corriger —
   * un échec non testé se lit comme un succès.
   */
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
    // ═════════════════════════════════════════════════════════════════════════════
    // 🔴 GYM-282 — LE DASHBOARD NE LIT PLUS `profiles.push_token`, ET N'APPELLE PLUS
    // LE TUYAU.
    // ═════════════════════════════════════════════════════════════════════════════
    // Avant : il lisait le jeton Expo du membre, puis le transmettait à
    // `send-notification` avec la clé anon. Deux problèmes, dont un seul saute aux yeux :
    //
    //   · le tuyau poussait un jeton FOURNI PAR LE CLIENT, donc n'importe quel jeton
    //     qu'un porteur de JWT pouvait connaître — c'est le défaut de GYM-282 ;
    //   · et le navigateur manipulait une donnée qu'il n'a aucune raison de connaître.
    //
    // Il envoie désormais un IDENTIFIANT DE MEMBRE, que le serveur peut VÉRIFIER — un
    // jeton, lui, ne se vérifie pas. `admin-send-push` contrôle que l'appelant est
    // gym_admin, que le membre appartient à SA salle, résout le jeton côté serveur, et
    // appelle le tuyau en SERVICE_ROLE avec le secret interne.
    //
    // ⚠️ `NO_PUSH_TOKEN` REMONTE MAINTENANT DU SERVEUR, avec le même code : le message
    // affiché au gérant ne change pas, seule la place de la décision change.
    const { data, error } = await invokeEdge<{ ok?: boolean; code?: string }>(
      'admin-send-push',
      { body: { member_id: memberId, title, body } },
    )
    if (error) return { ok: false, code: await extractErrorCode(error) }
    if (data && data.ok !== true) return { ok: false, code: data.code ?? 'PUSH_FAILED' }

    // Journalisé APRÈS le succès seulement : le journal ne doit pas affirmer un envoi
    // qui n'a pas eu lieu.
    //
    // 🔴 'push_sent' N'EXISTAIT PAS dans le CHECK (cf. logAction ci-dessus) : l'insert
    // était refusé à chaque envoi, sans un mot. Le journal comptait 0 ligne en production
    // depuis la mise en service — aucune notification n'y a JAMAIS laissé de trace. La
    // valeur prévue est 'push_notification_send'.
    await logAction('push_notification_send', memberId, { title })
    return { ok: true }
  }, [logAction])

  return { liftSuspension, sendPush, logAction }
}
