// GYM-102 (2/5) — appel de la recherche publique de salles.
//
// `search_gyms` est l'une des trois fonctions PUBLIQUES du socle (lot 1) : elle rend
// UNIQUEMENT slug, name, city et logo_url. Ce module ne fait que l'appeler et traduire
// ses refus en quelque chose qu'un écran sait afficher.
import { supabase } from './supabase'

/** Une salle telle que la recherche publique la rend. Jamais plus que ces quatre champs. */
export interface GymSearchResult {
  slug: string
  name: string
  /** Peut être NULL en base : une salle n'est pas obligée d'avoir renseigné sa commune. */
  city: string | null
  logo_url: string | null
}

/**
 * Longueur minimale, IDENTIQUE à celle du serveur.
 *
 * ⚠️ CE N'EST PAS UNE VALIDATION, C'EST UNE ÉCONOMIE. Le serveur rend déjà vide en
 * dessous de 3 caractères ; le tester ici évite un aller-retour qui, lui, CONSOMME UNE
 * UNITÉ DU RATE LIMIT (30 / 15 min). Sans ce filtre, taper « dopamine » lettre à lettre
 * brûlerait huit unités pour deux résultats utiles.
 */
export const MIN_QUERY_LENGTH = 3

/** Anti-rebond. 300 ms : au-dessus la frappe paraît lente, en dessous on gâche du quota. */
export const SEARCH_DEBOUNCE_MS = 300

export type GymSearchOutcome =
  | { status: 'ok'; results: GymSearchResult[] }
  /** Moins de 3 caractères — invite à préciser, JAMAIS une erreur. */
  | { status: 'too_short' }
  /** PT429 renvoyé par le serveur : trop de recherches depuis cette IP. */
  | { status: 'rate_limited' }
  /** Pas de réseau — message du helper edgeInvoke (GYM-276). */
  | { status: 'offline' }
  | { status: 'error' }

/** Code SQLSTATE levé par `search_gyms` quand le quota d'IP est atteint (lot 1). */
const RATE_LIMIT_CODE = 'PT429'

export async function searchGyms(query: string): Promise<GymSearchOutcome> {
  const q = query.trim()
  if (q.length < MIN_QUERY_LENGTH) return { status: 'too_short' }

  try {
    // ⚠️ LE CAST PORTE SUR LE CLIENT, PAS SUR LA MÉTHODE — leçon du correctif GYM-265 :
    // `const rpc = supabase.rpc as …` DÉTACHE la méthode de son receveur (`rpc` est une
    // méthode de prototype dont le corps fait `this.rest`), l'appel lève, et un catch
    // avale l'erreur en la faisant passer pour un résultat vide. Caster le client garde
    // l'appel sous forme de méthode : le receveur reste lié par construction.
    //
    // Cast nécessaire tant que `types/database.ts` n'a pas été régénéré après le
    // déploiement du socle : la fonction n'y figure pas encore.
    const { data, error } = await (supabase as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>
    }).rpc('search_gyms', { p_query: q })

    if (error) {
      if (error.code === RATE_LIMIT_CODE) return { status: 'rate_limited' }
      // Pas de réponse du tout = réseau. Même lecture que lib/edgeInvoke (GYM-276) :
      // une coupure n'est pas un défaut de l'app, et l'écran doit le dire au membre.
      const msg = (error.message ?? '').toLowerCase()
      if (msg.includes('network') || msg.includes('fetch')) return { status: 'offline' }
      return { status: 'error' }
    }

    const rows = Array.isArray(data) ? (data as GymSearchResult[]) : []
    return { status: 'ok', results: rows }
  } catch {
    // `rpc` ne lève pas en temps normal (il rend `{data, error}`) : arriver ici, c'est
    // que le fetch lui-même a échoué.
    return { status: 'offline' }
  }
}
