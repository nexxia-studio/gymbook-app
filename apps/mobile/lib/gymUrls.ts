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
// GYM-216 — la lecture de nexxia_gyms est passée dans lib/gymProfile (cache partagé) :
// l'adresse et le slug proviennent désormais de la MÊME requête, pas de deux.
import { getGymProfile, __resetGymProfileCache } from './gymProfile'
import { GYM_SLUG } from '../constants/dopamine'

/** Domaine des Universal Links membres (GYM-158). Infra produit, pas propre à une salle. */
const LINKS_BASE = 'https://links.viniz.app'

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
 *
 * ⚠️ Le repli n'est plus mémorisé (GYM-216) : ces URL se construisent DÉCONNECTÉ, où la
 * policy membre ne renvoie aucune ligne. Figer GYM_SLUG au premier échec condamnait la
 * session entière à la constante de build, même une fois le membre connecté.
 */
export async function getGymSlug(): Promise<string> {
  const profile = await getGymProfile()
  return profile?.slug ?? profile?.subdomain ?? GYM_SLUG
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

/** Réinitialise le cache — tests uniquement. Délègue au cache partagé (GYM-216). */
export function __resetGymUrlCache(): void {
  __resetGymProfileCache()
}
