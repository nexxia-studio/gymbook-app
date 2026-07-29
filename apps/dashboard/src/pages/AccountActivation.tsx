// GYM-202 — Activation d'un compte créé par INVITATION.
//
// Problème résolu (constaté en prod le 29/07) : le lien d'invitation Supabase ouvre une
// session immédiatement, sans jamais demander de mot de passe. Le dashboard voyait un
// utilisateur authentifié, sans gym_id, et le renvoyait vers /pending : le compte restait à
// moitié créé — session ouverte une seule fois, aucun mot de passe utilisable ensuite, donc
// plus aucune reconnexion possible. /reset-password (GYM-157/164) ne traite que le type
// 'recovery' ; une invitation est de type 'invite' et n'était gérée par AUCUN écran.
//
// Cette page est le seul endroit où un invité pose son mot de passe. Le détournement de
// l'arrivée se fait en amont, dans App.tsx (InviteGate), AVANT que ProtectedRoute ne décide
// la redirection vers /pending.
//
// Modèle suivi : pages/ResetPassword.tsx (détection de session, timeouts GYM-164,
// PasswordRules GYM-166, écran de renvoi de lien).
//
// ⚠️ SÉCURITÉ — le rôle et la salle sont AFFICHÉS EN LECTURE SEULE et ne sont jamais
// écrits depuis ce client : ils sont scellés dans l'invitation (GYM-200). Un rôle
// auto-déclaré est une faille — un compte gym_admin non autorisé a déjà été créé en prod
// via la page d'inscription publique. On n'écrit ici que first_name / last_name / phone.
import { useState, useEffect, useRef, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate } from 'react-router-dom'
import { CheckCircle2, AlertTriangle } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { PasswordInput } from '@/components/ui/PasswordInput'
import { PasswordRules } from '@/components/ui/PasswordRules'
import { Button } from '@/components/ui/Button'
import { supabase } from '@/lib/supabase'
import { validatePassword, mapPasswordError } from '@/lib/passwordPolicy'
import { inviteLink, markInviteConsumed, ACTIVATION_PATH } from '@/lib/inviteLink'
import { useAuthStore } from '@/stores/useAuthStore'
import { useGymStore } from '@/stores/useGymStore'
import vinizWordmark from '@/assets/brand/viniz-wordmark.svg'

const MIN_PASSWORD = 8

// 'checking'   → session en cours d'établissement (token en vol)
// 'ready'      → session valide, formulaire d'activation
// 'invalid'    → lien expiré ou déjà consommé → renvoi d'un nouveau lien
// 'no-session' → arrivée sans session exploitable → retour connexion, sans dramatiser
type Status = 'checking' | 'ready' | 'invalid' | 'no-session'

interface InviteContext {
  gymId: string | null
  gymName: string | null
  role: string | null
}

