import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// GYM-164 — Capture le fragment d'URL AVANT createClient. Avec detectSessionInUrl=true
// (défaut), supabase-js CONSOMME le fragment recovery (#access_token=…&type=recovery) et
// NETTOIE window.location.hash dès l'initialisation du client — donc avant le montage de
// /reset-password. Ce module s'exécutant de haut en bas, cette capture précède la création
// du client (et son nettoyage). ResetPassword s'appuie dessus pour détecter le lien recovery
// même après le nettoyage. (Aucun autre module ne crée de client : `supabase` ci-dessous est
// l'unique instance, exportée en singleton.)
export const initialUrlHash = typeof window !== 'undefined' ? window.location.hash : ''

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
  },
})
