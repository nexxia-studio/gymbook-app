// GYM-157 — Page PUBLIQUE de définition/réinitialisation du mot de passe.
//
// Cible : les MEMBRES (marque Dopamine). Les emails Auth (reset + invitation GYM-144)
// redirigent ici via Site URL. La route est déclarée HORS ProtectedRoute (cf. App.tsx) et
// n'a AUCUNE redirection de session : un membre avec une session recovery doit pouvoir y rester.
//
// Mécanisme recovery : le client supabase du dashboard n'a pas detectSessionInUrl explicite →
// il vaut true par défaut. Le lien recovery (#access_token=…&type=recovery) est parsé au
// chargement du client et émet l'événement PASSWORD_RECOVERY. On écoute cet événement ET on
// relit getSession() (l'événement a pu partir avant le montage).
import { useState, useEffect, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, AlertTriangle } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { PasswordInput } from '@/components/ui/PasswordInput'
import { Button } from '@/components/ui/Button'
import { supabase, initialUrlHash } from '@/lib/supabase'

const MIN_PASSWORD = 8

type Status = 'checking' | 'ready' | 'invalid' | 'done'

function DopamineWordmark() {
  return (
    <div className="mb-10 flex items-center justify-center">
      <span className="rounded-xl bg-[#111111] px-4 py-2 font-display text-lg font-black tracking-[0.2em] text-[#C8F000]">
        DOPAMINE
      </span>
    </div>
  )
}

export default function ResetPassword() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<Status>('checking')

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  // Renvoi de lien (état 'invalid').
  const [resendEmail, setResendEmail] = useState('')
  const [resendSent, setResendSent] = useState(false)
  const [isResending, setIsResending] = useState(false)

  // ── Détection du contexte recovery ──
  // GYM-164 — On lit initialUrlHash (capturé au chargement du module supabase, AVANT que
  // detectSessionInUrl ne nettoie window.location.hash) et non window.location.hash, qui est
  // déjà vide au montage. On ne conclut JAMAIS 'invalid' de façon synchrone quand un token
  // était présent : l'échange de token peut être encore en vol → on laisse l'événement
  // PASSWORD_RECOVERY / SIGNED_IN (ou le timeout long) décider.
  useEffect(() => {
    const hash = initialUrlHash || ''
    // Lien expiré / erreur explicite renvoyée par Supabase dans le fragment → invalide direct.
    if (hash.includes('error')) {
      setStatus('invalid')
      return
    }
    const hasRecoveryToken = hash.includes('access_token') || hash.includes('type=recovery')

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
        setStatus('ready')
      }
    })

    // L'événement a pu partir avant le montage → on relit la session courante.
    // On ne passe JAMAIS 'invalid' ici : si pas de session encore, on attend (token en vol).
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setStatus('ready')
    })

    // Filet de sécurité :
    //  - token présent → laisser à PASSWORD_RECOVERY le temps d'arriver (échange en vol) : 8s.
    //  - aucun token (arrivée directe) → court délai (~1s) pour laisser getSession répondre,
    //    puis afficher le formulaire de renvoi sans faire attendre 8s.
    const timer = setTimeout(() => {
      setStatus((s) => (s === 'checking' ? 'invalid' : s))
    }, hasRecoveryToken ? 8000 : 1000)

    return () => {
      sub.subscription.unsubscribe()
      clearTimeout(timer)
    }
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (isSaving) return
    setFormError(null)

    if (password.length < MIN_PASSWORD) {
      setFormError(t('reset.min_length', { count: MIN_PASSWORD }))
      return
    }
    if (password !== confirm) {
      setFormError(t('auth.validation.password_mismatch'))
      return
    }

    setIsSaving(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) {
        setFormError(t('reset.error_generic'))
        return
      }
      setStatus('done')
      // Ne pas laisser traîner la session recovery (le public est un membre).
      await supabase.auth.signOut().catch(() => { /* best-effort */ })
    } catch {
      setFormError(t('reset.error_generic'))
    } finally {
      setIsSaving(false)
    }
  }

  async function handleResend(e: FormEvent) {
    e.preventDefault()
    if (isResending) return
    setIsResending(true)
    await supabase.auth.resetPasswordForEmail(resendEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    }).catch(() => { /* on affiche toujours le succès (anti-énumération) */ })
    setIsResending(false)
    setResendSent(true)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-[440px]">
        <DopamineWordmark />

        {/* ── Vérification du lien ── */}
        {status === 'checking' && (
          <div className="flex flex-col items-center gap-4 py-10">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-dim border-t-transparent" />
            <p className="font-body text-sm text-dark/50">{t('reset.checking')}</p>
          </div>
        )}

        {/* ── Formulaire nouveau mot de passe ── */}
        {status === 'ready' && (
          <>
            <div className="text-center">
              <h1 className="font-display text-3xl font-black tracking-tight text-dark">
                {t('reset.title')}
              </h1>
              <p className="mt-2 font-body text-sm text-dark/50">{t('reset.subtitle')}</p>
            </div>

            <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-5">
              {formError && (
                <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{formError}</div>
              )}

              <PasswordInput
                label={t('reset.new_password')}
                name="new-password"
                autoComplete="new-password"
                placeholder={t('auth.password_placeholder')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <PasswordInput
                label={t('auth.password_confirm')}
                name="confirm-password"
                autoComplete="new-password"
                placeholder={t('auth.password_confirm_placeholder')}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />

              <Button type="submit" isLoading={isSaving} className="w-full">
                {t('reset.submit')}
              </Button>
            </form>
          </>
        )}

        {/* ── Succès (brandé Dopamine, pas de redirection dashboard) ── */}
        {status === 'done' && (
          <div className="text-center">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
              <CheckCircle2 className="h-8 w-8 text-green-600" />
            </div>
            <h1 className="font-display text-3xl font-black tracking-tight text-dark">
              {t('reset.success_title')}
            </h1>
            <p className="mt-3 font-body text-sm leading-relaxed text-dark/50">
              {t('reset.success_message')}
            </p>
          </div>
        )}

        {/* ── Lien invalide / expiré → renvoi ── */}
        {status === 'invalid' && (
          resendSent ? (
            <div className="text-center">
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-accent-dim/10">
                <CheckCircle2 className="h-8 w-8 text-accent-dim" />
              </div>
              <h1 className="font-display text-3xl font-black tracking-tight text-dark">
                {t('auth.check_email')}
              </h1>
              <p className="mt-3 font-body text-sm leading-relaxed text-dark/50">
                {t('reset.resend_success')}
              </p>
            </div>
          ) : (
            <>
              <div className="text-center">
                <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-red-50">
                  <AlertTriangle className="h-8 w-8 text-red-500" />
                </div>
                <h1 className="font-display text-3xl font-black tracking-tight text-dark">
                  {t('reset.invalid_title')}
                </h1>
                <p className="mt-2 font-body text-sm text-dark/50">{t('reset.invalid_message')}</p>
              </div>

              <form onSubmit={handleResend} className="mt-8 flex flex-col gap-5">
                <Input
                  label={t('auth.email')}
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder={t('auth.email_placeholder')}
                  value={resendEmail}
                  onChange={(e) => setResendEmail(e.target.value)}
                  required
                />
                <Button type="submit" isLoading={isResending} className="w-full">
                  {t('reset.resend_submit')}
                </Button>
              </form>
            </>
          )
        )}
      </div>
    </div>
  )
}
