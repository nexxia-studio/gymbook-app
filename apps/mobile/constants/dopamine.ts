import Constants from 'expo-constants'

export const COLORS = {
  background: '#F5F4F0',
  card: '#FFFFFF',
  dark: '#111111',
  accent: '#C8F000',
  accentDim: '#9DB800',
  textSecondary: '#6B6861',
  textMuted: '#9A9890',
  border: '#E8E6E0',
} as const

// Single source of truth for the active gym id. Reads the Expo config
// (extra.gymId, fed by EXPO_PUBLIC_GYM_ID in app.config.ts); falls back to the
// Dopamine gym so default behavior is unchanged when no env var is set.
export const GYM_ID: string =
  (Constants.expoConfig?.extra?.gymId as string | undefined) ?? 'a0000000-0000-0000-0000-000000000001'

// GYM-216 — GYM_NAME et WEBSITE retirés : constantes MORTES (aucun import) qui figeaient
// le nom et le site d'une salle dans le binaire. Le nom se lit dans nexxia_gyms via
// lib/gymProfile ; les laisser exportées, c'était garder le piège à portée de main.
//
// GYM_SLUG reste : c'est le REPLI de build de lib/gymUrls quand nexxia_gyms est
// illisible (écrans consultés déconnecté), pas une donnée d'affichage.
//
// GYM-258 — variabilisé, avec REPLI SUR LA VALEUR ACTUELLE : sans EXPO_PUBLIC_GYM_SLUG,
// la valeur reste 'dopamine' et le comportement de l'app de production est inchangé.
//
// ⚠️ POURQUOI CE N'ÉTAIT PAS ANODIN. lib/gymUrls construit les liens membres sur
// https://links.viniz.app/{slug}/… Sur la variante staging, un membre DÉCONNECTÉ (le cas
// où le repli sert, précisément : « mot de passe oublié ») aurait produit un lien
// .../dopamine/reset-password — c'est-à-dire le chemin que l'app de PRODUCTION revendique
// par son AASA. Le lien de staging aurait pu ouvrir l'app Dopamine de production sur
// l'appareil du testeur. Le profil EAS staging pose donc 'dopamine-staging', le slug réel
// du clone en base (vérifié : nexxia_gyms.slug = 'dopamine-staging').
export const GYM_SLUG: string = process.env.EXPO_PUBLIC_GYM_SLUG ?? 'dopamine'

// Identifiant de build, dupliqué de app.config.ts. Sans import aujourd'hui : à retirer
// ou à faire lire depuis expo-constants, mais changer de bundle exige un build de toute
// façon — hors périmètre GYM-216.
export const BUNDLE_ID = 'be.dopamineclub.app'
