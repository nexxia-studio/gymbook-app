import type { User } from '@supabase/supabase-js'
import * as Sentry from '@sentry/react-native'
import { supabase } from './supabase'
import { GYM_ID } from '../constants/dopamine'
import { LEGAL_VERSION } from '../constants/legal/meta'

export const ADMIN_ACCOUNT_ERROR = 'ADMIN_ACCOUNT'

// ── Résolution du nom depuis les metadata OAuth (Apple/Google) ──────────────
// Miroir de la logique COALESCE du trigger handle_new_user (GYM-150) :
//   first_name / given_name / 1er mot de full_name(|name)
//   last_name  / family_name / reste de full_name(|name)
function metaStr(user: User, key: string): string {
  const v = (user.user_metadata ?? {})[key]
  return typeof v === 'string' ? v.trim() : ''
}
function metaFirstName(user: User): string | null {
  const direct = metaStr(user, 'first_name') || metaStr(user, 'given_name')
  if (direct) return direct
  const full = metaStr(user, 'full_name') || metaStr(user, 'name')
  return full ? full.split(' ')[0] : null
}
function metaLastName(user: User): string | null {
  const direct = metaStr(user, 'last_name') || metaStr(user, 'family_name')
  if (direct) return direct
  const full = metaStr(user, 'full_name') || metaStr(user, 'name')
  if (!full) return null
  const parts = full.split(' ')
  return parts.length > 1 ? parts.slice(1).join(' ') : null
}

/**
 * GYM-154 — Heal du profil au login (défense en profondeur côté app).
 *
 * Bug prod (18-19/07) : une inscription via Sign in with Apple / Google crée un
 * utilisateur SANS user_metadata (le flux id_token ne les passe pas, contrairement au
 * signup email) → le trigger handle_new_user crée TOUJOURS le profil mais avec gym_id
 * NULL → l'app s'ouvre vide (RLS ne matche rien). L'app Dopamine est single-tenant :
 * le gym_id de la config runtime EST le bon.
 *
 * Ce heal, appelé quand le profil existe déjà :
 *   - pose gym_id = GYM_ID si absent (correctif du bug) ;
 *   - bonus : complète first_name/last_name depuis les metadata OAuth s'ils sont vides
 *     (le relais Apple/Google les expose de façon variable — tolérant à leur absence).
 * IDEMPOTENT (ne fait rien si tout est déjà posé), SILENCIEUX (pas d'UI), NON BLOQUANT
 * (échec → Sentry, l'app continue). RLS `id = auth.uid()` autorise ce self-update.
 *
 * NB : les noms Apple du 1er login (credential.fullName, hors user_metadata) restent
 * gérés par healAppleProfileName (oauth.ts, GYM-150) — source de données distincte,
 * complémentaire ; l'ordre est idempotent (le premier qui remplit gagne, l'autre no-op).
 */
export async function healProfile(
  user: User,
  profile: { gym_id: string | null; first_name: string | null; last_name: string | null },
): Promise<void> {
  try {
    const patch: { gym_id?: string; first_name?: string; last_name?: string } = {}

    if (!profile.gym_id) patch.gym_id = GYM_ID

    if (!profile.first_name || profile.first_name.trim() === '') {
      const given = metaFirstName(user)
      if (given) patch.first_name = given
    }
    if (!profile.last_name || profile.last_name.trim() === '') {
      const family = metaLastName(user)
      if (family) patch.last_name = family
    }

    // Idempotence : rien à corriger.
    if (Object.keys(patch).length === 0) return

    const { error } = await supabase.from('profiles').update(patch).eq('id', user.id)
    if (error) {
      console.error('[heal] profile heal failed (non-blocking)', error)
      Sentry.captureException(error, { tags: { area: 'gym154_profile_heal' } })
    }
  } catch (e) {
    // Le heal ne doit JAMAIS bloquer le login.
    console.error('[heal] profile heal threw (non-blocking)', e)
    try { Sentry.captureException(e, { tags: { area: 'gym154_profile_heal' } }) } catch { /* noop */ }
  }
}

export async function ensureProfile(user: User): Promise<void> {
  const { data: existing } = await supabase
    .from('profiles')
    .select('id, gym_id, first_name, last_name')
    .eq('id', user.id)
    .maybeSingle()

  // Cas normal : le profil existe (créé par le trigger handle_new_user) → on HEAL
  // (gym_id NULL du flux OAuth, + noms) au lieu de sortir sans rien faire.
  if (existing) {
    await healProfile(user, existing)
    return
  }

  // Chemin de secours uniquement — en pratique le profil est créé par le trigger DB
  // handle_new_user() qui pose désormais aussi les versions (GYM-109). Cet INSERT ne
  // s'exécute que si le trigger était absent.
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
    privacy_policy_version: LEGAL_VERSION,
    terms_accepted_at: new Date().toISOString(),
    terms_version: LEGAL_VERSION,
  })
}

/**
 * Verify the authenticated user is allowed on the member app, then ensure their profile
 * exists AND is healed. Throws ADMIN_ACCOUNT_ERROR if the user is a gym_admin / super_admin.
 */
export async function checkRoleAndEnsureProfile(user: User): Promise<void> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, gym_id, first_name, last_name')
    .eq('id', user.id)
    .maybeSingle()

  if (profile?.role === 'gym_admin' || profile?.role === 'super_admin') {
    await supabase.auth.signOut()
    throw new Error(ADMIN_ACCOUNT_ERROR)
  }

  if (!profile) {
    // Cas limite : trigger absent → insert de secours (comportement historique).
    await ensureProfile(user)
    return
  }

  // GYM-154 — le profil existe (trigger) : heal gym_id (+ noms) au lieu de l'ancienne
  // branche morte `if (!profile) ensureProfile()` qui n'était jamais atteinte.
  await healProfile(user, profile)
}