export default function AccountActivation() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const initialized = useAuthStore((s) => s.initialized)
  const session = useAuthStore((s) => s.session)
  const setGymContext = useAuthStore((s) => s.setGymContext)
  const storeGym = useGymStore((s) => s.gym)

  // Un fragment d'erreur est connu dès le premier rendu (constante de module) : on part
  // directement sur 'invalid' plutôt que de faire clignoter l'écran de vérification.
  const [status, setStatus] = useState<Status>(() => (inviteLink.hasError ? 'invalid' : 'checking'))
  const [context, setContext] = useState<InviteContext | null>(null)

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  // Le mot de passe a déjà été posé avec succès lors d'une tentative précédente : ne pas
  // rejouer updateUser() si seule la mise à jour du profil a échoué — Supabase répondrait
  // « New password should be different from the old password » et l'invité serait bloqué.
  const passwordDone = useRef(false)

  // Renvoi de lien (état 'invalid') — même mécanisme que ResetPassword.
  const [resendEmail, setResendEmail] = useState('')
  const [resendSent, setResendSent] = useState(false)
  const [isResending, setIsResending] = useState(false)

  // Cette page n'a de sens QUE sur une arrivée par lien. Sans fragment, on ne l'affiche
  // pas : un utilisateur déjà activé qui taperait /welcome ne doit jamais voir ce
  // formulaire. (initialUrlHash est capturé au niveau module — cf. lib/inviteLink.ts.)
  const cameFromLink = inviteLink.hasToken || inviteLink.hasError || inviteLink.isInvite

  // ── Établissement de la session ──
  // GYM-164 — ne JAMAIS conclure « invalide » de façon synchrone quand un token était
  // présent : l'échange peut encore être en vol. On écoute l'événement ET on relit
  // getSession() (l'événement a pu partir avant le montage), avec un filet de sécurité :
  // 8s quand un token était présent, 1s sinon.
  useEffect(() => {
    // Lien expiré / déjà consommé : rien à attendre, l'état initial vaut déjà 'invalid'.
    if (!cameFromLink || inviteLink.hasError) return

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      if (s) setStatus('ready')
    })

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setStatus('ready')
    })

    const timer = setTimeout(() => {
      setStatus((s) => (s !== 'checking' ? s : inviteLink.hasToken ? 'invalid' : 'no-session'))
    }, inviteLink.hasToken ? 8000 : 1000)

    return () => {
      sub.subscription.unsubscribe()
      clearTimeout(timer)
    }
  }, [cameFromLink])

  // ── Contexte de l'invitation (salle + rôle), en LECTURE SEULE ──
  // Lu directement depuis le profil plutôt que depuis le store : celui-ci est alimenté par
  // initialize() dont le timing n'est pas garanti sur cette arrivée particulière.
  useEffect(() => {
    if (status !== 'ready') return
    let cancelled = false

    void (async () => {
      const { data: userData } = await supabase.auth.getUser()
      const user = userData.user
      if (!user || cancelled) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('gym_id, role, first_name, last_name, phone')
        .eq('id', user.id)
        .single()
      if (cancelled) return

      // Pré-remplissage : l'invitation peut déjà porter prénom/nom (GYM-200).
      if (profile?.first_name) setFirstName(profile.first_name)
      if (profile?.last_name) setLastName(profile.last_name)
      if (profile?.phone) setPhone(profile.phone)

      const gymId = profile?.gym_id ?? null
      let gymName = storeGym?.id === gymId ? storeGym.name : null
      if (gymId && !gymName) {
        const { data: gym } = await supabase
          .from('nexxia_gyms')
          .select('name')
          .eq('id', gymId)
          .single()
        gymName = gym?.name ?? null
      }
      if (!cancelled) setContext({ gymId, gymName, role: profile?.role ?? null })
    })()

    return () => { cancelled = true }
    // storeGym n'est qu'un raccourci de cache : on ne relance pas la lecture s'il change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  // Le fragment d'invitation ne doit plus détourner la navigation une fois qu'on quitte
  // cette page, sinon /login rebondirait indéfiniment vers /welcome.
  useEffect(() => {
    if (status === 'no-session') markInviteConsumed()
  }, [status])

  const { valid: passwordValid } = validatePassword(password, MIN_PASSWORD)
  const isFormValid =
    passwordValid &&
    password === confirm &&
    firstName.trim().length > 0 &&
    lastName.trim().length > 0

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (isSaving) return
    setFormError(null)

    const { valid, failed } = validatePassword(password, MIN_PASSWORD)
    if (!valid) {
      const missing = failed.map((id) => t(`auth.password_rules.${id}`, { count: MIN_PASSWORD })).join(' · ')
      setFormError(`${t('auth.password_errors.missing_prefix')} ${missing}`)
      return
    }
    if (password !== confirm) {
      setFormError(t('auth.validation.password_mismatch'))
      return
    }

    setIsSaving(true)
    try {
      // 1. Le mot de passe — c'est LUI qui rend le compte réutilisable.
      if (!passwordDone.current) {
        const { error } = await supabase.auth.updateUser({ password })
        if (error) {
          // GYM-166 — mapping partagé des erreurs serveur.
          setFormError(t(mapPasswordError(error.message)))
          return
        }
        passwordDone.current = true
      }

      // 2. L'identité. JAMAIS role ni gym_id : ils viennent de l'invitation.
      const { data: userData } = await supabase.auth.getUser()
      const user = userData.user
      if (!user) {
        setFormError(t('auth.password_errors.expired'))
        return
      }

      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          phone: phone.trim() || null,
        })
        .eq('id', user.id)
      if (profileError) {
        setFormError(t('activation.error_profile'))
        return
      }

      // 3. Entrée dans le dashboard. Le fragment d'invitation ne doit plus rien détourner.
      markInviteConsumed()
      if (context?.gymId && context.role) setGymContext(context.gymId, context.role)
      navigate(context?.gymId ? '/dashboard' : '/pending', { replace: true })
    } catch {
      setFormError(t('activation.error_generic'))
    } finally {
      setIsSaving(false)
    }
  }

  async function handleResend(e: FormEvent) {
    e.preventDefault()
    if (isResending) return
    setIsResending(true)
    // Un compte invité sans mot de passe reste joignable par lien de récupération : celui-ci
    // rouvre une session et ramène ici pour terminer l'activation.
    await supabase.auth.resetPasswordForEmail(resendEmail, {
      redirectTo: `${window.location.origin}${ACTIVATION_PATH}`,
    }).catch(() => { /* on affiche toujours le succès (anti-énumération) */ })
    setIsResending(false)
    setResendSent(true)
  }

  // ── Arrivée directe, sans lien : cette page n'est pas la leur ──
  if (!cameFromLink) {
    if (!initialized) return <Loader />
    return <Navigate to={session ? '/' : '/login'} replace />
  }

  // ── Lien sans session exploitable : retour connexion, sans écran anxiogène ──
  if (status === 'no-session') {
    return <Navigate to="/login" replace />
  }

  const roleLabel = context?.role
    ? t(`activation.role_labels.${context.role}`, { defaultValue: context.role })
    : null

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-[440px]">
        <div className="mb-10 flex items-center justify-center">
          <img src={vinizWordmark} alt="Viniz" className="h-11 w-11 rounded-xl" />
        </div>

        {/* ── Vérification du lien ── */}
        {status === 'checking' && (
          <div className="flex flex-col items-center gap-4 py-10">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-dim border-t-transparent" />
            <p className="font-body text-sm text-dark/50">{t('activation.checking')}</p>
          </div>
        )}

        {/* ── Formulaire d'activation ── */}
        {status === 'ready' && (
          <>
            <div className="text-center">
              <h1 className="font-display text-3xl font-black tracking-tight text-dark">
                {t('activation.title')}
              </h1>
              <p className="mt-2 font-body text-sm text-dark/50">
                {t('activation.subtitle')}
              </p>
            </div>

            {/* Salle + rôle : LECTURE SEULE, jamais modifiables ici. Formulation neutre
                quand l'invitation ne porte pas de salle (invitation Supabase Studio). */}
            <div className="mt-6 rounded-xl border border-[#E8E6E0] bg-card px-4 py-3">
              {context?.gymName ? (
                <>
                  <p className="font-body text-xs uppercase tracking-wide text-dark/40">
                    {t('activation.joining')}
                  </p>
                  <p className="mt-1 font-body text-sm font-bold text-dark">{context.gymName}</p>
                </>
              ) : (
                <p className="font-body text-sm text-dark/60">{t('activation.no_gym')}</p>
              )}
              {roleLabel && (
                <p className="mt-2 font-body text-xs text-dark/50">
                  {t('activation.role')} <span className="font-semibold text-dark/70">{roleLabel}</span>
                </p>
              )}
            </div>

            <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-5">
              {formError && (
                <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{formError}</div>
              )}

              <div className="flex flex-col gap-2">
                <PasswordInput
                  label={t('activation.password')}
                  name="new-password"
                  autoComplete="new-password"
                  placeholder={t('auth.password_placeholder')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <PasswordRules password={password} minLength={MIN_PASSWORD} />
              </div>
              <PasswordInput
                label={t('auth.password_confirm')}
                name="confirm-password"
                autoComplete="new-password"
                placeholder={t('auth.password_confirm_placeholder')}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />

              <div className="grid grid-cols-2 gap-4">
                <Input
                  label={t('auth.first_name')}
                  name="first-name"
                  autoComplete="given-name"
                  placeholder={t('auth.first_name_placeholder')}
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                />
                <Input
                  label={t('auth.last_name')}
                  name="last-name"
                  autoComplete="family-name"
                  placeholder={t('auth.last_name_placeholder')}
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                />
              </div>
              <Input
                label={t('auth.phone_optional')}
                name="phone"
                type="tel"
                autoComplete="tel"
                placeholder={t('auth.phone_placeholder')}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />

              <Button type="submit" isLoading={isSaving} disabled={!isFormValid} className="w-full">
                {t('activation.submit')}
              </Button>
            </form>
          </>
        )}

        {/* ── Lien expiré / déjà consommé → renvoi ── */}
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
                {t('activation.resend_success')}
              </p>
            </div>
          ) : (
            <>
              <div className="text-center">
                <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-red-50">
                  <AlertTriangle className="h-8 w-8 text-red-500" />
                </div>
                <h1 className="font-display text-3xl font-black tracking-tight text-dark">
                  {t('activation.invalid_title')}
                </h1>
                <p className="mt-2 font-body text-sm text-dark/50">
                  {t('activation.invalid_message')}
                </p>
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
                  {t('activation.resend_submit')}
                </Button>
              </form>
            </>
          )
        )}
      </div>
    </div>
  )
}

function Loader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent-dim border-t-transparent" />
    </div>
  )
}
