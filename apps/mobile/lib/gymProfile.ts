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
import { getActiveGymId } from './activeGym'

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
  /**
   * GYM-242 — jours de planning que le membre peut voir, à partir d'aujourd'hui.
   *
   * Remplace le `+ 14` écrit en dur dans useSchedule. Réglé par le gérant dans /settings.
   * NOT NULL en base : jamais absent d'une ligne lue — mais si la LIGNE est illisible,
   * c'est `DEFAULT_HORIZON_DAYS` qui s'applique (cf. `getBookingHorizonDays`).
   */
  bookingHorizonDays: number
}

/**
 * ⚠️ REPLI QUAND LA SALLE EST ILLISIBLE — et il ne doit JAMAIS valoir 0.
 *
 * Ces écrans se chargent parfois avant que la session soit établie, ou hors ligne : la
 * policy membre (« Members voient leur salle ») ne renvoie alors aucune ligne. Un repli à
 * 0 — ou une absence de repli — donnerait un planning VIDE, c'est-à-dire une app qui a
 * l'air cassée. 30 est la valeur par défaut en base : le repli et le défaut disent la même
 * chose, ce qui évite qu'ils divergent.
 */
export const DEFAULT_HORIZON_DAYS = 30

// ── LE CACHE, INDEXÉ PAR SALLE (GYM-292) ─────────────────────────────────────────────
// 🔴 IL NE L'ÉTAIT PAS, ET L'AFFIRMATION QUI LE JUSTIFIAIT EST DEVENUE FAUSSE. Le
// commentaire d'origine disait « l'identité de la salle ne change pas pendant la vie du
// process » : c'était vrai quand une app servait une salle. En white-label, la salle
// active change EN COURS DE SESSION — par le switch GYM-288, et depuis GYM-292 par la
// réconciliation à l'ouverture de session.
//
// Un cache sans clé rendait donc le nom, l'adresse ET l'horizon de réservation de la
// salle QUITTÉE. `switchGym` le vidait explicitement, ce qui masquait le défaut sur ce
// chemin-là — mais tout autre changement de salle le laissait mentir. Et l'adresse est
// exactement la donnée où mentir coûte le plus cher : elle envoie le membre devant une
// porte.
//
// ⚠️ `inFlight` EST INDEXÉ AUSSI. Sans cela, deux salles demandées coup sur coup
// partageraient la même promesse et la seconde recevrait la réponse de la première.
const cached = new Map<string, GymProfile>()
const inFlight = new Map<string, Promise<GymProfile | null>>()

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
  // ⚠️ LA SALLE EST LUE AVANT LE CACHE, et pas l'inverse : c'est elle qui désigne l'entrée.
  const gymId = getActiveGymId()
  if (!gymId) return null

  const dejaLu = cached.get(gymId)
  if (dejaLu) return dejaLu
  const enCours = inFlight.get(gymId)
  if (enCours) return enCours

  const promesse = (async () => {
    try {
      const { data, error } = await supabase
        .from('nexxia_gyms')
        // ⚠️ Aucune colonne legal_* ici — voir l'en-tête du module.
        .select('name, address, postal_code, city, email, slug, subdomain, booking_horizon_days')
        .eq('id', gymId)
        .maybeSingle()

      if (error || !data) return null

      const profil: GymProfile = {
        name: nullIfBlank(data.name as string | null),
        address: nullIfBlank(data.address as string | null),
        postalCode: nullIfBlank(data.postal_code as string | null),
        city: nullIfBlank(data.city as string | null),
        email: nullIfBlank(data.email as string | null),
        slug: nullIfBlank(data.slug as string | null),
        subdomain: nullIfBlank(data.subdomain as string | null),
        // ⚠️ Suivi jusqu'à l'OBJET RENDU, pas seulement jusqu'au SELECT : c'est au mapping
        // que GYM-228 avait perdu `requires_coach`, pourtant bien demandée dans la requête.
        bookingHorizonDays: sanitizeHorizon(data.booking_horizon_days),
      }
      cached.set(gymId, profil)
      return profil
    } catch {
      return null
    } finally {
      inFlight.delete(gymId)
    }
  })()

  inFlight.set(gymId, promesse)
  return promesse
}

/**
 * GYM-242 — horizon lu en base, ramené à une valeur utilisable.
 *
 * Le CHECK en base borne déjà 1..366, mais cette lecture ne peut pas en dépendre : un
 * client déployé avant la migration lirait `undefined`, et une ligne écrite hors chemin
 * normal pourrait porter autre chose. Une valeur non entière ou hors bornes retombe sur le
 * défaut plutôt que de produire une date de fin absurde.
 */
function sanitizeHorizon(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(n) || n < 1 || n > 366) return DEFAULT_HORIZON_DAYS
  return n
}

/**
 * Horizon de la salle, avec repli. C'EST LE SEUL POINT D'ENTRÉE des hooks de planning.
 *
 * Jamais `null` : un appelant qui doit calculer une date de fin ne peut rien faire d'une
 * absence, et le forcer à choisir son propre repli ferait diverger les deux écrans.
 */
export async function getBookingHorizonDays(): Promise<number> {
  const profile = await getGymProfile()
  return profile?.bookingHorizonDays ?? DEFAULT_HORIZON_DAYS
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
  cached.clear()
  inFlight.clear()
}
