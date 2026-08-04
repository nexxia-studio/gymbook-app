// GYM-205 / GYM-207 / GYM-159 — Construction CENTRALISÉE des URL propres à la salle.
//
// Motif repris de GYM-194 / GYM-201 / GYM-205 : les URL d'une salle n'ont rien à faire
// dans le code. L'app connaît son gym (GYM_ID, alimenté par EXPO_PUBLIC_GYM_ID) et lit
// son slug dans nexxia_gyms — la même table, avec la même policy membre, que
// useLegalParams (« Members voient leur salle », SELECT gym_id = get_my_gym_id()).
//
// ⚠️ RÈGLE : ne JAMAIS remplacer une URL en dur par une autre URL en dur. Tout ce qui
// dépend de la salle passe par ce module. Seuls les DOMAINES produit (infra Nexxia,
// identiques pour toutes les salles) sont des constantes ici.
import { supabase } from './supabase'
import { GYM_ID, GYM_SLUG } from '../constants/dopamine'

/** Domaine des Universal Links membres (GYM-158). Infra produit, pas propre à une salle. */
const LINKS_BASE = 'https://links.viniz.app'

// Cache module : le slug ne change pas pendant la vie du process. Une seule lecture,
// partagée par tous les appelants (dédoublonnage via `inFlight`).
let cachedSlug: string | null = null
let inFlight: Promise<string> | null = null

/**
 * Slug de la salle courante, depuis nexxia_gyms.
 *
 * REPLI SÛR : toute défaillance (réseau, RLS, ligne absente, colonnes vides) retombe sur
 * GYM_SLUG, la constante de build. Une URL de repli plausible vaut mieux qu'une URL
 * malformée — on parle des chemins « mot de passe oublié » et « retour de paiement »,
 * où un échec laisse le membre bloqué dehors.
 *
 * `subdomain` sert de second choix : en base les deux valent 'dopamine', mais slug est
 * la colonne qui porte l'identité d'URL.
 */
export async function getGymSlug(): Promise<string> {
  if (cachedSlug) return cachedSlug
  if (inFlight) return inFlight

  inFlight = (async () => {
    let resolved = GYM_SLUG
    try {
      const { data, error } = await supabase
        .from('nexxia_gyms')
        .select('slug, subdomain')
        .eq('id', GYM_ID)
        .maybeSingle()
      if (!error && data) {
        const fromDb = (data.slug as string | null) || (data.subdomain as string | null)
        if (fromDb && fromDb.trim().length > 0) resolved = fromDb.trim()
      }
    } catch {
      /* repli GYM_SLUG */
    }
    cachedSlug = resolved
    inFlight = null
    return resolved
  })()

  return inFlight
}

/**
 * GYM-205 — Cible de réinitialisation de mot de passe MEMBRE.
 *
 * Doit être passée explicitement à resetPasswordForEmail : sans redirectTo, Supabase
 * applique son Site URL global (pointé sur le dashboard GÉRANT depuis le 29/07), et le
 * membre atterrit sur « Espace réservé aux gérants », définitivement bloqué hors de l'app.
 *
 * ⚠️ COCKPIT : cette URL doit figurer dans les Redirect URLs de Supabase Auth (prod ET
 * staging), sinon le lien est rejeté et le correctif reste inopérant.
 */
export async function buildMemberResetPasswordUrl(): Promise<string> {
  return `${LINKS_BASE}/${await getGymSlug()}/reset-password`
}

/**
 * GYM-207 — Retour de paiement Mollie.
 *
 * Universal Link et NON schéma custom : le checkout est ouvert dans un navigateur in-app
 * (WebBrowser / SFSafariViewController), qui BLOQUE les liens `dopamine://`. Un lien
 * https couvert par l'AASA (paths /{slug}/*) est lui honoré : iOS rouvre l'app
 * directement sur l'écran de vérification, avec le `?id=` ajouté par create-payment.
 * Android / desktop / app absente retombent sur la page statique apps/links.
 */
export async function buildPaymentReturnUrl(source: string): Promise<string> {
  return `${LINKS_BASE}/${await getGymSlug()}/payment-success?source=${encodeURIComponent(source)}`
}

/** Réinitialise le cache — tests uniquement. */
export function __resetGymUrlCache(): void {
  cachedSlug = null
  inFlight = null
}
