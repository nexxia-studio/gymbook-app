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
import { useLocation, Link } from 'react-router-dom'
import { CheckCircle2, AlertTriangle } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { PasswordInput } from '@/components/ui/PasswordInput'
import { PasswordRules } from '@/components/ui/PasswordRules'
import { Button } from '@/components/ui/Button'
import { supabase, initialUrlHash } from '@/lib/supabase'
import { validatePassword, mapPasswordError } from '@/lib/passwordPolicy'

const MIN_PASSWORD = 8

// GYM-170 — lien de téléchargement de l'app membre.
// GYM-173 — URL publique App Store depuis l'approbation Apple : un membre ne doit plus
// passer par TestFlight (bêta fermée, places limitées, app tierce à installer).
//
// Le segment /be/ est OBLIGATOIRE, NE PAS le retirer en le croyant superflu : la
// distribution de l'app est limitée aux 42 pays européens. Sans code pays, Apple retombe
// sur la boutique US — où l'app n'existe pas — et renvoie une 404. L'erreur est invisible
// sur iPhone (la boutique du compte, belge, est utilisée) mais frappe tout membre qui
// ouvre cette page depuis un navigateur desktop.
const APP_DOWNLOAD_URL = 'https://apps.apple.com/be/app/dopamine-performance-club/id6781670485'

// ═══════════════════════════════════════════════════════════════════════════════════════
// 🔴 GYM-303 — CETTE PAGE ÉTAIT BRANDÉE DOPAMINE POUR TOUT LE MONDE
// ═══════════════════════════════════════════════════════════════════════════════════════
// C'est ELLE que Antoine a vue, et non l'infra de liens : mesuré avant ce lot,
// links.viniz.app rendait un 404 NU (79 octets) pour les autres salles, sans marque. La
// marque Dopamine venait d'ici — mot-marque `DOPAMINE` en lime, et lien de téléchargement
// vers l'app Dopamine sur l'App Store.
//
// Or cette page est atteinte par TOUT LE MONDE, et par quatre chemins distincts :
//   · les membres de Dopamine, relayés depuis links.viniz.app/dopamine/reset-password ;
//   · les membres de TOUTE AUTRE salle, relayés depuis /<slug>/reset-password (GYM-303) ;
//   · les GÉRANTS de toute salle (ForgotPassword → `${origin}/reset-password`) ;
//   · tout membre créé par `admin-create-member`, quelle que soit sa salle.
// Les trois derniers voyaient donc la marque d'un client qui n'est pas le leur, et se
// voyaient proposer le téléchargement d'une app où ils n'ont pas de compte.
//
// ⚠️ LE CONTEXTE VIENT DE `?gym=<slug>`, ET DE RIEN D'AUTRE. Vérifié dans le dépôt, pas
// supposé : le lien de reset MEMBRE porte le slug dans son CHEMIN
// (`apps/mobile/lib/gymUrls.ts` → `${LINKS_BASE}/${slug}/reset-password`), et les pages de
// relais de `apps/links` le transmettent ici en query. Le lien GÉRANT, lui, ne porte AUCUN
// contexte (`${window.location.origin}/reset-password`) : il rend donc le neutre, ce qui
// est exactement ce qu'il doit rendre.
//
// ⚠️ ET LE NEUTRE EST LE DÉFAUT, PAS L'EXCEPTION. Sans paramètre, sans slug reconnu, sur un
// lien ancien : Viniz. Une page qui retomberait sur Dopamine « au cas où » reproduirait le
// défaut exact qu'on corrige, en le rendant plus difficile à voir.
const DOPAMINE_SLUG = 'dopamine'

/**
 * 🔴 GYM-303b — LES QUATRE PHRASES QUI CITAIENT DOPAMINE, ET POURQUOI DEUX JEUX DE CLÉS.
 *
 * #238 avait rendu le MOT-MARQUE et le LIEN du bouton dépendants du contexte, mais pas les
 * TEXTES : quatre chaînes de traduction nommaient Dopamine en dur. Un membre de Studio Yoga
 * lisait donc « ton compte Dopamine » sur le formulaire, puis « Réserve tes cours depuis
 * l'application Dopamine » après avoir réussi — sous un mot-marque ViNiZ. L'écran se
 * contredisait lui-même.
 *
 * ⚠️ ET LA FUITE N'ÉTAIT PAS QUE DANS L'ÉTAT DE SUCCÈS. `reset.subtitle` est affichée sur le
 * FORMULAIRE, à l'entrée — l'état que le ticket croyait couvert. Le balayage demandé l'a
 * trouvée ; la relecture de #238 ne l'avait pas vue parce qu'elle portait sur le JSX, et que
 * cette phrase-là vit dans un fichier de traduction.
 *
 * ⚠️ DEUX JEUX DE CLÉS PLUTÔT QU'UNE INTERPOLATION `{{app}}`. Insérer un nom de marque dans
 * une phrase suppose que la phrase reste juste quel que soit ce nom — or « ton compte
 * Viniz » serait FAUX : le membre a un compte chez SA salle, pas chez Viniz. Le neutre ne
 * nomme donc personne, et c'est ce qui le rend vrai partout. Les clés d'origine restent
 * intactes, mot pour mot : Dopamine ne bouge pas d'un caractère.
 */
