// GYM-102 (3/5) — LIVRABLE A : CHARGER LA MARQUE DE LA SALLE.
//
// `public_gym_branding(p_slug)` est la SEULE source : slug, name, logo_url, primary_color,
// secondary_color. Elle est publique (anon) par construction — c'est ce qui permet
// d'habiller l'app AVANT la connexion, tout l'intérêt du lot.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '../supabase'

export interface GymBrand {
  slug: string
  name: string
  /**
   * 🔴 GYM-299 — LE NOM COURT, ET POURQUOI IL VOYAGE AVEC LA MARQUE.
   *
   * `null` = le gérant n'en a pas choisi ; l'app affiche alors le nom complet. Ce n'est
   * PAS une chaîne vide : la distinction est posée en base depuis GYM-285 et elle porte
   * une décision — « pas de nom court » n'est pas « nom court vide ».
   *
   * ⚠️ IL EST ICI, ET PAS DANS `useGymProfile`, PARCE QUE C'EST LE CANAL QUI SE PROPAGE.
   * `public_gym_branding` est relue par le fournisseur de thème à chaque changement de
   * salle, et c'est ce chemin qui fait apparaître instantanément un changement de couleurs
   * fait au dashboard. Le nom court est de la même nature — une décision d'identité prise
   * par le gérant — et il doit apparaître par le même chemin, sinon l'app afficherait de
   * nouvelles couleurs sous un ancien nom.
   */
  shortName: string | null
  logoUrl: string | null
  primaryColor: string | null
  secondaryColor: string | null
}

/**
 * Cache local de la marque.
 *
 * ⚠️ CE N'EST PAS UNE OPTIMISATION, C'EST CE QUI ÉVITE UN CLIGNOTEMENT DE MARQUE. Sans
 * lui, chaque lancement afficherait le thème Viniz par défaut le temps d'un aller-retour
 * réseau, puis basculerait sur les couleurs de la salle : le membre verrait son app
 * changer de couleur sous ses yeux, à chaque ouverture.
 */
const CACHE_KEY = 'viniz.gym_brand'

/** Ce que rend le chargement — l'appelant doit pouvoir distinguer les trois cas. */
export type BrandLoad =
  | { status: 'ok'; brand: GymBrand; fromCache: boolean }
  /** Slug inconnu en base : la salle a été supprimée, ou le slug local est périmé. */
  | { status: 'unknown' }
  /** Réseau ou serveur : on ne sait pas, et on ne prétend pas savoir. */
  | { status: 'error' }

export async function readCachedBrand(slug: string): Promise<GymBrand | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY)
    if (!raw) return null
    // ⚠️ UN CACHE ÉCRIT AVANT GYM-299 N'A PAS DE `shortName`. `JSON.parse` rendrait
    // `undefined`, que le code aval lit comme « absent » — donc nom complet, le bon repli.
    // On le NORMALISE quand même à `null` pour que le type ne mente pas sur le contenu.
    const brut = JSON.parse(raw) as GymBrand
    const b: GymBrand = { ...brut, shortName: brut.shortName ?? null }
    // ⚠️ ON VÉRIFIE LE SLUG. Sans ce test, changer de salle afficherait la marque de la
    // précédente jusqu'au retour du réseau — la confusion exacte que le cache doit éviter.
    return b && b.slug === slug ? b : null
  } catch {
    return null
  }
}

async function writeCachedBrand(brand: GymBrand): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(brand))
  } catch {
    /* best-effort : le prochain lancement repassera par le réseau, sans plus */
  }
}

export async function clearCachedBrand(): Promise<void> {
  try {
    await AsyncStorage.removeItem(CACHE_KEY)
  } catch {
    /* best-effort */
  }
}

/**
 * Charge la marque d'une salle depuis `public_gym_branding`.
 *
 * Le résultat est mis en cache pour le lancement suivant. Le cache n'est PAS consulté ici :
 * l'appelant l'a déjà lu pour afficher quelque chose immédiatement, et cette fonction est
 * la rafraîchissante.
 */
export async function fetchBrand(slug: string): Promise<BrandLoad> {
  try {
    // ⚠️ LE CAST PORTE SUR LE CLIENT, PAS SUR LA MÉTHODE — leçon du correctif GYM-265 :
    // détacher `supabase.rpc` de son receveur fait lever l'appel, et le `catch` ci-dessous
    // ferait alors passer une erreur de code pour une panne réseau.
    const { data, error } = await (supabase as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message?: string } | null }>
    }).rpc('public_gym_branding', { p_slug: slug })

    if (error) return { status: 'error' }

    const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined
    if (!row) return { status: 'unknown' }

    const brand: GymBrand = {
      slug: String(row.slug ?? slug),
      name: String(row.name ?? ''),
      // ⚠️ `?? null` ET PAS `String(...)` : `String(null)` rendrait la chaîne « null »,
      // qui s'afficherait telle quelle en en-tête. Le repli doit rester la valeur nulle.
      shortName: (row.short_name as string | null) ?? null,
      logoUrl: (row.logo_url as string | null) ?? null,
      primaryColor: (row.primary_color as string | null) ?? null,
      secondaryColor: (row.secondary_color as string | null) ?? null,
    }
    await writeCachedBrand(brand)
    return { status: 'ok', brand, fromCache: false }
  } catch {
    return { status: 'error' }
  }
}
