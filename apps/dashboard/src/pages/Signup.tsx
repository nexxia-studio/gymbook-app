// GYM-248 — INSCRIPTION GÉRANT SELF-SERVE. Page REBRANCHÉE.
//
// ── Ce qui avait fermé cette page, et ce qui l'a rouverte ────────────────────────────
// GYM-200 §5 l'avait démontée parce qu'elle attribuait role:'gym_admin' dans les
// user_metadata, que handle_new_user() recopiait tel quel : n'importe qui pouvait se créer
// un compte gérant. Son commentaire posait la condition du rebranchement — « ne JAMAIS lui
// attribuer gym_admin depuis le client ». C'est exactement ce que GYM-248 a construit :
//
//   · handle_new_user force role='member', SANS exception (le client ne décide plus rien) ;
//   · signup_intent='gym_owner' garantit qu'aucun rattachement automatique ne capture le
//     compte — il naît orphelin, en attente de sa salle ;
//   · create_gym_self_serve (SECURITY DEFINER) crée la salle ET promeut l'appelant, côté
//     serveur, une seule fois, sous conditions vérifiées en base.
//
// Le client ne transmet donc NI rôle NI gym_id. Il demande ; le serveur crée et scelle.
//
// ⚠️ CETTE PAGE EST POUR LES GÉRANTS. Un membre de salle n'a rien à faire ici : il passe
// par l'app mobile. D'où le renvoi discret en bas de page — sans quoi des membres
// s'inscriraient sur le dashboard et se retrouveraient à créer une salle fantôme.
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Mail, ArrowLeft, Smartphone } from 'lucide-react'
import { AuthLayout } from '@/components/ui/AuthLayout'
import { Input } from '@/components/ui/Input'
import { PasswordInput } from '@/components/ui/PasswordInput'
import { PasswordRules } from '@/components/ui/PasswordRules'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/stores/useAuthStore'
import { validatePassword } from '@/lib/passwordPolicy'
import { supabase } from '@/lib/supabase'
import { SIGNUP_CONFIRMED_PATH } from '@/lib/signupLink'

// RÈGLE UNIQUE DU PRODUIT : 8, comme GoTrue des deux côtés (staging et prod), comme
// /reset-password et /welcome. Un seuil front plus élevé que le seuil auth ne protège rien
// — le compte reste créable à 8 par tout autre chemin — et ment à l'utilisateur sur ce qui
// est réellement exigé. Le 12 hérité de l'ancienne page a coûté un aller-retour au premier
// gérant self-serve réel : il n'y a pas de seuil à deux vitesses.
const SIGNUP_MIN_LENGTH = 8

interface FormErrors {
  firstName?: string
  lastName?: string
  email?: string
  password?: string
  passwordConfirm?: string
  terms?: string
}

