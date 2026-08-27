// GYM-102 (3/5) — LE THÈME, DISPONIBLE PARTOUT, SANS RIEN CHANGER POUR DOPAMINE.
//
// ═════════════════════════════════════════════════════════════════════════════════════
// 🔴 EN MODE `single`, CE MODULE NE FAIT AUCUN APPEL RÉSEAU ET NE LIT AUCUN CACHE.
// ═════════════════════════════════════════════════════════════════════════════════════
// `DOPAMINE_THEME` est une constante ; le hook la rend telle quelle, au premier rendu,
// sans état intermédiaire. Le chemin de Dopamine est donc STRICTEMENT le même
// qu'aujourd'hui : pas d'attente, pas de bascule de couleur, pas de requête.
//
// ⚠️ ET SES VALEURS SONT UNE COPIE DE tailwind.config.js, PAS SA SOURCE. Les 441 classes
// `bg-move-*` de l'app existante sont résolues À LA COMPILATION par NativeWind : elles ne
// peuvent pas lire ce contexte. Faire de ce module la source unique imposerait de
// réécrire ces 441 classes — c'est-à-dire de toucher chaque pixel de l'app de production,
// exactement ce que le cadrage interdit. La copie est le prix de cette garantie ; elle est
// figée (Dopamine ne change pas de charte) et signalée des deux côtés.
//
// ⚠️ GYM-286 EST PRÉCISÉMENT LE CHANTIER QUI RÉÉCRIT CES CLASSES, et il ne renverse pas
// pour autant le sens de la copie. Tant qu'UNE seule classe `move-*` subsiste, elle et ce
// module doivent dire la même chose : c'est `tailwind.config.js` qui reste la source, et
// `scripts/verify-theme-parity.mjs` qui refuse de laisser les deux diverger.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { GYM_MODE, FIXED_GYM_ID } from '../gymResolver'
import { resolveTheme, VINIZ_THEME, type ThemeTokens } from './resolveTheme'
import { readCachedBrand, fetchBrand, type GymBrand } from './brand'

/** Les couleurs actuelles de Dopamine, recopiées de tailwind.config.js. NE PAS MODIFIER. */
export const DOPAMINE_THEME: ThemeTokens = {
  mode: 'dark',
  background: '#111111',   // move-dark
  surface: '#FFFFFF',      // move-card
  onBackground: '#FFFFFF',
  onBackgroundMuted: '#9A9890', // move-text-muted
  accent: '#C8F000',       // move-accent  ⚠️ le lime DOPAMINE, pas le lime Viniz
  onAccent: '#111111',
  border: '#E8E6E0',       // move-border
  // ── GYM-286a — les quatre rôles ajoutés, eux aussi RECOPIÉS de tailwind.config.js.
  // 🔴 CES QUATRE VALEURS SONT LA CONDITION DE LA NON-RÉGRESSION. Un écran migré ne
  // rendra à l'identique que si le jeton résolu vaut EXACTEMENT la classe `move-*`
  // qu'il remplace. `scripts/verify-theme-parity.mjs` le vérifie mécaniquement contre
  // tailwind.config.js — c'est ce script, et non la relecture, qui tient la garantie.
  page: '#F5F4F0',              // move-bg
  onSurface: '#111111',         // move-dark, dans son emploi de TEXTE (≠ onAccent)
  onSurfaceSecondary: '#6B6861', // move-text-secondary
  accentDim: '#9DB800',         // move-accent-dim
  limeAllowed: true,
}

export interface BrandState {
  tokens: ThemeTokens
  /** La salle chargée, quand il y en a une. `null` en mode single et avant résolution. */
  brand: GymBrand | null
  /** `true` tant qu'on n'a pas tranché — jamais vrai en mode single. */
  isLoading: boolean
}

const DEFAULT_STATE: BrandState = {
  tokens: GYM_MODE === 'single' ? DOPAMINE_THEME : VINIZ_THEME,
  brand: null,
  isLoading: false,
}

const ThemeContext = createContext<BrandState>(DEFAULT_STATE)

export function useTheme(): BrandState {
  return useContext(ThemeContext)
}

