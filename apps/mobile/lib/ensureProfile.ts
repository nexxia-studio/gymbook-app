import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'

const DOPAMINE_GYM_ID = 'a0000000-0000-0000-0000-000000000001'

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
    gym_id: DOPAMINE_GYM_ID,
    preferred_language: 'fr',
    privacy_policy_accepted_at: new Date().toISOString(),
    terms_accepted_at: new Date().toISOString(),
  })
}
