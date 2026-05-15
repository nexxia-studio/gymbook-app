import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/useAuthStore'
import type { ReactNode } from 'react'

interface ProtectedRouteProps {
  children: ReactNode
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const session = useAuthStore((s) => s.session)
  const gymId = useAuthStore((s) => s.gym_id)

  if (!session) {
    return <Navigate to="/login" replace />
  }

  if (!gymId) {
    return <Navigate to="/pending" replace />
  }

  return <>{children}</>
}
