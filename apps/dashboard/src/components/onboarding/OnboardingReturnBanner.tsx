import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useOnboarding } from '@/hooks/useOnboarding'
import { ONBOARDING_LAST_STEP } from '@/lib/onboarding'

/**
 * ╔═══════════════════════════════════════════════════════════════════════════════════════╗
 * ║  LE CHEMIN DU RETOUR — il manquait, et c'était cinq occasions d'abandonner            ║
 * ╚═══════════════════════════════════════════════════════════════════════════════════════╝
 *
 * 🔴 LE DÉFAUT. L'assistant envoyait le gérant sur l'écran qui sait faire (Réglages,
 * planning, membres) et l'y laissait. Rien n'était perdu — `dismiss()` ferme pour la
 * session sans toucher à l'étape, et l'étape se valide PAR L'OBJET au retour — mais rien
 * ne RAMENAIT : il fallait penser à cliquer « Tableau de bord ». Sur SIX étapes, cinq
 * partaient ainsi. Cinq allers-retours, donc cinq occasions d'abandonner.
 *
 * ⚠️ LES ÉTAPES 2 ET 3 N'EN ONT PLUS BESOIN : elles ouvrent désormais leur modale
 * AU-DESSUS du dashboard, et le gérant ne quitte plus le fil. Ce bandeau ne sert donc que
 * les étapes 4 à 6 — planning, politique d'absences, membres — qui sont de VRAIS écrans et
 * non des formulaires, et qu'il aurait été absurde d'enfermer dans une modale.
 *
 * ⚠️ IL NE S'AFFICHE PAS SUR LE DASHBOARD. L'assistant y est déjà : un bandeau qui dit
 * « reviens à la configuration » juste au-dessus de la configuration serait du bruit.
 *
 * ⚠️ IL N'AVANCE RIEN ET NE FERME RIEN. C'est un lien, pas une action : cliquer ramène,
 * et l'étape reste validée par l'objet. La règle du premier parcours E2E — « une étape
 * n'est pas franchie parce qu'on a cliqué » — vaut aussi pour le chemin du retour.
 */
export function OnboardingReturnBanner() {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const { step, completed, isOpen } = useOnboarding()

  // `isOpen` porte déjà « salle chargée, non terminé, non masqué pour cette session ».
  // On y ajoute les deux seules conditions propres à ce bandeau.
  if (completed !== false || !isOpen || step === null) return null
  if (step < 4) return null
  if (pathname === '/dashboard') return null

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-accent-dim/5 px-4 py-2.5 lg:px-6">
      <p className="font-body text-sm text-dark">
        <strong className="font-semibold">
          {t('onboarding.step_counter', { current: step, total: ONBOARDING_LAST_STEP })}
        </strong>{' '}
        {t('onboarding.return_hint')}
      </p>
      <Link
        to="/dashboard"
        className="ml-auto inline-flex shrink-0 items-center gap-1.5 font-body text-sm font-semibold text-accent-dim underline underline-offset-4 hover:opacity-80"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        {t('onboarding.return_cta')}
      </Link>
    </div>
  )
}
