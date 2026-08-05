// GYM-216 — Lecture CENTRALISÉE des données d'identité de la salle (nexxia_gyms).
//
// Même motif que GYM-194 / GYM-201 / GYM-205 : ce que le gérant saisit dans le cockpit
// doit être ce que le membre voit dans l'app. L'adresse, le nom et l'email de contact
// d'une salle n'ont rien à faire dans le binaire — au white-label, une deuxième salle
// afficherait sinon les coordonnées de Dopamine.
//
// Ce module est LE lecteur de nexxia_gyms côté app : lib/gymUrls.ts (slug) s'appuie
// dessus, il n'y a donc qu'une seule requête et un seul cache pour toute la table.
//
// ⚠️⚠️ INTERDICTION ABSOLUE (GYM-180) : les colonnes legal_name / legal_address /
// legal_postal_code / legal_city sont le SIÈGE SOCIAL, réservé aux FACTURES. Elles ne
// doivent JAMAIS être sélectionnées ici ni affichées à un membre. En prod au 04/08 le
// siège vaut « Route du Condroz 95 A, 4121 Neupré » alors que la salle est « Avenue du
// Centenaire 313, 4102 Ougrée » : les confondre renverrait le membre à la mauvaise porte.
import { supabase } from './supabase'
import { GYM_ID } from '../constants/dopamine'

/** Identité de la salle telle qu'on peut la MONTRER à un membre. */
export interface GymProfile {
  /** Dénomination commerciale (nexxia_gyms.name). */
  name: string | null
  /** Adresse d'EXPLOITATION — celle où le membre se rend. Jamais le siège social. */
  address: string | null
  postalCode: string | null
  city: string | null
  /** Email de contact de la salle (nexxia_gyms.email). */
  email: string | null
  /** Identité d'URL — consommée par lib/gymUrls.ts. */
  slug: string | null
  subdomain: string | null
}

// Cache module : l'identité de la salle ne change pas pendant la vie du process.
// Une seule lecture, partagée par tous les appelants (dédoublonnage via `inFlight`).
let cached: GymProfile | null = null
let inFlight: Promise<GymProfile | null> | null = null

/**
 * Profil de la salle courante, ou `null` si indisponible.
 *
 * REPLI HONNÊTE : toute défaillance (réseau, RLS, ligne absente) renvoie `null`, et
 * l'appelant MASQUE le bloc concerné. On n'invente jamais une adresse de repli — une
 * adresse fausse envoie physiquement le membre au mauvais endroit, un bloc absent non.
 *
 * ⚠️ Un échec n'est PAS mis en cache : l'écran d'accueil et « mot de passe oublié » sont
 * consultés DÉCONNECTÉ, où la policy membre (« Members voient leur salle », SELECT
 * gym_id = get_my_gym_id()) ne matche rien. Mémoriser ce vide masquerait l'adresse pour
 * tout le reste de la session, une fois le membre pourtant connecté.
 */
export async function getGymProfile(): Promise<GymProfile | null> {
  if (cached) return cached
  if (inFlight) return inFlight

  inFlight = (async () => {
    try {
      const { data, error } = await supabase
        .from('nexxia_gyms')
        // ⚠️ Aucune colonne legal_* ici — voir l'en-tête du module.
        .select('name, address, postal_code, city, email, slug, subdomain')
        .eq('id', GYM_ID)
        .maybeSingle()

      if (error || !data) return null

      cached = {
        name: nullIfBlank(data.name as string | null),
        address: nullIfBlank(data.address as string | null),
        postalCode: nullIfBlank(data.postal_code as string | null),
        city: nullIfBlank(data.city as string | null),
        email: nullIfBlank(data.email as string | null),
        slug: nullIfBlank(data.slug as string | null),
        subdomain: nullIfBlank(data.subdomain as string | null),
      }
      return cached
    } catch {
      return null
    } finally {
      inFlight = null
    }
  })()

  return inFlight
}

/** Une colonne renseignée avec des espaces vaut une colonne vide. */
function nullIfBlank(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Adresse postale sur une ligne : « Avenue du Centenaire 313, 4102 Ougrée ».
 *
 * Renvoie `null` dès que la rue manque : un code postal seul n'est pas une adresse, et
 * mieux vaut masquer le bloc Localisation que d'afficher « 4102 Ougrée » tout court.
 */
export function formatGymAddress(profile: GymProfile | null): string | null {
  if (!profile?.address) return null
  const locality = [profile.postalCode, profile.city].filter(Boolean).join(' ')
  return locality ? `${profile.address}, ${locality}` : profile.address
}

/** Réinitialise le cache — tests uniquement. */
export function __resetGymProfileCache(): void {
  cached = null
  inFlight = null
}
