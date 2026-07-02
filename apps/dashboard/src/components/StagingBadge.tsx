/**
 * Badge visuel "STAGING", affiché UNIQUEMENT sur l'environnement de staging.
 * Détection par environnement (jamais en dur) :
 *  - hostname contient 'git-develop' (preview Vercel de la branche develop), OU
 *  - VITE_SUPABASE_URL pointe vers le projet staging (buovgpokubrkejunmauq).
 * En prod (URL prod + projet prod) les deux conditions sont fausses -> rien n'est rendu.
 */
export function StagingBadge() {
  const hostname = typeof window !== 'undefined' ? window.location.hostname : ''
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? ''

  const isStaging =
    hostname.includes('git-develop') || supabaseUrl.includes('buovgpokubrkejunmauq')

  if (!isStaging) return null

  return (
    <div
      className="fixed left-0 top-0 z-[9999] select-none rounded-br-md bg-pink-600 px-2 py-1 text-xs font-bold tracking-wide text-white shadow-md"
      aria-hidden="true"
    >
      STAGING
    </div>
  )
}
