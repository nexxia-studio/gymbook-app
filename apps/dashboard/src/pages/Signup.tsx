import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Mail } from 'lucide-react'
import { AuthLayout } from '@/components/ui/AuthLayout'
import { Input } from '@/components/ui/Input'
import { PasswordInput } from '@/components/ui/PasswordInput'
import { PasswordStrength } from '@/components/ui/PasswordStrength'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/stores/useAuthStore'

interface FormErrors {
  firstName?: string
  lastName?: string
  email?: string
  password?: string
  passwordConfirm?: string
  terms?: string
  privacy?: string
}

function validatePassword(password: string, t: (key: string) => string): string | undefined {
  if (password.length < 12) return t('auth.validation.password_min')
  if (!/[A-Z]/.test(password)) return t('auth.validation.password_uppercase')
  if (!/[0-9]/.test(password)) return t('auth.validation.password_number')
  if (!/[^A-Za-z0-9]/.test(password)) return t('auth.validation.password_special')
  return undefined
}

export default function Signup() {
  const { t } = useTranslation()
  const { signUp, isLoading, error, clearError } = useAuthStore()

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [terms, setTerms] = useState(false)
  const [privacy, setPrivacy] = useState(false)
  const [marketing, setMarketing] = useState(false)
  const [errors, setErrors] = useState<FormErrors>({})
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null)

  function validate(): boolean {
    const next: FormErrors = {}

    if (!firstName.trim()) next.firstName = t('auth.validation.first_name_required')
    if (!lastName.trim()) next.lastName = t('auth.validation.last_name_required')
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) next.email = t('auth.validation.email_invalid')

    const pwError = validatePassword(password, t)
    if (pwError) next.password = pwError

    if (password !== passwordConfirm) next.passwordConfirm = t('auth.validation.password_mismatch')
    if (!terms) next.terms = t('auth.terms_required')
    if (!privacy) next.privacy = t('auth.privacy_required')

    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    clearError()
    if (!validate()) return

    try {
      const { needsConfirmation } = await signUp(
        email,
        password,
        firstName.trim(),
        lastName.trim(),
        phone.trim() || undefined,
        { terms, privacy, marketing }
      )
      if (needsConfirmation) {
        setConfirmationEmail(email)
      }
    } catch {
      // Error is handled in store
    }
  }

  if (confirmationEmail) {
    return (
      <AuthLayout>
        <div className="text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-accent/10">
            <Mail className="h-8 w-8 text-accent-dim" />
          </div>
          <h1 className="font-display text-3xl font-black uppercase tracking-tight text-dark">
            {t('auth.check_email')}
          </h1>
          <p className="mt-3 font-body text-sm leading-relaxed text-dark/50">
            {t('auth.check_email_subtitle', { email: confirmationEmail })}
          </p>
          <Link
            to="/login"
            className="mt-8 inline-block font-body text-sm font-semibold text-dark transition-colors hover:text-accent-dim"
          >
            {t('auth.back_to_login')}
          </Link>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <div>
        <h1 className="font-display text-4xl font-black uppercase tracking-tight text-dark">
          {t('auth.signup_title')}
        </h1>
        <p className="mt-2 font-body text-sm text-dark/50">
          {t('auth.signup_subtitle')}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-5">
        {error && (
          <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">
            {t(error)}
          </div>
        )}

        {/* Name row */}
        <div className="grid grid-cols-2 gap-4">
          <Input
            label={t('auth.first_name')}
            name="firstName"
            autoComplete="given-name"
            placeholder={t('auth.first_name_placeholder')}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            error={errors.firstName}
            required
          />
          <Input
            label={t('auth.last_name')}
            name="lastName"
            autoComplete="family-name"
            placeholder={t('auth.last_name_placeholder')}
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            error={errors.lastName}
            required
          />
        </div>

        <Input
          label={t('auth.email')}
          name="email"
          type="email"
          autoComplete="email"
          placeholder={t('auth.email_placeholder')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          required
        />

        <Input
          label={t('auth.phone')}
          name="phone"
          type="tel"
          autoComplete="tel"
          placeholder={t('auth.phone_placeholder')}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          helper={t('auth.phone_optional')}
        />

        <div className="flex flex-col gap-2">
          <PasswordInput
            label={t('auth.password')}
            name="password"
            autoComplete="new-password"
            placeholder={t('auth.password_placeholder')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
            required
          />
          <PasswordStrength password={password} />
        </div>

        <PasswordInput
          label={t('auth.password_confirm')}
          name="passwordConfirm"
          autoComplete="new-password"
          placeholder={t('auth.password_confirm_placeholder')}
          value={passwordConfirm}
          onChange={(e) => setPasswordConfirm(e.target.value)}
          error={errors.passwordConfirm}
          required
        />

        {/* Consents */}
        <div className="flex flex-col gap-3 rounded-xl border border-[#E8E6E0] p-4">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={terms}
              onChange={(e) => setTerms(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-[#E8E6E0] accent-dark"
            />
            <span className="font-body text-sm text-dark/70">
              {t('auth.terms_accept')}{' '}
              <a href="#" className="font-semibold text-dark underline">
                {t('auth.terms_link')}
              </a>
            </span>
          </label>
          {errors.terms && <p className="text-xs text-red-500">{errors.terms}</p>}

          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={privacy}
              onChange={(e) => setPrivacy(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-[#E8E6E0] accent-dark"
            />
            <span className="font-body text-sm text-dark/70">
              {t('auth.privacy_accept')}{' '}
              <a href="#" className="font-semibold text-dark underline">
                {t('auth.privacy_link')}
              </a>
            </span>
          </label>
          {errors.privacy && <p className="text-xs text-red-500">{errors.privacy}</p>}

          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={marketing}
              onChange={(e) => setMarketing(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-[#E8E6E0] accent-dark"
            />
            <span className="font-body text-sm text-dark/70">
              {t('auth.marketing_accept')}
            </span>
          </label>
        </div>

        <Button type="submit" isLoading={isLoading} className="w-full">
          {t('auth.signup')}
        </Button>

        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-dark/10" />
          <span className="font-body text-xs text-dark/30">{t('common.or')}</span>
          <div className="h-px flex-1 bg-dark/10" />
        </div>

        <p className="text-center font-body text-sm text-dark/50">
          {t('auth.already_account')}{' '}
          <Link to="/login" className="font-semibold text-dark transition-colors hover:text-accent-dim">
            {t('auth.login')}
          </Link>
        </p>
      </form>
    </AuthLayout>
  )
}
