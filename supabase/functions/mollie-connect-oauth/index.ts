// Env vars requis (Supabase Dashboard → Edge Function Secrets) :
//   MOLLIE_CLIENT_ID, MOLLIE_CLIENT_SECRET, MOLLIE_REDIRECT_URI
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-action',
}

const MOLLIE_AUTHORIZE_URL = 'https://my.mollie.com/oauth2/authorize'
const MOLLIE_TOKEN_URL = 'https://api.mollie.com/oauth2/tokens'
// GYM-85 : /v2/profiles/me ne fonctionne PAS avec un token OAuth (org access token).
// La liste /v2/profiles, elle, est accessible en OAuth → on prend profiles[0].
const MOLLIE_PROFILES_URL = 'https://api.mollie.com/v2/profiles'
const MOLLIE_SCOPES = [
  'payments.read',
  'payments.write',
  'profiles.read',
  'subscriptions.read',
  'subscriptions.write',
  'customers.read',
  'customers.write',
  'organizations.read',
].join(' ')

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function errorResponse(status: number, message: string, code?: string) {
  return jsonResponse({ error: true, code: code ?? 'ERROR', message }, status)
}

interface MollieTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: string
  scope: string
}

interface MollieProfile {
  id: string
  name?: string
  mode?: 'test' | 'live'
}

interface MollieProfilesListResponse {
  count?: number
  _embedded?: { profiles?: MollieProfile[] }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  console.log('[mollie-connect-oauth] env check:', {
    hasClientId: !!Deno.env.get('MOLLIE_CLIENT_ID'),
    hasClientSecret: !!Deno.env.get('MOLLIE_CLIENT_SECRET'),
    hasRedirectUri: !!Deno.env.get('MOLLIE_REDIRECT_URI'),
    hasSupabaseUrl: !!Deno.env.get('SUPABASE_URL'),
    hasServiceKey: !!Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    hasAnonKey: !!Deno.env.get('SUPABASE_ANON_KEY'),
  })
  console.log('[mollie-connect-oauth] method:', req.method, 'x-action:', req.headers.get('x-action'))

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const clientId = Deno.env.get('MOLLIE_CLIENT_ID')
    const clientSecret = Deno.env.get('MOLLIE_CLIENT_SECRET')
    const redirectUri = Deno.env.get('MOLLIE_REDIRECT_URI')

