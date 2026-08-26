import { createClient } from '@supabase/supabase-js'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import { captureEvent } from './analytics'

// ═════════════════════════════════════════════════════════════════════════════════════
// GYM-269 — LE TROUSSEAU iOS REFUSAIT LE JETON QUAND LE TÉLÉPHONE ÉTAIT VERROUILLÉ
// ═════════════════════════════════════════════════════════════════════════════════════
// Symptôme en production : `getValueWithKeyAsync ... User interaction is not allowed`,
// avec `in_foreground: false` dans l'événement Sentry. L'app lit le jeton de session en
// ARRIÈRE-PLAN (rafraîchissement automatique, notification push), et l'entrée du trousseau
// était écrite avec l'accessibilité par défaut d'expo-secure-store — `WHEN_UNLOCKED`
// (constaté dans le typage installé : `@default SecureStore.WHEN_UNLOCKED`). Écran
// verrouillé = lecture refusée par iOS, promesse rejetée, membre déconnecté sans raison
// visible.
//
// `AFTER_FIRST_UNLOCK` est la réponse : l'entrée redevient lisible dès le premier
// déverrouillage suivant un démarrage, y compris ensuite écran verrouillé. C'est
// l'accessibilité recommandée pour un jeton que l'app doit rafraîchir seule.
const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
}

/**
 * 🔴 POURQUOI UN `delete` AVANT LE `set` — LE POINT QUI DÉCIDE DE TOUT.
 *
 * Poser l'option sur `setItemAsync` NE MIGRE PAS une entrée existante. Vérifié dans le
 * code natif de la version installée (expo-secure-store 15.0.8,
 * `ios/SecureStoreModule.swift`) et non supposé :
 *
 *   · `set()` place bien `kSecAttrAccessible` dans la requête… mais UNIQUEMENT dans le
 *     `SecItemAdd` ;
 *   · si l'entrée existe déjà, `SecItemAdd` rend `errSecDuplicateItem` et le module bascule
 *     sur `update()`, dont le dictionnaire de mise à jour ne contient QUE `kSecValueData` —
 *     PAS `kSecAttrAccessible`.
 *
 * Autrement dit : sans suppression préalable, tous les membres DÉJÀ CONNECTÉS auraient
 * gardé `WHEN_UNLOCKED` indéfiniment, et le correctif n'aurait rien corrigé pour eux —
 * c'est-à-dire pour la totalité de la base installée de Dopamine à l'ouverture.
 *
 * ⚠️ La suppression est best-effort et silencieuse : une entrée absente n'est pas une
 * erreur, et échouer ici ferait échouer l'écriture du jeton juste après.
 *
 * ⚠️ FENÊTRE ASSUMÉE : entre le `delete` et le `set`, l'entrée n'existe pas. Si l'app est
 * tuée pile là, la session est perdue et le membre se reconnecte — la reconnexion écrit
 * alors une entrée neuve, à la bonne accessibilité. Le risque est de l'ordre de la
 * milliseconde, contre un rejet de lecture à chaque écran verrouillé.
 */
async function writeSecure(key: string, value: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key, SECURE_STORE_OPTIONS)
  } catch {
    /* entrée absente ou déjà supprimée — rien à migrer */
  }
  await SecureStore.setItemAsync(key, value, SECURE_STORE_OPTIONS)
}

const ExpoSecureStoreAdapter = {
  getItem: async (key: string) => {
    if (Platform.OS === 'web') {
      return localStorage.getItem(key)
    }
    try {
      // ⚠️ `keychainAccessible` est SANS EFFET sur une lecture : `searchKeyChain()` ne
      // l'emploie pas (même source Swift). Il est passé pour que les trois accès
      // partagent une seule constante et ne puissent pas diverger — pas parce qu'il agit.
      return await SecureStore.getItemAsync(key, SECURE_STORE_OPTIONS)
    } catch (e) {
      // Trousseau verrouillé, entrée invalidée, ou toute autre erreur de lecture :
      // « session absente », JAMAIS une promesse non gérée. Une exception ici remonterait
      // dans supabase-js, hors de tout `try` applicatif, et finirait en crash Sentry — ce
      // qu'on a observé.
      //
      // Remonté à PostHog et non à Sentry : un trousseau verrouillé est un état NORMAL de
      // l'appareil, pas un défaut de l'app. C'est la même règle que le filtrage des refus
      // métier de GYM-270 — Sentry ne doit contenir que ce qui appelle une correction.
      // GYM-272 — `reason` ramené à un ENSEMBLE FERMÉ. La version GYM-269 envoyait les
      // 120 premiers caractères du message natif : du texte libre, que la convention de ce
      // lot interdit en propriété d'événement (et qui aurait fait une dimension à
      // cardinalité ouverte, illisible dans PostHog). Les deux cas qui comptent sont
      // distingués ; le reste tombe dans `other`, et le détail reste dans les logs.
      const raw = e instanceof Error ? e.message : ''
      captureEvent('secure_store_read_failed', {
        reason: raw.includes('User interaction is not allowed')
          ? 'locked'
          : raw.includes('not found') || raw.includes('errSecItemNotFound')
            ? 'not_found'
            : 'other',
      })
      return null
    }
  },
  setItem: (key: string, value: string) => {
    if (Platform.OS === 'web') {
      localStorage.setItem(key, value)
      return Promise.resolve()
    }
    return writeSecure(key, value)
  },
  removeItem: (key: string) => {
    if (Platform.OS === 'web') {
      localStorage.removeItem(key)
      return Promise.resolve()
    }
    return SecureStore.deleteItemAsync(key, SECURE_STORE_OPTIONS)
  },
}

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!

console.log('[Supabase] URL:', SUPABASE_URL?.slice(0, 30) + '...')

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_KEY,
  {
    auth: {
      storage: ExpoSecureStoreAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
)