/**
 * Fournit le thème à l'arbre.
 *
 * ⚠️ EN MODE `single` IL NE MONTE AUCUN EFFET : le `useEffect` sort à la première ligne,
 * l'état reste la constante `DEFAULT_STATE`, et le contexte rend exactement le même objet
 * à chaque rendu (`useMemo` sur des valeurs stables). Rien ne re-rend, rien n'attend.
 */
export function BrandThemeProvider({ slug, children }: { slug: string | null; children: ReactNode }) {
  const [brand, setBrand] = useState<GymBrand | null>(null)
  const [isLoading, setIsLoading] = useState(GYM_MODE === 'multi' && slug !== null)

  useEffect(() => {
    if (GYM_MODE === 'single') return
    if (!slug) { setBrand(null); setIsLoading(false); return }

    let alive = true
    setIsLoading(true)

    // 1. Le cache d'abord : la marque s'affiche IMMÉDIATEMENT au second lancement.
    readCachedBrand(slug).then((cached) => {
      if (!alive || !cached) return
      setBrand(cached)
      setIsLoading(false)
    })

    // 2. Puis le réseau, qui corrige si la salle a changé de logo ou de couleurs.
    fetchBrand(slug).then((res) => {
      if (!alive) return
      // ⚠️ UN ÉCHEC NE VIDE PAS CE QUI EST AFFICHÉ. Hors ligne, la marque du cache reste :
      // repasser au thème Viniz par défaut ferait clignoter l'app à chaque coupure, et
      // afficherait une marque qui n'est pas la sienne au membre — le pire des deux.
      if (res.status === 'ok') setBrand(res.brand)
      setIsLoading(false)
    })

    return () => { alive = false }
  }, [slug])

  const value = useMemo<BrandState>(() => {
    if (GYM_MODE === 'single') return DEFAULT_STATE

    // ═════════════════════════════════════════════════════════════════════════════════
    // 🔴 GYM-300 (3b) — C'EST ICI QUE L'ANCIENNE SALLE ÉTAIT MÉMORISÉE
    // ═════════════════════════════════════════════════════════════════════════════════
    // La ligne d'en dessous disait déjà « JAMAIS les couleurs d'une autre salle » — et
    // c'est pourtant exactement ce qui se produisait. `brand` est un état de composant :
    // il n'est PAS remis à zéro quand `slug` change. Il survivait donc à la bascule, et
    // la salle suivante s'affichait aux couleurs de la précédente.
    //
    // Le motif observé en recette : « Ce n'est pas ma salle » → nouvelle sélection → la
    // tab bar garde les couleurs d'avant. La tab bar n'y était pour rien ; elle lit
    // `useTheme()` à chaque rendu, fidèlement. C'est ce que le fournisseur lui donnait
    // qui était périmé.
    //
    // ⚠️ ET CE N'ÉTAIT PAS TRANSITOIRE. On aurait pu croire à une fenêtre de chargement
    // d'un aller-retour — non : `fetchBrand` ne pose `setBrand` que sur `status === 'ok'`
    // (garde volontaire, pour ne pas faire clignoter l'app à chaque coupure). Salle
    // inconnue, réseau coupé, serveur en erreur : rien ne remplaçait l'ancienne marque,
    // et elle restait affichée INDÉFINIMENT — sous le nom d'une autre salle.
    //
    // Le correctif ne retire pas cette garde, qui reste juste pour un rafraîchissement à
    // slug CONSTANT. Il rend simplement la marque solidaire de son slug : une marque ne
    // vaut que pour la salle dont elle vient, et `GymBrand` porte déjà ce slug — c'est le
    // même test que `readCachedBrand` applique au cache depuis GYM-288, appliqué cette
    // fois à l'état en mémoire, qui en avait tout autant besoin.
    if (!brand || brand.slug !== slug) return { tokens: VINIZ_THEME, brand: null, isLoading }
    const { tokens } = resolveTheme(brand.primaryColor, brand.secondaryColor)
    return { tokens, brand, isLoading }
  }, [brand, isLoading, slug])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

/** Rappel utile aux écrans : en single, la salle est celle du build, sans slug. */
export const SINGLE_MODE_GYM_ID = FIXED_GYM_ID
