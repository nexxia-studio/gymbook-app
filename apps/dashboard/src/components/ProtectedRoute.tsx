import { Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ShieldAlert, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/stores/useAuthStore'
import type { ReactNode } from 'react'

// GYM-145 — seuls les gérants accèdent au dashboard.
const ALLOWED_ROLES = ['gym_admin', 'super_admin']

interface ProtectedRouteProps {
  children: ReactNode
  /**
   * ╔═════════════════════════════════════════════════════════════════════════════════╗
   * ║  🔴 COCKPIT — UN SUPER-ADMIN N'A PAS DE SALLE, ET FINISSAIT SUR /pending        ║
   * ╚═════════════════════════════════════════════════════════════════════════════════╝
   *
   * LE DÉFAUT, constaté dans le navigateur (staging, 21/09) : connecté en super-admin,
   * Antoine atterrissait sur « en attente d'activation ». Le test `if (!gymId)` ci-dessous
   * s'exécutait AVANT le contrôle de rôle — or un super-administrateur a délibérément
   * `gym_id = NULL` : il n'appartient à aucune salle, sinon il gonflerait le décompte de
   * ses membres.
   *
   * ⚠️ POURQUOI UNE PROP ET NON UN RÉORDONNANCEMENT GLOBAL.
   * Déplacer le contrôle de rôle avant celui de la salle changerait le parcours de TOUTES
   * les routes — y compris celui d'un compte sans profil résolu, qui doit continuer
   * d'atterrir sur /pending. Ici, chaque `<ProtectedRoute>` existant garde le défaut et
   * reste strictement équivalent ; seule la route qui tolère une absence de salle le dit,
   * à son point d'appel, où on peut le lire.
   *
   * Défaut `true` : exiger une salle reste la règle, et l'exception se déclare.
   */
  requireGym?: boolean
}

function Loader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent-dim border-t-transparent" />
    </div>
  )
}

export function ProtectedRoute({ children, requireGym = true }: ProtectedRouteProps) {
  const { t } = useTranslation()
  const session = useAuthStore((s) => s.session)
  const gymId = useAuthStore((s) => s.gym_id)
  const role = useAuthStore((s) => s.role)
  const initialized = useAuthStore((s) => s.initialized)
  const signOut = useAuthStore((s) => s.signOut)

  // Tant que l'auth n'est pas résolue (init async au chargement direct d'une URL),
  // on ATTEND — ne pas rebondir vers /login, sinon un deep link protégé est perdu.
  if (!initialized) {
    return <Loader />
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  if (requireGym && !gymId) {
    return <Navigate to="/pending" replace />
  }

  // Rôle pas encore résolu : dans ce store il est chargé avec le gym_id (même fetch
  // profil), mais on affiche le loader plutôt qu'un flash "réservé aux gérants".
  //
  // ✅ VÉRIFIÉ (21/09) : `role` et `gym_id` viennent du MÊME `.select('gym_id, role')`,
  // dans les trois chemins du store — `signIn`, `initialize`, `refreshProfile`. Le rôle se
  // résout donc indépendamment de la salle : un super-administrateur sans salle obtient
  // bien `role = 'super_admin'`, et ce loader ne tourne pas à l'infini.
  //
  // ⚠️ Ce loader ne s'applique QU'AU parcours qui exige une salle — donc tous les écrans
  // existants, à l'identique. Sans salle exigée, un `role` nul après `initialized` n'est
  // plus une attente mais un fait : `initialized` n'est posé qu'APRÈS le fetch du profil
  // (useAuthStore:252). On tombe alors dans la garde de rôle ci-dessous, qui refuse — un
  // loader éternel serait la pire des réponses.
  if (requireGym && role === null) {
    return <Loader />
  }

  // GYM-145 — garde de rôle : un compte member ne doit pas accéder au dashboard gérant.
  if (!ALLOWED_ROLES.includes(role ?? '')) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-accent-dim/10">
            <ShieldAlert className="h-10 w-10 text-accent-dim" />
          </div>

          <h1 className="mt-4 font-display text-2xl font-black tracking-tight text-dark">
            {t('restricted.title')}
          </h1>

          <p className="mt-3 font-body text-sm leading-relaxed text-secondary">
            {t('restricted.message')}
          </p>

          <div className="mt-8">
            {/* signOut → session=null → re-render → <Navigate to="/login" />. */}
            <Button variant="ghost" onClick={() => { void signOut() }}>
              <LogOut className="h-4 w-4" />
              {t('auth.logout')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
