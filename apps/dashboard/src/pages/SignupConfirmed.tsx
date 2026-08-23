// GYM-248 — CRÉATION DE LA SALLE, juste après confirmation de l'email.
//
// Arrivée par le lien de confirmation : GoTrue dépose `#access_token=…&type=signup` et
// supabase-js échange le fragment AU CHARGEMENT. La mécanique d'établissement de session
// est celle d'AccountActivation (GYM-202/164) et n'est PAS réinventée ici :
//   · on lit le fragment capturé au niveau module (lib/signupLink.ts), jamais
//     window.location.hash — supabase-js l'a déjà consommé et nettoyé ;
//   · on ne conclut JAMAIS « invalide » de façon synchrone quand un token était présent :
//     l'échange peut être en vol. On écoute onAuthStateChange ET on relit getSession(),
//     avec un filet de 8s si un token était là, 1s sinon.
//
// ⚠️ Cette page est aussi le point de reprise d'un parcours interrompu : un gérant qui a
// fermé l'onglet avant de créer sa salle y est renvoyé à la connexion suivante (cf. la
// garde OwnerWithoutGymGate dans App.tsx). Elle doit donc fonctionner SANS fragment, sur
// une session déjà établie — d'où le `hasSession` en plus de `cameFromLink`.
import { useState, useEffect, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate, Link } from 'react-router-dom'
import { Building2, AlertTriangle, ArrowRight } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { supabase } from '@/lib/supabase'
import { signupLink } from '@/lib/signupLink'
import { mapGymCreationError, type GymCreationOutcome } from '@/lib/gymCreationErrors'
import { useAuthStore } from '@/stores/useAuthStore'
import { DEFAULT_TIMEZONE } from '@/lib/timezone'
import vinizWordmark from '@/assets/brand/viniz-wordmark.svg'

// Bornes du RPC, rejouées à l'écran : refuser AVANT l'aller-retour, où la violation
// reviendrait en PT422. Les deux doivent rester d'accord (create_gym_self_serve §e).
const NAME_MIN = 2
const NAME_MAX = 60

// 'checking'   → session en cours d'établissement (token en vol)
// 'ready'      → session valide, formulaire de création
// 'invalid'    → lien expiré ou déjà consommé
// 'no-session' → ni lien exploitable ni session → retour connexion
type Status = 'checking' | 'ready' | 'invalid' | 'no-session'

/**
 * Fuseaux proposés. `Intl.supportedValuesOf` est natif (pas de dépendance ajoutée) mais
 * n'existe pas partout : on retombe alors sur une liste courte couvrant le marché visé.
 * Le fuseau de la salle n'est pas cosmétique — GYM-93 en fait la base de TOUS les calculs
 * de dates civiles (rappels, bornes de semaine, chiffre d'affaires).
 */
function useTimezones(): string[] {
  return useState<string[]>(() => {
    const fallback = [
      'Europe/Brussels', 'Europe/Paris', 'Europe/Luxembourg', 'Europe/Amsterdam',
      'Europe/Berlin', 'Europe/Madrid', 'Europe/Lisbon', 'Europe/Rome',
      'Europe/Zurich', 'Europe/London', 'Europe/Dublin',
    ]
    try {
      const withValues = Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
      const all = withValues.supportedValuesOf?.('timeZone')
      if (all && all.length) return all
    } catch { /* API absente → liste courte */ }
    return fallback
  })[0]
}

