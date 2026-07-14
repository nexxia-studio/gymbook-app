import { useEffect, lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/useAuthStore'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { ToastContainer } from '@/components/ui/Toast'
import MollieCallback from '@/pages/MollieCallback'
import PaymentSuccess from '@/pages/PaymentSuccess'
import PaymentCancel from '@/pages/PaymentCancel'

const Login = lazy(() => import('@/pages/Login'))
const Signup = lazy(() => import('@/pages/Signup'))
const ForgotPassword = lazy(() => import('@/pages/ForgotPassword'))
const Dashboard = lazy(() => import('@/pages/Dashboard'))
const Planning = lazy(() => import('@/pages/Planning'))
const Settings = lazy(() => import('@/pages/Settings'))
const Members = lazy(() => import('@/pages/Members'))
const PendingActivation = lazy(() => import('@/pages/PendingActivation'))
const Revenue = lazy(() => import('@/pages/Revenue'))
const Communications = lazy(() => import('@/pages/Communications'))
const Plans = lazy(() => import('@/pages/Plans'))
// Pages légales PUBLIQUES (accessibles hors session — Apple vérifie les URLs déconnecté).
const PrivacyPolicy = lazy(() => import('@/pages/legal/PrivacyPolicy'))
const Terms = lazy(() => import('@/pages/legal/Terms'))
const Support = lazy(() => import('@/pages/Support'))

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
        {/* Routes légales publiques — hors ProtectedRoute (rendues sans session). */}
        <Route path="/legal/privacy" element={<PrivacyPolicy />} />
        <Route path="/legal/terms" element={<Terms />} />
        <Route path="/support" element={<Support />} />
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
              <Plans />
            </ProtectedRoute>
          }
        />
        {/* GYM-55 — /paiements fusionné dans /revenus (redirection explicite des 2 slugs FR/EN) */}
        <Route path="/payments" element={<Navigate to="/revenue" replace />} />
        <Route path="/paiements" element={<Navigate to="/revenue" replace />} />
        <Route
          path="/revenue"
          element={
            <ProtectedRoute>
              <Revenue />
            </ProtectedRoute>
          }
        />
        <Route
          path="/communications"
          element={
            <ProtectedRoute>
              <Communications />
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
        <Route path="/payment/success" element={<PaymentSuccess />} />
        <Route path="/payment/cancel" element={<PaymentCancel />} />
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