export default function Signup() {
  const { t } = useTranslation()
  const { signUpGymOwner, isLoading, error, clearError } = useAuthStore()

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [terms, setTerms] = useState(false)
  const [errors, setErrors] = useState<FormErrors>({})
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null)

  // Renvoi du mail de confirmation — le premier peut se perdre, et sans lui le compte
  // reste inutilisable (create_gym_self_serve refuse un email non confirmé, PT403).
  const [isResending, setIsResending] = useState(false)
  const [resent, setResent] = useState(false)

  function validate(): boolean {
    const next: FormErrors = {}

    if (!firstName.trim()) next.firstName = t('auth.validation.first_name_required')
    if (!lastName.trim()) next.lastName = t('auth.validation.last_name_required')
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) next.email = t('auth.validation.email_invalid')

    const { valid, failed } = validatePassword(password, SIGNUP_MIN_LENGTH)
    if (!valid) {
      const missing = failed.map((id) => t(`auth.password_rules.${id}`, { count: SIGNUP_MIN_LENGTH })).join(' · ')
      next.password = `${t('auth.password_errors.missing_prefix')} ${missing}`
    }

    if (password !== passwordConfirm) next.passwordConfirm = t('auth.validation.password_mismatch')
    if (!terms) next.terms = t('auth.terms_required')

    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    clearError()
    if (!validate()) return

    try {
      const { needsConfirmation } = await signUpGymOwner(
        email.trim(),
        password,
        firstName.trim(),
        lastName.trim(),
      )
      // Confirmation d'email activée sur le projet : il n'y a pas de session à ce stade.
      // On affiche l'écran d'attente dans les deux cas — si la confirmation était
      // désactivée, /signup/confirmed prendrait le relais sur la session déjà ouverte.
      setConfirmationEmail(email.trim())
      if (!needsConfirmation) {
        window.location.replace(SIGNUP_CONFIRMED_PATH)
      }
    } catch {
      // Le store a posé le message (dont « email déjà utilisé »), rendu ci-dessous.
    }
  }

  async function handleResend() {
    if (!confirmationEmail || isResending) return
    setIsResending(true)
    // Anti-énumération : on affiche le succès quoi qu'il arrive, comme ForgotPassword.
    await supabase.auth
      .resend({
        type: 'signup',
        email: confirmationEmail,
        options: { emailRedirectTo: `${window.location.origin}${SIGNUP_CONFIRMED_PATH}` },
      })
      .catch(() => { /* silencieux — cf. ci-dessus */ })
    setIsResending(false)
    setResent(true)
  }

  // ── Écran « vérifie ta boîte mail » ──
  if (confirmationEmail) {
    return (
      <AuthLayout>
        <div className="text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-accent-dim/10">
            <Mail className="h-8 w-8 text-accent-dim" />
          </div>
          <h1 className="font-display text-3xl font-black tracking-tight text-dark">
            {t('auth.check_email')}
          </h1>
          <p className="mt-3 font-body text-sm leading-relaxed text-dark/50">
            {t('signup_owner.check_email_subtitle', { email: confirmationEmail })}
          </p>

          <div className="mt-8 flex flex-col items-center gap-4">
            {resent ? (
              <p className="font-body text-sm font-semibold text-accent-dim">
                {t('signup_owner.resent')}
              </p>
            ) : (
              <Button variant="ghost" onClick={handleResend} isLoading={isResending}>
                {t('signup_owner.resend')}
              </Button>
            )}
            <Link
              to="/login"
              className="inline-flex items-center gap-1.5 font-body text-sm font-semibold text-dark transition-colors hover:text-accent-dim"
            >
              <ArrowLeft className="h-4 w-4" />
              {t('auth.back_to_login')}
            </Link>
          </div>
        </div>
      </AuthLayout>
    )
  }

  // « Email déjà utilisé » n'est pas une impasse : le compte existe, il faut se connecter.
  const isDuplicate = error === 'auth.errors.user_already_registered'

  return (
    <AuthLayout>
      <div>
        <h1 className="font-display text-4xl font-black tracking-tight text-dark">
          {t('signup_owner.title')}
        </h1>
        <p className="mt-2 font-body text-sm text-dark/50">
          {t('signup_owner.subtitle')}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-5">
        {error && (
          <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">
            {t(error)}
            {isDuplicate && (
              <>
                {' '}
                <Link to="/login" className="font-semibold underline">
                  {t('signup_owner.go_login')}
                </Link>
              </>
            )}
          </div>
        )}

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
          <PasswordRules password={password} minLength={SIGNUP_MIN_LENGTH} />
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

        {/* Consentement — une seule case. Les deux textes sont versionnés ensemble
            (LEGAL_VERSION partagé), et handle_new_user alimente terms_version ET
            privacy_policy_version depuis la même metadata `legal_version`. */}
        <div className="flex flex-col gap-2 rounded-xl border border-[#E8E6E0] p-4">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={terms}
              onChange={(e) => setTerms(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-[#E8E6E0] accent-dark"
            />
            <span className="font-body text-sm text-dark/70">
              {t('signup_owner.legal_accept')}{' '}
              <Link to="/legal/terms" target="_blank" className="font-semibold text-dark underline">
                {t('auth.terms_link')}
              </Link>
              {' '}{t('common.and')}{' '}
              <Link to="/legal/privacy" target="_blank" className="font-semibold text-dark underline">
                {t('auth.privacy_link')}
              </Link>
            </span>
          </label>
          {errors.terms && <p className="text-xs text-red-500">{errors.terms}</p>}
        </div>

        <Button type="submit" isLoading={isLoading} className="w-full">
          {t('signup_owner.submit')}
        </Button>

        <p className="text-center font-body text-sm text-dark/50">
          {t('auth.already_account')}{' '}
          <Link to="/login" className="font-semibold text-dark transition-colors hover:text-accent-dim">
            {t('auth.login')}
          </Link>
        </p>

        {/* ⚠️ Renvoi MEMBRE — discret mais présent. Sans lui, un membre de salle s'inscrit
            ici et crée une salle vide portant son propre nom. */}
        <div className="flex items-start gap-2.5 rounded-xl bg-dark/[0.03] px-4 py-3">
          <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-dark/40" />
          <p className="font-body text-xs leading-relaxed text-dark/50">
            {t('signup_owner.member_hint')}
          </p>
        </div>
      </form>
    </AuthLayout>
  )
}
