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
export const GYM_NAME = 'Dopamine Performance Club'
export const GYM_SLUG = 'dopamine'
export const BUNDLE_ID = 'be.dopamineclub.app'
export const WEBSITE = 'https://dopamineclub.be'