    if (!clientId || !clientSecret || !redirectUri) {
      console.warn('[mollie-connect-oauth] CONFIG_MISSING — clientId:', !!clientId, 'clientSecret:', !!clientSecret, 'redirectUri:', !!redirectUri)
      return errorResponse(500, 'Configuration Mollie OAuth manquante côté serveur', 'CONFIG_MISSING')
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return errorResponse(401, 'Non authentifié', 'UNAUTHORIZED')

    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const supabaseAdmin = createClient(supabaseUrl, serviceKey)

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
    if (authError || !user) return errorResponse(401, 'Non authentifié', 'UNAUTHORIZED')

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, gym_id, role')
      .eq('id', user.id)
      .single()

    if (!profile) return errorResponse(404, 'Profil introuvable', 'PROFILE_NOT_FOUND')
    if (!profile.gym_id) return errorResponse(400, 'Profil sans gym rattaché', 'NO_GYM')

    const gymId = profile.gym_id as string
    const action = req.headers.get('x-action') ?? 'status'

    if (action === 'authorize') {
      const state = crypto.randomUUID()
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

      const { error: insertErr } = await supabaseAdmin
        .from('oauth_states')
        .insert({ state, gym_id: gymId, expires_at: expiresAt })

      if (insertErr) {
        return errorResponse(500, `Création state échouée: ${insertErr.message}`, 'STATE_INSERT_FAILED')
      }

      const url = new URL(MOLLIE_AUTHORIZE_URL)
      url.searchParams.set('client_id', clientId)
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('state', state)
      url.searchParams.set('scope', MOLLIE_SCOPES)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('approval_prompt', 'auto')

      return jsonResponse({ url: url.toString() })
    }

    if (action === 'status') {
      const { data: existing } = await supabaseAdmin
        .from('gym_mollie_connections')
        .select('id, mollie_account_name, mollie_profile_id, connected_at, status')
        .eq('gym_id', gymId)
        .maybeSingle()

      const isConnected = !!existing && existing.status !== 'revoked' && existing.status !== 'expired'
      const fullyConnected = isConnected && existing.mollie_profile_id != null

      return jsonResponse({
        connected: isConnected,
        fully_connected: fullyConnected,          // GYM-85 : true seulement si mollie_profile_id non null
        mollie_profile_id: existing?.mollie_profile_id ?? null,
        profile_name: existing?.mollie_account_name ?? null,
        connected_at: existing?.connected_at ?? null,
        is_test_mode: null,
        status: existing?.status ?? null,
      })
    }

    if (action === 'disconnect') {
      const { error: updateErr } = await supabaseAdmin
        .from('gym_mollie_connections')
        .update({ status: 'revoked' })
        .eq('gym_id', gymId)

      if (updateErr) return errorResponse(500, updateErr.message, 'DISCONNECT_FAILED')
      return jsonResponse({ success: true })
    }

    if (action === 'callback') {
      let body: { code?: string, state?: string } = {}
      try {
        body = await req.json()
      } catch {
        return errorResponse(400, 'Body JSON invalide', 'INVALID_BODY')
      }
      const { code, state } = body
      if (!code || !state) return errorResponse(400, 'code et state requis', 'MISSING_CODE_STATE')

      const { data: stateRow, error: stateErr } = await supabaseAdmin
        .from('oauth_states')
        .select('id, state, gym_id, expires_at')
        .eq('state', state)
        .maybeSingle()

      if (stateErr || !stateRow) {
        return errorResponse(400, 'State invalide ou expiré (CSRF protection)', 'INVALID_STATE')
      }
      if (stateRow.gym_id !== gymId) {
        return errorResponse(403, 'State ne correspond pas au gym courant', 'STATE_MISMATCH')
      }
      if (new Date(stateRow.expires_at) < new Date()) {
        await supabaseAdmin.from('oauth_states').delete().eq('id', stateRow.id)
        return errorResponse(400, 'State expiré, refaire le flow', 'STATE_EXPIRED')
      }

      await supabaseAdmin.from('oauth_states').delete().eq('id', stateRow.id)

      const basicAuth = btoa(`${clientId}:${clientSecret}`)
      const tokenBody = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      })

