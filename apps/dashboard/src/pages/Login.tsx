import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { AuthLayout } from '@/components/ui/AuthLayout'
import { Input } from '@/components/ui/Input'
import { PasswordInput } from '@/components/ui/PasswordInput'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/stores/useAuthStore'

export default function Login() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { signIn, isLoading, error, clearError } = useAuthStore()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    clearError()
    try {
      await signIn(email, password)
      navigate('/dashboard')
    } catch {
      // Error is handled in store
    }
  }

  return (
    <AuthLayout>
      <div>
        <h1 className="font-display text-4xl font-black tracking-tight text-dark">
          {t('auth.login_title')}
        </h1>
        <p className="mt-2 font-body text-sm text-dark/50">
          {t('auth.login_subtitle')}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-5">
        {error && (
          <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">
            {t(error)}
          </div>
        )}

        <Input
          label={t('auth.email')}
          name="email"
          type="email"
          autoComplete="email"
          placeholder={t('auth.email_placeholder')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <PasswordInput
          label={t('auth.password')}
          name="password"
          autoComplete="current-password"
          placeholder={t('auth.password_placeholder')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        <div className="flex justify-end">
          <Link
            to="/forgot-password"
            className="font-body text-sm text-dark/50 transition-colors hover:text-dark"
          >
            {t('auth.forgot_password')}
          </Link>
        </div>

        <Button type="submit" isLoading={isLoading} className="w-full">
          {t('auth.login')}
        </Button>

        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-dark/10" />
          <span className="font-body text-xs text-dark/30">{t('common.or')}</span>
          <div className="h-px flex-1 bg-dark/10" />
        </div>

        <p className="text-center font-body text-sm text-dark/50">
          {t('auth.no_account')}{' '}
          <Link to="/signup" className="font-semibold text-dark transition-colors hover:text-accent-dim">
            {t('auth.signup')}
          </Link>
        </p>
      </form>
    </AuthLayout>
  )
}
