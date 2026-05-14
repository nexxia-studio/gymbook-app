import { useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/useAuthStore'
import type { Json } from '@/types/database'

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

  const liftSuspension = useCallback(async (memberId: string, reason: string) => {
    await supabase
      .from('profiles')
      .update({ suspended_until: null, noshow_count: 0 })
      .eq('id', memberId)

    await logAction('noshow_penalty_lift', memberId, { reason })

    // Notify member
    const { data: profile } = await supabase
      .from('profiles')
      .select('push_token')
      .eq('id', memberId)
      .single()

    if (profile?.push_token) {
      await supabase.functions.invoke('send-notification', {
        body: {
          tokens: [profile.push_token],
          title: 'Suspension levee',
          body: 'Votre suspension a ete levee par le gerant.',
          data: { type: 'suspension_lifted' },
        },
      })
    }
  }, [logAction])

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