      const tokenRes = await fetch(MOLLIE_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: tokenBody.toString(),
      })

      if (!tokenRes.ok) {
        const detail = await tokenRes.text()
        return errorResponse(502, `Mollie token exchange échoué: ${detail}`, 'TOKEN_EXCHANGE_FAILED')
      }

      const tokenData = await tokenRes.json() as MollieTokenResponse
      const accessToken = tokenData.access_token
      const refreshToken = tokenData.refresh_token ?? null
      const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString()

      const profilesRes = await fetch(MOLLIE_PROFILES_URL, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      })

      // On lit le corps brut une seule fois pour pouvoir le logger en cas d'échec.
      const profilesRaw = await profilesRes.text()
      let mollieProfile: MollieProfile | null = null
      if (profilesRes.ok) {
        try {
          const parsed = JSON.parse(profilesRaw) as MollieProfilesListResponse
          mollieProfile = parsed?._embedded?.profiles?.[0] ?? null
        } catch (_) {
          mollieProfile = null
        }
      }

      const mollieProfileId = mollieProfile?.id ?? null
      const mollieAccountName = mollieProfile?.name ?? null

      // GYM-85 : ne plus avaler l'échec. Si /v2/profiles échoue (non-2xx) OU
      // renvoie 0 profil, on LOG la réponse réelle (statut + corps) et on
      // abort proprement — surtout PAS de status='active' avec profile_id null,
      // ce qui entretenait la boucle de reconnexion côté front.
      if (!mollieProfileId) {
        console.error('[mollie-connect-oauth] callback PROFILE_FETCH_FAILED', {
          gymId,
          status: profilesRes.status,
          ok: profilesRes.ok,
          body: profilesRaw.slice(0, 2000),
        })
        return errorResponse(
          502,
          `Profil Mollie introuvable (HTTP ${profilesRes.status}). Connexion non finalisée, réessayez.`,
          'PROFILE_FETCH_FAILED',
        )
      }

      const { data: existing } = await supabaseAdmin
        .from('gym_mollie_connections')
        .select('id, access_token_vault_id, refresh_token_vault_id')
        .eq('gym_id', gymId)
        .maybeSingle()

      if (existing && existing.access_token_vault_id) {
        const { error: updAccessErr } = await supabaseAdmin.rpc('update_mollie_vault_token', {
          p_vault_id: existing.access_token_vault_id,
          p_new_secret: accessToken,
        })
        if (updAccessErr) return errorResponse(500, `Update access_token vault: ${updAccessErr.message}`, 'VAULT_UPDATE_FAILED')

        if (existing.refresh_token_vault_id && refreshToken) {
          const { error: updRefreshErr } = await supabaseAdmin.rpc('update_mollie_vault_token', {
            p_vault_id: existing.refresh_token_vault_id,
            p_new_secret: refreshToken,
          })
          if (updRefreshErr) return errorResponse(500, `Update refresh_token vault: ${updRefreshErr.message}`, 'VAULT_UPDATE_FAILED')
        }

        await supabaseAdmin
          .from('gym_mollie_connections')
          .update({
            expires_at: expiresAt,
            last_refreshed_at: new Date().toISOString(),
            status: 'active',
            mollie_profile_id: mollieProfileId,
            mollie_account_name: mollieAccountName,
          })
          .eq('gym_id', gymId)
      } else {
        const { data: vaultRows, error: vaultErr } = await supabaseAdmin
          .rpc('create_mollie_vault_tokens', {
            p_gym_id: gymId,
            p_access_token: accessToken,
            p_refresh_token: refreshToken,
          })
        if (vaultErr) return errorResponse(500, `Create vault tokens: ${vaultErr.message}`, 'VAULT_CREATE_FAILED')

        const vaultIds = Array.isArray(vaultRows) ? vaultRows[0] : vaultRows
        const accessVaultId = vaultIds?.access_vault_id ?? null
        const refreshVaultId = vaultIds?.refresh_vault_id ?? null

        if (existing) {
          await supabaseAdmin
            .from('gym_mollie_connections')
            .update({
              access_token_vault_id: accessVaultId,
              refresh_token_vault_id: refreshVaultId,
              expires_at: expiresAt,
              status: 'active',
              connected_at: new Date().toISOString(),
              last_refreshed_at: new Date().toISOString(),
              mollie_profile_id: mollieProfileId,
              mollie_account_name: mollieAccountName,
            })
            .eq('gym_id', gymId)
        } else {
          await supabaseAdmin
            .from('gym_mollie_connections')
            .insert({
              gym_id: gymId,
              access_token_vault_id: accessVaultId,
              refresh_token_vault_id: refreshVaultId,
              expires_at: expiresAt,
              status: 'active',
              connected_at: new Date().toISOString(),
              mollie_profile_id: mollieProfileId,
              mollie_account_name: mollieAccountName,
            })
        }
      }

      return jsonResponse({
        success: true,
        profile: mollieAccountName ?? mollieProfileId ?? 'Compte Mollie',
      })
    }

    return errorResponse(400, `Action inconnue: ${action}`, 'UNKNOWN_ACTION')
  } catch (err) {
    const e = err as Error
    console.error('[mollie-connect-oauth] uncaught error:', e?.message, '\nstack:', e?.stack)
    return errorResponse(500, e?.message ?? 'Erreur interne', 'INTERNAL')
  }
})