function useResetCopy(estDopamine: boolean) {
  const { t } = useTranslation()
  const cle = (base: string) => (estDopamine ? `reset.${base}` : `reset.${base}_neutral`)
  return {
    subtitle: t(cle('subtitle')),
    successMessage: t(cle('success_message')),
    nextStepText: t(cle('next_step_text')),
    downloadApp: t(cle('download_app')),
  }
}
const VINIZ_APP_URL = 'https://viniz.app'

/** Le contexte de salle porté par le lien, ou `null` — jamais deviné. */
function useGymContext(): string | null {
  const { search } = useLocation()
  const slug = new URLSearchParams(search).get('gym')?.trim().toLowerCase()
  return slug ? slug : null
}

type Status = 'checking' | 'ready' | 'invalid' | 'done'

/**
 * Le mot-marque de la page : celui de la salle quand le lien le dit, celui de Viniz sinon.
 *
 * ⚠️ LE LIME NE VA QUE SUR FOND SOMBRE, et les deux pastilles respectent la règle : le
 * `#111111` de Dopamine et le Violet Ink `#2D1B69` de Viniz sont l'un et l'autre des fonds
 * sombres. C'est la même contrainte que le garde-fou de l'app applique aux salles.
 */
function Wordmark({ dopamine }: { dopamine: boolean }) {
  return (
    <div className="mb-10 flex items-center justify-center">
      {dopamine ? (
        <span className="rounded-xl bg-[#111111] px-4 py-2 font-display text-lg font-black tracking-[0.2em] text-[#C8F000]">
          DOPAMINE
        </span>
      ) : (
        <span className="rounded-xl bg-[#2D1B69] px-4 py-2 font-display text-lg font-black tracking-[0.2em] text-[#C8FF3D]">
          ViNiZ
        </span>
      )}
    </div>
  )
}

export default function ResetPassword() {
  const { t } = useTranslation()
  // 🔴 GYM-303 — trois états : Dopamine si le lien le dit, Viniz neutre sinon.
  const gym = useGymContext()
  const estDopamine = gym === DOPAMINE_SLUG
  const copy = useResetCopy(estDopamine)
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
      const { error } = await supabase.auth.updateUser({ password })
      if (error) {
        setFormError(t(mapPasswordError(error.message)))
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
        <Wordmark dopamine={estDopamine} />

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
              <p className="mt-2 font-body text-sm text-dark/50">{copy.subtitle}</p>
            </div>

            <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-5">
              {formError && (
                <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{formError}</div>
              )}

              <div className="flex flex-col gap-2">
                <PasswordInput
                  label={t('reset.new_password')}
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
              {copy.successMessage}
            </p>

            {/* GYM-170 — inviter au téléchargement de l'app (moment clé d'activation).
                🔴 GYM-303 — L'APP DOPAMINE N'EST PROPOSÉE QUE SI LE CONTEXTE EST DOPAMINE.
                Envoyer un membre de Studio Kama sur la fiche App Store de Dopamine, c'est
                l'envoyer télécharger une app où il n'a pas de compte — le pire moment pour
                ça étant précisément celui où il vient de réussir à récupérer le sien. */}
            <div className="mt-8 border-t border-[#E8E6E0] pt-6">
              <p className="font-body text-sm font-bold text-dark">{t('reset.next_step_title')}</p>
              <p className="mt-1 font-body text-sm text-dark/50">{copy.nextStepText}</p>
              <a
                href={estDopamine ? APP_DOWNLOAD_URL : VINIZ_APP_URL}
                className={
                  estDopamine
                    ? 'mt-4 inline-block rounded-xl bg-[#111111] px-6 py-3 font-ui text-sm font-bold text-[#C8F000] transition-opacity hover:opacity-90'
                    : 'mt-4 inline-block rounded-xl bg-[#2D1B69] px-6 py-3 font-ui text-sm font-bold text-[#C8FF3D] transition-opacity hover:opacity-90'
                }
              >
                {copy.downloadApp}
              </a>
              {/* CTA demandé par l'arbitrage : revenir se connecter, quel que soit le
                  contexte — c'est la suite naturelle après un mot de passe redéfini. */}
              <div className="mt-4">
                <Link to="/login" className="font-body text-sm text-dark/50 underline">
                  {t('reset.back_to_login')}
                </Link>
              </div>
            </div>
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
