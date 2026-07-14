import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/useAuthStore'
import type { ReactNode } from 'react'

interface ProtectedRouteProps {
  children: ReactNode
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const session = useAuthStore((s) => s.session)
  const gymId = useAuthStore((s) => s.gym_id)
  const initialized = useAuthStore((s) => s.initialized)

  // Tant que l'auth n'est pas résolue (init async au chargement direct d'une URL),
  // on ATTEND — ne pas rebondir vers /login, sinon un deep link protégé est perdu.
  if (!initialized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent-dim border-t-transparent" />
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  if (!gymId) {
    return <Navigate to="/pending" replace />
  }

  return <>{children}</>
}
