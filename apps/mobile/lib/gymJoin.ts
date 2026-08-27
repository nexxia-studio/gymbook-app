// GYM-293 — L'APPEL À `join_gym_self_serve`, ET LA TRADUCTION DE SES REFUS.
//
// ⚠️ MÊME FORME QUE `gymSwitch.ts`, DÉLIBÉRÉMENT. Les deux parlent au serveur d'une salle et
// rendent une issue à jeu FERMÉ, jamais une erreur brute : c'est ce qui permet à l'appelant
// de décider sans lire un message, et à l'écran d'afficher un texte traduit plutôt qu'un
// libellé Postgres. Le cast porte sur le CLIENT et non sur la méthode — leçon de GYM-265.
import { supabase } from './supabase'

export type JoinOutcome =
  | { status: 'ok'; gymId: string; name: string; isActive: boolean }
  /** Refus MÉTIER du serveur : le `code` vient de son HINT, jamais d'une supposition. */
  | { status: 'refused'; code: string }
  /** Réseau ou serveur indisponible — rien n'a été décidé, une reprise a du sens. */
  | { status: 'offline'; code: string }

type RpcClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{
    data: unknown
    error: { code?: string; message?: string; hint?: string } | null
  }>
}

/** Les refus MÉTIER, par leur SQLSTATE — voir la migration 20260830100000. */
const REFUS: Record<string, string> = {
  PT401: 'GYM_UNAUTHENTICATED',
  PT403: 'GYM_EMAIL_NOT_CONFIRMED',
  PT404: 'GYM_NOT_FOUND',
  PT409: 'GYM_FULL',
  PT429: 'GYM_RATE_LIMITED',
  PT503: 'PLAN_RESOLUTION_FAILED',
}

function isNetwork(error: { message?: string } | null): boolean {
  const m = (error?.message ?? '').toLowerCase()
  return m.includes('network') || m.includes('fetch')
}

/**
 * Rattache le membre connecté à la salle `slug`.
 *
 * ⚠️ UN REFUS N'EST PAS UNE PANNE, et l'appelant doit pouvoir les distinguer : une salle
 * pleine se dit au membre, une coupure réseau se réessaie. Les confondre afficherait
 * « salle complète » à quelqu'un qui a juste perdu le réseau.
 */
export async function joinGym(slug: string): Promise<JoinOutcome> {
  try {
    const { data, error } = await (supabase as unknown as RpcClient)
      .rpc('join_gym_self_serve', { p_slug: slug })

    if (error) {
      const connu = error.code ? REFUS[error.code] : undefined
      if (connu) return { status: 'refused', code: connu }
      return { status: 'offline', code: isNetwork(error) ? 'OFFLINE' : 'JOIN_ERROR' }
    }

    const row = data as { gym_id?: string; name?: string; is_active?: boolean } | null
    // Une réponse sans identifiant est une réponse qu'on ne comprend pas : on ne l'invente
    // pas en succès. Le membre reverra l'écran d'erreur plutôt qu'une app vide.
    if (!row?.gym_id) return { status: 'offline', code: 'JOIN_ERROR' }
    return {
      status: 'ok',
      gymId: row.gym_id,
      name: String(row.name ?? ''),
      isActive: row.is_active === true,
    }
  } catch {
    return { status: 'offline', code: 'OFFLINE' }
  }
}
