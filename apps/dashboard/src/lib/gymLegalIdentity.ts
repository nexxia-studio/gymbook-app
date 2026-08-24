// GYM-265 — L'IDENTITÉ LÉGALE DE LA SALLE, RÉSOLUE SUR UNE PAGE PUBLIQUE.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// LE PROBLÈME QUE CE MODULE RÉSOUT
// ─────────────────────────────────────────────────────────────────────────────────────
// Les CGV sont le contrat entre LE MEMBRE et SA SALLE — pas avec Viniz. Le vendeur, son
// numéro d'entreprise, son siège : tout cela change d'une salle à l'autre. Jusqu'ici
// /legal/terms affichait « Dopamine Performance Club, Neupré » en dur, ce qui sera
// juridiquement FAUX pour la deuxième salle et déjà géographiquement faux pour la
// première (elle est à Ougrée depuis GYM-180).
//
// ⚠️ CETTE PAGE EST PUBLIQUE — RENDUE SANS SESSION. C'est une contrainte, pas un détail :
// Apple vérifie les URLs légales hors connexion, et un membre doit pouvoir relire ses CGV
// avant de créer un compte. Il n'y a donc AUCUN contexte de salle disponible : ni JWT, ni
// gym_id, ni store. La salle doit être désignée par l'URL, et lue sans authentification.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// 🔴 CE QUI BLOQUE LA LECTURE AUJOURD'HUI — À LIRE AVANT DE DÉBUGGER
// ─────────────────────────────────────────────────────────────────────────────────────
// `nexxia_gyms` a RLS activé et TROIS policies SELECT : gym_admin de la salle, membre de
// la salle, super_admin. AUCUNE pour `anon`. Un visiteur non connecté ne peut donc rien
// lire — vérifié sur la base staging le 24/08/2026 (pg_policy).
//
// Ouvrir une policy SELECT à `anon` sur la table serait la mauvaise réponse : le GRANT
// SELECT d'`anon` porte sur les 47 colonnes, dont `commission_cb_rate_override`,
// `mollie_profile_id`, `plan`, `status` et `trial_ends_at`. On exposerait la grille
// commerciale de chaque salle au premier venu pour afficher une adresse de siège.
//
// La réponse est une fonction SECURITY DEFINER étroite qui ne rend QUE l'identité légale
// — celle qui figure déjà sur les factures que la salle envoie à ses membres, donc rien
// de confidentiel. Elle est livrée en migration NON DÉPLOYÉE :
//   supabase/migrations/20260824140000_gym265_public_gym_legal_identity.sql
//
// ⚠️ TANT QU'ELLE N'EST PAS DÉPLOYÉE, `fetchGymLegalIdentity` rend `null` et la page
// affiche sa version générique. C'est un repli VOULU, pas une panne : la machinerie est
// complète, la page ne casse jamais, et le jour du déploiement les CGV se remplissent
// sans toucher une ligne de front.
import { supabase } from '@/lib/supabase'

/** Champs d'identité légale lus pour une salle. Tous facultatifs : une salle neuve n'a rien saisi. */
export interface GymLegalIdentity {
  slug: string
  /** Nom affiché de la salle (colonne `name`, NOT NULL en base). */
  name: string
  commercialName: string | null
  legalName: string | null
  legalForm: string | null
  /** Numéro d'entreprise / TVA. Voir la note BCE ≠ TVA dans la PR. */
  vatNumber: string | null
  legalAddress: string | null
  legalPostalCode: string | null
  legalCity: string | null
  address: string | null
  postalCode: string | null
  city: string | null
  email: string | null
  phone: string | null
}

/**
 * D'OÙ VIENT LE SLUG — deux sources, dans cet ordre.
 *
 * 1. `?gym=<slug>` — ce que portent DÈS MAINTENANT les liens de l'app et des emails.
 * 2. Le SOUS-DOMAINE (`dopamine.viniz.app`) — GYM-201. Il n'est pas encore en service ;
 *    accepter les deux dès aujourd'hui évite d'avoir à revenir dans ce fichier, et surtout
 *    évite que les liens déjà envoyés cessent de fonctionner le jour de la bascule.
 *
 * ⚠️ LES SOUS-DOMAINES D'INFRASTRUCTURE SONT EXCLUS. `www`, `app`, `dashboard` et les
 * hôtes de prévisualisation Vercel ne sont pas des salles : sans cette liste, une visite
 * sur `app.viniz.app/legal/terms` chercherait une salle nommée « app », ne la trouverait
 * pas, et afficherait la page générique — le bon résultat par accident, mais après une
 * requête inutile et un faux négatif impossible à diagnostiquer.
 */
const RESERVED_HOSTS = ['www', 'app', 'dashboard', 'admin', 'api', 'staging', 'localhost']

