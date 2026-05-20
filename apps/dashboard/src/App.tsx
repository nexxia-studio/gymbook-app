import { useEffect, lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/useAuthStore'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { ToastContainer } from '@/components/ui/Toast'
import MollieCallback from '@/pages/MollieCallback'

const Login = lazy(() => import('@/pages/Login'))
const Signup = lazy(() => import('@/pages/Signup'))
const ForgotPassword = lazy(() => import('@/pages/ForgotPassword'))
const Dashboard = lazy(() => import('@/pages/Dashboard'))
const Planning = lazy(() => import('@/pages/Planning'))
const Settings = lazy(() => import('@/pages/Settings'))
const Members = lazy(() => import('@/pages/Members'))
const PendingActivation = lazy(() => import('@/pages/PendingActivation'))
const PlaceholderPage = lazy(() => import('@/pages/PlaceholderPage'))

function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
    </div>
  )
}

function AppRoutes() {
  const session = useAuthStore((s) => s.session)

  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route
          path="/"
          element={<Navigate to={session ? '/dashboard' : '/login'} replace />}
        />
        <Route
          path="/login"
          element={session ? <Navigate to="/dashboard" replace /> : <Login />}
        />
        <Route
          path="/signup"
          element={session ? <Navigate to="/dashboard" replace /> : <Signup />}
        />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/pending" element={session ? <PendingActivation /> : <Navigate to="/login" replace />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/planning"
          element={
            <ProtectedRoute>
              <Planning />
            </ProtectedRoute>
          }
        />
        <Route
          path="/members"
          element={
            <ProtectedRoute>
              <Members />
            </ProtectedRoute>
          }
        />
        <Route
          path="/plans"
          element={
            <ProtectedRoute>
              <PlaceholderPage pageKey="plans" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/revenue"
          element={
            <ProtectedRoute>
              <PlaceholderPage pageKey="revenue" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <Settings />
            </ProtectedRoute>
          }
        />
        <Route 
          path="/mollie/callback" 
          element={
            <MollieCallback />
          } 
        />
      </Routes>
    </Suspense>
  )
}

function App() {
  const initialize = useAuthStore((s) => s.initialize)

  useEffect(() => {
    initialize()
  }, [initialize])

  return (
    <BrowserRouter>
      <AppRoutes />
      <ToastContainer />
    </BrowserRouter>
  )
}

export default App