export default function SignupConfirmed() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const initialized = useAuthStore((s) => s.initialized)
  const session = useAuthStore((s) => s.session)
  const refreshProfile = useAuthStore((s) => s.refreshProfile)
  const timezones = useTimezones()

  const cameFromLink = signupLink.isSignup || signupLink.hasToken || signupLink.hasError

  // Résolution ASYNCHRONE du fragment uniquement. Tout ce qui se déduit du rendu courant
  // (session déjà ouverte, lien en erreur, auth résolue) est DÉRIVÉ plus bas plutôt que
  // recopié ici : un setState synchrone dans un effet déclenche un rendu en cascade, et
  // surtout il duplique une information que le rendu possède déjà.
  const [linkStatus, setLinkStatus] = useState<Status>('checking')

  const [name, setName] = useState('')
  const [timezone, setTimezone] = useState<string>(() => {
    // Pré-sélection sur le fuseau du navigateur s'il est plausible, sinon Bruxelles.
    try {
      const guess = Intl.DateTimeFormat().resolvedOptions().timeZone
      if (guess) return guess
    } catch { /* ignore */ }
    return DEFAULT_TIMEZONE
  })

  const [nameError, setNameError] = useState<string | null>(null)
  const [banner, setBanner] = useState<{ message: string; outcome: GymCreationOutcome } | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  // ── Établissement de la session par le fragment (mécanique GYM-164) ──
  //
  // On n'écoute QUE dans le cas où quelque chose est réellement en vol : un lien exploitable,
  // pas encore de session, pas d'erreur annoncée. Les trois setState sont dans des callbacks
  // asynchrones (événement, promesse, timeout) — jamais dans le corps de l'effet.
  useEffect(() => {
    if (signupLink.hasError || session || !cameFromLink) return

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      if (s) setLinkStatus('ready')
    })
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setLinkStatus('ready')
    })
    // Filet GYM-164 : ne JAMAIS conclure « invalide » de façon synchrone quand un token
    // était présent — l'échange peut encore aboutir. 8s avec token, 1s sans.
    const timer = setTimeout(() => {
      setLinkStatus((s) => (s !== 'checking' ? s : signupLink.hasToken ? 'invalid' : 'no-session'))
    }, signupLink.hasToken ? 8000 : 1000)

    return () => {
      sub.subscription.unsubscribe()
      clearTimeout(timer)
    }
  }, [cameFromLink, session])

  // Statut EFFECTIF, dérivé du rendu courant. L'ordre compte : une erreur de lien annoncée
  // par GoTrue prime, puis une session déjà ouverte (reprise de parcours), puis l'attente de
  // initialize() — sans quoi un rechargement direct rebondirait vers /login à tort.
  const status: Status = signupLink.hasError
    ? 'invalid'
    : session
      ? 'ready'
      : !cameFromLink
        ? (initialized ? 'no-session' : 'checking')
        : linkStatus

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (isSaving) return
    setNameError(null)
    setBanner(null)

    const trimmed = name.trim()
    if (trimmed.length < NAME_MIN || trimmed.length > NAME_MAX) {
      setNameError(t('gym_creation.name_length_error', { min: NAME_MIN, max: NAME_MAX }))
      return
    }

    setIsSaving(true)
    const { error } = await supabase.rpc('create_gym_self_serve', {
      p_gym_name: trimmed,
      p_timezone: timezone,
    })
    setIsSaving(false)

    if (error) {
      const mapped = mapGymCreationError(error)
      // ⚠️ Aucun refus en toast générique : un nom invalide se dit SUR le champ, un
      // compte déjà rattaché propose le dashboard, un email non confirmé renvoie à
      // l'écran de confirmation. Le message générique est le dernier recours.
      if (mapped.outcome === 'invalid-name') {
        setNameError(t(mapped.messageKey))
        return
      }
      setBanner({ message: t(mapped.messageKey), outcome: mapped.outcome })
      return
    }

    // Le profil vient de changer côté SERVEUR (gym_admin + gym_id) : sans ce rappel,
    // ProtectedRoute verrait encore gym_id null et renverrait vers /pending.
    await refreshProfile()
    // Le wizard s'ouvre tout seul sur le dashboard tant que onboarding_completed est faux.
    navigate('/dashboard', { replace: true })
  }

  // ── Arrivée sans lien ET sans session : cette page n'est pas la leur ──
  if (status === 'no-session') {
    return <Navigate to={initialized && session ? '/dashboard' : '/login'} replace />
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-[440px]">
        <div className="mb-10 flex items-center justify-center">
          <img src={vinizWordmark} alt="Viniz" className="h-11 w-11 rounded-xl" />
        </div>

        {status === 'checking' && (
          <div className="flex flex-col items-center gap-4 py-10">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-dim border-t-transparent" />
            <p className="font-body text-sm text-dark/50">{t('gym_creation.checking')}</p>
          </div>
        )}

        {status === 'invalid' && (
          <div className="text-center">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-red-50">
              <AlertTriangle className="h-8 w-8 text-red-500" />
            </div>
            <h1 className="font-display text-3xl font-black tracking-tight text-dark">
              {t('gym_creation.invalid_title')}
            </h1>
            <p className="mt-2 font-body text-sm text-dark/50">
              {t('gym_creation.invalid_message')}
            </p>
            <Link
              to="/login"
              className="mt-8 inline-block font-body text-sm font-semibold text-dark transition-colors hover:text-accent-dim"
            >
              {t('auth.back_to_login')}
            </Link>
          </div>
        )}

        {status === 'ready' && (
          <>
            <div className="text-center">
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-accent-dim/10">
                <Building2 className="h-8 w-8 text-accent-dim" />
              </div>
              <h1 className="font-display text-3xl font-black tracking-tight text-dark">
                {t('gym_creation.title')}
              </h1>
              <p className="mt-2 font-body text-sm text-dark/50">
                {t('gym_creation.subtitle')}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-5">
              {banner && (
                <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">
                  <p>{banner.message}</p>
                  {/* Chaque refus porte sa sortie — jamais un cul-de-sac. */}
                  {banner.outcome === 'already-has-gym' && (
                    <Link to="/dashboard" className="mt-1 inline-flex items-center gap-1 font-semibold underline">
                      {t('gym_creation.go_dashboard')}
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  )}
                  {banner.outcome === 'email-unconfirmed' && (
                    <Link to="/signup" className="mt-1 inline-block font-semibold underline">
                      {t('gym_creation.back_to_confirm')}
                    </Link>
                  )}
                  {banner.outcome === 'needs-login' && (
                    <Link to="/login" className="mt-1 inline-block font-semibold underline">
                      {t('auth.back_to_login')}
                    </Link>
                  )}
                </div>
              )}

              <Input
                label={t('gym_creation.name_label')}
                name="gymName"
                placeholder={t('gym_creation.name_placeholder')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                error={nameError ?? undefined}
                helper={t('gym_creation.name_helper')}
                maxLength={NAME_MAX}
                required
              />

              <div className="flex flex-col gap-1.5">
                <label htmlFor="timezone" className="font-body text-sm font-semibold text-dark">
                  {t('gym_creation.timezone_label')}
                </label>
                <select
                  id="timezone"
                  name="timezone"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="w-full rounded-xl border border-[#E8E6E0] bg-card px-4 py-3 font-body text-sm text-dark outline-none transition-colors focus:border-dark"
                >
                  {/* Le fuseau deviné peut ne pas figurer dans la liste courte de repli :
                      on l'ajoute explicitement pour ne jamais afficher un champ vide. */}
                  {(timezones.includes(timezone) ? timezones : [timezone, ...timezones]).map((tz) => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </select>
                <p className="font-body text-xs text-dark/40">{t('gym_creation.timezone_helper')}</p>
              </div>

              <Button type="submit" isLoading={isSaving} className="w-full">
                {t('gym_creation.submit')}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
