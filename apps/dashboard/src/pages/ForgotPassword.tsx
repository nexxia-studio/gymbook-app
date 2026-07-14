import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ArrowLeft, Mail } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { supabase } from '@/lib/supabase'
import vinizWordmark from '@/assets/brand/viniz-wordmark.svg'

export default function ForgotPassword() {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setIsLoading(true)
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    // Always show success regardless of whether email exists (security)
    setIsLoading(false)
    setSent(true)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-[440px]">
        {/* Logo */}
        <div className="mb-10 flex items-center justify-center">
          <img src={vinizWordmark} alt="Viniz" className="h-11 w-11 rounded-xl" />
        </div>

        {sent ? (
          <div className="text-center">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-accent/10">
              <Mail className="h-8 w-8 text-accent-dim" />
            </div>
            <h1 className="font-display text-3xl font-black uppercase tracking-tight text-dark">
              {t('auth.check_email')}
            </h1>
            <p className="mt-3 font-body text-sm leading-relaxed text-dark/50">
              {t('auth.forgot_password_success')}
            </p>
            <Link
              to="/login"
              className="mt-8 inline-flex items-center gap-2 font-body text-sm font-semibold text-dark transition-colors hover:text-accent-dim"
            >
              <ArrowLeft className="h-4 w-4" />
              {t('auth.back_to_login')}
            </Link>
          </div>
        ) : (
          <>
            <div className="text-center">
              <h1 className="font-display text-3xl font-black uppercase tracking-tight text-dark">
                {t('auth.forgot_password_title')}
              </h1>
              <p className="mt-2 font-body text-sm text-dark/50">
                {t('auth.forgot_password_subtitle')}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-5">
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

              <Button type="submit" isLoading={isLoading} className="w-full">
                {t('auth.forgot_password_submit')}
              </Button>
            </form>

            <div className="mt-6 text-center">
              <Link
                to="/login"
                className="inline-flex items-center gap-2 font-body text-sm text-dark/50 transition-colors hover:text-dark"
              >
                <ArrowLeft className="h-4 w-4" />
                {t('auth.back_to_login')}
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
