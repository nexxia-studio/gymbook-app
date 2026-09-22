import type { ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { StagingBadge } from '@/components/StagingBadge'
// GYM-250 — le bandeau de fin d'essai est DANS LE LAYOUT, pas dans Réglages : le gérant
// n'y va que s'il a une raison, et la raison est justement ce qu'il ignore.
import { TrialBanner } from '@/components/subscription/TrialBanner'
// Le chemin du RETOUR vers l'assistant, sur les écrans où il envoie (étapes 4 à 6).
import { OnboardingReturnBanner } from '@/components/onboarding/OnboardingReturnBanner'

interface DashboardLayoutProps {
  children: ReactNode
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <div className="flex min-h-screen bg-background">
      <StagingBadge />
      <Sidebar />

      {/* Main area — offset by sidebar width on desktop */}
      <div className="flex flex-1 flex-col lg:pl-60">
        <Header />
        <TrialBanner />
        <OnboardingReturnBanner />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
