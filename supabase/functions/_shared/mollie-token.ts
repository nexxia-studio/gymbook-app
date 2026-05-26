import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const MOLLIE_TOKEN_URL = 'https://api.mollie.com/oauth2/tokens'
const REFRESH_MARGIN_MS = 5 * 60 * 1000

export async function getValidMollieToken(
  supabase: SupabaseClient,
  gymId: string,
): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_gym_mollie_tokens', { p_gym_id: gymId })
  if (error || !data || data.length === 0) return null

  const conn = data[0]
  if (conn.status !== 'active') return null

  const expiresAt = new Date(conn.expires_at).getTime()
  const now = Date.now()

  if (expiresAt - now > REFRESH_MARGIN_MS) {
    return conn.access_token
  }

  console.log('[mollie-token] token expiring soon for gym:', gymId, '— refreshing')

  const clientId = Deno.env.get('MOLLIE_CLIENT_ID')!
  const clientSecret = Deno.env.get('MOLLIE_CLIENT_SECRET')!
  const basicAuth = btoa(`${clientId}:${clientSecret}`)

  const refreshRes = await fetch(MOLLIE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: conn.refresh_token,
    }).toString(),
  })

  if (!refreshRes.ok) {
    const detail = await refreshRes.text()
    console.error('[mollie-token] refresh failed for gym:', gymId, '—', detail)
    await supabase
      .from('gym_mollie_connections')
      .update({ status: 'refresh_failed' })
      .eq('gym_id', gymId)
    return null
  }

  const tokenData = await refreshRes.json() as {
    access_token: string
    refresh_token?: string
    expires_in: number
  }

  const newExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString()

  const { data: connRow } = await supabase
    .from('gym_mollie_connections')
    .select('access_token_vault_id, refresh_token_vault_id')
    .eq('gym_id', gymId)
    .single()

  if (connRow?.access_token_vault_id) {
    await supabase.rpc('update_mollie_vault_token', {
      p_vault_id: connRow.access_token_vault_id,
      p_new_secret: tokenData.access_token,
    })
  }

  if (connRow?.refresh_token_vault_id && tokenData.refresh_token) {
    await supabase.rpc('update_mollie_vault_token', {
      p_vault_id: connRow.refresh_token_vault_id,
      p_new_secret: tokenData.refresh_token,
    })
  }

  await supabase
    .from('gym_mollie_connections')
    .update({
      expires_at: newExpiresAt,
      last_refreshed_at: new Date().toISOString(),
      status: 'active',
    })
    .eq('gym_id', gymId)

  console.log('[mollie-token] token refreshed for gym:', gymId)
  return tokenData.access_token
}
