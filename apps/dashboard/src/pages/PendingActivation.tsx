import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Clock, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/stores/useAuthStore'
import vinizWordmark from '@/assets/brand/viniz-wordmark.svg'

export default function PendingActivation() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { signOut } = useAuthStore()

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-accent/10">
          <Clock className="h-10 w-10 text-accent-dim" />
        </div>

        <div className="mb-2 flex items-center justify-center">
          <img src={vinizWordmark} alt="Viniz" className="h-9 w-9 rounded-lg" />
        </div>

        <h1 className="mt-4 font-display text-2xl font-black uppercase tracking-tight text-dark">
          {t('pending.title')}
        </h1>

        <p className="mt-3 font-body text-sm leading-relaxed text-secondary">
          {t('pending.message')}
        </p>

        <div className="mt-8">
          <Button variant="ghost" onClick={handleSignOut}>
            <LogOut className="h-4 w-4" />
            {t('auth.logout')}
          </Button>
        </div>
      </div>
    </div>
  )
}
