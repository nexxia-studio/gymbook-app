import { useEffect, lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/useAuthStore'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { ACTIVATION_PATH, shouldInterceptInvite } from '@/lib/inviteLink'
import { ToastContainer } from '@/components/ui/Toast'
import MollieCallback from '@/pages/MollieCallback'
import PaymentSuccess from '@/pages/PaymentSuccess'
import PaymentCancel from '@/pages/PaymentCancel'

const Login = lazy(() => import('@/pages/Login'))
const Signup = lazy(() => import('@/pages/Signup'))
const ForgotPassword = lazy(() => import('@/pages/ForgotPassword'))
const ResetPassword = lazy(() => import('@/pages/ResetPassword'))
const Dashboard = lazy(() => import('@/pages/Dashboard'))
const Planning = lazy(() => import('@/pages/Planning'))
const Settings = lazy(() => import('@/pages/Settings'))
const Members = lazy(() => import('@/pages/Members'))
const PendingActivation = lazy(() => import('@/pages/PendingActivation'))
const AccountActivation = lazy(() => import('@/pages/AccountActivation'))
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
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent-dim border-t-transparent" />
    </div>
  )
}

function AppRoutes() {
  const session = useAuthStore((s) => s.session)
  const { pathname } = useLocation()

  // GYM-202 — Détournement d'une arrivée par lien d'INVITATION.
  //
  // Évalué AVANT <Routes> : la décision précède donc toute décision de route, et en
  // particulier la redirection vers /pending que ProtectedRoute déclenche quand gym_id est
  // absent. C'était exactement le piège du bug — l'invité arrivait authentifié mais sans
  // mot de passe, était jugé « en attente d'activation », et n'avait plus aucun moyen de se
  // reconnecter ensuite.
  //
  // La garde ne s'arme QUE sur un fragment `type=invite` (ou une erreur de lien sur la
  // racine) et se désarme dès l'activation terminée : connexion classique, reset password
  // et utilisateur déjà activé ne la croisent jamais. Cf. lib/inviteLink.ts.
  if (shouldInterceptInvite(pathname)) {
    return <Navigate to={ACTIVATION_PATH} replace />
  }

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
        {/* GYM-157 — page publique de reset/définition MDP (MEMBRES). HORS ProtectedRoute et
            SANS redirection de session : le lien recovery établit une session member qui ne
            doit pas être interceptée vers /dashboard (bloquée par l'écran gérant GYM-145). */}
        <Route path="/reset-password" element={<ResetPassword />} />
        {/* GYM-202 — activation d'un compte créé par invitation (GÉRANTS, marque Viniz).
            Publique au sens du routeur — comme /reset-password, la session vient du lien —
            mais la page exige une session valide et se redirige elle-même sinon. */}
        <Route path={ACTIVATION_PATH} element={<AccountActivation />} />
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