/** Un slug de salle : minuscules, chiffres et tirets (cf. gym_slugify, GYM-248). */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function resolveGymSlug(search: string, hostname: string): string | null {
  const fromQuery = new URLSearchParams(search).get('gym')?.trim().toLowerCase()
  if (fromQuery && SLUG_RE.test(fromQuery)) return fromQuery

  // Sous-domaine : au moins trois segments (`salle.viniz.app`), le premier étant le slug.
  const parts = hostname.toLowerCase().split('.')
  if (parts.length < 3) return null
  const candidate = parts[0]
  if (RESERVED_HOSTS.includes(candidate) || !SLUG_RE.test(candidate)) return null
  return candidate
}

/**
 * Lit l'identité légale d'une salle. NE LÈVE JAMAIS.
 *
 * Toute erreur — RPC absente (migration non déployée), réseau, slug inconnu — rend `null`,
 * et l'appelant affiche la page générique. Un document légal ne doit jamais se solder par
 * un écran blanc : sans salle, la page explique où trouver les CGV de la sienne.
 */
export async function fetchGymLegalIdentity(slug: string): Promise<GymLegalIdentity | null> {
  try {
    // ⚠️ APPEL NON TYPÉ, VOLONTAIREMENT. `types/database.ts` est GÉNÉRÉ depuis le schéma
    // déployé : la fonction n'y figure pas encore, puisque sa migration n'est pas appliquée.
    // Sans cette échappatoire, le simple fait de livrer la machinerie casserait le build.
    // 👉 APRÈS DÉPLOIEMENT : régénérer les types, puis remplacer ce cast par un appel
    //    `supabase.rpc('public_gym_legal_identity', …)` direct — le typage reviendra seul.
    const rpc = supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: unknown }>

    const { data, error } = await rpc('public_gym_legal_identity', { p_slug: slug })
    if (error || !data) return null

    // La fonction rend un SETOF : supabase-js donne un tableau (vide si slug inconnu).
    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined
    if (!row || typeof row.name !== 'string') return null

    const str = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)
    return {
      slug,
      name: row.name,
      commercialName: str(row.commercial_name),
      legalName: str(row.legal_name),
      legalForm: str(row.legal_form),
      vatNumber: str(row.vat_number),
      legalAddress: str(row.legal_address),
      legalPostalCode: str(row.legal_postal_code),
      legalCity: str(row.legal_city),
      address: str(row.address),
      postalCode: str(row.postal_code),
      city: str(row.city),
      email: str(row.email),
      phone: str(row.phone),
    }
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────
// CHAMPS MANQUANTS : VISIBLES, JAMAIS VIDES
// ─────────────────────────────────────────────────────────────────────────────────────
/**
 * Marqueur d'un champ que la salle n'a pas encore renseigné.
 *
 * ⚠️ ON N'EFFACE PAS LA PHRASE, ON MONTRE LE TROU. Une clause dont le vendeur disparaît
 * se lit comme un texte complet et faux ; « [à compléter par la salle] » se lit comme ce
 * que c'est — un document inachevé, que le membre ET le gérant repèrent immédiatement.
 * C'est le pendant exact du bandeau d'incitation affiché au gérant dans /settings.
 */
export function toComplete(lang: 'fr' | 'en'): string {
  return lang === 'en' ? '[to be completed by the gym]' : '[à compléter par la salle]'
}

/** Valeur, ou marqueur visible si elle manque. */
export function orToComplete(value: string | null | undefined, lang: 'fr' | 'en'): string {
  return value && value.trim() !== '' ? value.trim() : toComplete(lang)
}

/**
 * Adresse composée « rue, code postal commune ».
 *
 * Le marqueur porte sur l'ADRESSE ENTIÈRE dès qu'une de ses trois parties manque : une
 * rue sans commune n'est pas une adresse à moitié valable, c'est une adresse invalide.
 */
export function composeAddress(
  street: string | null,
  postalCode: string | null,
  city: string | null,
  lang: 'fr' | 'en',
): string {
  if (!street || !postalCode || !city) return toComplete(lang)
  return `${street}, ${postalCode} ${city}`
}

/** Nom du vendeur tel qu'il doit apparaître au contrat : enseigne, à défaut raison sociale. */
export function sellerName(gym: GymLegalIdentity | null, lang: 'fr' | 'en'): string {
  if (!gym) return toComplete(lang)
  return gym.commercialName ?? gym.legalName ?? gym.name
}

/**
 * Champs indispensables à des CGV valables. Sert aux DEUX bouts de la chaîne : le gabarit
 * public y lit ce qu'il doit marquer, et /settings y lit s'il doit afficher le bandeau.
 * Une seule liste — deux listes auraient divergé au premier ajout.
 */
export const REQUIRED_LEGAL_FIELDS = [
  'legalName',
  'vatNumber',
  'legalAddress',
  'legalPostalCode',
  'legalCity',
  'email',
] as const

export function missingLegalFields(gym: Partial<Record<
  (typeof REQUIRED_LEGAL_FIELDS)[number], string | null | undefined
>>): string[] {
  return REQUIRED_LEGAL_FIELDS.filter((f) => {
    const v = gym[f]
    return !v || v.trim() === ''
  })
}
