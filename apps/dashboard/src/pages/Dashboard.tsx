import { useTranslation } from 'react-i18next'
import { Dumbbell, LogOut } from 'lucide-react'
import { useAuthStore } from '@/stores/useAuthStore'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'

export default function Dashboard() {
  const { t } = useTranslation()
  const { signOut, user } = useAuthStore()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center">
        <div className="mb-6 flex items-center justify-center gap-3">
          <Dumbbell className="h-10 w-10 text-accent" />
          <h1 className="font-display text-5xl font-black uppercase tracking-tight text-dark">
            {t('dashboard.title')}
          </h1>
        </div>
        <p className="text-lg text-dark/60">
          {t('dashboard.subtitle')}
        </p>
        {user && (
          <p className="mt-2 font-body text-sm text-dark/40">
            {user.email}
          </p>
        )}
        <div className="mx-auto mt-6 h-1 w-24 rounded-full bg-accent" />
        <div className="mt-8">
          <Button variant="secondary" onClick={handleSignOut}>
            <LogOut className="h-4 w-4" />
            {t('auth.logout')}
          </Button>
        </div>
      </div>
    </div>
  )
}
