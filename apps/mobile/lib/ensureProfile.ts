import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { GYM_ID } from '../constants/dopamine'

export const ADMIN_ACCOUNT_ERROR = 'ADMIN_ACCOUNT'

export async function ensureProfile(user: User): Promise<void> {
  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', user.id)
    .maybeSingle()

  if (existing) return

  const fullName = (user.user_metadata?.full_name as string) ?? ''
  const [firstName, ...lastNameParts] = fullName.split(' ')

  await supabase.from('profiles').insert({
    id: user.id,
    email: user.email,
    first_name: firstName || (user.user_metadata?.first_name as string) || '',
    last_name: lastNameParts.join(' ') || (user.user_metadata?.last_name as string) || '',
    role: 'member',
    gym_id: GYM_ID,
    preferred_language: 'fr',
    privacy_policy_accepted_at: new Date().toISOString(),
    terms_accepted_at: new Date().toISOString(),
  })
}

/**
 * Verify the authenticated user is allowed on the member app, then ensure their profile exists.
 * Throws ADMIN_ACCOUNT_ERROR if the user is a gym_admin / super_admin (member app blocks them).
 */
export async function checkRoleAndEnsureProfile(user: User): Promise<void> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .maybeSingle()

  if (profile?.role === 'gym_admin' || profile?.role === 'super_admin') {
    await supabase.auth.signOut()
    throw new Error(ADMIN_ACCOUNT_ERROR)
  }

  if (!profile) {
    await ensureProfile(user)
  }
}
